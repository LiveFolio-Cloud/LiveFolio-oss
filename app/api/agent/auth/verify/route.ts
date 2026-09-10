import { NextResponse } from 'next/server';
import { getRegistrationSession, completeRegistrationSession } from '@/lib/agent-auth-store';
import { provisionAgentWorkspace, getEmailAccountStatus } from '@/lib/auth-provisioner';
import { checkRateLimit, resetRateLimit, getClientIp, buildRateLimitHeaders } from '@/lib/rate-limit';

/**
 * GET /api/agent/auth/verify
 *
 * Human-facing authorization page. When a CLI agent gives the user a
 * claim_url, the user opens it in a browser and can either:
 *   - click one-click "Authorize" (magic-link semantics: possession of the
 *     inbox + the 256-bit claim token proves identity), or
 *   - enter the 6-digit OTP code from their email (fallback).
 *
 * GET ?token=<claim_token>&session=<registration_session_id> — renders the page
 * POST — completes authorization (one-click path posts authorize=1; the code
 *        path posts the OTP code)
 */

/** Constant-time string comparison (mirrors the OTP compare below). */
function constantTimeEq(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  let mismatch = 0;
  for (let i = 0; i < maxLen; i++) {
    mismatch |= (i < a.length ? a.charCodeAt(i) : 0) ^ (i < b.length ? b.charCodeAt(i) : 0);
  }
  return mismatch === 0 && a.length === b.length;
}

function verificationPage(
  sessionId: string,
  claimToken: string,
  errorMsg?: string,
  successMsg?: string,
  apiKey?: string,
  account?: 'existing' | 'new',
  authorizeEnabled?: boolean
): string {
  const authorizeLabel = account === 'new' ? 'Create My Workspace' : 'Authorize Agent';
  const formDescription = account === 'existing'
    ? 'This AI agent is requesting access to your existing LiveFolio workspace. One click connects it — no code needed.'
    : account === 'new'
      ? 'This AI agent will create your new LiveFolio workspace. One click gets you started — no code needed.'
      : 'An AI agent is requesting to connect to LiveFolio. Complete the verification to continue.';
  const keyIntro = account === 'new'
    ? '✅ Workspace created! Copy this key and paste it back to your agent:'
    : '✅ Authorized! Copy this key and paste it back to your agent:';

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>LiveFolio — Verify Your Identity</title>
<link rel="icon" type="image/svg+xml" href="/favicon-square.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://api.fontshare.com">
<link href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@500,700,900&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  :root{color-scheme:light;--bg:#F4F4F0;--card:#FFFFFF;--ink:#0F0F0D;--muted:rgba(15,15,13,.55);--faint:rgba(15,15,13,.35);--line:rgba(15,15,13,.08);--accent:#FF3B00;--code-bg:#0F0F0D;--code-ink:#F4F4F0}
  body{
    font-family:'Plus Jakarta Sans',ui-sans-serif,system-ui,-apple-system,sans-serif;
    background:var(--bg);color:var(--ink);
    min-height:100vh;min-height:100dvh;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    padding:32px 16px;
  }
  @keyframes lf-pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.3);opacity:.6}}
  .brand{display:flex;align-items:center;gap:10px;margin-bottom:20px}
  .brand-mark{width:14px;height:14px;background:var(--accent);animation:lf-pulse 1.2s ease-in-out infinite}
  .brand-name{font-family:'Space Grotesk','Cabinet Grotesk',sans-serif;font-size:18px;font-weight:700;letter-spacing:-.03em}
  .card{
    background:var(--card);width:100%;max-width:400px;
    border-radius:20px;padding:32px 28px;text-align:center;
    box-shadow:0 1px 2px rgba(15,15,13,.04),0 16px 48px -24px rgba(15,15,13,.18);
    border:1px solid var(--line);
  }
  .chip{display:inline-flex;align-items:center;gap:6px;border-radius:999px;background:rgba(255,59,0,.08);color:var(--accent);font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;padding:5px 12px;margin-bottom:16px}
  .chip::before{content:'';width:5px;height:5px;border-radius:99px;background:var(--accent)}
  h1{font-family:'Space Grotesk','Cabinet Grotesk',sans-serif;font-size:26px;font-weight:700;letter-spacing:-.035em;line-height:1.08}
  .description{font-size:13.5px;line-height:1.6;color:var(--muted);margin:10px auto 22px;max-width:300px}
  .btn{display:inline-flex;align-items:center;justify-content:center;width:100%;height:44px;border:none;border-radius:999px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;transition:opacity .15s ease,background-color .15s ease;text-decoration:none;background:var(--ink);color:var(--card)}
  .btn-primary{background:var(--accent);color:#fff}
  .btn-primary:hover{opacity:.9}
  .btn-ink{background:var(--ink);color:var(--card)}
  .btn-ink:hover{opacity:.9}
  .btn:disabled{opacity:.5;cursor:not-allowed}
  .divider{display:flex;align-items:center;gap:12px;margin:20px 0 18px;color:var(--faint);font-size:10px;font-weight:600;letter-spacing:.12em;text-transform:uppercase}
  .divider::before,.divider::after{content:'';flex:1;height:1px;background:var(--line)}
  .code-input{
    width:100%;height:56px;text-align:center;border-radius:14px;
    font-family:'IBM Plex Mono',monospace;font-size:26px;letter-spacing:10px;font-weight:500;
    border:1px solid var(--line);background:var(--bg);color:var(--ink);
    outline:none;transition:border-color .15s ease,box-shadow .15s ease;padding-left:10px;
  }
  .code-input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(255,59,0,.15)}
  .error{background:rgba(255,59,0,.07);border:1px solid rgba(255,59,0,.25);color:#D92D00;border-radius:12px;padding:10px 12px;font-size:12px;font-weight:600;line-height:1.5;margin-bottom:16px}
  .success{background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.25);color:#15803D;border-radius:12px;padding:10px 12px;font-size:12px;font-weight:600;line-height:1.5;margin-bottom:16px}
  .api-key-box{background:var(--code-bg);color:var(--code-ink);border-radius:12px;padding:14px;font-family:'IBM Plex Mono',monospace;font-size:11px;word-break:break-all;color:#FF8A66;margin-bottom:14px}
  .footnote{font-size:11px;color:var(--faint);margin-top:18px}
  form{display:contents}
  .stack{display:flex;flex-direction:column;gap:10px}
  @media (max-width:420px){.card{padding:28px 20px}h1{font-size:22px}}
  @media (prefers-color-scheme:dark){
    :root{color-scheme:dark;--bg:#0F0F0D;--card:#171714;--ink:#F4F4F0;--muted:rgba(244,244,240,.58);--faint:rgba(244,244,240,.32);--line:rgba(244,244,240,.1);--code-bg:#0A0A09;--code-ink:#F4F4F0}
    .btn-ink{background:#F4F4F0;color:#0F0F0D}
    .code-input{background:#0A0A09}
  }
</style></head><body>
  <div class="brand">
    <span class="brand-mark"></span>
    <span class="brand-name">LiveFolio</span>
  </div>
  <div class="card">
    <span class="chip">Agent connection</span>
    <h1>Verify your identity</h1>
    ${successMsg ? `<div class="success">${successMsg}</div>` : ''}
    ${apiKey ? `<p class="description" style="color:var(--accent);font-weight:600;">${keyIntro}</p><div class="api-key-box">${apiKey}</div><p class="description">Your agent now has access to LiveFolio. You can close this page.</p>` : ''}
    ${errorMsg ? `<div class="error">${errorMsg}</div>` : ''}
    ${!successMsg ? `
    ${authorizeEnabled ? `
    <p class="description">${formDescription}</p>
    <div class="stack">
      <form method="POST">
        <input type="hidden" name="session_id" value="${sessionId}">
        <input type="hidden" name="claim_token" value="${claimToken}">
        <input type="hidden" name="authorize" value="1">
        <button type="submit" class="btn btn-primary">${authorizeLabel}</button>
      </form>
      <div class="divider">or enter the code from your email</div>
    </div>
    ` : `
    <p class="description">Enter the 6-digit verification code sent to your email to complete the connection to your AI agent.</p>
    `}
    <form method="POST">
      <div class="stack">
        <input type="text" name="code" class="code-input" maxlength="6" placeholder="000000" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" autofocus required>
        <input type="hidden" name="session_id" value="${sessionId}">
        <input type="hidden" name="claim_token" value="${claimToken}">
        <button type="submit" class="btn btn-ink">Verify code</button>
      </div>
    </form>
    ` : ''}
    <p class="footnote">LiveFolio — your folios, your audience.</p>
  </div>
</body></html>`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || '';
  const sessionId = url.searchParams.get('session') || '';

  if (!token || !sessionId) {
    return new NextResponse(
      verificationPage('', '', 'Missing verification parameters. Please use the link provided by your agent.'),
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  // Validate session exists
  const session = await getRegistrationSession(sessionId);
  if (!session) {
    return new NextResponse(
      verificationPage('', '', 'Verification session not found or expired. Please request a new code from your agent.'),
      { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  if (session.status === 'completed') {
    return new NextResponse(
      verificationPage('', '', 'This verification has already been completed. If you need a new key, start a new session from your agent.'),
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  // Validate the claim token before rendering the one-click authorize button.
  // Without this, a tampered/expired link would still render an authorize form.
  let authorizeEnabled = false;
  if (session.claimToken) {
    const claimTokenExpired = session.claimTokenExpiresAt
      ? new Date() > new Date(session.claimTokenExpiresAt)
      : false;
    if (!constantTimeEq(token, session.claimToken) || claimTokenExpired) {
      return new NextResponse(
        verificationPage('', '', 'This authorization link is invalid or expired. Ask your agent to send a new one.'),
        { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    }
    authorizeEnabled = true;
  }

  // Vary the copy by whether the claimed email already has an account.
  const account = session.email ? await getEmailAccountStatus(session.email) : undefined;

  return new NextResponse(
    verificationPage(sessionId, token, undefined, undefined, undefined, account, authorizeEnabled),
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const code = (formData.get('code') as string || '').trim();
  const sessionId = formData.get('session_id') as string || '';
  const claimToken = formData.get('claim_token') as string || '';
  // One-click magic-link path: posted by the "Authorize Agent" button.
  const authorize = (formData.get('authorize') as string || '') === '1';

  if (authorize) {
    if (!sessionId || !claimToken) {
      return new NextResponse(
        verificationPage('', '', 'This authorization link is incomplete. Ask your agent to send a new one.'),
        { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    }
  } else if (!code || !sessionId) {
    return new NextResponse(
      verificationPage(sessionId, claimToken, 'Please enter the 6-digit code from your email.'),
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  // ── OTP brute-force protection ────────────────────────────────────────
  // Per-session attempt limit (5) + per-IP limit (30). The one-click authorize
  // path shares these buckets, so a leaked link is still brute-force bounded.
  // Security posture of one-click authorize: magic-link-equivalent — inbox
  // possession + a 256-bit claim token with a 15-minute expiry.
  const clientIp = getClientIp(request);
  const ipLimit = checkRateLimit(`otp-verify:ip:${clientIp}`, 30, 15 * 60_000, 60 * 60_000);
  if (!ipLimit.allowed) {
    return new NextResponse(
      verificationPage(sessionId, claimToken, 'Too many verification attempts from this network. Please try again later.'),
      { status: 429, headers: { 'Content-Type': 'text/html; charset=utf-8', ...buildRateLimitHeaders(ipLimit) } }
    );
  }
  const attemptLimit = checkRateLimit(`otp-verify:session:${sessionId}`, 5, 10 * 60_000, 30 * 60_000);
  if (!attemptLimit.allowed) {
    return new NextResponse(
      verificationPage(sessionId, claimToken, attemptLimit.reason || 'Too many failed attempts. Please request a new code.'),
      { status: 429, headers: { 'Content-Type': 'text/html; charset=utf-8', ...buildRateLimitHeaders(attemptLimit, ipLimit) } }
    );
  }

  // Validate session
  const session = await getRegistrationSession(sessionId);
  if (!session) {
    return new NextResponse(
      verificationPage('', '', 'Verification session expired. Please request a new code from your agent.'),
      { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', ...buildRateLimitHeaders(attemptLimit, ipLimit) } }
    );
  }

  // Validate the claim token when the session carries one (defense in depth —
  // the OTP is still the primary credential on the code path).
  if (authorize) {
    // One-click path: the claim token IS the credential — mandatory and
    // time-bounded. The OTP is not required here.
    if (!session.claimToken) {
      return new NextResponse(
        verificationPage(sessionId, claimToken, 'This link is no longer valid. Please use the 6-digit code from your email instead.'),
        { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8', ...buildRateLimitHeaders(attemptLimit, ipLimit) } }
      );
    }
    const claimTokenExpired = session.claimTokenExpiresAt
      ? new Date() > new Date(session.claimTokenExpiresAt)
      : false;
    if (!constantTimeEq(claimToken, session.claimToken) || claimTokenExpired) {
      return new NextResponse(
        verificationPage(sessionId, claimToken, 'This authorization link is invalid or expired. Ask your agent to send a new one.'),
        { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', ...buildRateLimitHeaders(attemptLimit, ipLimit) } }
      );
    }
  } else if (session.claimToken && session.claimToken !== claimToken) {
    return new NextResponse(
      verificationPage(sessionId, claimToken, 'Invalid verification link. Please use the link provided by your agent.'),
      { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', ...buildRateLimitHeaders(attemptLimit, ipLimit) } }
    );
  }

  if (session.status === 'completed') {
    return new NextResponse(
      verificationPage('', '', 'Already verified.'),
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8', ...buildRateLimitHeaders(attemptLimit, ipLimit) } }
    );
  }

  if (session.status !== 'awaiting_otp' || (!authorize && !session.otpCode)) {
    return new NextResponse(
      verificationPage(sessionId, claimToken, 'No code has been sent yet. Ask your agent to send one first.'),
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8', ...buildRateLimitHeaders(attemptLimit, ipLimit) } }
    );
  }

  // Code path only: expiration + timing-safe comparison.
  if (!authorize) {
    if (session.otpExpiresAt && new Date() > new Date(session.otpExpiresAt)) {
      return new NextResponse(
        verificationPage(sessionId, claimToken, 'Verification code has expired. Ask your agent to send a new one.'),
        { status: 410, headers: { 'Content-Type': 'text/html; charset=utf-8', ...buildRateLimitHeaders(attemptLimit, ipLimit) } }
      );
    }

    const storedCode = session.otpCode!;
    let mismatch = 0;
    const maxLen = Math.max(code.length, storedCode.length);
    for (let i = 0; i < maxLen; i++) {
      mismatch |= (i < code.length ? code.charCodeAt(i) : 0) ^ (i < storedCode.length ? storedCode.charCodeAt(i) : 0);
    }

    if (mismatch !== 0 || code.length !== storedCode.length) {
      return new NextResponse(
        verificationPage(sessionId, claimToken, 'Incorrect code. Please check and try again.'),
        { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', ...buildRateLimitHeaders(attemptLimit, ipLimit) } }
      );
    }
  }

  // Account status at authorize time (before provisioning flips new → existing).
  const account = session.email ? await getEmailAccountStatus(session.email) : undefined;

  // Complete registration
  await completeRegistrationSession(sessionId);
  resetRateLimit(`otp-verify:session:${sessionId}`);

  // Provision workspace — email control was proven (OTP or one-click magic
  // link), so the account is created confirmed.
  try {
    const provisioned = await provisionAgentWorkspace(session.email!, { emailConfirmed: true });

    // Hardening: revoke the claim token once completed so a stale link dies.
    try {
      const { supabaseAdmin } = await import('@/lib/supabase');
      const { isOSS } = await import('@/lib/env');
      if (!isOSS && supabaseAdmin) {
        await supabaseAdmin
          .from('agent_registrations')
          .update({ claim_token: null, claim_token_expires_at: null })
          .eq('id', sessionId);
      }
    } catch {
      // Non-critical — the completed status already blocks re-use.
    }

    const successMsg = account === 'new'
      ? 'Workspace created successfully!'
      : 'Verification successful!';

    return new NextResponse(
      verificationPage(sessionId, claimToken, undefined, successMsg, provisioned.apiKey, account, false),
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', ...buildRateLimitHeaders(attemptLimit, ipLimit) } }
    );
  } catch (err: unknown) {
    console.error('[Agent Auth Verify] Provisioning failed:', err);
    return new NextResponse(
      verificationPage(sessionId, claimToken, 'Failed to provision workspace. Please try again later.'),
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}
