import { supabaseAdmin } from '@/lib/supabase';

/**
 * Resolve a profile id from its @username OR uuid (public pages accept both).
 * Shared by the follow API surface so followers/following lists use the same
 * lookup semantics as the toggle.
 */
export async function resolveProfileId(usernameOrId: string): Promise<string | null> {
  if (!supabaseAdmin) return null;

  const { data: byUsername } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('username', usernameOrId)
    .maybeSingle();
  if (byUsername?.id) return byUsername.id;

  const { data: byId } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('id', usernameOrId)
    .single();
  return byId?.id ?? null;
}
