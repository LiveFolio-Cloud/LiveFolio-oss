import crypto from 'crypto';

/**
 * Timed-preview cookies. The raw route sets an HMAC-signed cookie the first
 * time a gated folio is served to a visitor; while it is valid the visitor
 * sees the content ("grace = clock starts"). Expiry is baked into the payload
 * so the cookie cannot be extended by editing Max-Age.
 *
 * This is MARKETING-grade enforcement by design: clearing the cookie re-arms
 * the preview. The real wall is the grant check — preview mode only shapes
 * what a non-paying visitor sees.
 */

function getSecret(): string {
  return process.env.LF_PREVIEW_SECRET || (process.env.STRIPE_SECRET_KEY || '').slice(0, 32);
}

export function signPreviewCookieValue(folioId: string, ttlSeconds: number): string {
  const expiryEpoch = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${folioId}.${expiryEpoch}`;
  const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyPreviewCookieValue(value: string, folioId: string): boolean {
  if (!value) return false;

  const parts = value.split('.');
  if (parts.length !== 3) return false;

  const [id, expiryStr, sig] = parts;
  if (id !== folioId) return false;

  const expiry = parseInt(expiryStr, 10);
  if (!Number.isInteger(expiry) || expiry < Math.floor(Date.now() / 1000)) return false;

  const payload = `${id}.${expiryStr}`;
  const expected = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
