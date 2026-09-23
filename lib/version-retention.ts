import { supabaseAdmin } from '@/lib/supabase';
import { isOSS } from '@/lib/env';

// ─── Free-plan version retention ──────────────────────────────────
// Pricing card (2026-09): the Free plan keeps the last 25 versions /
// 30 days of history; paid plans keep full history forever.
// Cloud only — OSS is local and unlimited by design.
//
// Version ids elsewhere are generated as `v${count + 1}`, which collides
// once pruning creates gaps in the id sequence — so writers must use
// nextVersionId() (max-based) instead.

export const FREE_VERSION_LIMIT = 25;
export const FREE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface VersionLike {
  versionId?: string;
  createdAt?: string | Date;
}

/** Next version id from the max existing numeric id — unique even after
 *  Free-tier pruning removes older ids from the middle of the sequence. */
export function nextVersionId(versions: VersionLike[]): string {
  let max = 0;
  for (const v of versions) {
    const m = /^v(\d+)$/.exec(v.versionId || '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `v${max + 1}`;
}

/** Drop versions older than 30 days, then cap to the newest 25. Arrays are
 *  appended chronologically (newest last), so the tail is the newest. */
export function trimToFreeRetention<T extends VersionLike>(versions: T[]): T[] {
  const cutoff = Date.now() - FREE_RETENTION_MS;
  const recent = versions.filter((v) => {
    if (!v.createdAt) return true;
    const t = new Date(v.createdAt as string).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
  return recent.length > FREE_VERSION_LIMIT
    ? recent.slice(recent.length - FREE_VERSION_LIMIT)
    : recent;
}

// ── Plan lookup cache ──────────────────────────────────────────────
// applyVersionRetention runs on EVERY version append (7 call sites: the folio
// route, ai/ai-stream, chat tool execute, sync, and the integration paths) and
// the only thing it needs from the DB is `organizations.plan`, which changes
// approximately never. Same bounded-map idiom as the watermark plan cache in
// app/api/raw/[id]/[[...path]]/route.ts.
//
// 60s rather than that cache's 5 min, because retention PRUNES: a stale 'Free'
// right after an upgrade would drop history the user just paid to keep, while
// a stale paid verdict merely keeps versions a little longer (harmless).
//
// No new imports on purpose — this module has to stay import-clean for the OSS
// sync, and a plain Map needs nothing. OSS never reaches these helpers: the
// isOSS/missing-org short-circuit still runs first.
const PLAN_CACHE_TTL_MS = 60_000;
const PLAN_CACHE_MAX = 500;

const _planCache = new Map<string, { isFree: boolean; expiresAt: number }>();

/** `null` = miss (a cached `false` is a valid, distinct answer). */
function readPlanCache(orgId: string): boolean | null {
  const hit = _planCache.get(orgId);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    _planCache.delete(orgId); // evict expired on read so the map tracks live entries only
    return null;
  }
  // Re-insert at the tail (Map preserves insertion order) so a hot org is the
  // last evicted under pressure.
  _planCache.delete(orgId);
  _planCache.set(orgId, hit);
  return hit.isFree;
}

function writePlanCache(orgId: string, isFree: boolean): void {
  if (_planCache.size >= PLAN_CACHE_MAX) {
    // Reclaim expired entries first; only if that frees nothing do we evict
    // oldest-first. Either path keeps the map at or below the bound.
    // forEach (not `for...of`) — this tsconfig target can't downlevel-iterate a
    // Map, and deleting the current entry inside forEach is well-defined.
    _planCache.forEach((v, k) => {
      if (v.expiresAt <= Date.now()) _planCache.delete(k);
    });
    while (_planCache.size >= PLAN_CACHE_MAX) {
      const oldest = _planCache.keys().next().value;
      if (oldest === undefined) break;
      _planCache.delete(oldest);
    }
  }
  _planCache.set(orgId, { isFree, expiresAt: Date.now() + PLAN_CACHE_TTL_MS });
}

/** Cloud: trim to the Free retention window when the owning org is on the
 *  Free plan. Paid plans pass through untouched. Fail-open: any lookup or
 *  DB problem leaves the versions as-is (retention is best-effort). */
export async function applyVersionRetention<T extends VersionLike>(
  versions: T[],
  orgId: string | null | undefined
): Promise<T[]> {
  // Short-circuit order is load-bearing: OSS and org-less callers return here
  // and never touch the cache below.
  if (isOSS || !orgId || !supabaseAdmin) return versions;
  try {
    // A hit skips the query entirely — same answer, no round trip. A miss
    // falls through to the identical query + fail-open path as before.
    let isFree = readPlanCache(orgId);
    if (isFree === null) {
      const { data } = await supabaseAdmin
        .from('organizations')
        .select('plan')
        .eq('id', orgId)
        .single();
      // No row (or a failed lookup): fail open, exactly as before — and cache
      // nothing, so a transient error is not remembered for 60s.
      if (!data) return versions;
      isFree = data.plan === 'Free';
      writePlanCache(orgId, isFree);
    }
    return isFree ? trimToFreeRetention(versions) : versions;
  } catch {
    return versions;
  }
}
