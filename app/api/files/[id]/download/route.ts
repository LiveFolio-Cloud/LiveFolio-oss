import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth';
import { supabaseAdmin, transformFolioRecord } from '@/lib/supabase';
import { isOSS } from '@/lib/env';
import { resolveGateConfig } from '@/lib/gating/config';
import { hasActiveGrant } from '@/lib/gating/grants';
import { buildZip } from '@/lib/gating/zip';
import { extractUUIDFromSlug } from '@/lib/utils';
import { embedTraceMarker } from '@/lib/folio-keys';
import { err } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * Bounded fan-out for the `asset://` downloads below. Each one is a round trip
 * to Supabase Storage, so the old serial loop made an image-heavy export pay
 * one sequential round trip per asset. Capped rather than an unbounded
 * `Promise.all`, which would open one socket per asset (and hold every blob
 * in memory at once).
 */
const ASSET_DOWNLOAD_CONCURRENCY = 6;

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
 * GET /api/files/[id]/download — buyer-side ZIP export of a paid folio.
 *
 * Allowed only when the viewer holds an ACTIVE grant AND the gate's
 * allowDownload flag is on (seller-controlled; default off). Owner/members
 * bypass (they already export from the editor). Enforcement is server-side —
 * the button hiding client-side is cosmetic only.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (isOSS) {
    return err('Not available in OSS mode.', { status: 403 });
  }
  try {
    const { userId } = await getAuthContext();
    if (!userId) {
      return err('Sign in to download.', { status: 401 });
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
    const orgId = folio.organization_id as string;

    // Owner/member bypass
    const { data: membership } = await supabaseAdmin
      .from('organization_members')
      .select('id')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .limit(1);
    const isMember = !!(membership && membership.length > 0);

    // Archived folios stop being distributable to buyers and guests. Members
    // keep access — they still own the content and may need to recover it.
    if (!isMember && folio.archivedAt) {
      return err('This folio is no longer available.', { status: 404 });
    }

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
        return err('Download is not enabled for this folio.', { status: 403 });
      }
    }

    // Resolve every file of the latest version to bytes: inline data URLs
    // decode directly; asset:// pointers download from Supabase Storage.
    const latest = folio.versions[folio.versions.length - 1];
    if (!latest) {
      return err('This folio has no content yet.', { status: 404 });
    }

    type Entry = { name: string; data: Buffer };
    const fileNames = Object.keys(latest.files);
    // Buyer downloads are stamped with an invisible trace marker (member
    // exports — the seller's own team — are not).
    const buyerExport = !isMember;

    // ── Pass 1 (synchronous, `fileNames` order) ────────────────────────────
    // Everything that needs no network: the trace stamp, inline data URLs, and
    // the legacy latin1 reconstruction. `asset://` pointers are recorded as
    // pending fetches for pass 2 and leave a `null` placeholder behind.
    //
    // The slot array is ORDER-CRITICAL: `buildZip(entries)` lays the archive
    // out in the order it is given, so entries must be assembled in
    // `fileNames` order exactly as the serial loop produced them.
    const slots: (Entry | null)[] = [];
    const pending: { slot: number; name: string; hash: string }[] = [];

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
        // A non-matching `data:` value contributes no entry (as before: the
        // serial loop `continue`d whether or not the pattern matched).
        slots.push(m ? { name, data: Buffer.from(m[1], 'base64') } : null);
        continue;
      }

      if (value.startsWith('asset://')) {
        const hash = value.replace('asset://sha256-', '');
        if (!/^[0-9a-f]{64}(?:\.[a-z0-9]{1,8})?$/i.test(hash)) {
          slots.push(null);
          continue;
        }
        slots.push(null);
        pending.push({ slot: slots.length - 1, name, hash });
        continue;
      }

      // Legacy latin1-encoded binary (extractBase64Images bug) — reconstruct.
      const imageExt = /\.(png|jpg|jpeg|gif|webp|ico|bmp)$/i.test(name);
      const hasHighBytes = Array.from(value).some((ch) => ch.charCodeAt(0) > 127);
      slots.push(
        imageExt && hasHighBytes
          ? { name, data: Buffer.from(value, 'latin1') }
          : { name, data: Buffer.from(value, 'utf8') },
      );
    }

    // ── Pass 2: fetch the `asset://` blobs (bounded concurrency) ───────────
    // Independent per asset: each destination is a distinct content-addressed
    // path and no fetch reads another's result. A `{ error }` result drops
    // that one entry (as before); a *thrown* fetch propagates and 500s the
    // whole export, also as before.
    const fetched = await mapWithConcurrency(
      pending,
      ASSET_DOWNLOAD_CONCURRENCY,
      async ({ name, hash }): Promise<Entry | null> => {
        const { data: blob, error: dlErr } = await supabaseAdmin.storage
          .from('folio-assets')
          .download(`${orgId}/${folio.id}/${hash}`);
        if (dlErr || !blob) return null;
        return { name, data: Buffer.from(await blob.arrayBuffer()) };
      },
    );
    // Write each result back into its own slot so pass 3 can rebuild the ZIP
    // in `fileNames` order regardless of which download finished first.
    for (let i = 0; i < pending.length; i++) {
      const entry = fetched[i];
      if (entry) slots[pending[i].slot] = entry;
    }

    // ── Pass 3: assemble in order ──────────────────────────────────────────
    const entries: Entry[] = [];
    for (const slot of slots) {
      if (slot) entries.push(slot);
    }

    if (entries.length === 0) {
      return err('This folio has no downloadable files.', { status: 404 });
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: error may be any thrown value; only error?.message is read
  } catch (error: any) {
    console.error('Download failed:', error?.message || error);
    return err('Internal server error.', { status: 500 });
  }
}
