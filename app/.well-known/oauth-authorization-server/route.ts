import { NextResponse } from 'next/server';
import { corsHeaders, corsPreflight } from '@/lib/api/cors';

/**
 * GET /.well-known/oauth-authorization-server
 *
 * OAuth 2.0 Authorization Server Metadata (RFC 8414).
 * AI connector clients (Claude, ChatGPT, Cursor) fetch this to auto-discover
 * LiveFolio's OAuth endpoints and register without manual config.
 */

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://livefolio.cloud';

// Discovery is the ONE route that advertises `Content-Type` alone (no
// Authorization) — it is fetched anonymously before any token exists.
const CORS = { methods: 'GET, OPTIONS', headers: 'Content-Type', maxAge: 86400 };

export async function OPTIONS() {
  return corsPreflight(CORS);
}

export async function GET() {
  return NextResponse.json({
    // RFC 8414 required fields
    issuer: BASE_URL,
    authorization_endpoint: `${BASE_URL}/api/oauth/authorize`,
    token_endpoint: `${BASE_URL}/api/oauth/token`,
    registration_endpoint: `${BASE_URL}/api/oauth/register`,
    revocation_endpoint: `${BASE_URL}/api/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp:read', 'mcp:write', 'folios:read', 'folios:write'],

    // RFC 8414 recommended fields
    response_modes_supported: ['query', 'fragment'],
    claims_supported: ['email', 'sub', 'iss', 'iat', 'aud'],

    // PKCE is required — we reject plain
    // No JWKS URI needed for public clients (token_endpoint_auth_method: none)

    // Service metadata
    service_documentation: `${BASE_URL}/docs`,
    ui_locales_supported: ['en'],
    op_policy_uri: `${BASE_URL}/privacy`,
    op_tos_uri: `${BASE_URL}/tos`,
  }, { headers: corsHeaders(CORS) });
}
