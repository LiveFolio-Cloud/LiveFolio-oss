import { createWorkspaceArchiveRoute } from '@/lib/api/archive-route';

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
 *
 * The handler itself is shared with the archive route — see
 * lib/api/archive-route.ts for the guard and envelope.
 */
export const POST = createWorkspaceArchiveRoute('unarchive');
