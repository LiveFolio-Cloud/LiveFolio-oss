/**
 * `GET /api/inbox` — the cross-folio feedback feed.
 *
 * Answers one question: *what feedback arrived across my folios, and what
 * haven't I seen yet?* Feedback lives inside each folio's JSONB `comments` /
 * `reactions` columns, so this route is an aggregation + read-state join, not a
 * new store of its own.
 *
 * The feed carries TWO things a reader did not write themselves, and the second
 * one needs its own read (see `_lib/caller-grants.ts`):
 * - feedback on their own folios (this route's org-scoped folio query), and
 * - the folios OTHER people shared with them — grants, which are rows in
 *   the granted-access records pointing at folios that belong to the sharer's
 *   organization and are therefore invisible to the org-scoped query above.
 *
 * Mode split (see `lib/inbox.ts` for the full rationale):
 * - **Cloud** — the watermark lives in `inbox_read_state` (per user), so the
 *   server computes and returns `unreadCount` as a number.
 * - **OSS** — single-user local instance with no server-side identity, so the
 *   server returns the raw feed with `unreadCount: null` and the browser applies
 *   its own localStorage watermark. There is no grant table in a local install,
 *   so the Cloud-only read below has no OSS counterpart and the OSS payload is
 *   unchanged.
 */
import { NextResponse } from 'next/server';
import { readDB } from '@/lib/db';
import { isOSS } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase';
import { getAuthContext } from '@/lib/auth';
import { err } from '@/lib/api/respond';
import {
  EMPTY_WATERMARK,
  buildInbox,
  type InboxFolioInput,
  type InboxWatermark,
} from '@/lib/inbox';
import { loadCallerGrants } from './_lib/caller-grants';
import { watermarkFromRow } from './_lib/read-state';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Columns the inbox needs — deliberately NOT `select('*')`. The
 * `folios_metadata` view also carries versions (a byte-count map) and design
 * preferences; the inbox wants only the feedback columns plus enough identity
 * to render a row and build a link.
 */
const INBOX_COLUMNS = 'id,title,slug,status,updated_at,archived_at,comments,reactions';

/** Load the caller's read-state. Missing row / unreadable table → empty
 *  watermark, i.e. everything reads as new. Fail-open on the *data* is correct
 *  here: the worst case is an inbox that shows more than it strictly needs to,
 *  never one that hides feedback.
 *
 *  The row goes through `watermarkFromRow` rather than `normalizeWatermark`
 *  because the stored id list carries both id namespaces — see
 *  `_lib/read-state.ts` for why, and for why that is a bridge rather than the
 *  intended home of the grant marks. */
async function loadWatermark(userId: string | null): Promise<InboxWatermark> {
  if (!userId || !supabaseAdmin) return { ...EMPTY_WATERMARK };
  const { data, error } = await supabaseAdmin
    .from('inbox_read_state')
    .select('last_comment_seen_at, seen_comment_ids, reaction_seen')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return { ...EMPTY_WATERMARK };
  return watermarkFromRow(data);
}

export async function GET() {
  try {
    if (isOSS) {
      const db = await readDB();
      const folios: InboxFolioInput[] = db.map((project) => ({
        id: project.id,
        title: project.title,
        slug: project.slug ?? null,
        status: project.status,
        updatedAt: project.updatedAt,
        archivedAt: project.archivedAt ?? null,
        comments: project.comments ?? [],
        reactions: project.reactions ?? null,
      }));
      // Empty watermark: ship every item and every reaction row, let the client
      // decide what is unread.
      const feed = buildInbox(folios, EMPTY_WATERMARK);
      return NextResponse.json({
        items: feed.items,
        reactions: feed.reactions,
        unreadIds: [],
        unreadCount: null,
      });
    }

    const { orgId, userId } = await getAuthContext();
    if (!orgId) return err('Unauthorized', { status: 401 });
    if (!supabaseAdmin) {
      return NextResponse.json(
        {
          error: 'Supabase client is not initialized.',
          message:
            'Please make sure that NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in your local .env file when running in cloud/SaaS mode.',
        },
        { status: 500 },
      );
    }

    const { data, error } = await supabaseAdmin
      .from('folios_metadata')
      .select(INBOX_COLUMNS)
      .eq('organization_id', orgId);

    if (error) throw error;

    interface FolioRow {
      id: string;
      title: string | null;
      slug: string | null;
      status: string | null;
      updated_at: string | null;
      archived_at: string | null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSONB columns are untyped at the driver level; lib/inbox validates every field it reads
      comments: any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same as comments above
      reactions: any;
    }

    const folios: InboxFolioInput[] = ((data ?? []) as unknown as FolioRow[]).map((r: FolioRow) => {
      return {
        id: r.id,
        title: r.title ?? 'Untitled',
        slug: r.slug ?? null,
        status: r.status ?? 'published',
        updatedAt: r.updated_at ?? undefined,
        archivedAt: r.archived_at ?? null,
        comments: Array.isArray(r.comments) ? r.comments : [],
        reactions: r.reactions && typeof r.reactions === 'object' ? r.reactions : null,
      };
    });

    const watermark = await loadWatermark(userId);
    // The caller's own shares. Read separately from `folios` and deliberately:
    // a granted folio belongs to the SHARER's org, so nothing the org-scoped
    // query above can return would produce a row for it. Active grants only —
    // see `_lib/caller-grants.ts`.
    const grants = await loadCallerGrants(userId);
    const feed = buildInbox(folios, watermark, grants);

    // The watermark rides along so a client mutation can merge against the true
    // server state instead of reconstructing (and guessing at) it. It is the
    // caller's own read-state, so there is nothing to leak.
    return NextResponse.json({ ...feed, watermark });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: err may be any thrown value; err.message is read
  } catch (error: any) {
    return err(error.message || 'Failed to load inbox.', { status: 500 });
  }
}
