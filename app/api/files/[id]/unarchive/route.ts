import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth';
import { isOSS } from '@/lib/env';
import { extractUUIDFromSlug } from '@/lib/utils';
import { unarchiveFolio } from '@/lib/archive';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /api/files/[id]/unarchive — restore an archived folio.
 *
 * Clears the archive flag ONLY. The folio comes back as a DRAFT and stays
 * unlisted — it never silently republishes, because the owner may have
 * archived it precisely to take it down. Publishing again is a deliberate
 * separate action (PUT /api/files/[id] with status, or the share menu).
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;

    let orgId: string | undefined;
    if (!isOSS) {
      const auth = await getAuthContext();
      if (!auth.orgId) {
        return NextResponse.json({ error: 'Sign in to unarchive a folio.' }, { status: 401 });
      }
      orgId = auth.orgId;
    }

    const state = await unarchiveFolio(isOSS ? id : extractUUIDFromSlug(id), orgId);
    if (!state) {
      return NextResponse.json({ error: 'Folio not found.' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      project: {
        id: state.id,
        status: state.status,
        archived: false,
        archivedAt: null,
      },
      note: 'Restored as a draft. Publish it again when you are ready.',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- thrown error shape is dynamic (err.message read below)
  } catch (err: any) {
    console.error('Unarchive failed:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Failed to unarchive folio.' }, { status: 500 });
  }
}
