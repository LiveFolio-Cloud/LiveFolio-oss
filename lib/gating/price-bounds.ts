/**
 * OSS stub for lib/gating/price-bounds.ts.
 *
 * The Cloud bounds are commercial terms — a price floor and ceiling chosen
 * around platform economics. They must not be published. This module keeps
 * the EXACT same export surface, because two shipped modules read it
 * (`lib/gating/config.ts`, which re-exports both, and `lib/gating/paid-access.ts`),
 * as does `app/(app)/_components/tabs/gate-config.tsx` (a component that never
 * mounts in OSS but is imported statically).
 *
 * ⚠️ THE VALUES BELOW ARE DELIBERATELY GENERIC.
 *
 * They are broad type-level sanity checks, not price points, and they must
 * stay that way:
 *
 *   - MIN is one cent — the smallest amount that can be represented at all.
 *     It is a representational floor (a negative or zero price is nonsense),
 *     not "the cheapest folio costs this much".
 *   - MAX is a round technical cap, chosen to be far below
 *     Number.MAX_SAFE_INTEGER so the arithmetic in the validator cannot lose
 *     precision. It is a guard against a fat-fingered input, not a statement
 *     about what anything costs.
 *
 * Neither number is derived from, nor hints at, the Cloud bounds. Do not
 * "tidy" them into rounder, more plausible prices — a plausible-looking
 * number is exactly the leak this stub exists to prevent.
 */

/** Generic sanity floor — one minor unit. NOT a price. */
export const MIN_AMOUNT_CENTS = 1;

/** Generic sanity ceiling — a technical cap, NOT a price. */
export const MAX_AMOUNT_CENTS = 100_000_000;
