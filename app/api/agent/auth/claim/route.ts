import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getRegistrationSession, updateRegistrationSessionEmail } from '@/lib/agent-auth-store';
import { getEmailAccountStatus } from '@/lib/auth-provisioner';
import { sendOtpEmail } from '@/lib/email';
import { checkRateLimit, getClientIp, buildRateLimitHeaders } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { registration_session_id, email } = body;

    if (!registration_session_id) {
      return NextResponse.json(
        { error: "Missing required parameter: 'registration_session_id'." },
        { status: 400 }
      );
    }

    if (!email) {
      return NextResponse.json(
        { error: "Missing required parameter: 'email'." },
        { status: 400 }
      );
    }

    // Validate email format basic check
    if (!email.includes('@') || email.length < 5) {
      return NextResponse.json(
        { error: "Invalid email address format." },
        { status: 400 }
      );
    }

    // Rate limit by IP address (prevent email bombing)
    const clientIp = getClientIp(request);
    const ipLimit = checkRateLimit(`otp-claim:ip:${clientIp}`, 10, 15 * 60_000, 30 * 60_000);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: ipLimit.reason || 'Rate limit exceeded. Please try again later.' },
        { status: 429, headers: buildRateLimitHeaders(ipLimit) }
      );
    }

    // Rate limit by email (prevent targeting a single email)
    const emailLimit = checkRateLimit(`otp-claim:email:${email.toLowerCase()}`, 3, 15 * 60_000, 30 * 60_000);
    if (!emailLimit.allowed) {
      return NextResponse.json(
        { error: emailLimit.reason || 'Too many code requests for this email. Please try again later.' },
        { status: 429, headers: buildRateLimitHeaders(emailLimit, ipLimit) }
      );
    }

    // Verify session exists and is still valid (not completed or expired)
    const session = await getRegistrationSession(registration_session_id);
    if (!session) {
      return NextResponse.json(
        { error: `Registration session '${registration_session_id}' not found.` },
        { status: 404 }
      );
    }

    if (session.status === 'completed') {
      return NextResponse.json(
        { error: "This registration session has already been completed." },
        { status: 400 }
      );
    }

    // Generate 6-digit cryptographically secure OTP
    const otpCode = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60000); // OTP expires in 10 minutes

    // Generate a claim_token for the clickable one-click authorization URL
    const claimToken = crypto.randomBytes(32).toString('hex');
    const claimTokenExpiresAt = new Date(Date.now() + 15 * 60_000); // 15 minutes
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://livefolio.cloud';
    const claimUrl = `${baseUrl}/api/agent/auth/verify?token=${claimToken}&session=${registration_session_id}`;

    // Whether this email already has a LiveFolio account — agents use this to
    // set expectations ("Authorize access" vs "Create workspace"). Computed at
    // request time, never persisted.
    const account = await getEmailAccountStatus(email);

    // Persist OTP code, email, claim_token, and claim-time account status
    // (the session poll uses it to report 'created' for newly-made accounts).
    const updated = await updateRegistrationSessionEmail(
      registration_session_id,
      email,
      otpCode,
      expiresAt,
      claimToken,
      claimTokenExpiresAt,
      account
    );

    if (!updated) {
      return NextResponse.json(
        { error: "Failed to update registration session." },
        { status: 500 }
      );
    }

    // Dispatch OTP + one-click authorization email using Resend (falls back to
    // console mock in dev/sandbox mode). The claim URL CTA is a magic link —
    // inbox possession proves identity — and the 6-digit code stays as fallback.
    const emailResult = await sendOtpEmail(email, otpCode, claimUrl);

    return NextResponse.json(
      {
        registration_session_id,
        status: 'awaiting_otp',
        account,
        verification_method: 'email_otp',
        provider: emailResult.provider,
        // Clickable one-click authorization URL for CLI agents to show users
        claim_url: claimUrl,
        claim_token: claimToken,
        claim_token_expires_at: claimTokenExpiresAt.toISOString(),
        // Rate limit info for agent feedback
        rate_limit: {
          remaining: ipLimit.remaining,
          reset_at: new Date(ipLimit.resetAt).toISOString(),
        },
      },
      { status: 200, headers: buildRateLimitHeaders(emailLimit, ipLimit) }
    );

  } catch (err: unknown) {
    console.error('[Agent Auth Claim Error]:', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
