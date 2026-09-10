import { NextResponse } from 'next/server';
import { isOSS } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * POST /api/oauth/revoke
 *
 * OAuth 2.0 Token Revocation (RFC 7009).
 *
 * Allows agents and users to revoke their API keys via standard OAuth mechanisms.
 * Accepts: token, token_type_hint (optional: 'access_token' | 'refresh_token')
 *
 * Returns 200 OK regardless of whether the token was valid (per RFC 7009 §2.2).
 */

export async function POST(request: Request) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RFC 7009 body may be JSON or form-encoded; only token is read
  let body: any;
  try {
    body = await request.json();
  } catch {
    // Also support form-encoded body per RFC 7009
    try {
      const formData = await request.formData();
      body = Object.fromEntries(formData.entries());
    } catch {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'JSON or form-encoded body required' },
        { status: 400 }
      );
    }
  }

  const { token } = body;

  if (!token) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'token is required' },
      { status: 400 }
    );
  }

  // In OSS mode, just acknowledge the revocation
  if (isOSS) {
    console.log('[OAuth Revoke] OSS mode — token revocation acknowledged:', token.substring(0, 12) + '...');
    return new Response(null, { status: 200 });
  }

  // Cloud mode: find and rotate the API key
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: 'server_error', error_description: 'Database not configured' },
      { status: 500 }
    );
  }

  try {
    // Find the organization with this API key
    const { data: org, error: lookupErr } = await supabaseAdmin
      .from('organizations')
      .select('id, api_key')
      .eq('api_key', token)
      .maybeSingle();

    // If token not found, still return 200 per RFC 7009 (don't leak whether token was valid)
    if (lookupErr || !org) {
      return new Response(null, { status: 200 });
    }

    // Rotate the API key: set to null (effectively revoking it)
    // A new key will be auto-generated on next provisionAgentWorkspace call
    const { error: updateErr } = await supabaseAdmin
      .from('organizations')
      .update({ api_key: null })
      .eq('id', org.id);

    if (updateErr) {
      console.error('[OAuth Revoke] Failed to revoke key:', updateErr);
      return NextResponse.json(
        { error: 'server_error', error_description: 'Failed to revoke token' },
        { status: 500 }
      );
    }

    console.log(`[OAuth Revoke] Revoked API key for org ${org.id}`);
    return new Response(null, { status: 200 });
  } catch (err) {
    console.error('[OAuth Revoke] Error:', err);
    // Still return 200 per RFC 7009 — don't leak errors to caller
    return new Response(null, { status: 200 });
  }
}

// Handle CORS preflight
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}
