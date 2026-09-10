import { NextResponse } from 'next/server';

/**
 * GET /api/health/email
 *
 * Returns the current Resend email integration status without exposing secrets.
 * Used by monitoring dashboards and CI to verify email is operational in production.
 *
 * Response shape:
 * {
 *   configured: boolean,       // Is a valid-looking API key set?
 *   provider: 'resend' | 'console',
 *   fromEmail: string,         // Masked sender address
 *   lastChecked: string,       // ISO timestamp
 *   appEnv: string,            // Current NEXT_PUBLIC_APP_ENV
 * }
 */
export async function GET() {
  const apiKey = process.env.RESEND_API_KEY || '';
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
  const appEnv = process.env.NEXT_PUBLIC_APP_ENV || 'oss';

  // Validate API key without leaking it
  const isConfigured =
    apiKey.length > 0 &&
    apiKey !== 're_your_resend_api_key_here' &&
    apiKey.startsWith('re_') &&
    apiKey.length >= 20;

  // Mask the from-email for safe exposure
  const maskEmail = (email: string): string => {
    const [local, domain] = email.split('@');
    if (!domain) return email;
    if (local.length <= 3) return `${local}@${domain}`;
    return `${local.slice(0, 3)}…@${domain}`;
  };

  const isCloud = appEnv === 'cloud';

  return NextResponse.json({
    configured: isConfigured,
    provider: isConfigured ? 'resend' : 'console',
    fromEmail: maskEmail(fromEmail),
    lastChecked: new Date().toISOString(),
    appEnv,
    status: isConfigured && isCloud ? 'healthy' : 'degraded',
    // Reasons for degraded status
    reasons: [
      ...(isConfigured ? [] : ['RESEND_API_KEY is not configured or is a placeholder']),
      ...(isCloud ? [] : ['NEXT_PUBLIC_APP_ENV is not "cloud" — email is for cloud mode']),
      ...(isConfigured && !isCloud ? ['Email would work if APP_ENV were "cloud"'] : []),
    ],
  });
}
