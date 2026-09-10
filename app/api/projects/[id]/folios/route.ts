import { NextResponse } from 'next/server';
import { isOSS } from '@/lib/env';
import { supabaseAdmin, transformFolioRecord, FolioRecord } from '@/lib/supabase';
import { getAuthContext } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /api/projects/[id]/folios — Add or move a folio into this project.
 * Lives in its own route file so Next.js matches the /folios URL segment.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await context.params;
    const { orgId } = await getAuthContext();

    if (isOSS) {
      return NextResponse.json({ error: 'Not implemented in OSS mode.' }, { status: 501 });
    }

    if (!supabaseAdmin) {
      return NextResponse.json({
        error: 'Supabase client is not initialized.',
        message: 'Please make sure that NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in your local .env file when running in cloud/SaaS mode.'
      }, { status: 500 });
    }

    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { folioId } = body;

    if (!folioId) {
      return NextResponse.json({ error: 'folioId is required.' }, { status: 400 });
    }

    // Verify the project exists and belongs to the org
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('organization_id', orgId)
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    }

    // Verify the folio exists and belongs to the same org
    const { data: folio, error: folioError } = await supabaseAdmin
      .from('folios')
      .select('id, organization_id')
      .eq('id', folioId)
      .eq('organization_id', orgId)
      .single();

    if (folioError || !folio) {
      return NextResponse.json({ error: 'Folio not found or does not belong to this organization.' }, { status: 404 });
    }

    // Update the folio's project_id
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('folios')
      .update({ project_id: projectId, updated_at: new Date().toISOString() })
      .eq('id', folioId)
      .select()
      .single();

    if (updateError) throw updateError;

    return NextResponse.json({
      success: true,
      folio: transformFolioRecord(updated as FolioRecord),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- thrown error shape is dynamic (err.message read below)
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to add folio to project.' }, { status: 500 });
  }
}
