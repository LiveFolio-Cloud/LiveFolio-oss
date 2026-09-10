import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { isOSS } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

/**
 * POST /api/oauth/register
 *
 * OAuth 2.0 Dynamic Client Registration (RFC 7591).
 *
 * Claude Code, ChatGPT, Cursor, and other MCP connectors call this
 * to register themselves as OAuth clients before starting the
 * authorization_code flow. We accept any well-formed registration
 * and return a client_id.
 *
 * Body: { client_name, redirect_uris, grant_types, token_endpoint_auth_method }
 * Response: { client_id, client_name, redirect_uris, grant_types, ... }
 */

// In-memory store for OSS mode and as fallback
const registeredClients = new Map<string, {
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  created_at: string;
}>();

// Load persisted clients on startup (Cloud mode)
async function loadPersistedClients(): Promise<void> {
  if (isOSS || !supabaseAdmin) return;
  try {
    const { data, error } = await supabaseAdmin
      .from('oauth_clients')
      .select('*');
    if (error || !data) return;
    for (const row of data) {
      registeredClients.set(row.client_id, {
        client_name: row.client_name,
        redirect_uris: Array.isArray(row.redirect_uris) ? row.redirect_uris : JSON.parse(row.redirect_uris || '[]'),
        grant_types: Array.isArray(row.grant_types) ? row.grant_types : JSON.parse(row.grant_types || '["authorization_code"]'),
        created_at: row.created_at,
      });
    }
    console.log(`[OAuth Register] Loaded ${data.length} persisted OAuth clients`);
  } catch (err) {
    console.error('[OAuth Register] Failed to load persisted clients:', err);
  }
}

// Load on module init
loadPersistedClients();

/**
 * Validate redirect URIs per RFC 8252 / OAuth best practice for public
 * clients: only https, or http on loopback (localhost / 127.0.0.1).
 * This prevents malicious clients from registering javascript:/file:/http
 * URIs used to steal authorization codes (open-redirect / code theft).
 */
function isValidRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol === 'https:') return true;
    if (u.protocol === 'http:') {
      const host = u.hostname.toLowerCase();
      return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
    }
    return false;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  // Rate limit registrations per IP to prevent unbounded registry growth / DoS.
  const clientIp = getClientIp(request);
  const regLimit = checkRateLimit(`oauth-register:ip:${clientIp}`, 20, 60 * 60_000, 24 * 60 * 60_000);
  if (!regLimit.allowed) {
    return corsResponse(
      { error: 'invalid_request', error_description: 'Too many client registrations. Please try again later.' },
      { status: 429 }
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- registration JSON from external OAuth clients; each field is validated at runtime
  let body: any;
  try {
    body = await request.json();
  } catch {
    return corsResponse(
      { error: 'invalid_request', error_description: 'JSON body required' },
      { status: 400 }
    );
  }

  const {
    client_name,
    redirect_uris,
    grant_types,
    token_endpoint_auth_method,
  } = body;

  if (!client_name || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    return corsResponse(
      { error: 'invalid_client_metadata', error_description: 'client_name and redirect_uris (array) are required' },
      { status: 400 }
    );
  }

  // Validate every redirect URI (https or loopback http only)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- redirect_uris comes from unvalidated client JSON until the string check below
  const invalidUris = redirect_uris.filter((u: any) => typeof u !== 'string' || !isValidRedirectUri(u));
  if (invalidUris.length > 0) {
    return corsResponse(
      { error: 'invalid_redirect_uri', error_description: 'redirect_uris must be https:// or http://localhost / http://127.0.0.1' },
      { status: 400 }
    );
  }

  // Cap the number of redirect URIs per client
  if (redirect_uris.length > 10) {
    return corsResponse(
      { error: 'invalid_redirect_uri', error_description: 'Too many redirect URIs (max 10)' },
      { status: 400 }
    );
  }

  // Generate a stable client_id based on the client name
  const slug = client_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const clientId = `${slug}-${crypto.randomBytes(8).toString('hex')}`;
  const now = new Date().toISOString();
  const finalGrantTypes = grant_types || ['authorization_code'];

  // Store the registration
  registeredClients.set(clientId, {
    client_name,
    redirect_uris,
    grant_types: finalGrantTypes,
    created_at: now,
  });

  // Persist to database in Cloud mode
  if (!isOSS && supabaseAdmin) {
    try {
      await supabaseAdmin
        .from('oauth_clients')
        .insert({
          client_id: clientId,
          client_name,
          redirect_uris: JSON.stringify(redirect_uris),
          grant_types: JSON.stringify(finalGrantTypes),
          token_endpoint_auth_method: token_endpoint_auth_method || 'none',
        });
      console.log(`[OAuth Register] Persisted client: ${client_name} -> ${clientId}`);
    } catch (err) {
      console.error('[OAuth Register] Failed to persist client to DB:', err);
      // Continue anyway — in-memory store still has it
    }
  } else {
    console.log(`[OAuth Register] Registered client (in-memory): ${client_name} -> ${clientId}`);
  }

  const clientIdIssuedAt = Math.floor(Date.now() / 1000);

  return corsResponse({
    client_id: clientId,
    client_name,
    redirect_uris,
    grant_types: finalGrantTypes,
    token_endpoint_auth_method: token_endpoint_auth_method || 'none',
    scope: 'mcp:read mcp:write folios:read folios:write',
    client_id_issued_at: clientIdIssuedAt,
    client_secret_expires_at: 0, // no client secret for public clients
    // Include empty client_secret for compatibility with strict OAuth libraries
    client_secret: '',
  }, { status: 201 });
}

// Handle CORS preflight
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}

// Wrap responses with CORS headers
function corsResponse(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// Also support GET for client lookup (some connectors query their registration)
export async function GET(request: Request) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get('client_id');

  if (!clientId) {
    return corsResponse(
      { error: 'invalid_request', error_description: 'client_id query parameter required' },
      { status: 400 }
    );
  }

  if (registeredClients.has(clientId)) {
    const client = registeredClients.get(clientId)!;
    return corsResponse({
      client_id: clientId,
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      grant_types: client.grant_types,
      token_endpoint_auth_method: 'none',
      scope: 'mcp:read mcp:write folios:read folios:write',
      client_id_issued_at: Math.floor(new Date(client.created_at).getTime() / 1000),
      client_secret_expires_at: 0,
    });
  }

  // If not in memory, try DB (Cloud mode recovery after restart)
  if (!isOSS && supabaseAdmin) {
    try {
      const { data, error } = await supabaseAdmin
        .from('oauth_clients')
        .select('*')
        .eq('client_id', clientId)
        .maybeSingle();
      if (data && !error) {
        // Restore to in-memory cache
        const redirectUris = Array.isArray(data.redirect_uris) ? data.redirect_uris : JSON.parse(data.redirect_uris || '[]');
        const grantTypes = Array.isArray(data.grant_types) ? data.grant_types : JSON.parse(data.grant_types || '["authorization_code"]');
        registeredClients.set(clientId, {
          client_name: data.client_name,
          redirect_uris: redirectUris,
          grant_types: grantTypes,
          created_at: data.created_at,
        });
        return corsResponse({
          client_id: clientId,
          client_name: data.client_name,
          redirect_uris: redirectUris,
          grant_types: grantTypes,
          token_endpoint_auth_method: data.token_endpoint_auth_method || 'none',
          scope: 'mcp:read mcp:write folios:read folios:write',
          client_id_issued_at: Math.floor(new Date(data.created_at).getTime() / 1000),
          client_secret_expires_at: 0,
        });
      }
    } catch (err) {
      console.error('[OAuth Register] DB lookup failed:', err);
    }
  }

  return corsResponse(
    { error: 'not_found', error_description: 'Client not found' },
    { status: 404 }
  );
}

// Export for the authorize route to validate
export { registeredClients };
