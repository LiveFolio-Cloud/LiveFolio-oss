/**
 * Client-side analytics-consent helper.
 *
 * The cookie-consent banner writes `livefolio_consent=accepted|declined` to a
 * cookie (in addition to localStorage) so that analytics providers can check
 * consent synchronously before loading. Without explicit consent, no
 * third-party analytics scripts are initialized.
 */

export function hasAnalyticsConsent(): boolean {
  if (typeof document === 'undefined') return false;
  const match = document.cookie.match(/(?:^|;\s*)livefolio_consent=([^;]+)/);
  return match?.[1] === 'accepted';
}

/**
 * Fired on `window` whenever consent changes (accept or decline). Providers
 * that mount before consent exists — e.g. PostHog and the third-party
 * analytics tags — subscribe so they can initialize mid-session instead of
 * waiting for the next full page load.
 */
export const ANALYTICS_CONSENT_EVENT = 'livefolio:consent-change';

export function setAnalyticsConsent(value: 'accepted' | 'declined'): void {
  if (typeof document === 'undefined') return;
  document.cookie = `livefolio_consent=${value}; path=/; max-age=31536000; SameSite=Lax`;
  window.dispatchEvent(new CustomEvent(ANALYTICS_CONSENT_EVENT, { detail: value }));
}
