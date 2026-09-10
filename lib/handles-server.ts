import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { isReservedHandle, isValidHandle, padHandle, toHandleSeed } from './handles';

/**
 * Server-side handle helpers. claim_username / is_username_available RPCs
 * are revoked from anon/authenticated (security hardening) — everything
 * goes through supabaseAdmin (service role) from server code only.
 */

/** Reserved-word guard runs here (the DB RPC doesn't know reserved words). */
export async function claimHandle(userId: string, raw: string): Promise<
  | { success: true; username: string }
  | { success: false; error: string }
> {
  const username = raw.trim().toLowerCase();
  if (!isValidHandle(username)) {
    return {
      success: false,
      error: 'Username must be 3–30 characters using letters, numbers, hyphens, and underscores. Cannot start or end with a special character.',
    };
  }
  if (isReservedHandle(username)) {
    return { success: false, error: 'This username is reserved. Try another.' };
  }
  const { data, error } = await supabaseAdmin!.rpc('claim_username', {
    p_user_id: userId,
    p_username: username,
  });
  if (error) return { success: false, error: error.message };
  const result = data as { success?: boolean; error?: string; username?: string } | null;
  if (!result?.success) {
    return { success: false, error: result?.error || 'Failed to claim username.' };
  }
  return { success: true, username: result.username || username };
}

export async function isHandleAvailable(
  username: string,
  excludeUserId?: string
): Promise<{ available: boolean; reason: 'valid' | 'reserved' | 'taken' | 'invalid' }> {
  if (!isValidHandle(username)) return { available: false, reason: 'invalid' };
  if (isReservedHandle(username)) return { available: false, reason: 'reserved' };
  const { data } = await supabaseAdmin!.rpc('is_username_available', {
    p_username: username,
    p_user_id: excludeUserId || null,
  });
  return { available: data === true, reason: data === true ? 'valid' : 'taken' };
}

/**
 * 3+ suggestion handles for a user, seeded from their auth email / full
 * name, uniqued against reserved words + live availability. Always returns
 * at least one (deterministic fallback: user + random hex).
 */
export async function suggestHandles(userId: string, count = 3): Promise<string[]> {
  const seeds: string[] = [];
  const candidates: string[] = [];
  const addSeed = (s: string) => {
    const seed = padHandle(toHandleSeed(s)).slice(0, 30);
    if (seed && !seeds.includes(seed)) seeds.push(seed);
  };

  try {
    const { data: user } = await supabaseAdmin!.auth.admin.getUserById(userId);
    const email = user?.user?.email || '';
    const meta = user?.user?.user_metadata as Record<string, unknown> | undefined;
    if (email) addSeed(email.split('@')[0]);
    if (typeof meta?.full_name === 'string') addSeed(meta.full_name);
    addSeed(email.split('@')[0] + '1');
  } catch {
    /* user lookup failed — fallback seeds only */
  }
  if (seeds.length === 0) addSeed(`user${crypto.randomBytes(3).toString('hex')}`);

  for (const seed of seeds) {
    if (candidates.length >= count) break;
    if (isReservedHandle(seed)) continue;
    const check = await isHandleAvailable(seed, userId);
    if (check.available) candidates.push(seed);
    // try numbered variants of the primary seed while below the count
    if (candidates.length === 0 && seeds.length === 1) {
      for (let i = 1; i <= 9 && candidates.length < count; i++) {
        const variant = `${seed.slice(0, 28)}${i}`;
        const v = await isHandleAvailable(variant, userId);
        if (v.available) candidates.push(variant);
      }
    }
  }

  // Hard fallback: always return something claimable.
  while (candidates.length < count) {
    const fallback = `user${crypto.randomBytes(3).toString('hex')}`.slice(0, 30);
    const v = await isHandleAvailable(fallback, userId);
    if (v.available) candidates.push(fallback);
  }
  return candidates.slice(0, count);
}

/**
 * Best-effort: guarantee an org's Owner has a handle (agents publish folios
 * before the human ever opens Settings). Called after agent-driven creates;
 * failures are swallowed — the claim step in the UI remains the fallback.
 */
export async function ensureOwnerHandle(orgId: string): Promise<string | null> {
  try {
    if (!supabaseAdmin) return null;
    const { data: member } = await supabaseAdmin
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', orgId)
      .eq('role', 'Owner')
      .limit(1);
    const ownerId = member?.[0]?.user_id;
    if (!ownerId) return null;

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('username')
      .eq('id', ownerId)
      .maybeSingle();
    if (profile?.username) return profile.username;

    const suggestions = await suggestHandles(ownerId, 1);
    if (suggestions.length === 0) return null;
    const claim = await claimHandle(ownerId, suggestions[0]);
    return claim.success ? claim.username : null;
  } catch {
    return null;
  }
}
