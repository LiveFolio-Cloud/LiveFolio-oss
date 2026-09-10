import { NextResponse } from 'next/server';
import { isOSS } from '@/lib/env';
import { getAuthContext } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { UserProfile } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** GET /api/profile — returns the current authenticated user's own profile */
export async function GET() {
  try {
    const { userId } = await getAuthContext();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    if (isOSS) {
      return NextResponse.json({
        profile: { id: 'oss-local-user', username: 'local', full_name: 'Local Developer', is_public: true } as UserProfile,
      });
    }

    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'Supabase not configured.' }, { status: 500 });
    }

    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('id, username, full_name, avatar_url, bio, website, is_public, background_url, accent_color, seller_terms_accepted_at, seller_terms_version, account_status, updated_at, created_at')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });
    }

    return NextResponse.json({
      profile: {
        id: profile.id,
        username: profile.username,
        full_name: profile.full_name,
        avatar_url: profile.avatar_url,
        bio: profile.bio,
        website: profile.website,
        is_public: profile.is_public,
        background_url: profile.background_url,
        accent_color: profile.accent_color,
        seller_terms_accepted_at: profile.seller_terms_accepted_at,
        seller_terms_version: profile.seller_terms_version,
        account_status: profile.account_status,
        updated_at: profile.updated_at,
        created_at: profile.created_at,
      } as UserProfile,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { userId } = await getAuthContext();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    if (isOSS) {
      return NextResponse.json({
        error: 'Profile editing is not available in OSS mode.',
        message: 'OSS mode does not support user profiles. Switch to Cloud mode (Supabase) to use this feature.',
      }, { status: 501 });
    }

    // Cloud Mode
    if (!supabaseAdmin) {
      return NextResponse.json({
        error: 'Supabase client is not initialized.',
        message: 'Please configure Supabase environment variables.',
      }, { status: 500 });
    }

    const body = await request.json();
    const {
      username,
      full_name,
      bio,
      website,
      avatar_url,
      background_url,
      is_public,
      featured_folio_id,
      accent_color,
    } = body;

    // 1. If username is being changed, validate and claim it via RPC
    if (username !== undefined && username !== null && username !== '') {
      const { data: claimResult, error: claimErr } = await supabaseAdmin
        .rpc('claim_username', {
          p_user_id: userId,
          p_username: username,
        });

      if (claimErr) {
        console.error('[PUT /api/profile] claim_username RPC error:', claimErr.message);
        return NextResponse.json({ error: claimErr.message }, { status: 500 });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- claim_username RPC payload shape is dynamic (success/error fields)
      const result = claimResult as any;
      if (!result?.success) {
        return NextResponse.json({
          error: result?.error || 'Failed to claim username.',
        }, { status: 409 });
      }
    }

    // 2. Build the update payload (only include fields that were provided)
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (username === null || username === '') {
      // Explicitly clearing username
      updates.username = null;
    } else if (username !== undefined) {
      updates.username = username;
    }
    if (full_name !== undefined) updates.full_name = full_name;
    if (bio !== undefined) updates.bio = bio;
    if (website !== undefined) updates.website = website;
    if (avatar_url !== undefined) updates.avatar_url = avatar_url;
    if (background_url !== undefined) updates.background_url = background_url;
    if (is_public !== undefined) updates.is_public = is_public;

    // Accent color: strict 6-digit hex — reject anything else so the public
    // profile CSS var never receives an invalid color. Explicit `null`
    // clears it back to the default LiveFolio page.
    if (accent_color !== undefined) {
      if (accent_color === null) {
        updates.accent_color = null;
      } else if (typeof accent_color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(accent_color)) {
        return NextResponse.json({
          error: 'accent_color must be a 6-digit hex color like #FF3B00.',
        }, { status: 400 });
      } else {
        updates.accent_color = accent_color;
      }
    }

    // Featured folio: must belong to this user's org and be published+public,
    // otherwise the profile would pin a folio the creator doesn't own.
    if (featured_folio_id !== undefined) {
      if (featured_folio_id === null || featured_folio_id === '') {
        updates.featured_folio_id = null;
      } else {
        const { data: membership } = await supabaseAdmin
          .from('organization_members')
          .select('organization_id')
          .eq('user_id', userId)
          .eq('role', 'Owner')
          .single();
        if (!membership) {
          return NextResponse.json({ error: 'No owned workspace found.' }, { status: 400 });
        }
        const { data: folio } = await supabaseAdmin
          .from('folios_metadata')
          .select('id')
          .eq('id', featured_folio_id)
          .eq('organization_id', membership.organization_id)
          .eq('status', 'published')
          .eq('is_private', false)
          .single();
        if (!folio) {
          return NextResponse.json({ error: 'Folio not found or not publishable.' }, { status: 400 });
        }
        updates.featured_folio_id = featured_folio_id;
      }
    }

    // 3. Update the profile row
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', userId)
      .select('id, username, full_name, avatar_url, bio, website, is_public, background_url, accent_color, updated_at, created_at')
      .single();

    if (updateErr) {
      console.error('[PUT /api/profile] Update error:', updateErr.message);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    if (!updated) {
      return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });
    }

    // 4. Return the updated profile
    const profile: UserProfile = {
      id: updated.id,
      username: updated.username,
      full_name: updated.full_name,
      avatar_url: updated.avatar_url,
      bio: updated.bio,
      website: updated.website,
      is_public: updated.is_public,
      background_url: updated.background_url,
      accent_color: updated.accent_color,
      updated_at: updated.updated_at,
      created_at: updated.created_at,
    };

    return NextResponse.json({ profile });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- error shape is dynamic (err.message may be missing)
  } catch (err: any) {
    console.error('PUT /api/profile error:', err.message || err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
