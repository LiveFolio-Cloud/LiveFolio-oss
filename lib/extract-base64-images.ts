import { createHash } from 'crypto';

const BASE64_IMAGE_REGEX = /data:([^;]+);base64,([A-Za-z0-9+/=]+)/g;
const DATA_URL_REGEX = /^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/;

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

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/svg+xml': '.svg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

function getExtensionFromMime(mimeType: string): string {
  return MIME_TO_EXT[mimeType] || '.png';
}

/**
 * Generate a deterministic full sha256 hex hash of the base64 payload.
 * Identical base64 payloads produce identical hashes. (Previously a
 * truncated 8-char MD5 of only the first 64 chars + length — collision-
 * prone, so two different images could share one asset file.)
 */
function generateHash(base64Content: string): string {
  return createHash('sha256').update(base64Content).digest('hex');
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
    const dataUrlMatch = content.match(DATA_URL_REGEX);
    if (dataUrlMatch && IMAGE_EXTENSIONS.has(ext)) {
      const [, mimeType, b64] = dataUrlMatch;
      const hash = generateHash(b64);
      const assetExt = getExtensionFromMime(mimeType);
      const assetPath = `assets/img-${hash}${assetExt}`;

      const decoded = Buffer.from(b64, 'base64');

      if (decoded.length < 1024) {
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
      // Collect matches with a regex exec loop (es5-compatible)
      const matches: RegExpExecArray[] = [];
      let match: RegExpExecArray | null;
      const scanRegex = new RegExp(BASE64_IMAGE_REGEX.source, 'g');
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
        const hash = generateHash(b64);
        const assetExt = getExtensionFromMime(mimeType);
        const assetPath = `assets/img-${hash}${assetExt}`;

        const decoded = Buffer.from(b64, 'base64');

        if (decoded.length < 1024) {
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
