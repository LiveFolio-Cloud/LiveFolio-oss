/**
 * Creator-country corridor for Stripe Connect payouts.
 *
 * Destination charges WITHOUT `on_behalf_of` only work when the connected
 * account's country is the same region as the platform (US) or inside the
 * cross-border transfer corridor. `on_behalf_of` is unavailable to
 * recipient-agreement Express accounts, so anything outside this list must be
 * treated as unable to receive payouts.
 *
 * Lives here (not in app/api/billing/connect/shared.ts, which is excluded from
 * the OSS sync) because lib/gating/seller.ts needs it and that file ships to
 * OSS. Pure data + predicates — no Stripe or Supabase imports.
 */

export const SUPPORTED_CREATOR_COUNTRIES: readonly string[] = [
  'US', 'CA', 'GB', 'CH',
  // EU + EEA
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE',
  // EFTA in the EEA
  'NO', 'IS', 'LI',
];

export function isSupportedCreatorCountry(country: string | null | undefined): boolean {
  if (!country) return false;
  return SUPPORTED_CREATOR_COUNTRIES.includes(country.toUpperCase());
}

/**
 * Shown when a creator's account country is outside the payout corridor. The
 * country is chosen inside Stripe's hosted onboarding and cannot be changed on
 * an existing account, so the creator has to onboard again for a supported one.
 */
export const UNSUPPORTED_COUNTRY_MESSAGE =
  'Stripe can only pay out to creators in: US, CA, GB, CH, and the EU/EEA. ' +
  'Your Stripe account was created in a country outside that list.';
