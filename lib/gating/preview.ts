import crypto from 'crypto';
import { safeEqual } from '@/lib/crypto';

/**
 * Self-hosted variant of `lib/gating/preview.ts`, swapped in by the downstream
 * sync. Same two exports, same cookie format, same verification.
 *
 * The Cloud copy derives its fallback signing secret from the payment
 * provider's key — a convenient source of already-provisioned entropy on a
 * hosted install, and a vendor reference the public tree has no business
 * carrying. A self-hosted instance has no such key, so it uses its own
 * fallback here. The Cloud file is untouched; only this variant differs.
 *
 * ⚠️ Timed-preview cookies are MARKETING-grade enforcement by design: clearing
 * the cookie re-arms the preview. The real wall is the grant check — preview
 * mode only shapes what a non-paying visitor sees. That trade-off is unchanged
 * here, and the default secret below is only a convenience for installs that
 * have not set `LF_PREVIEW_SECRET`.
 *
 * Operators who care about forged preview cookies should set
 * `LF_PREVIEW_SECRET`; without it, anyone who can read this file can mint one.
 */

/**
 * Fallback used when `LF_PREVIEW_SECRET` is unset.
 *
 * Deliberately a constant, and deliberately documented: it keeps the feature
 * working out of the box on a fresh install, and it is not a secret. The
 * alternative — deriving entropy from something else in the environment —
 * would make cookie validity depend on unrelated configuration.
 */
const DEFAULT_PREVIEW_SECRET = 'livefolio-self-hosted-preview';

function getSecret(): string {
  return process.env.LF_PREVIEW_SECRET || DEFAULT_PREVIEW_SECRET;
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

  return safeEqual(sig, expected);
}
