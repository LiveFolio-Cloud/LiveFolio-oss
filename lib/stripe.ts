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
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors `Stripe | null` without importing the stripe package
export function getStripe(): any {
  return null;
}

/**
 * OSS counterpart of the Cloud customer resolver (lib/stripe.ts).
 *
 * No Stripe in OSS, so this always reports failure — which is the honest
 * answer, and keeps lib/gating/checkout's existing error branch intact rather
 * than letting it proceed with a customer ID that cannot exist. The return
 * union is mirrored literally so callers narrow identically without importing
 * the stripe package.
 */
export type StripeCustomerScope = 'organization' | 'profile';

export type StripeCustomerResult =
  | { ok: true; customerId: string }
  | { ok: false; code: 'LOOKUP_FAILED' | 'CREATE_FAILED'; message: string };

export async function resolveStripeCustomer(
  _stripe: unknown, // eslint-disable-line @typescript-eslint/no-unused-vars -- stub mirrors the Cloud signature
  _supabaseAdmin: unknown, // eslint-disable-line @typescript-eslint/no-unused-vars -- stub mirrors the Cloud signature
  _scope: StripeCustomerScope, // eslint-disable-line @typescript-eslint/no-unused-vars -- stub mirrors the Cloud signature
  _ownerId: string, // eslint-disable-line @typescript-eslint/no-unused-vars -- stub mirrors the Cloud signature
  _opts: { email?: string | null; userId?: string | null } = {} // eslint-disable-line @typescript-eslint/no-unused-vars -- stub mirrors the Cloud signature
): Promise<StripeCustomerResult> {
  return { ok: false, code: 'CREATE_FAILED', message: 'Stripe is not available in OSS mode.' };
}
