/**
 * `POST /api/inbox/read` — advance the read watermark.
 *
 * Body is a PARTIAL watermark (either field may be omitted):
 *
 *   { lastCommentSeenAt?: string | null, reactionSeen?: { [folioId]: { [emoji]: number } } }
 *
 * Cloud upserts it into `inbox_read_state` (ratcheting — see
 * `mergeWatermark`: reaction counts only ever move up, so a stale client cannot
 * resurrect a delta the user already dismissed). OSS is a 200 no-op because the
 * browser owns its own watermark in localStorage.
 */
import { NextResponse } from 'next/server';
import { isOSS } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase';
import { getAuthContext } from '@/lib/auth';
import { err } from '@/lib/api/respond';
import { EMPTY_WATERMARK, applyUnread, mergeWatermark, normalizeWatermark } from '@/lib/inbox';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: Request) {
  try {
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      return err('Invalid JSON body', { status: 400 });
    }

    const patch = normalizeWatermark(body);

    // Explicit un-read: ids to REMOVE from the seen set. Merging can only add
    // (that union is what stops a stale client resurrecting dismissed items),
    // so removal is a separate, deliberate instruction rather than a side
    // effect of the merge.
    const unreadCommentIds = Array.isArray((body as { unreadCommentIds?: unknown })?.unreadCommentIds)
      ? ((body as { unreadCommentIds: unknown[] }).unreadCommentIds.filter(
          (id): id is string => typeof id === 'string' && id.length > 0,
        ))
      : [];

    if (isOSS) {
      // Single-user local instance: no server-side identity to key read-state
      // on. The client persists this to localStorage itself.
      return NextResponse.json({ success: true, watermark: patch, persisted: false });
    }

    const { userId } = await getAuthContext();
    if (!userId) return err('Unauthorized', { status: 401 });
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

    // Read-merge-write so a request that only clears one reaction row cannot
    // wipe the comment mark (and vice versa).
    // Read-state is a CONVENIENCE layer: it decides what looks new, not what
    // exists. If the store is unavailable (most likely the `inbox_read_state`
    // migration has not been applied to this project), the inbox must keep
    // working — every item simply reads as new — rather than failing the write
    // and leaving the client's optimistic update stranded.
    //
    // The failure is logged loudly server-side so an unapplied migration is
    // obvious in the logs; the client is told `persisted: false` and keeps its
    // optimistic state.
    const { data: existing, error: readError } = await supabaseAdmin
      .from('inbox_read_state')
      .select('last_comment_seen_at, seen_comment_ids, reaction_seen')
      .eq('user_id', userId)
      .maybeSingle();

    if (readError) {
      console.error(
        `[inbox/read] read-state unavailable (${readError.message}) — has the inbox_read_state migration been applied? Serving non-persistent read-state.`,
      );
      return NextResponse.json({ success: true, watermark: patch, persisted: false });
    }

    const current = existing ? normalizeWatermark(existing) : { ...EMPTY_WATERMARK };
    const merged = applyUnread(mergeWatermark(current, patch), unreadCommentIds);

    const { error: writeError } = await supabaseAdmin
      .from('inbox_read_state')
      .upsert(
        {
          user_id: userId,
          last_comment_seen_at: merged.lastCommentSeenAt,
          seen_comment_ids: merged.seenCommentIds,
          reaction_seen: merged.reactionSeen,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );

    if (writeError) {
      console.error(
        `[inbox/read] failed to persist read-state (${writeError.message}) — has the inbox_read_state migration been applied? Serving non-persistent read-state.`,
      );
      return NextResponse.json({ success: true, watermark: merged, persisted: false });
    }

    return NextResponse.json({ success: true, watermark: merged, persisted: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: err may be any thrown value; err.message is read
  } catch (error: any) {
    return err(error.message || 'Failed to update inbox read state.', { status: 500 });
  }
}
