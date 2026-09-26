import { createFolioArchiveRoute } from '@/lib/api/archive-route';
import { gateFolioArchive } from '../../_lib/role-gate';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /api/files/[id]/archive — hide a folio from every public surface.
 *
 * The reversible alternative to delete: the folio is unpublished, unlisted
 * from Explore, and gated everywhere public, but the owner keeps it and it
 * still counts toward storage. Restore with POST /api/files/[id]/unarchive —
 * it returns as a DRAFT, never auto-republished.
 *
 * Idempotent: archiving an already-archived folio succeeds and keeps the
 * original timestamp, so agent retries are safe.
 *
 * The handler itself is shared with the unarchive route — see
 * lib/api/archive-route.ts for the guard and envelope.
 *
 * OWNER ONLY. That shared guard is org-scoped, so before this
 * wrapper any org `Member` could archive any folio in the workspace. The handler
 * is outside this task's scope, so the owner check is applied in front of it,
 * through the same `resolveFolioRole` the sibling folio routes use. A caller
 * with no standing gets the same 404 a missing folio gets.
 */

const archive = createFolioArchiveRoute('archive');

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const denial = await gateFolioArchive(context);
  if (denial) return denial;
  return archive(request, context);
}
