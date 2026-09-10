import { NextResponse } from 'next/server';
import { isOSS } from '@/lib/env';
import { readDB, UserProfile, Project, HTMLFile } from '@/lib/db';
import { supabaseAdmin } from '@/lib/supabase';
import { extractUUIDFromSlug, isUUID } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ username: string }> }
) {
  try {
    const { username } = await context.params;

    if (isOSS) {
      const db = await readDB();
      // Only expose published, non-private folios — private folios and
      // drafts must never appear on a public profile (or leak via this
      // public API). The username is not meaningful in OSS (single user),
      // but the data filter is.
      const visibleFolios = db.filter((f) => f.status === 'published' && !f.isPrivate);
      // Group by projectId for project grouping
      const projectMap = new Map<string, HTMLFile[]>();
      const ungroupedFolios: HTMLFile[] = [];

      for (const folio of visibleFolios) {
        if (folio.projectId) {
          const group = projectMap.get(folio.projectId) || [];
          group.push(folio);
          projectMap.set(folio.projectId, group);
        } else {
          ungroupedFolios.push(folio);
        }
      }

      // Build projects array from the grouped folios
      // In OSS mode, projects are just logical groupings — we return placeholder projects
      const projects: (Project & { folios: HTMLFile[] })[] = [];
      projectMap.forEach((folios, projectId) => {
        projects.push({
          id: projectId,
          organization_id: 'local-workspace',
          name: projectId,
          slug: projectId,
          folios,
        });
      });

      return NextResponse.json({
        profile: {
          id: 'oss-local-user',
          username: 'local',
          full_name: 'Local Developer',
          is_public: true,
        } as UserProfile,
        folios: ungroupedFolios,
        projects,
      }, {
        headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
      });
    }

    // Cloud Mode
    if (!supabaseAdmin) {
      return NextResponse.json({
        error: 'Supabase client is not initialized.',
        message: 'Please configure Supabase environment variables.',
      }, { status: 500 });
    }

    // 1. Look up the profile by username first, then by id (UUID)
    const profileQuery = supabaseAdmin
      .from('profiles')
      .select('id, username, full_name, avatar_url, bio, website, is_public, updated_at, created_at')
      .eq('username', username);

    const profileLookup = await profileQuery.single();
    let { data: profile } = profileLookup;
    const { error: profileErr } = profileLookup;

    // If not found by username, try by id (UUID or UUID extracted from slug)
    if (profileErr || !profile) {
      const lookupId = isUUID(username) ? username : extractUUIDFromSlug(username);
      const { data: byId, error: byIdErr } = await supabaseAdmin
        .from('profiles')
        .select('id, username, full_name, avatar_url, bio, website, is_public, updated_at, created_at')
        .eq('id', lookupId)
        .single();

      if (byIdErr || !byId) {
        return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });
      }

      profile = byId;
    }

    // 2. Respect privacy setting
    if (profile.is_public === false) {
      return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });
    }

    // 3. Find user's personal organization (where they are Owner)
    const { data: ownerMembership } = await supabaseAdmin
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', profile.id)
      .eq('role', 'Owner')
      .maybeSingle();

    const personalOrgId = ownerMembership?.organization_id || null;

    // 4. Get published public folios from the personal org
    let folios: HTMLFile[] = [];
    const projects: (Project & { folios: HTMLFile[] })[] = [];

    if (personalOrgId) {
      const { data: folioRecords, error: foliosErr } = await supabaseAdmin
        .from('folios_metadata')
        .select('*')
        .eq('organization_id', personalOrgId)
        .eq('status', 'published')
        .eq('is_private', false)
        .order('updated_at', { ascending: false });

      if (!foliosErr && folioRecords) {
        // Transform DB records to HTMLFile shape
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped Supabase folio record mapped onto the HTMLFile shape below
        folios = folioRecords.map((r: any) => ({
          id: r.id,
          organization_id: r.organization_id,
          title: r.title,
          description: r.description,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          versions: r.versions || [],
          isPrivate: r.is_private,
          allowComments: r.allow_comments,
          presentationModeOnly: r.presentation_mode_only,
          projectMode: r.project_mode,
          designPreferences: r.design_preferences,
          aiPersona: r.ai_persona,
          collaborators: r.collaborators || [],
          reactions: r.reactions || {},
          comments: r.comments || [],
          status: r.status,
          projectId: r.project_id,
          folderId: r.folder_id,
          cliLastSeen: r.cli_last_seen,
          publicTunnelEnabled: r.public_tunnel_enabled,
          analytics: r.analytics,
        })) as HTMLFile[];

        // 5. Group folios by project_id
        const projectMap = new Map<string, HTMLFile[]>();
        const projectIds = new Set<string>();
        const ungroupedFolios: HTMLFile[] = [];

        for (const folio of folios) {
          if (folio.projectId) {
            const group = projectMap.get(folio.projectId) || [];
            group.push(folio);
            projectMap.set(folio.projectId, group);
            projectIds.add(folio.projectId);
          } else {
            ungroupedFolios.push(folio);
          }
        }

        // Assign ungrouped back (they're top-level folios)
        folios = ungroupedFolios;

        // Fetch project details for each project group
        if (projectIds.size > 0) {
          const { data: projectRecords, error: projectsErr } = await supabaseAdmin
            .from('projects')
            .select('*')
            .in('id', Array.from(projectIds))
            .eq('organization_id', personalOrgId);

          if (!projectsErr && projectRecords) {
            for (const prj of projectRecords) {
              projects.push({
                id: prj.id,
                organization_id: prj.organization_id,
                created_by: prj.created_by,
                name: prj.name,
                slug: prj.slug,
                description: prj.description,
                is_public: prj.is_public,
                created_at: prj.created_at,
                updated_at: prj.updated_at,
                folios: projectMap.get(prj.id) || [],
              });
            }
          }
        }
      }
    }

    // 6. Build the response profile object
    const userProfile: UserProfile = {
      id: profile.id,
      username: profile.username,
      full_name: profile.full_name,
      avatar_url: profile.avatar_url,
      bio: profile.bio,
      website: profile.website,
      is_public: profile.is_public,
      updated_at: profile.updated_at,
      created_at: profile.created_at,
    };

    return NextResponse.json({
      profile: userProfile,
      folios,
      projects,
    }, {
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- error shape is dynamic (err.message may be missing)
  } catch (err: any) {
    console.error('GET /api/profile/[username] error:', err.message || err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
