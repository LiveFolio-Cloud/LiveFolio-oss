/**
 * OSS stub for lib/gating/fee-model.ts.
 *
 * The Cloud original carries the platform take rate — a commercial term that
 * is not ours to publish. There are no payment rails in an OSS install, so a
 * self-hosted instance takes no cut at all: the rate is 0, a sale nets the
 * seller exactly the gross amount.
 *
 * Keeps the EXACT same export surface as the Cloud module, because
 * `app/(app)/_components/tabs/gate-config.tsx` imports three symbols from it
 * and is itself imported statically by `header-menus.tsx` (a file that ships
 * with OSS-only menu content, so it cannot simply be removed). Both of that
 * component's mount sites are mode-gated (`!isOSS` / `isCloud`), so it never
 * renders in OSS — the zero rate below is never displayed.
 */

/**
 * Platform cut, in basis points. 0 = the platform takes nothing.
 *
 * The Cloud value is a commercial term and is deliberately NOT reproduced
 * here. The number is only ever rendered by a component that never mounts
 * under OSS.
 */
export const DEFAULT_PLATFORM_FEE_BPS = 0;

/** Minimum fee per sale, in minor units. 0 = no floor. */
export const DEFAULT_PLATFORM_FEE_MIN_CENTS = 0;

/**
 * The platform's cut for a given gross amount.
 *
 * Same arithmetic as the Cloud original — a generic basis-points calculation
 * with no commercial value baked in. With the defaults above it returns 0 for
 * every amount, i.e. the platform's cut is nothing.
 */
export function computePlatformFee(
  amountCents: number,
  bps: number = DEFAULT_PLATFORM_FEE_BPS,
  minCents: number = DEFAULT_PLATFORM_FEE_MIN_CENTS
): number {
  if (amountCents <= 0) return 0;
  const byRate = Math.floor((amountCents * bps) / 10000);
  // Never exceeds the sale: a floor larger than a very cheap item must not
  // invert the charge.
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
