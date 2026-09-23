import { NextResponse } from 'next/server';

/**
 * CORS for the public, agent-facing endpoints (OAuth discovery/token/
 * registration/revocation, agent auth, MCP).
 *
 * ── Why this is parameterised rather than a single constant ──────────────
 * These routes do NOT share one policy, and an earlier consolidation attempt
 * was correctly abandoned for assuming they did. The real per-site values are:
 *
 * | Route                              | Allow-Methods        | Max-Age |
 * |------------------------------------|----------------------|---------|
 * | .well-known/oauth-authorization-server | `GET, OPTIONS`   | 86400   |
 * | oauth/token                        | `POST, OPTIONS`      | 86400   |
 * | oauth/revoke                       | `POST, OPTIONS`      | 86400   |
 * | oauth/register (preflight)         | `POST, GET, OPTIONS` | 86400   |
 * | oauth/register (JSON responses)    | —                    | —       |
 * | agent/auth                         | `POST, OPTIONS`      | —       |
 * | agent/auth/session                 | `GET, OPTIONS`       | —       |
 * | agent/auth/claim                   | `POST, OPTIONS`      | —       |
 * | agent/auth/claim/complete          | `POST, OPTIONS`      | —       |
 *
 * Two traps a blind swap would spring:
 * - `oauth/register` advertises `POST, GET, OPTIONS` because it also serves a
 *   GET client-lookup endpoint. Dropping the `GET` breaks preflight for
 *   connectors that query their own registration.
 * - the `agent/auth/**` routes deliberately send NO `Access-Control-Max-Age`.
 *   Adding one changes how long a browser caches those preflights.
 *
 * So every caller passes its values EXPLICITLY. There is no default that can
 * silently stand in for the wrong one: an omitted field means the header is
 * genuinely absent, which is what the agent routes want.
 *
 * `Access-Control-Allow-Origin: '*'` is emitted unconditionally — every site
 * above sends exactly that.
 */
export type CorsHeadersOptions = {
  /** `Access-Control-Allow-Methods`. Omit → the header is not emitted. */
  methods?: string;
  /** `Access-Control-Allow-Headers`. Omit → the header is not emitted. */
  headers?: string;
  /** `Access-Control-Max-Age`, in seconds (serialised via String()). Omit → the header is not emitted. */
  maxAge?: number;
};

/** `Content-Type, Authorization` — the Allow-Headers value shared by all but the discovery route. */
export const CORS_JSON_HEADERS = 'Content-Type, Authorization';

/**
 * Builds the CORS header set. Key order is Origin → Methods → Headers →
 * Max-Age, matching every hand-written copy this replaced.
 */
export function corsHeaders(options: CorsHeadersOptions = {}): Record<string, string> {
  const headers: Record<string, string> = { 'Access-Control-Allow-Origin': '*' };
  if (options.methods !== undefined) headers['Access-Control-Allow-Methods'] = options.methods;
  if (options.headers !== undefined) headers['Access-Control-Allow-Headers'] = options.headers;
  if (options.maxAge !== undefined) headers['Access-Control-Max-Age'] = String(options.maxAge);
  return headers;
}

/** The 204 empty preflight response every `OPTIONS` handler returns. */
export function corsPreflight(options: CorsHeadersOptions = {}): Response {
  return new Response(null, { status: 204, headers: corsHeaders(options) });
}

/**
 * `NextResponse.json` with CORS headers merged on top of any caller headers —
 * caller headers are spread first, CORS wins on collision (both previous
 * wrappers agreed on that precedence).
 */
export function corsJson(body: unknown, init?: ResponseInit, options: CorsHeadersOptions = {}): NextResponse {
  return NextResponse.json(body, {
    ...init,
    headers: { ...(init?.headers || {}), ...corsHeaders(options) },
  });
}
