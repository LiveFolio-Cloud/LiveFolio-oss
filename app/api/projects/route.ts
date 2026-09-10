import { NextResponse } from 'next/server';
import { isOSS } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase';
import { getAuthContext } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const { orgId } = await getAuthContext();

    if (isOSS) {
      return NextResponse.json([]);
    }

    // Cloud Mode - Scoped to Org
    if (!supabaseAdmin) {
      return NextResponse.json({
        error: 'Supabase client is not initialized.',
        message: 'Please make sure that NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in your local .env file when running in cloud/SaaS mode.'
      }, { status: 500 });
    }

    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data, error } = await supabaseAdmin
      .from('projects')
      .select('*')
      .eq('organization_id', orgId)
      .order('updated_at', { ascending: false });

    if (error) throw error;

    // Enrich each project with folio count
    const enriched = await Promise.all(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project rows come from a select('*') on the schema-less supabase client
      (data || []).map(async (project: any) => {
        const { count, error: countError } = await supabaseAdmin
          .from('folios')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', project.id);

        return {
          id: project.id,
          organization_id: project.organization_id,
          created_by: project.created_by,
          name: project.name,
          slug: project.slug,
          description: project.description,
          is_public: project.is_public,
          // Must echo paid_access / thumbnail_url or the workspace dialog
          // reopens with them dropped despite the DB row holding them
          // (silent drop — same class of bug as the gate deactivation).
          paid_access: project.paid_access ?? null,
          thumbnail_url: project.thumbnail_url ?? null,
          created_at: project.created_at,
          updated_at: project.updated_at,
          folio_count: countError ? 0 : (count || 0),
        };
      })
    );

    return NextResponse.json(enriched);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { orgId, userId } = await getAuthContext();

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
    const { name, slug: providedSlug, description, is_public } = body;

    // Validate name
    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    // Auto-generate slug from name if not provided: lowercase, replace spaces/special chars with hyphens
    const slug = (providedSlug || name.trim())
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    if (!slug) {
      return NextResponse.json({ error: 'Could not generate a valid slug from the provided name.' }, { status: 400 });
    }

    // Check for duplicate slug within the org
    const { data: existing, error: dupError } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('organization_id', orgId)
      .eq('slug', slug)
      .maybeSingle();

    if (dupError) throw dupError;
    if (existing) {
      return NextResponse.json({ error: `A project with the slug "${slug}" already exists in this organization.` }, { status: 409 });
    }

    const { data, error } = await supabaseAdmin
      .from('projects')
      .insert({
        organization_id: orgId,
        created_by: userId,
        name: name.trim(),
        slug,
        description: description?.trim() || null,
        is_public: !!is_public,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, project: data });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
