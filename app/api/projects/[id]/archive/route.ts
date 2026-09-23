import { createWorkspaceArchiveRoute } from '@/lib/api/archive-route';

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
 *
 * The handler itself is shared with the unarchive route — see
 * lib/api/archive-route.ts for the guard and envelope.
 */
export const POST = createWorkspaceArchiveRoute('archive');
