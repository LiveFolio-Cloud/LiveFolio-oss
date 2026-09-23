import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAuthContext } from '@/lib/auth';
import { supabaseAdmin, transformFolioRecord, transformToFolioRecord } from '@/lib/supabase';
import { isOSS } from '@/lib/env';
import { resolveGateConfig } from '@/lib/gating/config';
import { hasActiveGrant } from '@/lib/gating/grants';
import { extractUUIDFromSlug } from '@/lib/utils';
import { embedTraceMarker } from '@/lib/folio-keys';
import { err } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * Bounded fan-out for the asset copies below. Each `storage.copy` is one round
 * trip, so the old serial loop made an image-heavy folio pay one sequential
 * round trip per asset on the duplication path. Capped rather than an
 * unbounded `Promise.all`, which would open one socket per asset for a
 * 200-asset folio.
 */
const ASSET_COPY_CONCURRENCY = 6;

/**
 * `Promise.all` over a fixed pool of `limit` workers, preserving input order.
 *
 * Same idiom as `mapWithConcurrency` in `lib/process-upload.ts` (which is
 * module-private, hence the local copy). Fail-fast, matching a serial loop:
 * the FIRST rejection stops new work being claimed and is rethrown once every
 * worker has drained, so no rejection escapes unobserved.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  type Outcome = { ok: true; value: R } | { ok: false; error: unknown };

  const outcomes = new Array<Outcome>(items.length);
  // Held on an object so TypeScript does not narrow these across the awaits
  // below (they are mutated from inside the worker closure).
  const state: { halted: boolean; error?: unknown } = { halted: false };
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (state.halted) return;
      const index = next++;
      if (index >= items.length) return;
      try {
        outcomes[index] = { ok: true, value: await fn(items[index]) };
      } catch (error) {
        outcomes[index] = { ok: false, error };
        if (!state.halted) {
          state.halted = true;
          state.error = error;
        }
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));

  if (state.halted) throw state.error;
  return outcomes.map((outcome) => (outcome as { ok: true; value: R }).value);
}

/**
 * POST /api/files/[id]/duplicate — a buyer copies a paid folio into their
 * own account. Allowed only with an ACTIVE grant AND the gate's allowCopy
 * flag (seller-controlled, default off). Owner/members bypass (they create
 * freely in the editor).
 *
 * Copies every version verbatim plus the content-addressed storage objects
 * (asset:// pointers) from the seller's bucket path into the buyer's org
 * path under the new folio id. The copy lands as a DRAFT in the buyer's
 * account — they own it from there.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (isOSS) {
    return err('Not available in OSS mode.', { status: 403 });
  }
  try {
    const { userId, orgId } = await getAuthContext();
    if (!userId || !orgId) {
      return err('Sign in to duplicate.', { status: 401 });
    }
    if (!supabaseAdmin) {
      return err('Database connection unavailable.', { status: 500 });
    }

    const { id } = await context.params;
    const queryId = extractUUIDFromSlug(id);

    const { data: row, error } = await supabaseAdmin
      .from('folios')
      .select('*')
      .eq('id', queryId)
      .maybeSingle();
    if (error || !row) {
      return err('Folio not found.', { status: 404 });
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
        return err('Duplication is not enabled for this folio.', { status: 403 });
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
    // Order-independent by construction: `hashes` is a Set (so no two copies
    // share a destination) and every destination is keyed by the hash under
    // the buyer's new folio id, so no copy can observe another. Only the
    // failure COUNT is carried forward, never the sequence.
    //
    // A `{ error }` result (the normal failure shape) is counted and the pool
    // carries on — exactly as the serial loop did. A *thrown* copy aborts the
    // pool and propagates to the outer catch, which 500s without inserting the
    // folio row, again matching the serial loop; the only difference is that
    // up to `ASSET_COPY_CONCURRENCY` in-flight copies may still land in the
    // buyer's not-yet-created folio path (harmless orphaned objects).
    const copyResults = await mapWithConcurrency(
      Array.from(hashes),
      ASSET_COPY_CONCURRENCY,
      async (hash): Promise<boolean> => {
        const { error: cpErr } = await supabaseAdmin.storage
          .from('folio-assets')
          .copy(`${sellerOrgId}/${folio.id}/${hash}`, `${orgId}/${newId}/${hash}`);
        return !cpErr;
      },
    );
    const copyErrors = copyResults.filter((copied) => !copied).length;

    if (copyErrors > 0) {
      console.error(`[duplicate] ${copyErrors}/${hashes.size} assets failed to copy for folio ${newId}`);
    }

    const { error: insertErr } = await supabaseAdmin
      .from('folios')
      .insert(transformToFolioRecord(copied, orgId));

    if (insertErr) {
      console.error('Duplicate insert failed:', insertErr.message);
      return err('Could not create the copy.', { status: 500 });
    }

    return NextResponse.json({ success: true, projectId: newId });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: error may be any thrown value; only error?.message is read
  } catch (error: any) {
    console.error('Duplicate failed:', error?.message || error);
    return err('Internal server error.', { status: 500 });
  }
}
