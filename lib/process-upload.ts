import { isOSS } from '@/lib/env';
import { putAsset as putAssetCloud } from '@/lib/asset-store';
import { putAsset as putAssetOSS } from '@/lib/asset-store.oss';
import {
  ASSET_POINTER_RE,
  DATA_URL_ANCHORED_LOOSE_RE,
  MIN_EXTRACTED_ASSET_BYTES,
  mimeToUploadExt,
} from '@/lib/mime';

/**
 * Bounded upload concurrency. Each offloaded asset costs TWO network round
 * trips in Cloud mode (Supabase Storage upload + `folio_assets` upsert), so the
 * old serial loop made a 20-image save pay ~40 sequential round trips — the
 * dominant term on any image-heavy save. An unbounded `Promise.all` would fix
 * the latency but open ~40 sockets at once and risk tripping Storage rate
 * limits, so the fan-out is capped here instead.
 */
const UPLOAD_CONCURRENCY = 6;

export interface ProcessResult {
  files: Record<string, string>;
  storedBytes: number;
  assetCount: number;
}

/**
 * `Promise.all` over a fixed pool of `limit` workers, preserving input order.
 *
 * Fail-fast, matching the serial loop's semantics: the FIRST rejection is
 * captured and rethrown once every worker has drained. Workers stop claiming
 * new items as soon as one fails, but never rethrow from inside — so no
 * rejection can escape unobserved while sibling uploads are still in flight.
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

/** One entry's processed value plus the bookkeeping the accumulator needs. */
interface UploadOutcome {
  filename: string;
  value: string;
  size: number;
  uploaded: boolean;
}

/**
 * Process all files in a folio save. Text files pass through unchanged.
 * Base64 data URLs >1 KB are decoded and uploaded to the asset store
 * (Supabase Storage / local disk), replaced with `asset://` pointers.
 * Existing `asset://` pointers and small inline images pass through.
 *
 * Called by: POST /api/files, PUT /api/files/[id], MCP create/update.
 */
export async function processUploadFiles(
  files: Record<string, string>,
  folioId: string,
  orgId: string,
): Promise<ProcessResult> {
  // Snapshot once — `Object.entries` builds an array, so later mutation of
  // `files` cannot affect this call (same as the previous `for…of`).
  const entries = Object.entries(files);

  // ── Pass 0: pointer validation (synchronous, entry order) ──────────────
  // An `asset://` value is accepted ONLY in the strict content-addressed
  // format. Anything else (e.g. path traversal like "asset://sha256-../../.env")
  // is rejected so it can never be stored and later served by /api/raw.
  //
  // Hoisted ahead of the uploads deliberately: every entry is validated before
  // the first byte is written, so a rejected save performs no uploads and the
  // thrown message names the FIRST offending entry in entry order — exactly
  // what the serial loop reported, minus the orphaned partial uploads.
  for (const [filename, content] of entries) {
    if (content.startsWith('asset://') && !ASSET_POINTER_RE.test(content)) {
      throw new Error(`Invalid asset pointer for "${filename}" — content-addressed pointers only.`);
    }
  }

  // ── Pass 1: offload oversized data URLs (bounded concurrency) ──────────
  // Order-independent by construction: assets are content-addressed (the
  // sha256 of the buffer picks both the Storage path and the `folio_assets`
  // conflict key), so no entry can observe another's upload. Nothing here
  // reads a running counter or an earlier entry's result — the totals are
  // folded afterwards, in entry order, over the returned outcomes.
  const outcomes = await mapWithConcurrency(
    entries,
    UPLOAD_CONCURRENCY,
    async ([filename, content]): Promise<UploadOutcome> => {
      // Already a validated pointer — pass through.
      if (content.startsWith('asset://')) {
        return { filename, value: content, size: 0, uploaded: false };
      }

      // Dialect C — whole value, loose payload class. Deliberately looser
      // than the markup scanner in `extract-base64-images`: this is the last
      // gate before a value is stored, and it must accept every data URL the
      // clients hand us (URL-safe base64, whitespace-wrapped payloads).
      const match = content.match(DATA_URL_ANCHORED_LOOSE_RE);
      // Plain text file — pass through.
      if (!match) {
        return { filename, value: content, size: 0, uploaded: false };
      }

      const mime = match[1];
      const b64 = match[2];
      const buf = Buffer.from(b64, 'base64');

      // Small inline images stay as data URLs. Returning here also releases
      // `buf` before the pool claims its next entry.
      if (buf.length < MIN_EXTRACTED_ASSET_BYTES) {
        return { filename, value: content, size: 0, uploaded: false };
      }

      const ext = mimeToUploadExt(mime);
      const { pointer, size } = isOSS
        ? await putAssetOSS(folioId, orgId, buf, mime, ext)
        : await putAssetCloud(folioId, orgId, buf, mime, ext);

      return { filename, value: pointer, size, uploaded: true };
    },
  );

  // ── Pass 2: assemble in entry order ────────────────────────────────────
  // Insertion order of `result` matches `Object.entries(files)` exactly, and
  // the `+=` / `++` folds replay the serial loop's accumulation order, so the
  // returned record is identical — same keys, same values, same totals.
  const result: Record<string, string> = {};
  let storedBytes = 0;
  let assetCount = 0;

  for (const outcome of outcomes) {
    result[outcome.filename] = outcome.value;
    storedBytes += outcome.size;
    if (outcome.uploaded) assetCount++;
  }

  return { files: result, storedBytes, assetCount };
}
