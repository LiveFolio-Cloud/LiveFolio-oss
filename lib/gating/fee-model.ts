/**
 * The creator-fee calculation, as a pure module.
 *
 * Split out of lib/gating/fees.ts because that module reads `process.env` at
 * import time, which only works on the server or where NEXT_PUBLIC_* values are
 * inlined. The seller UI needs to show the fee and their payout at the moment
 * they set a price, so it imports from here instead.
 *
 * Mirrors lib/gating/fees.ts, which reads the env overrides and delegates here.
 * Keeping one implementation is what stops the displayed fee and the charged fee
 * from disagreeing.
 */

/** Platform cut, in basis points. 1500 = 15%. */
export const DEFAULT_PLATFORM_FEE_BPS = 1500;

/**
 * Minimum fee per sale, in minor units. 0 = pure percentage.
 *
 * The floor's original job was covering Stripe's fixed $0.30 on very cheap
 * sales; the $10 folio price floor (./price-bounds) already guarantees a fee
 * far above it, so it is off by default.
 */
export const DEFAULT_PLATFORM_FEE_MIN_CENTS = 0;

/**
 * Stripe's approximate cost for a destination charge, in minor units.
 *
 * ESTIMATE, not authoritative — the real figure depends on card origin,
 * currency conversion and the account's negotiated rate, and the authoritative
 * value is the balance transaction. Use for display only; never for charging.
 * 3.15% = the 2.9% standard US rate plus the Connect surcharge for
 * platform-controlled accounts.
 */
export const STRIPE_ESTIMATE_BPS = 315;
export const STRIPE_ESTIMATE_FIXED_CENTS = 30;

/** The platform's cut for a given gross amount. */
export function computePlatformFee(
  amountCents: number,
  bps: number = DEFAULT_PLATFORM_FEE_BPS,
  minCents: number = DEFAULT_PLATFORM_FEE_MIN_CENTS
): number {
  if (amountCents <= 0) return 0;
  const byRate = Math.floor((amountCents * bps) / 10000);
  // Never exceeds the sale: a floor larger than a very cheap item must not
  // invert the charge (Stripe also rejects a fee above the amount).
  return Math.min(Math.max(byRate, minCents), amountCents);
}

/** What the creator receives: gross minus the platform's cut. */
export function computeCreatorNet(
  amountCents: number,
  bps: number = DEFAULT_PLATFORM_FEE_BPS,
  minCents: number = DEFAULT_PLATFORM_FEE_MIN_CENTS
): number {
  return amountCents - computePlatformFee(amountCents, bps, minCents);
}

/** Estimated Stripe cost. Display only — see STRIPE_ESTIMATE_BPS. */
export function computeStripeEstimate(amountCents: number): number {
  if (amountCents <= 0) return 0;
  return Math.round((amountCents * STRIPE_ESTIMATE_BPS) / 10000) + STRIPE_ESTIMATE_FIXED_CENTS;
}
