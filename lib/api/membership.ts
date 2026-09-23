import { supabaseAdmin } from '@/lib/supabase';

/**
 * "Is this user a member of this organization?" — the ownership probe that
 * gates owner-only surfaces (trace, gate resolution, ...).
 *
 * Extracted verbatim from the copies it replaces:
 *
 *   .from('organization_members')
 *   .select('id').eq('organization_id', orgId).eq('user_id', userId).limit(1)
 *
 * then `!!(data && data.length > 0)`.
 *
 * NOTE ON THE MISSING NULL GUARD — deliberate, not an oversight. Every call
 * site has already dereferenced `supabaseAdmin` earlier in the same request
 * (either an explicit `if (!supabaseAdmin)` bail, or an unguarded
 * `supabaseAdmin.from(...)` that would have thrown first). Adding a
 * `!supabaseAdmin → false` guard here would silently convert an existing
 * throw into a "not a member" answer, which is a behaviour change on an
 * authorization path. It is left pure so this is a true extraction.
 */
export async function isOrgMember(userId: string, orgId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('organization_members')
    .select('id')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .limit(1);
  return !!(data && data.length > 0);
}
