/**
 * Platform fee applied to every gated purchase (LiveFolio's cut).
 *
 * Basis points of the gross amount, applied via Stripe's
 * `application_fee_amount` on destination charges. Overridable for testing
 * and experimentation via STRIPE_PLATFORM_FEE_BPS.
 */
export const PLATFORM_FEE_BPS = (() => {
  const raw = parseInt(process.env.STRIPE_PLATFORM_FEE_BPS || '', 10);
  if (Number.isInteger(raw) && raw >= 0 && raw <= 10000) return raw;
  return 1000; // 10%
})();

/**
 * The platform fee in minor units for a given gross price.
 * Rounds down — never charge a fee larger than the sale.
 */
export function platformFeeCents(amountCents: number): number {
  const fee = Math.floor((amountCents * PLATFORM_FEE_BPS) / 10000);
  return Math.min(fee, amountCents);
}
