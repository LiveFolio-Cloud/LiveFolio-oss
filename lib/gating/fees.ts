import {
  DEFAULT_PLATFORM_FEE_BPS,
  DEFAULT_PLATFORM_FEE_MIN_CENTS,
  computePlatformFee,
  computeStripeEstimate,
} from './fee-model';

/**
 * Platform fee applied to every gated purchase (LiveFolio's cut).
 *
 * A percentage of the gross amount with an optional per-sale minimum, applied
 * via Stripe's `application_fee_amount` on destination charges.
 *
 * IMPORTANT: the value charged is persisted on the grant at sale time
 * (lib/gating/grants.ts). These constants describe what NEW sales are charged —
 * never recompute a historical fee from them, or changing the rate would
 * rewrite past sales. Tune via STRIPE_PLATFORM_FEE_BPS and
 * STRIPE_PLATFORM_FEE_MIN_CENTS.
 *
 * This module is the env-reading boundary; the arithmetic lives in
 * ./fee-model so the client UI can import it without reading process.env.
 */

export const PLATFORM_FEE_BPS = (() => {
  const raw = parseInt(process.env.STRIPE_PLATFORM_FEE_BPS || '', 10);
  if (Number.isInteger(raw) && raw >= 0 && raw <= 10000) return raw;
  return DEFAULT_PLATFORM_FEE_BPS;
})();

export const PLATFORM_FEE_MIN_CENTS = (() => {
  const raw = parseInt(process.env.STRIPE_PLATFORM_FEE_MIN_CENTS || '', 10);
  if (Number.isInteger(raw) && raw >= 0) return raw;
  return DEFAULT_PLATFORM_FEE_MIN_CENTS;
})();

/**
 * The platform fee in minor units for a given gross price.
 * Rounds down — never charge a fee larger than the sale.
 */
export function platformFeeCents(amountCents: number): number {
  return computePlatformFee(amountCents, PLATFORM_FEE_BPS, PLATFORM_FEE_MIN_CENTS);
}

/** Estimated Stripe cost for a sale. Display only — the balance transaction is authoritative. */
export function stripeProcessingCents(amountCents: number): number {
  return computeStripeEstimate(amountCents);
}

/**
 * What the platform keeps from a sale, after Stripe's cut.
 * An estimate, because the Stripe side is.
 */
export function platformMarginCents(amountCents: number): number {
  return platformFeeCents(amountCents) - stripeProcessingCents(amountCents);
}
