import { createHash } from 'crypto';

/**
 * Shared asset plumbing — the single source of truth for data-URL parsing,
 * MIME→extension mapping, content-addressing and `asset://` pointer format.
 *
 * Extracted from four modules that had each grown their own copy —
 * `lib/extract-base64-images.ts`, `lib/process-upload.ts`,
 * `lib/asset-store.ts` and `lib/asset-store.oss.ts`.
 *
 * Two things this module deliberately does NOT do: unify the data-URL
 * dialects, or unify the two hash namespaces. Both are load-bearing. Read the
 * two notes below before "tidying" anything in here.
 *
 * ─── Dialects are preserved, not merged ─────────────────────────────────
 * The three data-URL regexes are three different languages, not three
 * spellings of one. Swapping them changes which inputs parse, so each keeps
 * its own name and each call site keeps the dialect it always had:
 *
 *   DATA_URL_SCAN_RE           unanchored + global, strict payload class
 *                              → scan HTML/CSS/JS for inline images.
 *                                `lib/extract-base64-images.ts` case 2.
 *   DATA_URL_ANCHORED_STRICT_RE whole value, strict payload class
 *                              → "is this entire file value a data URL?"
 *                                `lib/extract-base64-images.ts` case 1.
 *   DATA_URL_ANCHORED_LOOSE_RE  whole value, any payload
 *                              → "may I decode this file value as a data URL?"
 *                                `lib/process-upload.ts`.
 *
 * The observable difference is the payload class. `[A-Za-z0-9+/=]+` rejects
 * URL-safe base64 (`-`, `_`), interior whitespace and empty payloads; `(.+)`
 * accepts the first two. Neither crosses a newline: `.` does not match `\n`
 * without the `s` flag, and the anchored `$` in JS means end-of-input only.
 *
 * ─── Two hash namespaces, both sha256, NOT interchangeable ──────────────
 *   hashAssetBytes(buf)     CONTENT ADDRESS — sha256 of the DECODED bytes.
 *                           Names the Storage object / disk file, the
 *                           `folio_assets.hash` conflict key, and the
 *                           `asset://sha256-{hash}.{ext}` pointer stored as
 *                           the VALUE of an image entry.
 *   hashBase64Payload(b64)  VERSION-MAP KEY — sha256 of the base64 TEXT.
 *                           Names `assets/img-{hash}{ext}` only.
 *
 * `hashBase64Payload`'s output is persisted twice over: as a key in every
 * version's `files` map, and inside the HTML that points at it
 * (`<img src="assets/img-{hash}.png">`). It is FROZEN. In short:
 * re-pointing it at the decoded bytes would not orphan existing keys
 * (`extract-base64-images` always re-emits the original filename), but it
 * WOULD re-key every future save, stranding the old entries as dead
 * data-URL copies of every image, and it buys no deduplication — the pointer
 * is already `hashAssetBytes` on both pipelines, so the asset store already
 * converges on one object per image.
 */

/* ────────────────────────────── hashing ────────────────────────────── */

/**
 * The one sha256 primitive. Both hash namespaces above and every asset
 * pipeline route through this — no module below hashes on its own.
 */
export function sha256Hex(input: string | Buffer | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Content address of decoded asset bytes — Storage path, DB hash, pointer. */
export function hashAssetBytes(buf: Buffer | Uint8Array): string {
  return sha256Hex(buf);
}

/**
 * Version-map key hash for an extracted inline image. Hashes the base64 TEXT
 * (not the bytes) and is frozen — see the namespace note at the top of this
 * file. Used only to build `assets/img-{hash}{ext}`.
 */
export function hashBase64Payload(base64Text: string): string {
  return sha256Hex(base64Text);
}

/* ─────────────────────────── asset:// pointers ─────────────────────── */

/** Canonical content-address prefix. Any other `asset://` variant is invalid. */
export const ASSET_POINTER_PREFIX = 'asset://sha256-';

/**
 * Build the stored pointer for a content-addressed asset.
 * `ext` may be passed with or without its leading dot.
 */
export function buildAssetPointer(hash: string, ext: string): string {
  return `${ASSET_POINTER_PREFIX}${hash}.${ext.replace('.', '')}`;
}

/**
 * Strict accepted-pointer shape: `asset://sha256-<64 lowercase hex>[.<ext>]`.
 * Anything else — notably a traversal such as `asset://sha256-../../.env` —
 * is rejected before it can be stored and later served by `/api/raw`.
 */
export const ASSET_POINTER_RE = /^asset:\/\/sha256-[0-9a-f]{64}(?:\.[a-z0-9]{1,8})?$/i;

/* ────────────────────────────── data URLs ──────────────────────────── */

/**
 * Dialect A — unanchored, global scan for inline images in markup.
 * Mutates `lastIndex`, so callers MUST re-derive a fresh regex per scan:
 * `new RegExp(DATA_URL_SCAN_RE.source, 'g')`.
 */
export const DATA_URL_SCAN_RE = /data:([^;]+);base64,([A-Za-z0-9+/=]+)/g;

/** Dialect B — the whole value is one data URL; strict payload class. */
export const DATA_URL_ANCHORED_STRICT_RE = /^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/;

/**
 * Dialect C — the whole value is one data URL; loose payload class.
 * Groups: `[1]` = mime type, `[2]` = base64 payload.
 * NOTE: the legacy download route inlines this same pattern with a different
 * group layout (`[1]` = payload only); it must be migrated by hand.
 */
export const DATA_URL_ANCHORED_LOOSE_RE = /^data:([^;]+);base64,(.+)$/;

/* ──────────────────────────── MIME → extension ─────────────────────── */

/**
 * The five image types the inline-extraction pass recognises, falling back to
 * `.png`. It is intentionally narrower than `MIME_TO_EXT_UPLOAD` — an
 * `image/x-icon` or `image/bmp` payload extracted from markup becomes
 * `assets/img-{hash}.png`, not `.ico`/`.bmp`. Do not merge the two tables.
 */
export const MIME_TO_EXT_INLINE: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/svg+xml': '.svg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

/**
 * The seven image types the upload/asset pipeline recognises, falling back to
 * `.bin` (an unrecognised MIME is still a real binary worth storing).
 */
export const MIME_TO_EXT_UPLOAD: Record<string, string> = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/svg+xml': '.svg',
  'image/gif': '.gif', 'image/webp': '.webp', 'image/x-icon': '.ico',
  'image/bmp': '.bmp',
};

/** Extension for a data URL extracted out of markup. Fallback: `.png`. */
export function mimeToInlineExt(mime: string): string {
  return MIME_TO_EXT_INLINE[mime] || '.png';
}

/** Extension for an uploaded asset. Fallback: `.bin`. */
export function mimeToUploadExt(mime: string): string {
  return MIME_TO_EXT_UPLOAD[mime] || '.bin';
}

/* ───────────────────────────── thresholds ──────────────────────────── */

/**
 * Decoded assets smaller than this stay inline as data URLs (icons, tracking
 * pixels) instead of paying a storage round trip. Both pipelines compare with
 * `<`, so the threshold is exclusive.
 */
export const MIN_EXTRACTED_ASSET_BYTES = 1024;
