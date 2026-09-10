import { NextResponse } from 'next/server';
import { getRegistrationSession, completeRegistrationSession } from '@/lib/agent-auth-store';
import { provisionAgentWorkspace, getEmailAccountStatus } from '@/lib/auth-provisioner';
import { checkRateLimit, resetRateLimit, getClientIp, buildRateLimitHeaders } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { registration_session_id, code } = body;

    if (!registration_session_id) {
      return NextResponse.json(
        { error: "Missing required parameter: 'registration_session_id'." },
        { status: 400 }
      );
    }

    if (!code) {
      return NextResponse.json(
        { error: "Missing required parameter: 'code'." },
        { status: 400 }
      );
    }

    // Rate limit OTP attempts by session AND by IP (prevent brute-force)
    const clientIp = getClientIp(request);
    const ipLimit = checkRateLimit(`otp-verify:ip:${clientIp}`, 30, 15 * 60_000, 60 * 60_000);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many verification attempts from this network. Please try again later.' },
        { status: 429, headers: buildRateLimitHeaders(ipLimit) }
      );
    }
    const attemptLimit = checkRateLimit(`otp-verify:${registration_session_id}`, 5, 10 * 60_000, 15 * 60_000);
    if (!attemptLimit.allowed) {
      return NextResponse.json(
        { error: attemptLimit.reason || 'Too many failed attempts. Please request a new code.' },
        { status: 429, headers: buildRateLimitHeaders(attemptLimit, ipLimit) }
      );
    }

    // Fetch and validate session
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

    if (session.status !== 'awaiting_otp' || !session.otpCode) {
      return NextResponse.json(
        { error: "Session is not awaiting OTP verification. Call the /claim endpoint first." },
        { status: 400 }
      );
    }

    // Verify OTP Code matches (constant-time comparison)
    const providedCode = code.trim();
    const storedCode = session.otpCode;

    // Use timing-safe comparison
    let mismatch = 0;
    const maxLen = Math.max(providedCode.length, storedCode.length);
    for (let i = 0; i < maxLen; i++) {
      const a = i < providedCode.length ? providedCode.charCodeAt(i) : 0;
      const b = i < storedCode.length ? storedCode.charCodeAt(i) : 0;
      mismatch |= a ^ b;
    }

    if (mismatch !== 0 || providedCode.length !== storedCode.length) {
      return NextResponse.json(
        {
          error: "Invalid verification code. Please check and try again.",
          attempts_remaining: Math.max(0, attemptLimit.remaining - 1),
        },
        { status: 401, headers: buildRateLimitHeaders(attemptLimit, ipLimit) }
      );
    }

    // Check expiration
    if (session.otpExpiresAt && new Date() > new Date(session.otpExpiresAt)) {
      return NextResponse.json(
        { error: "Verification code has expired. Please request a new code via the /claim endpoint." },
        { status: 410 }
      );
    }

    // Update session status to completed
    const completed = await completeRegistrationSession(registration_session_id);
    if (!completed) {
      return NextResponse.json(
        { error: "Failed to update registration status." },
        { status: 500 }
      );
    }

    // Reset rate limits on successful verification
    resetRateLimit(`otp-verify:${registration_session_id}`);
    if (session.email) {
      resetRateLimit(`otp-claim:email:${session.email.toLowerCase()}`);
    }

    // High-fidelity provisioning of user identity & workspace.
    // Email control was proven via OTP → account is created confirmed.
    const provisioned = await provisionAgentWorkspace(session.email!, { emailConfirmed: true });

    // Prefer the claim-time status persisted at /claim: a workspace created by
    // this session reads 'created' instead of flipping to 'existing' — agents
    // diffing claim → completion read "existing" as a contradiction.
    const accountAtClaim = session.claimAccount || await getEmailAccountStatus(session.email!);
    const account = accountAtClaim === 'new' ? 'created' : accountAtClaim;

    return NextResponse.json(
      {
        registration_session_id,
        status: 'completed',
        account,
        credential: {
          access_token: provisioned.apiKey,
          token_type: 'Bearer',
          expires_at: null, // API key remains valid indefinitely until revoked by user
          organization: provisioned.organization,
        },
      },
      { status: 200, headers: buildRateLimitHeaders(attemptLimit, ipLimit) }
    );

  } catch (err: unknown) {
    console.error('[Agent Auth Claim Complete Error]:', err);
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
