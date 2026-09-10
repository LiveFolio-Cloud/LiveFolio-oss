import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAuthContext } from '@/lib/auth';
import { supabaseAdmin, transformFolioRecord, transformToFolioRecord } from '@/lib/supabase';
import { isOSS } from '@/lib/env';
import { resolveGateConfig } from '@/lib/gating/config';
import { hasActiveGrant } from '@/lib/gating/grants';
import { extractUUIDFromSlug } from '@/lib/utils';
import { embedTraceMarker } from '@/lib/folio-keys';

export const dynamic = 'force-dynamic';

/**
 * POST /api/files/[id]/duplicate — a buyer copies a paid folio into their
 * own account. Allowed only with an ACTIVE grant AND the gate's allowCopy
 * flag (seller-controlled, default off). Owner/members bypass (they create
 * freely in the studio).
 *
 * Copies every version verbatim plus the content-addressed storage objects
 * (asset:// pointers) from the seller's bucket path into the buyer's org
 * path under the new folio id. The copy lands as a DRAFT in the buyer's
 * account — they own it from there.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (isOSS) {
    return NextResponse.json({ error: 'Not available in OSS mode.' }, { status: 403 });
  }
  try {
    const { userId, orgId } = await getAuthContext();
    if (!userId || !orgId) {
      return NextResponse.json({ error: 'Sign in to duplicate.' }, { status: 401 });
    }
    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'Database connection unavailable.' }, { status: 500 });
    }

    const { id } = await context.params;
    const queryId = extractUUIDFromSlug(id);

    const { data: row, error } = await supabaseAdmin
      .from('folios')
      .select('*')
      .eq('id', queryId)
      .maybeSingle();
    if (error || !row) {
      return NextResponse.json({ error: 'Folio not found.' }, { status: 404 });
    }

    const folio = transformFolioRecord(row);
    const sellerOrgId = folio.organization_id as string;

    // Owner/member bypass — the creator's own team duplicates freely.
    const { data: membership } = await supabaseAdmin
      .from('organization_members')
      .select('id')
      .eq('organization_id', sellerOrgId)
      .eq('user_id', userId)
      .limit(1);
    const isMember = !!(membership && membership.length > 0);

    if (!isMember) {
      const gate = await resolveGateConfig({
        paid_access: folio.paidAccess,
        project_id: folio.projectId,
        organization_id: sellerOrgId,
      });
      const granted =
        (await hasActiveGrant(userId, 'folio', folio.id)) ||
        (!folio.paidAccess && folio.projectId
          ? await hasActiveGrant(userId, 'workspace', folio.projectId)
          : false);
      if (!granted || !gate?.config.enabled || gate.config.allowCopy !== true) {
        return NextResponse.json({ error: 'Duplication is not enabled for this folio.' }, { status: 403 });
      }
    }

    // The copy: fresh id, fresh identity — the buyer owns it from here.
    const newId = crypto.randomUUID();
    const copied: typeof folio = {
      ...JSON.parse(JSON.stringify(folio)),
      id: newId,
      organization_id: orgId,
      title: folio.title ? `${folio.title} (copy)` : 'Untitled (copy)',
      projectId: null,
      folderId: null,
      slug: null,
      status: 'draft',
      isPrivate: false,
      accessKey: undefined,
      publicTunnelEnabled: undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Buyer copies are stamped with an invisible trace marker in every HTML
    // file of every carried version — a leaked copy identifies its buyer.
    // (Member/team duplicates are not stamped.)
    if (!isMember) {
      const buyerId = userId;
      for (const v of copied.versions) {
        for (const key of Object.keys(v.files)) {
          const fileValue = v.files[key];
          if (/\.html?$/i.test(key)) {
            const stamped = embedTraceMarker(String(fileValue), {
              f: folio.id, // the seller folio this content came from
              u: buyerId,
              k: 'copy',
              t: Date.now(),
            });
            if (stamped !== fileValue) v.files[key] = stamped;
          }
        }
      }
    }

    // Copy content-addressed assets into the buyer's storage path so the
    // raw route (which resolves assets by {orgId}/{folioId}/) keeps serving.
    const hashes = new Set<string>();
    for (const v of copied.versions) {
      for (const value of Object.values(v.files)) {
        if (typeof value === 'string' && value.startsWith('asset://')) {
          const hash = value.replace('asset://sha256-', '');
          if (/^[0-9a-f]{64}(?:\.[a-z0-9]{1,8})?$/i.test(hash)) hashes.add(hash);
        }
      }
    }
    let copyErrors = 0;
    for (const hash of Array.from(hashes)) {
      const { error: cpErr } = await supabaseAdmin.storage
        .from('folio-assets')
        .copy(`${sellerOrgId}/${folio.id}/${hash}`, `${orgId}/${newId}/${hash}`);
      if (cpErr) copyErrors++;
    }
    if (copyErrors > 0) {
      console.error(`[duplicate] ${copyErrors}/${hashes.size} assets failed to copy for folio ${newId}`);
    }

    const { error: insertErr } = await supabaseAdmin
      .from('folios')
      .insert(transformToFolioRecord(copied, orgId));

    if (insertErr) {
      console.error('Duplicate insert failed:', insertErr.message);
      return NextResponse.json({ error: 'Could not create the copy.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, projectId: newId });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: err may be any thrown value; only err?.message is read
  } catch (err: any) {
    console.error('Duplicate failed:', err?.message || err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
