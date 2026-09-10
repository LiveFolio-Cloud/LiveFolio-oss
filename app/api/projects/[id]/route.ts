import { NextResponse } from 'next/server';
import { isOSS } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase';
import { getAuthContext } from '@/lib/auth';
import { sanitizePaidAccess } from '@/lib/gating/config';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { orgId } = await getAuthContext();

    if (isOSS) {
      return NextResponse.json({ error: 'Not implemented in OSS mode.' }, { status: 501 });
    }

    // Cloud Mode
    if (!supabaseAdmin) {
      return NextResponse.json({
        error: 'Supabase client is not initialized.',
        message: 'Please make sure that NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in your local .env file when running in cloud/SaaS mode.'
      }, { status: 500 });
    }

    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch the project
    const { data: project, error } = await supabaseAdmin
      .from('projects')
      .select('*')
      .eq('id', id)
      .eq('organization_id', orgId)
      .single();

    if (error || !project) {
      return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    }

    // Fetch folios belonging to this project
    const { data: folios, error: foliosError } = await supabaseAdmin
      .from('folios')
      .select('*')
      .eq('project_id', id)
      .eq('organization_id', orgId)
      .order('updated_at', { ascending: false });

    if (foliosError) throw foliosError;

    return NextResponse.json({
      ...project,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- folio rows come from a select('*') on the schema-less supabase client
      folios: (folios || []).map((f: any) => ({
        id: f.id,
        title: f.title,
        description: f.description,
        status: f.status,
        project_mode: f.project_mode,
        is_private: f.is_private,
        folder_id: f.folder_id,
        created_at: f.created_at,
        updated_at: f.updated_at,
      })),
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { orgId } = await getAuthContext();

    if (isOSS) {
      return NextResponse.json({ error: 'Not implemented in OSS mode.' }, { status: 501 });
    }

    // Cloud Mode
    if (!supabaseAdmin) {
      return NextResponse.json({
        error: 'Supabase client is not initialized.',
        message: 'Please make sure that NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in your local .env file when running in cloud/SaaS mode.'
      }, { status: 500 });
    }

    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { name, slug: providedSlug, description, is_public, paid_access, thumbnail_url } = body;

    // Build update patch
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (name !== undefined) {
      if (!name.trim()) {
        return NextResponse.json({ error: 'Name cannot be empty.' }, { status: 400 });
      }
      patch.name = name.trim();
    }

    if (description !== undefined) {
      patch.description = description?.trim() || null;
    }

    if (is_public !== undefined) {
      patch.is_public = !!is_public;
    }

    // Workspace gate default. `null` clears it (no default price); a value
    // must survive the same strict sanitizer every other write surface uses.
    if (paid_access !== undefined) {
      if (paid_access === null) {
        patch.paid_access = null;
      } else {
        const sanitized = sanitizePaidAccess(paid_access);
        if (!sanitized) {
          return NextResponse.json({ error: 'Invalid paid_access configuration.' }, { status: 400 });
        }
        patch.paid_access = sanitized;
      }
    }

    // Workspace thumbnail (public storage URL). `null` clears; a value must
    // be a plausible http(s) URL — never a data/blob/javascript payload.
    if (thumbnail_url !== undefined) {
      if (thumbnail_url === null) {
        patch.thumbnail_url = null;
      } else if (
        typeof thumbnail_url === 'string' &&
        /^https?:\/\//.test(thumbnail_url) &&
        thumbnail_url.length <= 2048
      ) {
        patch.thumbnail_url = thumbnail_url;
      } else {
        return NextResponse.json({ error: 'Invalid thumbnail_url.' }, { status: 400 });
      }
    }

    // Check slug uniqueness within the org if provided
    if (providedSlug !== undefined) {
      const slug = providedSlug
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

      if (!slug) {
        return NextResponse.json({ error: 'Could not generate a valid slug from the provided name.' }, { status: 400 });
      }

      const { data: existing, error: dupError } = await supabaseAdmin
        .from('projects')
        .select('id')
        .eq('organization_id', orgId)
        .eq('slug', slug)
        .neq('id', id)
        .maybeSingle();

      if (dupError) throw dupError;
      if (existing) {
        return NextResponse.json({ error: `A project with the slug "${slug}" already exists in this organization.` }, { status: 409 });
      }

      patch.slug = slug;
    }

    // If name changed and no explicit slug provided, regenerate slug from name
    if (name !== undefined && providedSlug === undefined) {
      const slug = name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

      if (slug) {
        const { data: existing, error: dupError } = await supabaseAdmin
          .from('projects')
          .select('id')
          .eq('organization_id', orgId)
          .eq('slug', slug)
          .neq('id', id)
          .maybeSingle();

        if (!dupError && !existing) {
          patch.slug = slug;
        }
      }
    }

    if (Object.keys(patch).length <= 1) {
      // Only updated_at — nothing to change
      return NextResponse.json({ success: true, project: { id } });
    }

    const { data, error } = await supabaseAdmin
      .from('projects')
      .update(patch)
      .eq('id', id)
      .eq('organization_id', orgId)
      .select()
      .single();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    }

    return NextResponse.json({ success: true, project: data });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { orgId } = await getAuthContext();

    if (isOSS) {
      return NextResponse.json({ error: 'Not implemented in OSS mode.' }, { status: 501 });
    }

    // Cloud Mode
    if (!supabaseAdmin) {
      return NextResponse.json({
        error: 'Supabase client is not initialized.',
        message: 'Please make sure that NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in your local .env file when running in cloud/SaaS mode.'
      }, { status: 500 });
    }

    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // The project_id FK on folios is ON DELETE SET NULL, so deleting the project
    // will automatically detach folios without deleting them.
    const { error } = await supabaseAdmin
      .from('projects')
      .delete()
      .eq('id', id)
      .eq('organization_id', orgId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
