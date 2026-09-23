/**
 * Shared plumbing for the MCP tool handlers in `lib/mcp/tools/*`.
 *
 * Everything here is depended on by BOTH the transport in
 * `app/api/mcp/route.ts` and the domain handler modules, so it lives one level
 * below both: the dependency direction is strictly route → lib/mcp, never
 * lib/mcp → route (an import of a route module would be a cycle and would also
 * re-instantiate the route's module state).
 *
 * The mutable state here (`globalWithTunnel`, `_tokenOrgCache`) is process-wide
 * by construction: it hangs off a `global` key, or is a module singleton that
 * both the route and every handler module resolve to the same instance of.
 */
import { HTMLFile } from '@/lib/db';
import path from 'path';
import { type Tunnel } from 'untun';
import { getFolioEditUrl } from '@/lib/network';
import { supabaseAdmin, transformFolioRecord, FolioRecord } from '@/lib/supabase';
import { headers } from 'next/headers';

export const SETTINGS_FILE = path.join(process.cwd(), 'settings.json');

/**
 * One live SSE stream. `owner` is the identity that authenticated the GET that
 * created it — a POST presenting this session id from a different identity is
 * rejected rather than being allowed to inject into another tenant's stream.
 */
export interface SseSession {
  controller: ReadableStreamDefaultController;
  owner: string;
  createdAt: number;
  /** Last *client* activity (connect or POST enqueue) — drives the idle sweep. */
  lastActivityAt: number;
  /** Clears this session's heartbeat interval, used when the map evicts it. */
  stop?: () => void;
}

export const globalWithTunnel = global as typeof globalThis & {
  activeTunnel?: Tunnel;
  activeUrl?: string | null;
  mcpSseConnections?: Map<string, SseSession>;
};

if (!globalWithTunnel.mcpSseConnections) {
  globalWithTunnel.mcpSseConnections = new Map();
}

// ── Auth token cache (avoids DB lookup on every request) ──────────────
// Keyed by caller-supplied credentials, so it MUST be bounded — without a cap
// every distinct key ever presented stays resident for the process lifetime.
export const _tokenOrgCache = new Map<string, { orgId: string; expiresAt: number }>();

export const TOKEN_CACHE_TTL = 5 * 60_000; // 5 minutes

export const TOKEN_ORG_CACHE_MAX = 500;

export function writeTokenOrgCache(candidate: string, orgId: string): void {
  if (_tokenOrgCache.size >= TOKEN_ORG_CACHE_MAX) {
    // Reclaim expired entries first; only if that frees nothing do we evict
    // least-recently-written. Either path keeps the map at or below the bound.
    // forEach (not `for...of`) — this tsconfig target can't downlevel-iterate a
    // Map, and deleting the current entry inside forEach is well-defined.
    _tokenOrgCache.forEach((v, k) => {
      if (v.expiresAt <= Date.now()) _tokenOrgCache.delete(k);
    });
    while (_tokenOrgCache.size >= TOKEN_ORG_CACHE_MAX) {
      const oldest = _tokenOrgCache.keys().next().value;
      if (oldest === undefined) break;
      _tokenOrgCache.delete(oldest);
    }
  }
  _tokenOrgCache.set(candidate, { orgId, expiresAt: Date.now() + TOKEN_CACHE_TTL });
}

/**
 * The cloud-only guard, in one place. Every cloud branch used to open with an
 * inline `if (!supabaseAdmin) throw new Error(...)`; this replaces all 24
 * copies and keeps the thrown message in exactly one spot.
 *
 * The message is byte-identical to the inline form on purpose — agents match
 * on that exact string when a misconfigured deployment surfaces it. Type and
 * behaviour are unchanged: a null client still throws an `Error` (not a
 * `TypeError` from a null dereference) at the same point, before any query
 * runs. (`supabaseAdmin` is `null as any` when unconfigured, so this was never
 * a type-level narrowing — the assert is purely a runtime one.)
 *
 * Returns the client, so a caller that wants to bind it locally can; callers
 * that keep reading the module binding can simply call it for the assert.
 */
export function requireSupabaseAdmin(): NonNullable<typeof supabaseAdmin> {
  if (!supabaseAdmin) throw new Error("Supabase is not initialized.");
  return supabaseAdmin;
}

/**
 * Resolve one folio by id, scoped to the caller's org — the read that opened
 * `get_project`, `update_project`, `get_curated_brief` and
 * `get_active_design_system` as four copies of the same five lines.
 *
 * Security: the lookup is org-scoped and there is deliberately NO global
 * fallback — a folio that is not under the caller's org is not visible to
 * them. A miss (or a query error) throws the exact string those four sites
 * threw, `Project with ID '<id>' not found.`, so error text is unchanged.
 *
 * The caller's cloud branch has already asserted the admin client; the guard
 * is repeated here so a null client can never reach the query.
 */
export async function resolveFolioForOrg(projectId: string, orgId: string): Promise<HTMLFile> {
  const sb = requireSupabaseAdmin();
  const { data, error } = await sb
    .from('folios')
    .select('*')
    .eq('id', projectId)
    .eq('organization_id', orgId)
    .single();

  if (error || !data) throw new Error(`Project with ID '${projectId}' not found.`);
  return transformFolioRecord(data as FolioRecord);
}

/** Resolve org ID from the current request headers (works in both middleware and OAuth paths) */
export async function resolveOrgIdFromHeaders(): Promise<string> {
  const headerList = await headers();
  const middlewareOrg = headerList.get('x-organization-id');
  if (middlewareOrg) return middlewareOrg;

  // Try OAuth Bearer token
  const authHeader = headerList.get('authorization');
  const token = authHeader ? authHeader.replace('Bearer ', '').trim() : '';
  if (token && supabaseAdmin) {
    const cached = _tokenOrgCache.get(token);
    if (cached && cached.expiresAt > Date.now()) return cached.orgId;

    const { data, error } = await supabaseAdmin
      .from('organizations')
      .select('id')
      .eq('api_key', token)
      .single();

    if (!error && data) {
      writeTokenOrgCache(token, data.id);
      return data.id;
    }
  }

  throw new Error('Unauthorized');
}

/**
 * Resolve the user id that user-scoped tools (profile, handle, follow,
 * seller account, purchases) act on behalf of. Middleware injects
 * x-user-id for session and org-API-key requests; the OAuth Bearer path
 * has no user header, so fall back to the org Owner. Throws a clear error
 * when neither resolves.
 */
export async function resolveActingUserId(orgId: string): Promise<string> {
  const headerList = await headers();
  const headerUserId = headerList.get('x-user-id');
  if (headerUserId && headerUserId !== '00000000-0000-0000-0000-000000000000') {
    return headerUserId;
  }
  if (supabaseAdmin) {
    const { data: owner } = await supabaseAdmin
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', orgId)
      .eq('role', 'Owner')
      .limit(1)
      .maybeSingle();
    if (owner) return owner.user_id;
  }
  throw new Error('This action requires a user identity, but the MCP session has none. Reconnect with a workspace API key or a signed-in session.');
}

/**
 * Verify the acting user holds one of the given roles in the org.
 * Always checks organization_members — client-supplied role headers are
 * stripped by middleware and must never be trusted.
 */
export async function requireRole(orgId: string, userId: string, roles: string[]): Promise<string> {
  if (!supabaseAdmin) throw new Error('Database connection unavailable.');
  const { data, error } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) throw new Error('You are not a member of this workspace.');
  if (!roles.includes(data.role)) {
    throw new Error(`This action requires the ${roles.join(' or ')} role in the workspace.`);
  }
  return data.role;
}

/** Strict destructive confirmation — rejects truthy strings like "true". */
export function requireConfirmed(confirmed: unknown): void {
  if (confirmed !== true) {
    throw new Error("Destructive action requires confirmed: true (the exact boolean) to proceed.");
  }
}

/**
 * The owner-facing folio links returned by every project tool.
 *
 * `edit_url` is the canonical name (v2 serves the editor at `/app/{id}`).
 * `studio_url` is a deprecated alias kept so existing agent sessions and SDK
 * consumers that read the old key don't break — it points at the same working
 * URL, never the retired `/studio/{id}` route.
 */
export function buildFolioLinks(id: string, origin: string): { edit_url: string; studio_url: string } {
  const edit_url = getFolioEditUrl(id, origin);
  return { edit_url, studio_url: edit_url };
}

export function getRequestOrigin(request?: Request): string {
  // Use configured app URL first, then derive from request, never fall back to localhost
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');
  }
  if (!request) return 'https://livefolio.cloud';
  const host = request.headers.get('host');
  if (!host || host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
    return 'https://livefolio.cloud';
  }
  const protocol = request.headers.get('x-forwarded-proto') || 'https';
  return `${protocol}://${host}`;
}

export function sanitizeAuthor(author?: string): string {
  if (!author) return 'Anonymous';
  // If it's an email, redact it to prevent leakage of internal identities
  if (author.includes('@')) {
    const [name] = author.split('@');
    return `${name.slice(0, 2)}... (Verified User)`;
  }
  return author;
}

/**
 * Sanitizes folio-authored snippet text before it lands in the brief's
 * markdown — section labels come from the folio's own headings and can carry
 * markdown metacharacters or newlines. Collapse whitespace, escape the
 * characters that would corrupt the table/list rendering, cap the length.
 */
export function sanitizeBriefText(s?: string): string {
  if (!s) return '';
  return s.replace(/[\r\n]+/g, ' ').replace(/([|*_`])/g, '\\$1').slice(0, 80);
}
