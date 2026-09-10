import { NextResponse } from 'next/server';
import { getRegistrationSession } from '@/lib/agent-auth-store';
import { getExistingWorkspaceForEmail, getEmailAccountStatus } from '@/lib/auth-provisioner';
import { checkRateLimit, getClientIp, buildRateLimitHeaders } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/agent/auth/session?registration_session_id=…
 *
 * Pollable session-status endpoint for the agentic install flow. After the
 * agent relays the one-click `claim_url` to the user, it polls this endpoint
 * to learn when authorization completed — no user copy-paste of the API key.
 *
 * Auth: the `lf_preclaim_*` token issued by POST /api/agent/auth is the
 * polling credential for this endpoint only (it is NOT valid on /api/mcp or
 * any other REST surface). Passed as a Bearer token.
 */

function constantTimeEq(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  let mismatch = 0;
  for (let i = 0; i < maxLen; i++) {
    mismatch |= (i < a.length ? a.charCodeAt(i) : 0) ^ (i < b.length ? b.charCodeAt(i) : 0);
  }
  return mismatch === 0 && a.length === b.length;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('registration_session_id') || '';

  if (!sessionId) {
    return NextResponse.json(
      { error: "Missing required parameter: 'registration_session_id'." },
      { status: 400 }
    );
  }

  // Light per-IP limit — this is a polling endpoint agents hit repeatedly.
  const clientIp = getClientIp(request);
  const ipLimit = checkRateLimit(`agent-session:ip:${clientIp}`, 60, 5 * 60_000, 15 * 60_000);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: ipLimit.reason || 'Too many requests. Please slow down.' },
      { status: 429, headers: buildRateLimitHeaders(ipLimit) }
    );
  }

  const session = await getRegistrationSession(sessionId);
  if (!session) {
    return NextResponse.json(
      { error: `Registration session '${sessionId}' not found.` },
      { status: 404, headers: buildRateLimitHeaders(ipLimit) }
    );
  }

  // The preclaim token authenticates status polling (constant-time compare).
  const authHeader = request.headers.get('authorization');
  const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';
  if (!token || !constantTimeEq(token, session.preclaimToken)) {
    return NextResponse.json(
      { error: 'Unauthorized. Authenticate with the preclaim token issued by /api/agent/auth as a Bearer credential.' },
      { status: 401, headers: buildRateLimitHeaders(ipLimit) }
    );
  }

  const base = { registration_session_id: sessionId, status: session.status };

  // Prefer the claim-time status (persisted at /claim) over a fresh lookup:
  // a completed 'new' account reads 'created' instead of flipping to
  // 'existing' — consistent with the claim response the agent compared.
  const accountAtClaim = session.claimAccount ||
    (session.email ? await getEmailAccountStatus(session.email) : undefined);
  const account = session.status === 'completed' && accountAtClaim === 'new' ? 'created' : accountAtClaim;

  if (session.status === 'pending_claim') {
    return NextResponse.json(base, { status: 200, headers: buildRateLimitHeaders(ipLimit) });
  }

  if (session.status === 'awaiting_otp') {
    // Let polling agents set expectations while the user authorizes.
    return NextResponse.json({ ...base, account }, { status: 200, headers: buildRateLimitHeaders(ipLimit) });
  }

  // completed — resolve the workspace credential for the claimed email.
  const workspace = session.email ? await getExistingWorkspaceForEmail(session.email) : null;

  return NextResponse.json(
    {
      ...base,
      account,
      credential: workspace
        ? {
            access_token: workspace.apiKey,
            token_type: 'Bearer',
            expires_at: null, // API key remains valid indefinitely until revoked by user
            organization: workspace.organization,
          }
        : null,
    },
    { status: 200, headers: buildRateLimitHeaders(ipLimit) }
  );
}

// Support pre-flight CORS requests
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
