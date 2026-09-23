import { supabaseAdmin } from '@/lib/supabase';

/**
 * Owner accent color for a folio's organization — powers paywall + share
 * chrome styling (`profiles.accent_color`, set in the paid-gating migration).
 *
 * Null-safe by design: any missing org, missing owner, or query failure
 * falls back to `undefined`, and the paywall renders its default accent.
 * No caching — this only runs on gated/paid surfaces, not the hot free path.
 */
/**
 * Owner identity (accent + username) for a folio's organization. Powers the
 * canonical public link (@username/slug) and the paywall/share chrome.
 *
 * Null-safe: any missing org/owner/query failure yields undefined. A tiny
 * in-process cache (5 min) keeps this off the hot free path after the first
 * lookup per org.
 */
interface OwnerIdentity {
  accentColor?: string;
  username?: string;
}

const OWNER_CACHE_TTL = 5 * 60_000;
// Keyed by org id — a count that grows with the tenant base, so the map is
// bounded. TTL is unchanged (5 min); the bound is what stops entries that
// expired logically from staying resident for the life of the process.
const _OWNER_CACHE_MAX = 500;
const _ownerCache = new Map<string, { identity: OwnerIdentity; expiresAt: number }>();

/** Cached identity, or null on miss (an empty identity is a real answer). */
function readOwnerCache(organizationId: string): OwnerIdentity | null {
  const hit = _ownerCache.get(organizationId);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    _ownerCache.delete(organizationId); // evict expired on read so the map tracks live entries only
    return null;
  }
  // Re-insert at the tail (Map preserves insertion order) so a hot org is the
  // last evicted under pressure.
  _ownerCache.delete(organizationId);
  _ownerCache.set(organizationId, hit);
  return hit.identity;
}

function writeOwnerCache(organizationId: string, identity: OwnerIdentity): void {
  if (_ownerCache.size >= _OWNER_CACHE_MAX) {
    // Reclaim expired entries first; only if that frees nothing do we evict
    // least-recently-used. Either path keeps the map at or below the bound.
    // forEach (not `for...of`) — this tsconfig target can't downlevel-iterate a
    // Map, and deleting the current entry inside forEach is well-defined.
    _ownerCache.forEach((v, k) => {
      if (v.expiresAt <= Date.now()) _ownerCache.delete(k);
    });
    while (_ownerCache.size >= _OWNER_CACHE_MAX) {
      const oldest = _ownerCache.keys().next().value;
      if (oldest === undefined) break;
      _ownerCache.delete(oldest);
    }
  }
  _ownerCache.set(organizationId, { identity, expiresAt: Date.now() + OWNER_CACHE_TTL });
}

export async function getOwnerIdentity(
  organizationId?: string | null
): Promise<OwnerIdentity> {
  if (!organizationId || !supabaseAdmin) return {};

  const cached = readOwnerCache(organizationId);
  if (cached) return cached;

  try {
    const { data: membership } = await supabaseAdmin
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', organizationId)
      .eq('role', 'Owner')
      .limit(1);

    const ownerId = membership?.[0]?.user_id;
    if (!ownerId) return {};

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('accent_color, username')
      .eq('id', ownerId)
      .maybeSingle();

    const identity: OwnerIdentity = {
      accentColor: profile?.accent_color || undefined,
      username: profile?.username || undefined,
    };
    writeOwnerCache(organizationId, identity);
    return identity;
  } catch {
    return {};
  }
}

/** Back-compat alias for surfaces that only style with the accent. */
export async function getOwnerAccent(organizationId?: string | null): Promise<string | undefined> {
  const identity = await getOwnerIdentity(organizationId);
  return identity.accentColor;
}
