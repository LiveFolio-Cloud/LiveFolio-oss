/**
 * Folio state — the persistence module behind the localStorage shim.
 *
 * A folio runs in an opaque-origin iframe in the share viewer, where native
 * `localStorage` throws on every access: viewer edits are swallowed by the
 * folio's own try/catch and never reach the owner. `public/livefolio-state-bridge.js`
 * replaces `localStorage` inside the folio with an in-memory map and relays
 * writes to the parent page, which calls `PUT /api/files/[id]/state`. That
 * route reads and writes through THIS module — nobody else touches the
 * `folio_state` table or the `set_folio_state` RPC (db-layer owns them).
 *
 * Contract notes that are load-bearing:
 *   * `serializeStateSeed` is security-critical — the state is user-generated
 *     and lands inside an inline `<script>`. It MUST stay
 *     `JSON.stringify(seed).replace(/</g, '\\u003c')`.
 *   * The size cap is enforced by the RPC (the last place before the row is
 *     written). This module surfaces it as a distinguishable error code so the
 *     route can answer 413 without pattern-matching a message.
 *   * Everything is null-safe in OSS: the flat-file branch lives in the route
 *     (`readDB`/`runTransaction`, same as the comments route), and this module
 *     simply reports "no cloud store" instead of throwing.
 *
 * The Supabase client is imported lazily (repo convention — see
 * lib/supabase-config.ts) so this module can be imported by unit tests without
 * dragging in `next/headers` and the whole server graph.
 */
import { isOSS } from './env';

/** Who is allowed to edit the data a folio collects. Mirrors the column check. */
export type StateWriteMode = 'off' | 'anonymous' | 'signed_in';

/** Runtime companion to `StateWriteMode` — MCP/UI/REST validation shares it. */
export const STATE_WRITE_MODES: readonly StateWriteMode[] = ['off', 'anonymous', 'signed_in'];

export function isStateWriteMode(value: unknown): value is StateWriteMode {
  return typeof value === 'string' && (STATE_WRITE_MODES as readonly string[]).includes(value);
}

/**
 * 256 KB, the same number the RPC enforces (`octet_length(p_state::text) >
 * 262144` → SQLSTATE LF001). The shim drops oversized payloads client-side;
 * this constant is the server-side half of the same rule, shared with the API
 * route so no caller invents its own cap.
 */
export const STATE_SEED_MAX_BYTES = 262144;

/** One folio's persisted client state, as stored. */
export interface FolioStateRecord {
  folioId: string;
  /** localStorage key → string value. Values are always strings (Storage semantics). */
  state: Record<string, string>;
  /** Monotonic write counter. The shim's SYNC gate compares against it. */
  rev: number;
  /** Session user id when the writer was signed in, else null. */
  updatedBy: string | null;
  /** Display name, or 'Guest'. Never null for rows written through the route. */
  updatedLabel: string | null;
  /** ISO-8601 timestamp of the last accepted write. */
  updatedAt: string;
}

/** The inline seed shape: `window.__LF_STATE__ = {v, s, ro}`. */
export interface StateSeed {
  /** rev the seed was built from. */
  v: number;
  /** the whole localStorage map, values as strings. */
  s: Record<string, string>;
  /** read-only: the viewer may read the seed but their writes will be refused. */
  ro: boolean;
}

export interface SetFolioStateInput {
  folioId: string;
  state: Record<string, string>;
  /** Only set when the writer is signed in; the route decides this, not the client. */
  updatedBy?: string | null;
  /** Display name, or 'Guest'. Truncated to 120 chars defensively. */
  updatedLabel?: string | null;
}

export type FolioStateErrorCode =
  | 'STATE_TOO_LARGE'   // over the 256 KB cap (RPC LF001) → the route answers 413
  | 'STATE_INVALID'     // not a {key: string} map, or a malformed id (RPC LF002) → 400
  | 'STATE_UNAVAILABLE' // OSS / no service-role client configured → the route's OSS arm
  | 'STATE_WRITE_FAILED'; // the RPC ran and failed for some other reason → 500

/**
 * Single error type with a stable `code`. The route branches on the code
 * rather than on `instanceof`, which survives duplicate module instances and
 * the ES5 downlevel that this repo's `target` implies.
 */
export class FolioStateError extends Error {
  readonly code: FolioStateErrorCode;

  constructor(code: FolioStateErrorCode, message: string) {
    super(message);
    this.name = 'FolioStateError';
    this.code = code;
  }
}

// ── Validation ─────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The state guard: an object whose values are ALL strings, or nothing.
 * Anything else is rejected rather than coerced — a non-string value would
 * reach the shim as a value the real Storage API could never have produced.
 * Returns a null-prototype copy, so a key literally named `__proto__` is an
 * own key rather than a silent prototype write.
 */
export function validateStateMap(value: unknown): Record<string, string> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const out: Record<string, string> = Object.create(null);
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val !== 'string') return null;
    out[key] = val;
  }
  return out;
}

/**
 * Byte size of a state map as it will be measured server-side (the RPC uses
 * `octet_length(jsonb::text)`; this is the UTF-8 length of the JSON text).
 * The RPC is authoritative — Postgres canonicalises jsonb (space after `:`
 * and `,`), so treat this as a fast pre-check, never as the cap itself.
 */
export function stateByteLength(state: Record<string, string>): number {
  return new TextEncoder().encode(JSON.stringify(state)).length;
}

// ── Seed serialization (security-critical) ─────────────────────────────────

/**
 * Serialize the seed for inline `<script>` interpolation.
 *
 * `JSON.stringify` does not escape `<`, so a folio value containing
 * `</script>` would end the script element and turn user-generated data into
 * executable markup. Escaping every `<` as `<` (the same character once
 * the JSON is parsed) makes that impossible. This is the ONLY sanctioned way
 * to inline state; never interpolate the raw JSON.
 *
 * Total by design (it sits on the serve path): a malformed `s` is dropped in
 * full (fail closed — a partially-string map could never have been produced by
 * the real Storage API), `v`/`ro` are coerced — a serve must not 500 because
 * one stored value is odd.
 */
export function serializeStateSeed(seed: StateSeed): string {
  const map = validateStateMap(seed?.s) ?? {};
  const normalized: StateSeed = {
    v: Number.isFinite(seed?.v) ? Math.max(0, Math.trunc(seed.v)) : 0,
    s: map,
    ro: seed?.ro === true,
  };
  return JSON.stringify(normalized).replace(/</g, '\\u003c');
}

/** Build a seed from a stored record (or its absence) — one place that decides `v`. */
export function buildStateSeed(record: FolioStateRecord | null, readOnly: boolean): StateSeed {
  return {
    v: record ? record.rev : 0,
    s: record ? record.state : {},
    ro: readOnly,
  };
}

// ── Cache ──────────────────────────────────────────────────────────────────
// Mirrors `projectMemoryCache` (lib/project-cache.ts): a bounded in-memory map
// with a TTL, invalidated on write. Short TTL (not the project cache's 10
// minutes) because a viewer's edit in another process must not be served as a
// stale seed for long — the raw route's `no-store` header covers the rest.

const STATE_CACHE_TTL_MS = 60 * 1000;
const STATE_CACHE_MAX_ENTRIES = 256;

interface StateCacheEntry {
  record: FolioStateRecord;
  expiresAt: number;
}

const stateCache = new Map<string, StateCacheEntry>();

function cacheRead(folioId: string): FolioStateRecord | null {
  const entry = stateCache.get(folioId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    stateCache.delete(folioId);
    return null;
  }
  // LRU-ish: Map preserves insertion order, so re-inserting on read moves the
  // key to the tail and eviction below always drops the coldest entry.
  stateCache.delete(folioId);
  stateCache.set(folioId, entry);
  return entry.record;
}

function cacheWrite(record: FolioStateRecord): void {
  const now = Date.now();
  // Drop expired entries first — the cheap half of the bound.
  // forEach (not `for...of`) — this tsconfig target can't downlevel-iterate a
  // Map, and deleting the current entry inside forEach is well-defined.
  stateCache.forEach((entry, key) => {
    if (entry.expiresAt <= now) stateCache.delete(key);
  });
  if (stateCache.size >= STATE_CACHE_MAX_ENTRIES) {
    const oldest = stateCache.keys().next();
    if (!oldest.done) stateCache.delete(oldest.value);
  }
  stateCache.set(record.folioId, { record, expiresAt: now + STATE_CACHE_TTL_MS });
}

/** Drop one folio's cached state. Exported for writers outside this module. */
export function invalidateFolioState(folioId: string): void {
  stateCache.delete(folioId);
}

/** Drop the whole cache (tests, and any future admin surface). */
export function clearFolioStateCache(): void {
  stateCache.clear();
}

// ── Store access ───────────────────────────────────────────────────────────

/**
 * The service-role client, or null when this deployment has no Supabase
 * (OSS, or cloud without keys). Lazy so importing this module never
 * constructs a client and never pulls in the server graph.
 *
 * The return type is INFERRED from the import site, deliberately: this module
 * must not name a `@supabase/supabase-js` type, because the self-hosted tree
 * ships without that dependency (its stub exports `null` / `any`). Inference
 * keeps the cloud build fully typed and the OSS build dependency-free.
 */
async function adminClient() {
  if (isOSS) return null;
  const { supabaseAdmin } = await import('./supabase');
  return supabaseAdmin ?? null;
}

/** PostgREST returns `RETURNS TABLE` as an array of rows; tolerate both shapes. */
function firstRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) {
    const row = data[0];
    return row && typeof row === 'object' ? (row as Record<string, unknown>) : null;
  }
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
}

/**
 * Read one folio's state, from the cache when warm, else from the table.
 * Returns null for "no row" — and also for OSS, an unconfigured client, or a
 * read error, because every caller treats "no state" as "serve no seed",
 * which the shim already handles (spike `noseed`). A read failure must never
 * take down the folio's HTML.
 */
export async function getFolioState(folioId: string): Promise<FolioStateRecord | null> {
  if (!folioId || !UUID_RE.test(folioId)) return null;

  const cached = cacheRead(folioId);
  if (cached) return cached;

  const admin = await adminClient();
  if (!admin) return null;

  try {
    const { data, error } = await admin
      .from('folio_state')
      .select('folio_id, state, rev, updated_by, updated_label, updated_at')
      .eq('folio_id', folioId)
      .maybeSingle();

    if (error) {
      console.warn('[folio-state] read failed:', error.message);
      return null;
    }
    if (!data) return null;

    const state = validateStateMap((data as { state?: unknown }).state);
    if (!state) {
      // Stored state that is not a string map is unusable as a seed. Serve
      // nothing rather than injecting a shape the shim cannot apply.
      console.warn('[folio-state] stored state is not a string map; serving no seed');
      return null;
    }

    const row = data as Record<string, unknown>;
    const record: FolioStateRecord = {
      folioId,
      state,
      rev: Number(row.rev ?? 0) || 0,
      updatedBy: typeof row.updated_by === 'string' ? row.updated_by : null,
      updatedLabel: typeof row.updated_label === 'string' ? row.updated_label : null,
      updatedAt: typeof row.updated_at === 'string' ? row.updated_at : String(row.updated_at ?? ''),
    };
    cacheWrite(record);
    return record;
  } catch (err) {
    console.warn('[folio-state] read threw:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Atomic write through the `set_folio_state` RPC (`rev = rev + 1` under a row
 * lock) and cache invalidation. Throws a `FolioStateError` whose `code` the
 * route maps to a status: STATE_TOO_LARGE → 413, STATE_INVALID → 400,
 * STATE_UNAVAILABLE → the OSS arm, STATE_WRITE_FAILED → 500.
 */
export async function setFolioState(
  input: SetFolioStateInput
): Promise<{ rev: number; updatedAt: string }> {
  const folioId = typeof input?.folioId === 'string' ? input.folioId.trim() : '';
  if (!UUID_RE.test(folioId)) {
    throw new FolioStateError('STATE_INVALID', 'setFolioState: folioId must be a UUID');
  }

  const state = validateStateMap(input?.state);
  if (!state) {
    throw new FolioStateError(
      'STATE_INVALID',
      'setFolioState: state must be an object whose values are all strings'
    );
  }

  const updatedBy = input.updatedBy ?? null;
  if (updatedBy !== null && !UUID_RE.test(updatedBy)) {
    throw new FolioStateError('STATE_INVALID', 'setFolioState: updatedBy must be a UUID or null');
  }

  const rawLabel = input.updatedLabel ?? null;
  const updatedLabel = typeof rawLabel === 'string' ? rawLabel.slice(0, 120) : null;

  const admin = await adminClient();
  if (!admin) {
    throw new FolioStateError(
      'STATE_UNAVAILABLE',
      'setFolioState: no cloud store in this deployment (OSS uses the flat-file branch)'
    );
  }

  const { data, error } = await admin.rpc('set_folio_state', {
    p_folio_id: folioId,
    p_state: state,
    p_updated_by: updatedBy,
    p_updated_label: updatedLabel,
  });

  // Invalidate first: once the RPC returns without error the row has moved,
  // whether or not we like the shape of the response.
  invalidateFolioState(folioId);

  if (error) {
    if (error.code === 'LF001') {
      throw new FolioStateError('STATE_TOO_LARGE', error.message);
    }
    if (error.code === 'LF002') {
      throw new FolioStateError('STATE_INVALID', error.message);
    }
    throw new FolioStateError('STATE_WRITE_FAILED', error.message);
  }

  const row = firstRow(data);
  const rev = Number(row?.rev);
  if (!row || !Number.isFinite(rev)) {
    // The write itself succeeded (no PostgREST error) but we cannot report the
    // authoritative rev, and a wrong rev destroys unacknowledged writes in the
    // shim (spike §C3). Fail loudly; the caller's next GET re-syncs.
    throw new FolioStateError('STATE_WRITE_FAILED', 'set_folio_state returned no rev');
  }

  return {
    rev,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : String(row.updated_at ?? ''),
  };
}
