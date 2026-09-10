/**
 * LiveFolio Environment Configuration
 * 
 * NEXT_PUBLIC_APP_ENV determines if the application runs in:
 * - 'oss': Local-first mode using database.json and no centralized auth.
 * - 'cloud': Multi-tenant mode using Supabase, Stripe, and OIDC.
 */

// In production (deployed), default to cloud mode unless explicitly set to oss.
// In development, default to oss unless explicitly set to cloud.
// NEXT_PUBLIC_APP_ENV is inlined at Next.js build time (required for Edge Runtime middleware).
const rawEnv = process.env.NEXT_PUBLIC_APP_ENV || process.env.APP_ENV;
export const APP_ENV = (
  rawEnv ||
  (process.env.NODE_ENV === 'production' ? 'cloud' : 'oss')
) as 'oss' | 'cloud';

export const isOSS = APP_ENV === 'oss';
export const isCloud = APP_ENV === 'cloud';

/**
 * Mock payments (dev/demo): NEXT_PUBLIC_MOCK_PAYMENTS=1 makes the gate
 * checkout provision grants directly without Stripe, so the whole gated
 * flow (paywall → unlock → grant → access) can be tested end-to-end before
 * real payments are configured. Client-safe (NEXT_PUBLIC inlined).
 */
export const MOCK_PAYMENTS = process.env.NEXT_PUBLIC_MOCK_PAYMENTS === '1';

/**
 * Provider Feature Gates
 * Use these to conditionally render UI or branch API logic.
 */
export const FEATURES = {
  billing: isCloud,
  checkpoints: true,
  canvasAnnotations: true,
  mcp: isOSS,
  paidGating: isCloud,
};
