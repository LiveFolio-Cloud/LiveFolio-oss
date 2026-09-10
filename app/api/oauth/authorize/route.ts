import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import crypto from 'crypto';
import { createServerClient } from '@/lib/supabase';
import { getPublicOrigin } from '@/lib/network';
import { storeAuthCode } from '../token/route';
import { registeredClients } from '../register/route';

/**
 * GET /api/oauth/authorize
 *
 * OAuth 2.0 Authorization Endpoint — shows a consent screen.
 * After user approval, redirects back with an authorization code.
 *
 * Query params: client_id, redirect_uri, code_challenge, code_challenge_method, state, scope
 *
 * GET: renders consent screen
 * POST: handles approval/denial
 */

// Pre-registered OAuth clients — icons are real provider favicons
// (Google's public icon service), so the consent screen shows the actual
// brand instead of an emoji.
const REGISTERED_CLIENTS: Record<string, { name: string; domain: string }> = {
  'claude-code': { name: 'Claude Code', domain: 'claude.ai' },
  claude: { name: 'Claude', domain: 'claude.ai' },
  chatgpt: { name: 'ChatGPT', domain: 'chatgpt.com' },
  cursor: { name: 'Cursor', domain: 'cursor.com' },
  windsurf: { name: 'Windsurf', domain: 'windsurf.com' },
  copilot: { name: 'GitHub Copilot', domain: 'github.com' },
  gemini: { name: 'Gemini', domain: 'gemini.google.com' },
  openai: { name: 'OpenAI', domain: 'openai.com' },
  anthropic: { name: 'Anthropic', domain: 'anthropic.com' },
};

/** Provider logo — Google's public favicon service (img-src https: ok). */
function providerIcon(domain?: string): string {
  return domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128` : '';
}

// HTML-escape user/client-controlled values interpolated into the consent page.
const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));

// HMAC-sign the oauth_session cookie so its contents cannot be tampered with.
// The signing key MUST be configured in cloud (LIVEFOLIO_API_KEY). A fixed
// dev fallback is used only so local OSS development keeps working.
const COOKIE_SECRET = process.env.LIVEFOLIO_API_KEY || process.env.OAUTH_SESSION_SECRET || 'livefolio-oauth-dev-key-do-not-use-in-prod';
function signCookieValue(value: string): string {
  const hmac = crypto.createHmac('sha256', COOKIE_SECRET).update(value).digest('hex');
  return `${value}.${hmac}`;
}
function verifyCookieValue(signed: string): string | null {
  const dot = signed.lastIndexOf('.');
  if (dot === -1) return null;
  const value = signed.slice(0, dot);
  const sig = signed.slice(dot + 1);
  const expected = crypto.createHmac('sha256', COOKIE_SECRET).update(value).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return value;
}

function consentPage(title: string, clientName: string, clientIcon: string, scopes: string[], errorMsg?: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate"><title>${title}</title>
<link rel="icon" type="image/svg+xml" href="/favicon-square.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  :root{color-scheme:light;--bg:#F4F4F0;--card:#FFFFFF;--ink:#0F0F0D;--muted:rgba(15,15,13,.55);--faint:rgba(15,15,13,.35);--line:rgba(15,15,13,.08);--accent:#FF3B00;--panel:rgba(15,15,13,.03)}
  body{font-family:'Plus Jakarta Sans',ui-sans-serif,system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--ink);min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 16px}
  @keyframes lf-pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.3);opacity:.6}}
  .brand{display:flex;align-items:center;gap:10px;margin-bottom:20px}
  .brand-mark{width:14px;height:14px;background:var(--accent);animation:lf-pulse 1.2s ease-in-out infinite}
  .brand-name{font-family:'Space Grotesk','Cabinet Grotesk',sans-serif;font-size:18px;font-weight:700;letter-spacing:-.03em}
  .card{background:var(--card);width:100%;max-width:400px;border-radius:20px;padding:32px 28px;text-align:center;box-shadow:0 1px 2px rgba(15,15,13,.04),0 16px 48px -24px rgba(15,15,13,.18);border:1px solid var(--line)}
  .chip{display:inline-flex;align-items:center;gap:6px;border-radius:999px;background:rgba(255,59,0,.08);color:var(--accent);font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;padding:5px 12px;margin-bottom:16px}
  .chip::before{content:'';width:5px;height:5px;border-radius:99px;background:var(--accent)}
  h1{font-family:'Space Grotesk','Cabinet Grotesk',sans-serif;font-size:24px;font-weight:700;letter-spacing:-.035em;line-height:1.1}
  .flow-row{display:flex;align-items:center;justify-content:center;gap:18px;margin:24px 0 20px}
  .party{display:flex;flex-direction:column;align-items:center;gap:8px;width:88px}
  .client-icon-wrap{width:52px;height:52px;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:26px;line-height:1;background:var(--panel);border:1px solid var(--line);overflow:hidden}
  .client-favicon{width:100%;height:100%;object-fit:cover}
  .party-name{font-family:'Space Grotesk','Cabinet Grotesk',sans-serif;font-size:11px;font-weight:700;letter-spacing:-.01em;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .party-sub{font-size:9px;font-weight:600;color:var(--faint);text-transform:uppercase;letter-spacing:.12em}
  .lf-mark{width:16px;height:16px;background:var(--accent)}
  .arrow{font-size:18px;color:var(--accent);font-weight:700}
  .description{font-size:13px;line-height:1.6;color:var(--muted);margin:0 auto 18px;max-width:300px}
  .scopes{text-align:left;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:20px}
  .scopes-title{font-size:10px;font-weight:700;color:var(--faint);text-transform:uppercase;letter-spacing:.12em;margin-bottom:8px}
  .scope-item{font-size:12px;font-weight:500;color:var(--ink);opacity:.75;padding:3px 0}
  .scope-item::before{content:'✓ ';color:var(--accent);font-weight:700}
  .actions{display:flex;flex-direction:column;gap:10px}
  .btn{display:inline-flex;align-items:center;justify-content:center;width:100%;height:44px;border:none;border-radius:999px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;transition:opacity .15s ease,background-color .15s ease;text-decoration:none}
  .btn-approve{background:var(--accent);color:#fff}
  .btn-approve:hover{opacity:.9}
  .btn-deny{background:transparent;color:var(--ink);border:1px solid var(--line)}
  .btn-deny:hover{background:var(--panel)}
  .error{background:rgba(255,59,0,.07);border:1px solid rgba(255,59,0,.25);color:#D92D00;border-radius:12px;padding:10px 12px;font-size:12px;font-weight:600;line-height:1.5;margin-bottom:16px}
  .footnote{font-size:11px;color:var(--faint);margin-top:18px}
  form{display:contents}
  @media (max-width:420px){.card{padding:28px 20px}h1{font-size:21px}}
  @media (prefers-color-scheme:dark){
    :root{color-scheme:dark;--bg:#0F0F0D;--card:#171714;--ink:#F4F4F0;--muted:rgba(244,244,240,.58);--faint:rgba(244,244,240,.32);--line:rgba(244,244,240,.1);--panel:rgba(244,244,240,.04)}
    .btn-deny{color:var(--ink)}
  }
</style></head><body>
  <div class="brand">
    <span class="brand-mark"></span>
    <span class="brand-name">LiveFolio</span>
  </div>
  <div class="card">
    <span class="chip">OAuth connection</span>
    <h1>Authorize access</h1>
    <div class="flow-row">
      <div class="party">
        <span class="client-icon-wrap">${/^https?:\/\//.test(clientIcon) ? `<img class="client-favicon" src="${esc(clientIcon)}" alt="${esc(clientName)}" referrerpolicy="no-referrer">` : esc(clientIcon)}</span>
        <span class="party-name">${esc(clientName)}</span>
        <span class="party-sub">App</span>
      </div>
      <span class="arrow">&rarr;</span>
      <div class="party">
        <span class="client-icon-wrap"><span class="lf-mark"></span></span>
        <span class="party-name">LiveFolio</span>
        <span class="party-sub">Workspace</span>
      </div>
    </div>
    <p class="description">${esc(clientName)} wants to access your LiveFolio workspace to create, update, and manage your folios through the MCP protocol.</p>
    ${errorMsg ? `<div class="error">${esc(errorMsg)}</div>` : ''}
    <div class="scopes">
      <div class="scopes-title">Permissions requested</div>
      ${scopes.map(s => `<div class="scope-item">${esc(s)}</div>`).join('')}
    </div>
    <div class="actions">
      <form method="POST" action="/api/oauth/authorize"><input type="hidden" name="action" value="approve"><button type="submit" class="btn btn-approve">Approve &amp; connect</button></form>
      <form method="POST" action="/api/oauth/authorize"><input type="hidden" name="action" value="deny"><button type="submit" class="btn btn-deny">Deny</button></form>
    </div>
    <p class="footnote">LiveFolio — your folios, your audience.</p>
  </div>
</body></html>`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const client_id = url.searchParams.get('client_id') || 'unknown';
  const redirect_uri = url.searchParams.get('redirect_uri');
  const code_challenge = url.searchParams.get('code_challenge');
  const code_challenge_method = url.searchParams.get('code_challenge_method');
  const state = url.searchParams.get('state') || '';
  const scope = url.searchParams.get('scope') || 'mcp:read mcp:write';

  // Validate required params
  if (!redirect_uri || !code_challenge) {
    return NextResponse.json({ error: 'invalid_request', error_description: 'redirect_uri and code_challenge are required' }, { status: 400 });
  }

  if (code_challenge_method !== 'S256') {
    return NextResponse.json({ error: 'invalid_request', error_description: 'Only S256 code_challenge_method is supported' }, { status: 400 });
  }

  // ── Client + redirect_uri validation (prevents authorization-code theft) ──
  const staticClient = REGISTERED_CLIENTS[client_id];
  const dynamicClient = registeredClients.get(client_id);
  const dynamicDomain = (() => {
    try {
      const uri = dynamicClient?.redirect_uris?.[0];
      return uri ? new URL(uri).hostname : undefined;
    } catch { return undefined; }
  })();
  const client = staticClient
    ? { name: staticClient.name, icon: providerIcon(staticClient.domain), domain: staticClient.domain, redirectUris: null as string[] | null }
    : dynamicClient
      ? { name: dynamicClient.client_name, icon: providerIcon(dynamicDomain), domain: dynamicDomain, redirectUris: dynamicClient.redirect_uris }
      : null;

  if (!client) {
    return NextResponse.json(
      { error: 'invalid_client', error_description: 'Unknown client_id. Register the client first via /api/oauth/register.' },
      { status: 400 }
    );
  }

  const redirectUriValid = (() => {
    if (client.redirectUris) {
      return client.redirectUris.includes(redirect_uri);
    }
    // Static well-known clients (Claude Code, Cursor, …) use loopback or
    // https redirects — enforce that instead of accepting anything.
    try {
      const u = new URL(redirect_uri);
      if (u.protocol === 'https:') return true;
      if (u.protocol === 'http:') {
        const host = u.hostname.toLowerCase();
        return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
      }
      return false;
    } catch {
      return false;
    }
  })();

  if (!redirectUriValid) {
    return NextResponse.json(
      { error: 'invalid_redirect_uri', error_description: 'redirect_uri is not registered for this client (https or loopback http only)' },
      { status: 400 }
    );
  }

  // Require authentication — redirect to login if no session
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) {
    // Redirect to the PUBLIC origin — request.url is the internal bind
    // address behind the Render proxy (0.0.0.0:10000) and would dead-end.
    const loginUrl = new URL('/login', getPublicOrigin(request));
    loginUrl.searchParams.set('next', `/api/oauth/authorize?${new URL(request.url).searchParams.toString()}`);
    return NextResponse.redirect(loginUrl.toString());
  }

  // Store OAuth params in a SIGNED cookie for the POST handler. The cookie is
  // HMAC-signed so its contents (redirect_uri, challenge, …) cannot be
  // tampered with, and the session is re-verified in POST.
  const params = JSON.stringify({ client_id, redirect_uri, code_challenge, state, scope });
  const signedParams = signCookieValue(params);
  const isSecureContext = getPublicOrigin(request).startsWith('https://');
  const cookieHeader = `oauth_session=${encodeURIComponent(signedParams)}; Path=/api/oauth; HttpOnly; SameSite=Lax${isSecureContext ? '; Secure' : ''}; Max-Age=120`;

  const scopes = scope.split(' ').filter(Boolean);

  return new NextResponse(consentPage('LiveFolio — Authorize Access', client.name, client.icon, scopes), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Set-Cookie': cookieHeader,
    },
  });
}

/** Follow the form POST with a 200 scripted redirect — a plain form
 * navigation to a 303/302 trips the global CSP's form-action 'self' in some
 * embedding contexts; location.replace() is a normal navigation and immune. */
function redirectPage(url: string, extraHeaders?: Record<string, string>): Response {
  const safe = JSON.stringify(url);
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Cache-Control" content="no-cache, no-store"><title>Redirecting…</title></head><body><script>location.replace(${safe})<\/script></body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, max-age=0', ...extraHeaders },
  });
}

/** Follow the form POST with a scripted redirect (see redirectPage). */
function redirectPageWithHeaders(url: string, extra?: Record<string, string>): Response {
  return redirectPage(url, extra);
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const action = formData.get('action') as string;

  // Read OAuth params from the SIGNED cookie
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/oauth_session=([^;]+)/);
  if (!match) {
    return new NextResponse(consentPage('LiveFolio — Session Expired', 'Unknown', '🔌', [], 'Session expired. Please try connecting again.'), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // Verify the cookie signature — tampered cookies are rejected.
  const signedValue = decodeURIComponent(match[1]);
  const value = verifyCookieValue(signedValue);
  if (!value) {
    return new NextResponse(consentPage('LiveFolio — Session Expired', 'Unknown', '🔌', [], 'Session verification failed. Please try connecting again.'), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // Params come from the HMAC-signed oauth_session cookie written by GET with
  // exactly these four string fields, so the parsed shape is fixed.
  let params: { client_id: string; redirect_uri: string; code_challenge: string; state: string };
  try {
    params = JSON.parse(value);
  } catch {
    return new NextResponse(consentPage('LiveFolio — Session Expired', 'Unknown', '🔌', [], 'Session expired. Please try connecting again.'), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
  const { client_id, redirect_uri, code_challenge, state } = params;

  // Re-verify the Supabase session — authorization codes are minted ONLY for
  // the currently authenticated user, never from the cookie's contents.
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) {
    return new NextResponse(consentPage('LiveFolio — Session Expired', 'Unknown', '🔌', [], 'Your session has expired. Please sign in again and retry the connection.'), {
      status: 401,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
  const email = user.email;

  if (action === 'deny') {
    const denyUrl = new URL(redirect_uri);
    denyUrl.searchParams.set('error', 'access_denied');
    denyUrl.searchParams.set('error_description', 'User denied the request');
    if (state) denyUrl.searchParams.set('state', state);
    return redirectPage(denyUrl.toString());
  }

  const authCode = storeAuthCode(email, code_challenge, redirect_uri, client_id);

  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set('code', authCode);
  if (state) redirectUrl.searchParams.set('state', state);

  // Clear the oauth session cookie
  const clearCookie = 'oauth_session=; Path=/api/oauth; HttpOnly; SameSite=Lax; Max-Age=0';

  // Scripted redirect page (GET semantics after the POST) — Claude/OpenAI
  // callbacks are GET-only, and a plain 3xx would also re-trip the global
  // CSP's form-action 'self' in embedding contexts.
  return redirectPageWithHeaders(
    redirectUrl.toString(),
    clearCookie ? { 'Set-Cookie': clearCookie } : undefined
  );
}
