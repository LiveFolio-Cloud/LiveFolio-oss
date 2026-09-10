import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth';
import { supabaseAdmin, transformFolioRecord } from '@/lib/supabase';
import { isOSS } from '@/lib/env';
import { resolveGateConfig } from '@/lib/gating/config';
import { hasActiveGrant } from '@/lib/gating/grants';
import { buildZip } from '@/lib/gating/zip';
import { extractUUIDFromSlug } from '@/lib/utils';
import { embedTraceMarker } from '@/lib/folio-keys';

export const dynamic = 'force-dynamic';

/**
 * GET /api/files/[id]/download — buyer-side ZIP export of a paid folio.
 *
 * Allowed only when the viewer holds an ACTIVE grant AND the gate's
 * allowDownload flag is on (seller-controlled; default off). Owner/members
 * bypass (they already export from the studio). Enforcement is server-side —
 * the button hiding client-side is cosmetic only.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (isOSS) {
    return NextResponse.json({ error: 'Not available in OSS mode.' }, { status: 403 });
  }
  try {
    const { userId } = await getAuthContext();
    if (!userId) {
      return NextResponse.json({ error: 'Sign in to download.' }, { status: 401 });
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
    const orgId = folio.organization_id as string;

    // Owner/member bypass
    const { data: membership } = await supabaseAdmin
      .from('organization_members')
      .select('id')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .limit(1);
    const isMember = !!(membership && membership.length > 0);

    if (!isMember) {
      // Buyer path: active grant + allowDownload on the effective gate.
      const gate = await resolveGateConfig({
        paid_access: folio.paidAccess,
        project_id: folio.projectId,
        organization_id: orgId,
      });
      const granted =
        (await hasActiveGrant(userId, 'folio', folio.id)) ||
        (!folio.paidAccess && folio.projectId
          ? await hasActiveGrant(userId, 'workspace', folio.projectId)
          : false);
      if (!granted || !gate?.config.enabled || gate.config.allowDownload !== true) {
        return NextResponse.json({ error: 'Download is not enabled for this folio.' }, { status: 403 });
      }
    }

    // Resolve every file of the latest version to bytes: inline data URLs
    // decode directly; asset:// pointers download from Supabase Storage.
    const latest = folio.versions[folio.versions.length - 1];
    if (!latest) {
      return NextResponse.json({ error: 'This folio has no content yet.' }, { status: 404 });
    }

    const entries: { name: string; data: Buffer }[] = [];
    const fileNames = Object.keys(latest.files);
    // Buyer downloads are stamped with an invisible trace marker (member
    // exports — the seller's own team — are not).
    const buyerExport = !isMember;
    for (const name of fileNames) {
      let value = latest.files[name];

      // HTML text files only — assets and binaries pass through untouched.
      if (buyerExport && /\.html?$/i.test(name)) {
        const stamped = embedTraceMarker(value, {
          f: folio.id,
          u: userId,
          k: 'download',
          t: Date.now(),
        });
        if (stamped !== value) value = stamped;
      }

      if (value.startsWith('data:')) {
        const m = value.match(/^data:[^;]+;base64,(.+)$/);
        if (m) entries.push({ name, data: Buffer.from(m[1], 'base64') });
        continue;
      }

      if (value.startsWith('asset://')) {
        const hash = value.replace('asset://sha256-', '');
        if (!/^[0-9a-f]{64}(?:\.[a-z0-9]{1,8})?$/i.test(hash)) continue;
        const { data: blob, error: dlErr } = await supabaseAdmin.storage
          .from('folio-assets')
          .download(`${orgId}/${folio.id}/${hash}`);
        if (!dlErr && blob) {
          entries.push({ name, data: Buffer.from(await blob.arrayBuffer()) });
        }
        continue;
      }

      // Legacy latin1-encoded binary (extractBase64Images bug) — reconstruct.
      const imageExt = /\.(png|jpg|jpeg|gif|webp|ico|bmp)$/i.test(name);
      const hasHighBytes = Array.from(value).some((ch) => ch.charCodeAt(0) > 127);
      if (imageExt && hasHighBytes) {
        entries.push({ name, data: Buffer.from(value, 'latin1') });
      } else {
        entries.push({ name, data: Buffer.from(value, 'utf8') });
      }
    }

    if (entries.length === 0) {
      return NextResponse.json({ error: 'This folio has no downloadable files.' }, { status: 404 });
    }

    const zip = buildZip(entries);
    const safeTitle = (folio.title || 'folio').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'folio';

    return new NextResponse(new Uint8Array(zip), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${safeTitle}.zip"`,
        'Content-Length': String(zip.length),
        'Cache-Control': 'no-store',
      },
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: err may be any thrown value; only err?.message is read
  } catch (err: any) {
    console.error('Download failed:', err?.message || err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
