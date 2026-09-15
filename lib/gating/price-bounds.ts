/**
 * Folio price bounds — shared by the server validator and the seller UI.
 *
 * Lives apart from lib/gating/config.ts because that module imports Supabase,
 * and the gate-config UI is a client component. Importing the validator just to
 * read a number would drag server-only code toward the browser bundle; a
 * constants module keeps the two in sync with no such risk.
 *
 * Both bounds are hard REJECTS at validation time, never clamps — see
 * sanitizePaidAccess in ./config.ts.
 */

/**
 * $10 floor. Below it the platform fee stops covering Stripe's fixed $0.30 and
 * the sale stops being worth processing.
 */
export const MIN_AMOUNT_CENTS = 1000;

/**
 * $10,000 ceiling — a sanity bound, NOT a compliance control.
 *
 * It catches a fat-fingered price and caps platform exposure per sale. It does
 * not prevent money laundering: a per-sale cap cannot, since many small sales
 * launder exactly as well as one large one. What actually bounds that risk is
 * Connect identity verification on the seller and Stripe's own payout rails.
 */
export const MAX_AMOUNT_CENTS = 1_000_000;
