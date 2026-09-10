import { supabaseAdmin } from '@/lib/supabase';

/**
 * Exact follower/following totals via the server-side RPC
 * (profile_follow_metrics) — REST head-counting proved unreliable for this
 * table. Returns zeros on any failure (null-safe).
 */
export async function getProfileFollowCounts(profileId: string): Promise<{
  followers: number;
  following: number;
}> {
  if (!supabaseAdmin) return { followers: 0, following: 0 };
  try {
    const { data } = await supabaseAdmin.rpc('profile_follow_metrics', {
      p_target: profileId,
    });
    const parsed = (data ?? {}) as { followers?: number; following?: number };
    return {
      followers: Number(parsed.followers) || 0,
      following: Number(parsed.following) || 0,
    };
  } catch {
    return { followers: 0, following: 0 };
  }
}
