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

const _ownerCache = new Map<string, { identity: OwnerIdentity; expiresAt: number }>();
const OWNER_CACHE_TTL = 5 * 60_000;

export async function getOwnerIdentity(
  organizationId?: string | null
): Promise<OwnerIdentity> {
  if (!organizationId || !supabaseAdmin) return {};

  const cached = _ownerCache.get(organizationId);
  if (cached && cached.expiresAt > Date.now()) return cached.identity;

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
    _ownerCache.set(organizationId, { identity, expiresAt: Date.now() + OWNER_CACHE_TTL });
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
