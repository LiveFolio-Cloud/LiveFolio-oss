import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth';
import { isOSS } from '@/lib/env';
import { extractUUIDFromSlug } from '@/lib/utils';
import { archiveFolio } from '@/lib/archive';

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
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;

    let orgId: string | undefined;
    if (!isOSS) {
      const auth = await getAuthContext();
      if (!auth.orgId) {
        return NextResponse.json({ error: 'Sign in to archive a folio.' }, { status: 401 });
      }
      orgId = auth.orgId;
    }

    const state = await archiveFolio(isOSS ? id : extractUUIDFromSlug(id), orgId);
    if (!state) {
      return NextResponse.json({ error: 'Folio not found.' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      project: {
        id: state.id,
        status: state.status,
        archived: true,
        archivedAt: state.archivedAt,
      },
      note: 'Archived — unpublished and unlisted. Restore it as a draft with unarchive.',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- thrown error shape is dynamic (err.message read below)
  } catch (err: any) {
    console.error('Archive failed:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Failed to archive folio.' }, { status: 500 });
  }
}
