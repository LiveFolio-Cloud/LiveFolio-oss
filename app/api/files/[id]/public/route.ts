import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { readDB } from '@/lib/db';
import { isOSS, FEATURES } from '@/lib/env';
import { supabaseAdmin, transformFolioRecord, FolioRecord } from '@/lib/supabase';
import { extractUUIDFromSlug } from '@/lib/utils';
import { resolveGateConfig } from '@/lib/gating/config';
import { hasActiveGrant } from '@/lib/gating/grants';
import { getOwnerIdentity } from '@/app/api/_lib/gate-owner';
import type { ResolvedGate } from '@/lib/gating/types';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/**
 * Public metadata for a project (used by Share link)
 * Returns title, description, isPrivate (bool), and allowed flags.
 * Does NOT return versions (except latest metadata) or sensitive keys.
 * Private folios without a valid access key only receive minimal metadata —
 * comments/reactions/file lists are withheld until the key is proven.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    let targetId = id;
    const { searchParams } = new URL(request.url);
    const accessKeyParam = searchParams.get('access_key') || '';

    if (isOSS) {
      const db = await readDB();
      let project = db.find((p) => p.id === targetId);
      if (!project && targetId.includes('-')) {
        const parts = targetId.split('-');
        for (let i = 1; i <= parts.length; i++) {
          const candidate = parts.slice(-i).join('-');
          const found = db.find((p) => p.id === candidate);
          if (found) {
            project = found;
            targetId = project.id;
            break;
          }
        }
      }
      if (!project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      }

      const isPrivate = !!project.isPrivate;
      const keyValid = !!project.accessKey && timingSafeEqualStr((project.accessKey || '').trim(), accessKeyParam.trim());
      const hasAccess = !isPrivate || keyValid;

      return NextResponse.json({
        id: project.id,
        title: project.title,
        description: project.description,
        isPrivate,
        allowComments: project.allowComments !== false,
        presentationModeOnly: !!project.presentationModeOnly,
        hasAccessKey: !!project.accessKey,
        status: project.status || 'published',
        draft: project.status === 'draft',
        latestVersionId: hasAccess ? project.versions[project.versions.length - 1]?.versionId : undefined,
        activeFileList: hasAccess ? Object.keys(project.versions[project.versions.length - 1]?.files || {}) : [],
        comments: hasAccess ? (project.comments || []).filter(c => c.versionId === project.versions[project.versions.length - 1]?.versionId && !c.resolved) : [],
        reactions: hasAccess ? (project.reactions || {}) : {},
      }, {
        headers: { 'Cache-Control': 'public, max-age=0, must-revalidate' },
      });
    }

    // Cloud Mode — extract UUID from human-readable slug before querying
    const queryId = extractUUIDFromSlug(targetId);
    const folioSelect =
      'id, organization_id, title, description, is_private, allow_comments, presentation_mode_only, access_key, versions, reactions, comments, status, paid_access, thumbnail_url, project_id, slug';
    let { data, error } = await supabaseAdmin
      .from('folios')
      .select(folioSelect)
      .eq('id', queryId)
      .maybeSingle();

    if (!data && !error && queryId !== targetId) {
      // Fallback: try the full slug (edge case for manually-created non-UUID IDs)
      const res = await supabaseAdmin
        .from('folios')
        .select(folioSelect)
        .eq('id', targetId)
        .maybeSingle();
      if (!res.error && res.data) data = res.data;
      error = res.error;
    }

    if (error || !data) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const project = transformFolioRecord(data as FolioRecord);

    // Content takedown — moderated-down folios behave as unpublished on the
    // public metadata surface too (viewers see "not found", never a leak).
    if (project.moderationStatus === 'hidden') {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    const latestVersion = project.versions[project.versions.length - 1];

    // Private folios: withhold content unless a valid access key is provided.
    const isPrivate = !!project.isPrivate;
    const keyValid = !!data.access_key && timingSafeEqualStr((data.access_key || '').trim(), accessKeyParam.trim());
    const hasAccess = !isPrivate || keyValid;
    // A validated private-key holder IS the access the owner chose to share —
    // paid gating never applies to them (they were handed the key directly).
    // They're also reported with OWNER viewer standing: the client treats
    // 'none' as locked, so anything less would immediately show the lock/
    // paywall overlay right after the key is accepted.
    const keyAccess = isPrivate && keyValid;
    let viewerAccess: 'owner' | 'granted' | 'preview' | 'none' = 'none';
    if (keyAccess) viewerAccess = 'owner';

    // ── Paid gate metadata (cloud only) ──────────────────────────────
    // Resolve the effective gate and the VIEWER's standing, so the share
    // page can render the right surface without hitting the raw route.
    // Private/access-key precedence is untouched: `hasAccess` above already
    // withholds lists from key-less visitors, and the prune below only
    // narrows an existing list further.
    let gate: ResolvedGate | null = null;
    let paidAccess: {
      targetType: 'folio' | 'workspace';
      priceType: string;
      amountCents: number;
      currency: string;
      rentalDays?: number;
      previewMode: 'none' | 'timed' | 'first_page';
      previewSeconds?: number;
      allowCopy?: boolean;
      allowDownload?: boolean;
    } | null = null;
    let accentColor: string | undefined;

    if (FEATURES.paidGating && !keyAccess) {
      gate = await resolveGateConfig({
        paid_access: project.paidAccess,
        project_id: project.projectId,
        organization_id: project.organization_id,
      });

      if (gate && !keyAccess) {
        // Config minus secrets — nothing here can hurt client-side.
        paidAccess = {
          targetType: gate.targetType,
          priceType: gate.config.priceType,
          amountCents: gate.config.amountCents,
          currency: gate.config.currency,
          rentalDays: gate.config.rentalDays,
          previewMode: gate.config.previewMode,
          previewSeconds: gate.config.previewSeconds,
          allowCopy: gate.config.allowCopy === true,
          allowDownload: gate.config.allowDownload === true,
        };

        // Viewer identity — null-safe (anonymous visitors get preview/none).
        let user: { id: string } | null = null;
        try {
          const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
          const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
          const cookieStore = await cookies();
          const { createServerClient } = await import('@/lib/supabase');
          const clientSupabase = createServerClient(supabaseUrl, supabaseAnonKey, {
            cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} }
          });
          const { data: authData } = await clientSupabase.auth.getUser();
          user = authData.user;
        } catch { /* anonymous */ }

        let isMember = false;
        if (user && project.organization_id) {
          const { data: membership } = await supabaseAdmin
            .from('organization_members')
            .select('id')
            .eq('organization_id', project.organization_id)
            .eq('user_id', user.id)
            .limit(1);
          isMember = !!(membership && membership.length > 0);
        }

        const folioHasOwnGate = project.paidAccess != null;
        let granted = false;
        if (user && !isMember) {
          // `project.id` is the folio UUID — the route param may be a slug.
          granted = await hasActiveGrant(user.id, 'folio', project.id)
            || (!folioHasOwnGate && project.projectId
              ? await hasActiveGrant(user.id, 'workspace', project.projectId)
              : false);
        }

        viewerAccess = isMember
          ? 'owner'
          : granted
            ? 'granted'
            : (gate.config.previewMode !== 'none' ? 'preview' : 'none');

        const identity = await getOwnerIdentity(project.organization_id);
        accentColor = identity.accentColor;
      }
    }

    // First-page preview prunes the page switcher server-side: non-owner/
    // non-granted viewers only see index.html. `!hasAccess` already yields
    // an empty list — keep that precedence (never fabricate ['index.html']).
    const activeFileList = !hasAccess
      ? []
      : (gate && gate.config.previewMode === 'first_page' && viewerAccess !== 'owner' && viewerAccess !== 'granted'
        ? ['index.html']
        : Object.keys(latestVersion?.files || {}));

    // Canonical public link (@username/slug) support — the share page
    // redirects /share/... here, so surfaces can hand out the pretty link.
    // Cached in-process (5 min) — not a per-view cost after the first.
    const ownerIdentity = project.slug && project.organization_id
      ? await getOwnerIdentity(project.organization_id)
      : {};
    const ownerUsername = ownerIdentity.username;

    return NextResponse.json({
      id: project.id,
      title: project.title,
      description: project.description,
      isPrivate,
      allowComments: project.allowComments,
      presentationModeOnly: project.presentationModeOnly,
      hasAccessKey: !!data.access_key,
      status: project.status || 'published',
      draft: project.status === 'draft',
      latestVersionId: hasAccess ? latestVersion?.versionId : undefined,
      activeFileList,
      comments: hasAccess ? (project.comments || []).filter(c => c.versionId === latestVersion?.versionId && !c.resolved) : [],
      reactions: hasAccess ? (project.reactions || {}) : {},
      paidAccess,
      viewerAccess,
      accentColor,
      thumbnailUrl: project.thumbnailUrl ?? null,
      slug: project.slug ?? null,
      ownerUsername,
      // Buyer-facing license terms (Explore/storefront listings) — shown on
      // the paywall so the purchase decision names the rights being sold.
      license: project.listing?.license ?? null,
    }, {
      headers: { 'Cache-Control': 'public, max-age=0, must-revalidate' },
    });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: err may be any thrown value; only logged
  } catch (err: any) {
    console.error('GET /api/files/[id]/public error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    let targetId = id;
    const body = await request.json();
    const { accessKey } = body;

    const sanitizedAttempt = (accessKey || '').trim();

    if (isOSS) {
      const db = await readDB();
      let project = db.find((p) => p.id === targetId);
      if (!project && targetId.includes('-')) {
        const parts = targetId.split('-');
        for (let i = 1; i <= parts.length; i++) {
          const candidate = parts.slice(-i).join('-');
          const found = db.find((p) => p.id === candidate);
          if (found) {
            project = found;
            targetId = project.id;
            break;
          }
        }
      }
      if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      
      const serverKey = (project.accessKey || '').trim();
      const isValid = serverKey !== '' && timingSafeEqualStr(serverKey, sanitizedAttempt);
      
      return NextResponse.json({ success: isValid });
    }

    // Cloud Mode — extract UUID from human-readable slug before querying
    const queryId = extractUUIDFromSlug(targetId);
    let { data, error } = await supabaseAdmin
      .from('folios')
      .select('access_key')
      .eq('id', queryId)
      .maybeSingle();

    if (!data && !error && queryId !== targetId) {
      // Fallback: try the full slug (edge case for manually-created non-UUID IDs)
      const res = await supabaseAdmin
        .from('folios')
        .select('id, access_key')
        .eq('id', targetId)
        .maybeSingle();
      if (!res.error && res.data) data = res.data;
      error = res.error;
    }

    if (error || !data) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    
    const serverKey = (data.access_key || '').trim();
    const isValid = serverKey !== '' && timingSafeEqualStr(serverKey, sanitizedAttempt);
    
    return NextResponse.json({ success: isValid });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: err may be any thrown value; only logged
  } catch (err: any) {
    console.error('POST /api/files/[id]/public error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
