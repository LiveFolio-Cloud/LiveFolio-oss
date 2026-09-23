/**
 * MCP tool handlers — profile, handle claims, follows and public profiles.
 */
import { isOSS } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase';
import { claimHandle, suggestHandles, isHandleAvailable } from '@/lib/handles-server';
import { getProfileFollowCounts } from '@/app/api/_lib/profile-follow-counts';
import { resolveProfileId } from '@/app/api/_lib/resolve-profile';
import { requireSupabaseAdmin, resolveOrgIdFromHeaders, resolveActingUserId } from '@/lib/mcp/shared';

/** Read or update the acting user's profile (cloud-only). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
export async function handleManageProfile(args: any) {
  if (isOSS) throw new Error('Profiles are a cloud feature and are not available in OSS mode.');
  requireSupabaseAdmin();
  const { action } = args || {};
  const orgId = await resolveOrgIdFromHeaders();
  const userId = await resolveActingUserId(orgId);

  if (action !== 'update') {
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('id, username, full_name, avatar_url, bio, website, is_public, background_url, accent_color, seller_terms_accepted_at, seller_terms_version, account_status, featured_folio_id, updated_at, created_at')
      .eq('id', userId)
      .maybeSingle();
    if (error || !profile) throw new Error('Profile not found.');

    const counts = await getProfileFollowCounts(userId);
    return {
      profile: { ...profile, followers: counts.followers, following: counts.following },
    };
  }

  const { username, full_name, bio, website, avatar_url, is_public, accent_color, featured_folio_id } = args || {};

  if (accent_color !== undefined && accent_color !== null && !/^#[0-9a-fA-F]{6}$/.test(accent_color)) {
    throw new Error('accent_color must be a #RRGGBB hex color or null.');
  }

  if (featured_folio_id !== undefined && featured_folio_id !== null) {
    const { data: folio } = await supabaseAdmin
      .from('folios')
      .select('id')
      .eq('id', featured_folio_id)
      .eq('organization_id', orgId)
      .maybeSingle();
    if (!folio) throw new Error('featured_folio_id must be one of your own folios.');
  }

  // Username changes go through the claim RPC (invalid/taken → clear error).
  if (typeof username === 'string' && username.trim()) {
    const claimed = await claimHandle(userId, username.trim());
    if (!claimed) {
      throw new Error('Username is unavailable: it may be invalid, reserved, or already taken. Try claim_handle without a username for suggestions.');
    }
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (full_name !== undefined) patch.full_name = String(full_name);
  if (bio !== undefined) patch.bio = String(bio);
  if (website !== undefined) patch.website = String(website);
  if (avatar_url !== undefined) patch.avatar_url = avatar_url;
  if (is_public !== undefined) patch.is_public = !!is_public;
  if (accent_color !== undefined) patch.accent_color = accent_color;
  if (featured_folio_id !== undefined) patch.featured_folio_id = featured_folio_id;

  const { data: updated, error } = await supabaseAdmin
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select('id, username, full_name, avatar_url, bio, website, is_public, accent_color, featured_folio_id')
    .maybeSingle();
  if (error) throw error;
  return { success: true, profile: updated };
}

/** Claim a @username or get suggestions (cloud-only). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
export async function handleClaimHandle(args: any) {
  if (isOSS) throw new Error('Handles are a cloud feature and are not available in OSS mode.');
  const { username } = args || {};
  const orgId = await resolveOrgIdFromHeaders();
  const userId = await resolveActingUserId(orgId);

  if (typeof username === 'string' && username.trim()) {
    const claimed = await claimHandle(userId, username.trim());
    if (!claimed) {
      const availability = await isHandleAvailable(username.trim());
      if (!availability.available && availability.reason === 'taken') {
        throw new Error(`@${username.trim()} is already taken.`);
      }
      throw new Error(`@${username.trim()} is not available: it may be invalid or reserved. Use claim_handle without a username for suggestions.`);
    }
    return { success: true, username: claimed };
  }

  const suggestions = await suggestHandles(userId);
  return { suggestions };
}

/** Follow / unfollow a creator by @username (cloud-only). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
export async function handleFollowProfile(args: any) {
  if (isOSS) throw new Error('Follows are a cloud feature and are not available in OSS mode.');
  requireSupabaseAdmin();
  const { username } = args || {};
  if (!username || typeof username !== 'string') throw new Error("Argument 'username' is required.");

  const orgId = await resolveOrgIdFromHeaders();
  const userId = await resolveActingUserId(orgId);

  const targetId = await resolveProfileId(username.trim());
  if (!targetId) throw new Error(`Profile '@${username}' not found.`);
  if (targetId === userId) throw new Error('Cannot follow yourself.');

  const { data: existing } = await supabaseAdmin
    .from('profile_followers')
    .select('id')
    .eq('follower_id', userId)
    .eq('following_id', targetId)
    .maybeSingle();

  if (existing) {
    await supabaseAdmin
      .from('profile_followers')
      .delete()
      .eq('follower_id', userId)
      .eq('following_id', targetId);
  } else {
    const { error: insertErr } = await supabaseAdmin
      .from('profile_followers')
      .insert({ follower_id: userId, following_id: targetId });
    if (insertErr) throw insertErr;
  }

  const counts = await getProfileFollowCounts(targetId);
  return { following: !existing, follower_count: counts.followers };
}

/** Read a creator's public profile + catalog by @username (cloud-only). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
export async function handleGetPublicProfile(args: any) {
  if (isOSS) throw new Error('Public profiles are a cloud feature and are not available in OSS mode.');
  requireSupabaseAdmin();
  const { username } = args || {};
  if (!username || typeof username !== 'string') throw new Error("Argument 'username' is required.");

  const targetId = await resolveProfileId(username.trim());
  if (!targetId) throw new Error(`Profile '@${username}' not found.`);

  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('id, username, full_name, avatar_url, bio, website, is_public, background_url, accent_color, created_at')
    .eq('id', targetId)
    .maybeSingle();
  if (error || !profile) throw new Error(`Profile '@${username}' not found.`);
  if (profile.is_public === false) {
    return { profile: { username: profile.username, full_name: profile.full_name, is_public: false }, note: 'This profile is private.' };
  }

  const counts = await getProfileFollowCounts(targetId);

  // Public folios live in the org where this creator is Owner.
  const { data: membership } = await supabaseAdmin
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', targetId)
    .eq('role', 'Owner')
    .maybeSingle();

  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://livefolio.cloud').replace(/\/+$/, '');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed DB rows for a creator's public folios
  let folios: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed DB rows for a creator's public workspaces
  let workspaces: any[] = [];

  if (membership) {
    const orgId = membership.organization_id;
    const { data: folioRows, error: folioErr } = await supabaseAdmin
      .from('folios')
      .select('id, title, slug, description, project_mode, thumbnail_url, paid_access, listed, category, tags, creation, license, reactions, updated_at')
      .eq('organization_id', orgId)
      .eq('status', 'published')
      .eq('is_private', false)
      .eq('moderation_status', 'ok')
      .order('updated_at', { ascending: false });
    if (folioErr) throw folioErr;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped Supabase folio rows
    folios = (folioRows || []).map((f: any) => ({
      project_id: f.id,
      title: f.title,
      description: f.description,
      share_url: f.slug ? `${base}/@${profile.username}/${f.slug}` : `${base}/share/${f.id}`,
      project_mode: f.project_mode,
      thumbnail_url: f.thumbnail_url,
      listed_in_explore: f.listed === true,
      category: f.category,
      tags: f.tags || [],
      paid: !!(f.paid_access && f.paid_access.enabled),
      price: f.paid_access?.enabled
        ? { amount_cents: f.paid_access.amountCents, currency: f.paid_access.currency, price_type: f.paid_access.priceType }
        : null,
      reactions: f.reactions || {},
      updated_at: f.updated_at,
    }));

    const { data: projectRows, error: projErr } = await supabaseAdmin
      .from('projects')
      .select('id, name, slug, description, is_public')
      .eq('organization_id', orgId)
      .eq('is_public', true)
      // A creator's public catalog never advertises an archived workspace.
      .is('archived_at', null);
    if (projErr) throw projErr;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped Supabase project rows
    workspaces = (projectRows || []).map((p: any) => ({
      project_id: p.id,
      name: p.name,
      url: p.slug ? `${base}/u/${profile.username}/w/${p.slug}` : null,
      description: p.description,
    }));
  }

  return {
    profile: {
      username: profile.username,
      full_name: profile.full_name,
      avatar_url: profile.avatar_url,
      bio: profile.bio,
      website: profile.website,
      accent_color: profile.accent_color,
      joined_at: profile.created_at,
    },
    stats: { followers: counts.followers, following: counts.following },
    folios,
    folio_count: folios.length,
    workspaces,
  };
}
