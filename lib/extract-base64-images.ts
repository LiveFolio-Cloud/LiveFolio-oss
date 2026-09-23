import {
  DATA_URL_ANCHORED_STRICT_RE,
  DATA_URL_SCAN_RE,
  hashBase64Payload,
  MIN_EXTRACTED_ASSET_BYTES,
  mimeToInlineExt,
} from '@/lib/mime';

const TEXT_EXTENSIONS = new Set(['.html', '.htm', '.css', '.js', '.svg']);
const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.ico',
  '.bmp',
]);

/**
 * Asset filename for an extracted image, keyed by the hash of the base64 TEXT.
 *
 * That hash is `hashBase64Payload`, NOT the `hashAssetBytes` content address
 * the asset store uses, and it is FROZEN. These paths are persisted as
 * version-map keys and hard-coded into the saved HTML
 * (`<img src="assets/img-{hash}.png">`), so re-keying them would strand every
 * existing entry — and it would buy nothing, because the `asset://` pointer
 * that becomes the entry's value is already `hashAssetBytes` on both
 * pipelines. See the namespace note in lib/mime.ts.
 */
function extractedAssetPath(hash: string, mimeType: string): string {
  return `assets/img-${hash}${mimeToInlineExt(mimeType)}`;
}

/**
 * Extracts inline base64 data URLs from file content and replaces them
 * with relative paths to decoded asset files.
 *
 * - Text files (`.html`, `.htm`, `.css`, `.js`, `.svg`): scans content
 *   for `data:image/...;base64,...` URLs, decodes them, stores them under
 *   `assets/img-{hash}.{ext}`, and replaces the URL in the source.
 * - Image files whose entire content is a base64 data URL: decodes them
 *   in-place and also stores a copy under `assets/`.
 * - Skips images smaller than 1 KB (small inline icons stay inline).
 * - Duplicate images (same base64 payload) are de-duplicated: only one
 *   asset file is written; all references point to the same path.
 *
 * @param files - Map of filename to file content (strings).
 * @returns The modified files map, count of extracted images, and total
 *          decoded byte size of all extractions.
 */
export function extractBase64Images(files: Record<string, string>): {
  files: Record<string, string>;
  extractedCount: number;
  totalSizeBytes: number;
} {
  if (!files || Object.keys(files).length === 0) {
    return { files: {}, extractedCount: 0, totalSizeBytes: 0 };
  }

  const result: Record<string, string> = {};
  // Track hashes we've already written so identical images share one asset file
  const seenHashes = new Set<string>();
  let extractedCount = 0;
  let totalSizeBytes = 0;

  for (const [filename, content] of Object.entries(files)) {
    const dotIndex = filename.lastIndexOf('.');
    const ext = dotIndex >= 0 ? filename.slice(dotIndex).toLowerCase() : '';

    // ── Case 1: File content is itself a base64 data URL ──────────────
    // (e.g. "logo.png" whose value is "data:image/png;base64,iVBOR...")
    // Dialect B — whole value, strict payload class.
    const dataUrlMatch = content.match(DATA_URL_ANCHORED_STRICT_RE);
    if (dataUrlMatch && IMAGE_EXTENSIONS.has(ext)) {
      const [, mimeType, b64] = dataUrlMatch;
      const hash = hashBase64Payload(b64);
      const assetPath = extractedAssetPath(hash, mimeType);

      const decoded = Buffer.from(b64, 'base64');

      if (decoded.length < MIN_EXTRACTED_ASSET_BYTES) {
        // Too small — keep as-is
        result[filename] = content;
        continue;
      }

      const dataUrl = `data:${mimeType};base64,${b64}`;

      if (!seenHashes.has(hash)) {
        result[assetPath] = dataUrl;
        seenHashes.add(hash);
        extractedCount++;
        totalSizeBytes += decoded.length;
        console.log(
          `[extractBase64Images] Extracted: ${filename} -> ${assetPath} (${decoded.length} bytes)`
        );
      }

      // Original filename gets the data URL (preserved as base64, not latin1)
      result[filename] = dataUrl;
      continue;
    }

    // ── Case 2: Text file — scan for inline base64 data URLs ──────────
    if (TEXT_EXTENSIONS.has(ext)) {
      // Collect matches with a regex exec loop (es5-compatible).
      // Dialect A — re-derived from `.source` so the shared constant's
      // `lastIndex` is never mutated across calls (a `/g` regex is stateful).
      const matches: RegExpExecArray[] = [];
      let match: RegExpExecArray | null;
      const scanRegex = new RegExp(DATA_URL_SCAN_RE.source, 'g');
      while ((match = scanRegex.exec(content)) !== null) {
        matches.push(match);
      }

      if (matches.length === 0) {
        result[filename] = content;
        continue;
      }

      let modifiedContent = content;

      for (const match of matches) {
        const [fullMatch, mimeType, b64] = match;
        const hash = hashBase64Payload(b64);
        const assetPath = extractedAssetPath(hash, mimeType);

        const decoded = Buffer.from(b64, 'base64');

        if (decoded.length < MIN_EXTRACTED_ASSET_BYTES) {
          // Small inline icon — leave as-is
          continue;
        }

        if (!seenHashes.has(hash)) {
          result[assetPath] = `data:${mimeType};base64,${b64}`;
          seenHashes.add(hash);
          extractedCount++;
          totalSizeBytes += decoded.length;
          console.log(
            `[extractBase64Images] Extracted: ${filename} -> ${assetPath} (${decoded.length} bytes)`
          );
        }

        // Replace data URL with relative asset path
        modifiedContent = modifiedContent.replace(fullMatch, assetPath);
      }

      result[filename] = modifiedContent;
      continue;
    }

    // ── Case 3: Other files — pass through unchanged ──────────────────
    result[filename] = content;
  }

  return { files: result, extractedCount, totalSizeBytes };
}
