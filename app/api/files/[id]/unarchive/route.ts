import { createFolioArchiveRoute } from '@/lib/api/archive-route';
import { gateFolioArchive } from '../../_lib/role-gate';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /api/files/[id]/unarchive — restore an archived folio.
 *
 * Clears the archive flag ONLY. The folio comes back as a DRAFT and stays
 * unlisted — it never silently republishes, because the owner may have
 * archived it precisely to take it down. Publishing again is a deliberate
 * separate action (PUT /api/files/[id] with status, or the share menu).
 *
 * The handler itself is shared with the archive route — see
 * lib/api/archive-route.ts for the guard and envelope.
 *
 * OWNER ONLY — the same wrapper, and the same reason, as
 * app/api/files/[id]/archive/route.ts.
 */

const unarchive = createFolioArchiveRoute('unarchive');

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const denial = await gateFolioArchive(context);
  if (denial) return denial;
  return unarchive(request, context);
}
