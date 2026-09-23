import { Resend } from 'resend';

// Instantiate Resend client lazily — env vars may not be loaded at module init time
let resend: Resend | null = null;
let resendInit = false;
function getResend(): Resend | null {
  if (resendInit) return resend;
  resendInit = true;
  const key = process.env.RESEND_API_KEY || '';
  if (key && key !== 're_your_resend_api_key_here') {
    resend = new Resend(key);
  }
  return resend;
}
function getFromEmail(): string {
  return process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
}

/**
 * Service to dispatch transactional emails.
 * Integrates Resend in production/cloud, and falls back to terminal console logs in local development.
 */
// ─── Shared fragments (v2 Apple-style) ────────────────────────────────────
// A white rounded card on the bone canvas, Space Grotesk display type, soft
// ink text, hairline borders, and one vermillion moment (the square mark +
// the CTA). No hard borders, no mono-everything, no shouting uppercase.
// Email HTML stays table-based with inline styles for maximum client
// compatibility.

// Escape user-controlled values before interpolating them into email HTML —
// otherwise folio titles / inviter names / share messages can inject markup
// (phishing links) into transactional emails sent from the LiveFolio domain.
function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

// Brand mark rendered as a vermillion square via nested table cells — works in
// every email client (no <img>/SVG needed). `size` in px.
function brandSquare(size: number): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-block;vertical-align:middle"><tr><td style="width:${size}px;height:${size}px;background-color:#FF3B00;font-size:0;line-height:0">&nbsp;</td></tr></table>`;
}

function emailHeader(): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
    <td style="padding:36px 36px 8px 36px;text-align:center">
      ${brandSquare(14)}
      <span style="font-family:'Space Grotesk',-apple-system,'Segoe UI',system-ui,sans-serif;font-size:19px;font-weight:700;letter-spacing:-0.02em;color:#0F0F0D;vertical-align:middle;margin-left:10px">LiveFolio</span>
    </td></tr></table>`;
}

function emailFooter(): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
    <td style="padding:24px 36px 32px 36px;border-top:1px solid rgba(15,15,13,0.08)">
      <p style="margin:0 0 10px 0;font-family:-apple-system,'Segoe UI',system-ui,sans-serif;font-size:12px;line-height:1.5;color:#8A8A85;text-align:center">If you did not request this, please ignore this email.</p>
      <p style="text-align:center;margin:0">
        ${brandSquare(9)}
        <span style="font-family:'Space Grotesk',-apple-system,'Segoe UI',system-ui,sans-serif;font-size:11px;font-weight:700;color:#8A8A85;vertical-align:middle;margin-left:6px">LiveFolio</span>
      </p>
      <p style="margin:8px 0 0 0;font-family:Georgia,'Times New Roman',serif;font-size:12px;font-style:italic;color:#B0B0AA;text-align:center">Links, not files.</p>
    </td></tr></table>`;
}

function emailWrapper(title: string, heading: string, bodyHtml: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta name="color-scheme" content="light"><title>${title}</title></head>
<body style="margin:0;padding:0;background-color:#F4F4F0">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F0;padding:48px 20px"><tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:520px;background-color:#FFFFFF;border-radius:16px;border:1px solid rgba(15,15,13,0.06);font-family:-apple-system,'Segoe UI',system-ui,sans-serif;color:#0F0F0D">
${emailHeader()}
<tr><td style="padding:0 36px 16px 36px"><h2 style="font-family:'Space Grotesk',-apple-system,'Segoe UI',system-ui,sans-serif;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#0F0F0D;margin:0;text-align:center">${heading}</h2></td></tr>
${bodyHtml}
${emailFooter()}
</table></td></tr></table></body></html>`;
}

/** Rounded vermillion CTA button — the one loud moment in the email. */
function ctaButton(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto"><tr><td align="center">
  <a href="${href}" style="display:inline-block;background-color:#FF3B00;color:#FFFFFF;font-family:'Space Grotesk',-apple-system,'Segoe UI',system-ui,sans-serif;font-size:14px;font-weight:600;text-decoration:none;padding:13px 28px;border-radius:10px">${label} →</a>
</td></tr></table>`;
}

// ─── Shared dispatch ──────────────────────────────────────────────────────────

async function dispatch(params: {
  to: string; subject: string; text: string; html: string; label: string;
}): Promise<{ success: boolean; provider: 'resend' | 'console' }> {
  const client = getResend();
  if (client) {
    try {
      await client.emails.send({ from: `LiveFolio <${getFromEmail()}>`, to: params.to, subject: params.subject, text: params.text, html: params.html });
      console.log(`[Email Service] ${params.label} sent via Resend to: ${params.to}`);
      return { success: true, provider: 'resend' };
    } catch (err) {
      console.error(`[Email Service] ${params.label} dispatch failed, falling back to console:`, err);
    }
  }
  console.log(`[Email Sandbox] ${params.label} → ${params.to}: "${params.subject}"`);
  return { success: true, provider: 'console' };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * OTP verification code for agent auth flow.
 * When `authorizeUrl` is provided, the email becomes a magic link: the CTA
 * completes the one-click authorize (possession of the inbox proves identity)
 * and the 6-digit code remains as a fallback for chat-console entry.
 */
export async function sendOtpEmail(
  to: string,
  code: string,
  authorizeUrl?: string
): Promise<{ success: boolean; provider: 'resend' | 'console' }> {
  // Never put the OTP in the subject line — subjects are logged by mail
  // servers, shown on lock screens, and captured by notification centers.
  const subject = `🔑 Your LiveFolio Verification Code`;
  const text = `Hello,\n\nAn AI Agent has requested to bind with your LiveFolio workspace.\n\n${authorizeUrl ? `One-click authorize: ${authorizeUrl}\n\n` : ''}Your 6-digit code is:\n👉 ${code}\n\n${authorizeUrl ? 'Click the link above to authorize with one click, or ' : ''}Enter this code in your agent's chat window. Valid for 10 minutes.\n\nIf you did not request this, ignore this email.\n\n— The LiveFolio Team`;
  const body = `<tr><td style="padding:0 36px 24px 36px"><p style="font-size:14px;line-height:1.6;margin:0;color:#5A5A56;text-align:center">An AI Agent is requesting authorization to publish, update, and manage interactive HTML documents in your LiveFolio workspace.</p></td></tr>
${authorizeUrl ? `<tr><td style="padding:0 36px 24px 36px">${ctaButton('Authorize Agent', escapeHtml(authorizeUrl))}</td></tr>
<tr><td style="padding:0 36px 24px 36px;text-align:center"><p style="font-size:11px;color:#8A8A85;margin:0">Or: <span style="color:#FF3B00;word-break:break-all">${escapeHtml(authorizeUrl)}</span></p></td></tr>` : ''}
<tr><td style="padding:0 36px 24px 36px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F0;border-radius:12px"><tr><td style="padding:24px;text-align:center"><span style="font-family:'SF Mono','Fira Code',ui-monospace,monospace;font-size:32px;font-weight:700;letter-spacing:0.18em;color:#0F0F0D;word-break:break-all">${escapeHtml(code)}</span></td></tr></table></td></tr>
<tr><td style="padding:0 36px 24px 36px"><p style="font-size:12px;line-height:1.5;color:#8A8A85;text-align:center;margin:0">This code is valid for 10 minutes.${authorizeUrl ? ' The authorize link is valid for 15 minutes.' : ''} Enter this code into your assistant's chat console to link your account.</p></td></tr>`;
  return dispatch({ to, subject, text, html: emailWrapper('LiveFolio — Verify Your Agent', 'Verify Your Agent', body), label: 'OTP' });
}

/** Organization invitation — sent when an Owner/Admin invites a teammate. */
export async function sendOrgInviteEmail(params: {
  to: string; orgName: string; inviterName: string; role: 'Admin' | 'Member'; inviteUrl: string;
}): Promise<{ success: boolean; provider: 'resend' | 'console' }> {
  const orgName = escapeHtml(params.orgName);
  const inviterName = escapeHtml(params.inviterName);
  const role = escapeHtml(params.role);
  const inviteUrl = escapeHtml(params.inviteUrl);
  const subject = `🤝 You've been invited to join ${orgName} on LiveFolio`;
  const text = `Hello,\n\n${inviterName} has invited you to join ${orgName} on LiveFolio as a${params.role === 'Admin' ? 'n' : ''} ${role}.\n\nAccept: ${params.inviteUrl}\n\nIf you don't know ${inviterName}, you can safely ignore this email.\n\n— The LiveFolio Team`;
  const body = `<tr><td style="padding:0 36px 16px 36px"><p style="font-size:14px;line-height:1.6;color:#5A5A56;margin:0;text-align:center"><strong style="color:#0F0F0D">${inviterName}</strong> has invited you to join <strong style="color:#0F0F0D">${orgName}</strong> as a${params.role === 'Admin' ? 'n' : ''} <strong style="color:#0F0F0D">${role}</strong>.</p></td></tr>
<tr><td style="padding:0 36px 24px 36px;text-align:center"><span style="display:inline-block;background-color:#FF3B000D;color:#FF3B00;font-family:'Space Grotesk',system-ui,sans-serif;font-size:12px;font-weight:600;letter-spacing:0.04em;padding:6px 14px;border-radius:999px">${role}</span></td></tr>
<tr><td style="padding:0 36px 24px 36px">${ctaButton('Accept Invitation', inviteUrl)}</td></tr>
<tr><td style="padding:0 36px 24px 36px;text-align:center"><p style="font-size:11px;color:#8A8A85;margin:0">Or: <span style="color:#FF3B00;word-break:break-all">${inviteUrl}</span></p></td></tr>
<tr><td style="padding:0 36px 8px 36px"><p style="font-size:11px;color:#8A8A85;text-align:center;margin:0">Invitation sent by ${inviterName}.</p></td></tr>`;
  return dispatch({ to: params.to, subject, text, html: emailWrapper(`Join ${orgName} on LiveFolio`, "You've Been Invited", body), label: 'Org Invite' });
}

/** Magic link / password reset — branded sign-in email. */
export async function sendMagicLinkEmail(params: {
  to: string; link: string; isReset?: boolean;
}): Promise<{ success: boolean; provider: 'resend' | 'console' }> {
  const isReset = !!params.isReset;
  const subject = isReset ? 'Reset your LiveFolio password' : 'Sign in to LiveFolio';
  const heading = isReset ? 'Reset Your Password' : 'Sign In';
  const btn = isReset ? 'Reset Password' : 'Sign In';
  const desc = isReset
    ? 'Click below to set a new password. No need to remember the old one.'
    : 'Click below to sign in. No password needed — the link does the work.';
  const text = `${desc}\n\n${params.link}\n\nThis link works once and expires in 10 minutes — click it on the device you're signing in on. If you need another, just request a new link.\n\nIf you did not request this, please ignore this email.\n\n— The LiveFolio Team`;
  const body = `<tr><td style="padding:0 36px 24px 36px"><p style="font-size:14px;line-height:1.6;margin:0;color:#5A5A56;text-align:center">${desc}</p></td></tr>
<tr><td style="padding:0 36px 24px 36px">${ctaButton(btn, params.link)}</td></tr>
<tr><td style="padding:0 36px 8px 36px"><p style="font-size:11px;color:#8A8A85;text-align:center;margin:0">Single-use link — expires in 10 minutes. Click it on the device you're signing in on.</p></td></tr>`;
  return dispatch({ to: params.to, subject, text, html: emailWrapper(subject, heading, body), label: 'Magic Link' });
}

/** Welcome email — sent after new user signup. */
export async function sendWelcomeEmail(params: {
  to: string; userName: string; dashboardUrl: string;
}): Promise<{ success: boolean; provider: 'resend' | 'console' }> {
  const userName = escapeHtml(params.userName);
  const dashboardUrl = escapeHtml(params.dashboardUrl);
  const subject = `🎉 Welcome to LiveFolio — let's get started`;
  const text = `Welcome to LiveFolio, ${userName}!\n\n1. CREATE YOUR FIRST FOLIO — ${dashboardUrl}\n2. CONNECT YOUR AI AGENT — Install the LiveFolio MCP server\n3. SHARE WITH THE WORLD — Every folio gets a public URL\n\n— The LiveFolio Team`;
  const step = (n: number, title: string, desc: string) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F0;border-radius:12px;margin-bottom:12px"><tr><td style="padding:16px 18px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="width:32px;vertical-align:top"><span style="display:inline-block;width:26px;height:26px;background-color:#FF3B00;color:#FFFFFF;font-family:'Space Grotesk',system-ui,sans-serif;font-size:13px;font-weight:700;line-height:26px;text-align:center;border-radius:999px">${n}</span></td><td style="vertical-align:top;padding-left:12px"><p style="font-size:13px;font-weight:700;color:#0F0F0D;margin:0 0 4px 0">${title}</p><p style="font-size:12px;line-height:1.5;color:#5A5A56;margin:0">${desc}</p></td></tr></table></td></tr></table>`;
  const body = `<tr><td style="padding:0 36px 16px 36px"><p style="font-size:14px;line-height:1.6;color:#5A5A56;margin:0;text-align:center">Create, share, and version AI-generated interactive HTML documents — we call them <strong style="color:#0F0F0D">folios</strong>.</p></td></tr>
<tr><td style="padding:0 36px 8px 36px">${step(1, 'Create Your First Folio', 'Go to your dashboard and describe what you want — our AI builds it instantly.')}${step(2, 'Connect Your AI Agent', 'Install the LiveFolio MCP server so AI coding agents can publish folios directly.')}${step(3, 'Share With the World', 'Every folio gets a public URL. Share it, embed it, collect feedback.')}</td></tr>
<tr><td style="padding:16px 36px 16px 36px">${ctaButton('Go to Dashboard', params.dashboardUrl)}</td></tr>
<tr><td style="padding:0 36px 16px 36px;text-align:center"><p style="font-size:12px;color:#8A8A85;margin:0"><a href="https://livefolio.cloud/docs" style="color:#FF3B00">Documentation</a> · <a href="https://livefolio.cloud/docs/mcp" style="color:#FF3B00">MCP Setup</a></p></td></tr>`;
  return dispatch({ to: params.to, subject, text, html: emailWrapper('Welcome to LiveFolio', `Welcome, ${userName}!`, body), label: 'Welcome' });
}

/** Share notification — sent when a user shares a folio via email. */
export async function sendShareNotification(params: {
  to: string; folioTitle: string; sharedByName: string; folioUrl: string; message?: string;
}): Promise<{ success: boolean; provider: 'resend' | 'console' }> {
  const folioTitle = escapeHtml(params.folioTitle);
  const sharedByName = escapeHtml(params.sharedByName);
  const folioUrl = escapeHtml(params.folioUrl);
  const message = params.message ? escapeHtml(params.message) : '';
  const subject = `📄 ${sharedByName} shared a LiveFolio with you: ${folioTitle}`;
  const text = `Hello,\n\n${params.sharedByName} shared a LiveFolio with you:\n"${params.folioTitle}"\n${params.message ? `\n"${params.message}"\n` : ''}\nView: ${params.folioUrl}\n\n— The LiveFolio Team`;
  const body = `<tr><td style="padding:0 36px 16px 36px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F0;border-radius:12px"><tr><td style="padding:22px;text-align:center"><p style="font-family:'Space Grotesk',system-ui,sans-serif;font-size:18px;font-weight:700;color:#0F0F0D;margin:0 0 6px 0;letter-spacing:-0.02em">${folioTitle}</p><p style="font-size:12px;color:#8A8A85;margin:0">Interactive HTML document · View on LiveFolio</p></td></tr></table></td></tr>${message ? `<tr><td style="padding:0 36px 16px 36px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F0;border-radius:12px"><tr><td style="padding:14px 18px"><p style="font-size:13px;line-height:1.5;color:#5A5A56;font-style:italic;margin:0">"${message}"</p></td></tr></table></td></tr>` : ''}<tr><td style="padding:0 36px 24px 36px">${ctaButton('View Folio', folioUrl)}</td></tr><tr><td style="padding:0 36px 16px 36px;text-align:center"><p style="font-size:11px;color:#8A8A85;margin:0">Or: <span style="color:#FF3B00;word-break:break-all">${folioUrl}</span></p></td></tr><tr><td style="padding:0 36px 8px 36px"><p style="font-size:11px;color:#8A8A85;text-align:center;margin:0">Sent by ${sharedByName} via LiveFolio.</p></td></tr>`;
  return dispatch({ to: params.to, subject, text, html: emailWrapper(`${folioTitle} — Shared via LiveFolio`, `${sharedByName} shared a folio with you`, body), label: 'Share' });
}
