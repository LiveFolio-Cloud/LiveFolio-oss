import crypto from 'crypto';
import { provisionAgentWorkspace } from '@/lib/auth-provisioner';
import { CORS_JSON_HEADERS, corsPreflight, corsJson } from '@/lib/api/cors';

/**
 * POST /api/oauth/token
 *
 * OAuth 2.0 Token Endpoint — exchanges authorization code + PKCE verifier for an API key.
 *
 * Body: { grant_type, code, code_verifier, client_id, redirect_uri }
 * Response: { access_token, token_type, expires_in, scope }
 *
 * Supports: authorization_code grant with S256 PKCE.
 */

// In-memory code store (codes expire after 5 minutes)
const codeStore = new Map<string, { email: string; challenge: string; redirectUri: string; clientId: string; expiresAt: number; used: boolean }>();

// ── CORS ─────────────────────────────────────────────────────────────
// Cached for a day: connectors preflight this endpoint once per session.
const CORS = { methods: 'POST, OPTIONS', headers: CORS_JSON_HEADERS, maxAge: 86400 };

export async function OPTIONS() {
  return corsPreflight(CORS);
}

function corsResponse(body: unknown, init?: ResponseInit) {
  return corsJson(body, init, CORS);
}

/**
 * Reject a token request AND log why.
 *
 * Every failure below returns `invalid_grant` to the client, which by design
 * reveals nothing. But they used to reveal nothing to US either: the request
 * and its body were logged, then the handler returned 400 with no line
 * explaining which check failed. A connector stuck in a retry loop was
 * therefore indistinguishable from a healthy one in the logs — the only
 * evidence was a repeated POST with no outcome.
 */
function reject(error: string, description: string) {
  console.warn(`[OAuth Token] REJECTED [${error}] ${description}`);
  return corsResponse({ error, error_description: description }, { status: 400 });
}

export function storeAuthCode(email: string, challenge: string, redirectUri?: string, clientId?: string): string {
  const code = crypto.randomBytes(32).toString('hex');
  codeStore.set(code, {
    email,
    challenge,
    redirectUri: redirectUri || '',
    clientId: clientId || '',
    expiresAt: Date.now() + 5 * 60_000,
    used: false,
  });
  return code;
}

// Clean expired codes every 60 seconds
setInterval(() => {
  const now = Date.now();
  codeStore.forEach((entry, code) => {
    if (entry.expiresAt < now || entry.used) codeStore.delete(code);
  });
}, 60_000);

export async function POST(request: Request) {
  console.log('[OAuth Token] POST received — content-type:', request.headers.get('content-type'));
  let body: Record<string, string> = {};

  // OAuth 2.0 §4.1.3: token requests use application/x-www-form-urlencoded
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      body = await request.json();
    } catch (err) {
      console.error('[OAuth Token] Failed to parse JSON body:', err);
      return corsResponse({ error: 'invalid_request', error_description: 'Invalid JSON body' }, { status: 400 });
    }
  } else {
    // Parse as form-encoded
    try {
      const text = await request.text();
      const params = new URLSearchParams(text);
      params.forEach((value, key) => {
        body[key] = value;
      });
    } catch (err) {
      console.error('[OAuth Token] Failed to parse form body:', err);
      return corsResponse({ error: 'invalid_request', error_description: 'Invalid request body' }, { status: 400 });
    }
  }

  console.log('[OAuth Token] Body:', JSON.stringify({ grant_type: body.grant_type, client_id: body.client_id, has_code: !!body.code, has_verifier: !!body.code_verifier }));
  const { grant_type, code, code_verifier, client_id, redirect_uri } = body;

  // Validate grant type
  if (grant_type !== 'authorization_code') {
    return reject('unsupported_grant_type', 'Only authorization_code is supported');
  }

  // Validate required params
  if (!code || !code_verifier || !client_id) {
    return reject('invalid_request', 'code, code_verifier, and client_id are required');
  }

  // Look up the auth code
  const entry = codeStore.get(code);
  if (!entry) {
    // The store is in-process memory, so a restart between authorize and
    // redeem empties it and every in-flight code reads as "not found". Say so
    // explicitly — it is the one cause that is neither the client's fault nor
    // fixable by retrying with the same code.
    return reject(
      'invalid_grant',
      `Authorization code not found or expired (store holds ${codeStore.size} live code(s); a service restart drops them)`
    );
  }

  if (entry.used) {
    return reject('invalid_grant', 'Authorization code already used');
  }

  if (entry.expiresAt < Date.now()) {
    codeStore.delete(code);
    return reject('invalid_grant', 'Authorization code expired');
  }

  // Validate redirect_uri and client_id binding (RFC 6749 §4.1.3):
  // if they were present at authorization, they MUST match at redemption.
  if (entry.redirectUri) {
    if (!redirect_uri || entry.redirectUri !== redirect_uri) {
      return reject(
        'invalid_grant',
        `redirect_uri mismatch (expected "${entry.redirectUri}", got "${redirect_uri ?? ''}")`
      );
    }
  }
  if (entry.clientId && entry.clientId !== client_id) {
    return reject('invalid_grant', `client_id mismatch (expected "${entry.clientId}", got "${client_id}")`);
  }

  // Verify PKCE (S256)
  try {
    const expectedChallenge = crypto.createHash('sha256').update(code_verifier).digest('base64url');
    if (expectedChallenge !== entry.challenge) {
      return reject('invalid_grant', 'PKCE verification failed');
    }
  } catch {
    return reject('invalid_grant', 'PKCE verification failed');
  }

  // Mark code as used (one-time use)
  entry.used = true;

  // Provision workspace and get API key (the user authenticated via
  // Supabase session — email control is proven).
  try {
    const { apiKey, organization } = await provisionAgentWorkspace(entry.email, { emailConfirmed: true });
    return corsResponse({
      access_token: apiKey,
      token_type: 'Bearer',
      expires_in: 315360000, // 10 years (API keys don't expire, but OAuth clients expect a number)
      scope: 'mcp:read mcp:write folios:read folios:write',
      organization,
    });
  } catch (err: unknown) {
    console.error('[OAuth Token] Workspace provisioning failed:', err);
    return corsResponse({ error: 'server_error', error_description: 'Failed to provision workspace' }, { status: 500 });
  }
}
