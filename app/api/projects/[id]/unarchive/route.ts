import { NextResponse } from 'next/server';
import { isOSS } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase';
import { getAuthContext } from '@/lib/auth';
import { unarchiveWorkspace } from '@/lib/archive';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /api/projects/[id]/unarchive — restore an archived workspace.
 *
 * Clears the flag on the workspace and on every folio inside it. Everything
 * comes back as DRAFTS — nothing republishes automatically, and the workspace
 * stays off the public profile until it is made public again.
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

    const state = await unarchiveWorkspace(projectId, orgId);
    if (!state) {
      return NextResponse.json({ error: 'Workspace not found.' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      project: { id: state.id, archived: false, archivedAt: null },
      restored_folios: state.affectedFolios,
      note: 'Workspace and its folios restored as drafts. Publish them again when you are ready.',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- thrown error shape is dynamic (err.message read below)
  } catch (err: any) {
    console.error('Workspace unarchive failed:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Failed to unarchive workspace.' }, { status: 500 });
  }
}
