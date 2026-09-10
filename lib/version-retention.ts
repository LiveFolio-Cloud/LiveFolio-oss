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

/** Cloud: trim to the Free retention window when the owning org is on the
 *  Free plan. Paid plans pass through untouched. Fail-open: any lookup or
 *  DB problem leaves the versions as-is (retention is best-effort). */
export async function applyVersionRetention<T extends VersionLike>(
  versions: T[],
  orgId: string | null | undefined
): Promise<T[]> {
  if (isOSS || !orgId || !supabaseAdmin) return versions;
  try {
    const { data } = await supabaseAdmin
      .from('organizations')
      .select('plan')
      .eq('id', orgId)
      .single();
    return data?.plan === 'Free' ? trimToFreeRetention(versions) : versions;
  } catch {
    return versions;
  }
}
