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
 * WHO MAY ARCHIVE. That shared guard is org-scoped, so before this wrapper any
 * org `Member` could archive any folio in the workspace. The role check is
 * applied in front of it, through the same `resolveFolioRole` the sibling folio
 * routes use: a caller with no standing gets the same 404 a missing folio gets,
 * and a caller who can see the folio but not archive it gets a 403. Since
 * 2026-09-26 the matrix admits an `editor` collaborator to `archive` as well as
 * an org member.
 *
 * The gate also hands the shared handler the org that OWNS the folio. A
 * collaborator's own workspace is not the folio's, and the handler's org-scoped
 * toggle would answer 404 for a folio they were just granted — the same
 * `gate.access.folio.organization_id` the sibling routes write with.
 */

const archive = createFolioArchiveRoute('archive');

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const gate = await gateFolioArchive(context);
  if (!gate.ok) return gate.response;
  return archive(request, context, gate.folioOrgId ? { orgId: gate.folioOrgId } : undefined);
}
