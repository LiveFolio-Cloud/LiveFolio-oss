/**
 * OSS stub for lib/stripe.ts — swapped in by bin/sync-oss.js (STUB_SWAPS).
 *
 * OSS mode has no Stripe; `getStripe()` returns null and callers degrade
 * with their existing "Stripe service is not configured" paths. Keep the
 * export surface signature-locked to lib/stripe.ts.
 *
 * The Cloud signature is `getStripe(): Stripe | null`. The real `stripe`
 * package cannot be imported here, so the return type is widened to `any | null`:
 * callers that guard `if (!stripe) …` still type-check (a bare `null` return
 * narrows the guarded branch to `never` and fails the OSS type-check), and at
 * runtime the value is always null so paid flows short-circuit on their guards.
 */
export const STRIPE_API_VERSION = '2025-01-27';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors `Stripe | null` without importing the stripe package
export function getStripe(): any {
  return null;
}
