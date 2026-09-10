/**
 * Short-TTL page tokens for source-locked folio delivery.
 *
 * A `source_locked` paid folio serves its HTML pages through a tiny JS
 * bootstrap (see app/api/raw/[id]/[[...path]]/route.ts). The bootstrap
 * holds a token minted here and exchanges it for the real page; the token
 * binds to the exact folio + version + filename and expires in ~60s, so a
 * saved copy of the shell is a dead end and stale CDN/crawler fetches fail
 * closed.
 *
 * Zero imports (node:crypto only) so the file syncs cleanly to the OSS repo
 * — there the feature is inert because no gate can enable source_locking
 * and the secret is never set.
 */
import crypto from 'node:crypto';

/** What a token proves: this exact file of this exact version of this folio. */
export interface PageTokenSpec {
  /** Folio UUID. */
  f: string;
  /** Served versionId (the shell shows the version the server resolved). */
  v: string;
  /** Served filename (index.html, page2.html, …). */
  n: string;
}

const TOKEN_TTL_MS = 60_000;
const MAX_TOKEN_LENGTH = 512;

let warned = false;

function secretKey(): Buffer | null {
  const secret = process.env.FOLIO_TOKEN_SECRET || '';
  if (secret && secret.length >= 16) return Buffer.from(secret);
  if (!warned) {
    warned = true;
    console.warn(
      '[folio-tokens] FOLIO_TOKEN_SECRET is not set (or shorter than 16 chars). ' +
        'Source-locked pages will fail open and serve normally. Set it in production to enable the protection layer.'
    );
  }
  return null;
}

/** Mint a token for a page spec, or null when the secret is unconfigured. */
export function signPageToken(spec: PageTokenSpec, ttlMs: number = TOKEN_TTL_MS): string | null {
  const key = secretKey();
  if (!key) return null;
  const payload = Buffer.from(
    JSON.stringify({ f: spec.f, v: spec.v, n: spec.n, e: Date.now() + ttlMs }),
    'utf8'
  );
  const mac = crypto.createHmac('sha256', key).update(payload).digest();
  return Buffer.concat([payload, mac]).toString('base64url');
}

/**
 * Verify a token against a page spec. Rejects expired tokens, tokens for
 * other files/versions/folios, garbage, and oversized input.
 */
export function verifyPageToken(token: string, spec: PageTokenSpec): boolean {
  const key = secretKey();
  if (!key || !token || token.length > MAX_TOKEN_LENGTH) return false;
  try {
    const buf = Buffer.from(token, 'base64url');
    if (buf.length < 32) return false;
    const payload = buf.subarray(0, buf.length - 32);
    const mac = buf.subarray(buf.length - 32);
    const expected = crypto.createHmac('sha256', key).update(payload).digest();
    if (!crypto.timingSafeEqual(mac, expected)) return false;

    const parsed = JSON.parse(payload.toString('utf8')) as {
      f?: unknown;
      v?: unknown;
      n?: unknown;
      e?: unknown;
    };
    if (parsed.f !== spec.f || parsed.v !== spec.v || parsed.n !== spec.n) return false;
    if (typeof parsed.e !== 'number' || parsed.e < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}
