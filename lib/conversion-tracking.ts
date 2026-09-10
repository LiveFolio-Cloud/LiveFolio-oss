/* -------------------------------------------------------------------------- */
/* OSS stub for lib/conversion-tracking.ts (cloud-only analytics — GA4,       */
/* Meta Pixel, LinkedIn Insight Tag, PostHog). The cloud module is excluded   */
/* from the OSS sync; this stub is swapped in by bin/sync-oss.js STUB_SWAPS   */
/* with an identical export surface so OSS-shipped files (app/register) keep  */
/* compiling. All calls are no-ops — OSS ships zero tracking.                 */
/* -------------------------------------------------------------------------- */

export enum ConversionEvent {
  // Acquisition
  PAGE_VIEW = 'page_view',
  SIGNUP = 'signup',
  ONBOARDING_COMPLETE = 'onboarding_complete',

  // Activation (aha moment — user creates their first folio)
  FOLIO_CREATED = 'folio_created',
  FOLIO_PUBLISHED = 'folio_published',

  // Monetization
  TRIAL_STARTED = 'trial_started',
  CHECKOUT_STARTED = 'checkout_started',
  CHECKOUT_COMPLETED = 'checkout_completed',
  SUBSCRIPTION_UPGRADE = 'subscription_upgrade',
  SUBSCRIPTION_DOWNGRADE = 'subscription_downgrade',
  SUBSCRIPTION_CANCELLED = 'subscription_cancelled',

  // Engagement
  FOLIO_SHARED = 'folio_shared',
  FOLIO_VIEWED = 'folio_viewed',
  COLLABORATOR_INVITED = 'collaborator_invited',
  MCP_CONNECTED = 'mcp_connected',

  // Referral
  REFERRAL_LINK_CLICKED = 'referral_link_clicked',
  REFERRAL_SIGNUP = 'referral_signup',
  REFERRAL_CONVERTED = 'referral_converted',
}

export const UTM_CONVENTION = {
  source: {
    twitter: 'twitter',
    linkedin: 'linkedin',
    github: 'github',
    newsletter: 'newsletter',
    google: 'google',
    facebook: 'facebook',
    instagram: 'instagram',
    direct: 'direct',
    referral: 'referral',
  },
  medium: {
    social: 'social',
    email: 'email',
    cpc: 'cpc',
    paid_social: 'paid_social',
    organic: 'organic',
    referral: 'referral',
  },
} as const;

interface TrackParams {
  value?: number;
  currency?: string;
  method?: string;
  folioId?: string;
  planName?: string;
  [key: string]: unknown;
}

/** No-op — OSS ships no conversion tracking. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function trackConversion(_event: ConversionEvent, _params: TrackParams = {}): void {}

/** No-op — OSS ships no conversion tracking. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function trackPageView(_path: string): void {}
