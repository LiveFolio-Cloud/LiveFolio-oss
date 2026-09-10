import { isOSS } from '@/lib/env';
import { putAsset as putAssetCloud } from '@/lib/asset-store';
import { putAsset as putAssetOSS } from '@/lib/asset-store.oss';

const DATA_URL_RE = /^data:([^;]+);base64,(.+)$/;
// Strict content-addressed pointer: asset://sha256-<64 hex>[.<ext>]
const ASSET_POINTER_RE = /^asset:\/\/sha256-[0-9a-f]{64}(?:\.[a-z0-9]{1,8})?$/i;
const MAX_INLINE_BYTES = 1024; // images < 1 KB stay inline as data URLs

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/svg+xml': '.svg',
  'image/gif': '.gif', 'image/webp': '.webp', 'image/x-icon': '.ico',
  'image/bmp': '.bmp',
};

export interface ProcessResult {
  files: Record<string, string>;
  storedBytes: number;
  assetCount: number;
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
  const result: Record<string, string> = {};
  let storedBytes = 0;
  let assetCount = 0;

  for (const [filename, content] of Object.entries(files)) {
    // Already a pointer — pass through ONLY if it matches the strict
    // content-addressed format. Anything else (e.g. path traversal like
    // "asset://sha256-../../.env") is rejected so it can never be stored
    // and later served by /api/raw.
    if (content.startsWith('asset://')) {
      if (!ASSET_POINTER_RE.test(content)) {
        throw new Error(`Invalid asset pointer for "${filename}" — content-addressed pointers only.`);
      }
      result[filename] = content;
      continue;
    }

    // Data URL — could be a large image
    const match = content.match(DATA_URL_RE);
    if (match) {
      const mime = match[1];
      const b64 = match[2];
      const buf = Buffer.from(b64, 'base64');

      // Small inline images stay as data URLs
      if (buf.length < MAX_INLINE_BYTES) {
        result[filename] = content;
        continue;
      }

      const ext = MIME_TO_EXT[mime] || '.bin';
      const { pointer, size } = isOSS
        ? await putAssetOSS(folioId, orgId, buf, mime, ext)
        : await putAssetCloud(folioId, orgId, buf, mime, ext);

      result[filename] = pointer;
      storedBytes += size;
      assetCount++;
      continue;
    }

    // Plain text file — pass through
    result[filename] = content;
  }

  return { files: result, storedBytes, assetCount };
}
