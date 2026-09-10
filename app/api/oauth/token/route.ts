import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { provisionAgentWorkspace } from '@/lib/auth-provisioner';

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
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function corsResponse(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...(init?.headers || {}), ...CORS_HEADERS },
  });
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
    return corsResponse({ error: 'unsupported_grant_type', error_description: 'Only authorization_code is supported' }, { status: 400 });
  }

  // Validate required params
  if (!code || !code_verifier || !client_id) {
    return corsResponse({ error: 'invalid_request', error_description: 'code, code_verifier, and client_id are required' }, { status: 400 });
  }

  // Look up the auth code
  const entry = codeStore.get(code);
  if (!entry) {
    return corsResponse({ error: 'invalid_grant', error_description: 'Authorization code not found or expired' }, { status: 400 });
  }

  if (entry.used) {
    return corsResponse({ error: 'invalid_grant', error_description: 'Authorization code already used' }, { status: 400 });
  }

  if (entry.expiresAt < Date.now()) {
    codeStore.delete(code);
    return corsResponse({ error: 'invalid_grant', error_description: 'Authorization code expired' }, { status: 400 });
  }

  // Validate redirect_uri and client_id binding (RFC 6749 §4.1.3):
  // if they were present at authorization, they MUST match at redemption.
  if (entry.redirectUri) {
    if (!redirect_uri || entry.redirectUri !== redirect_uri) {
      return corsResponse({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, { status: 400 });
    }
  }
  if (entry.clientId && entry.clientId !== client_id) {
    return corsResponse({ error: 'invalid_grant', error_description: 'client_id mismatch' }, { status: 400 });
  }

  // Verify PKCE (S256)
  try {
    const expectedChallenge = crypto.createHash('sha256').update(code_verifier).digest('base64url');
    if (expectedChallenge !== entry.challenge) {
      return corsResponse({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, { status: 400 });
    }
  } catch {
    return corsResponse({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, { status: 400 });
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
