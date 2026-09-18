import { NextResponse } from 'next/server';
import { isOSS } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase';
import { getAuthContext } from '@/lib/auth';
import { archiveWorkspace } from '@/lib/archive';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /api/projects/[id]/archive — archive a workspace and everything in it.
 *
 * Sweeps every folio in the workspace through the same invariant as a folio
 * archive: unpublished, unlisted, hidden from the public workspace page and
 * from every profile listing. The workspace itself is gated on its own
 * `archived_at`, since workspaces have no status column.
 *
 * Cloud-only — OSS has no workspaces.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await context.params;

    if (isOSS) {
      return NextResponse.json({ error: 'Not implemented in OSS mode.' }, { status: 501 });
    }

    const { orgId } = await getAuthContext();
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (!supabaseAdmin) {
      return NextResponse.json({
        error: 'Supabase client is not initialized.',
        message: 'Please make sure that NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in your local .env file when running in cloud/SaaS mode.'
      }, { status: 500 });
    }

    const state = await archiveWorkspace(projectId, orgId);
    if (!state) {
      return NextResponse.json({ error: 'Workspace not found.' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      project: { id: state.id, archived: true, archivedAt: state.archivedAt },
      archived_folios: state.affectedFolios,
      note: 'Workspace archived — its folios are unpublished and hidden, and still count toward storage. Restore returns them as drafts.',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- thrown error shape is dynamic (err.message read below)
  } catch (err: any) {
    console.error('Workspace archive failed:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Failed to archive workspace.' }, { status: 500 });
  }
}
