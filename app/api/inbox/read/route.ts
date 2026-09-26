/**
 * `POST /api/inbox/read` — advance the read watermark.
 *
 * Body is a PARTIAL watermark, plus an explicit un-read instruction for each id
 * namespace (every field may be omitted):
 *
 *   {
 *     lastCommentSeenAt?: string | null,
 *     seenCommentIds?: string[],
 *     seenGrantIds?: string[],                       // share rows, by namespaced id
 *     reactionSeen?: { [folioId]: { [emoji]: number } },
 *     unreadCommentIds?: string[],                   // REMOVE from the comment set
 *     unreadGrantIds?: string[]                      // REMOVE from the grant set
 *   }
 *
 * Cloud upserts it into `inbox_read_state` (ratcheting — see
 * `mergeWatermark`: reaction counts only ever move up, so a stale client cannot
 * resurrect a delta the user already dismissed). OSS is a 200 no-op because the
 * browser owns its own watermark in localStorage.
 *
 * Two details that are not obvious from the body shape:
 *
 * - **Removal travels separately, in both namespaces.** The merge can only add
 *   (that union is what stops a stale client resurrecting dismissed items), so
 *   "mark unread" arrives as an explicit removal list. A share row is removed by
 *   id exactly as a comment is; the comment boundary cannot express either.
 * - **The stored id list holds both namespaces.** `inbox_read_state` has no
 *   grant column, so grant marks serialize into `seen_comment_ids` and are split
 *   back out on read — `_lib/read-state.ts` documents the bridge in full. With
 *   no grants involved, the written value is byte-identical to what this route
 *   wrote before share rows existed.
 */
import { NextResponse } from 'next/server';
import { isOSS } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase';
import { getAuthContext } from '@/lib/auth';
import { err } from '@/lib/api/respond';
import { EMPTY_WATERMARK, applyUnread, mergeWatermark, normalizeWatermark } from '@/lib/inbox';
import { seenCommentIdsColumn, watermarkFromRow } from '../_lib/read-state';

/** One list of non-empty id strings off an untrusted body, else []. */
function idList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];
}

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
    // effect of the merge. One list per namespace — a share row is un-read by
    // its own id, never by moving the comment boundary.
    const unreadCommentIds = idList((body as { unreadCommentIds?: unknown })?.unreadCommentIds);
    const unreadGrantIds = idList((body as { unreadGrantIds?: unknown })?.unreadGrantIds);

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

    // `watermarkFromRow` (not `normalizeWatermark`): the stored id list holds
    // both namespaces and has to be split before the merge, or a grant mark
    // would be treated as a comment id — and a moved boundary would then clear
    // it. See `_lib/read-state.ts`.
    const current = existing ? watermarkFromRow(existing) : { ...EMPTY_WATERMARK };
    const merged = applyUnread(mergeWatermark(current, patch), unreadCommentIds);

    const removeGrants = new Set(unreadGrantIds);
    // Removal is deliberate and explicit, so it happens AFTER the union merge —
    // otherwise the merge's own grant union would simply put the id back.
    const next = removeGrants.size > 0
      ? { ...merged, seenGrantIds: (merged.seenGrantIds ?? []).filter((id) => !removeGrants.has(id)) }
      : merged;

    const { error: writeError } = await supabaseAdmin
      .from('inbox_read_state')
      .upsert(
        {
          user_id: userId,
          last_comment_seen_at: next.lastCommentSeenAt,
          seen_comment_ids: seenCommentIdsColumn(next),
          reaction_seen: next.reactionSeen,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );

    if (writeError) {
      console.error(
        `[inbox/read] failed to persist read-state (${writeError.message}) — has the inbox_read_state migration been applied? Serving non-persistent read-state.`,
      );
      return NextResponse.json({ success: true, watermark: next, persisted: false });
    }

    return NextResponse.json({ success: true, watermark: next, persisted: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: err may be any thrown value; err.message is read
  } catch (error: any) {
    return err(error.message || 'Failed to update inbox read state.', { status: 500 });
  }
}
