import { createFolioArchiveRoute } from '@/lib/api/archive-route';

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
 */
export const POST = createFolioArchiveRoute('archive');
