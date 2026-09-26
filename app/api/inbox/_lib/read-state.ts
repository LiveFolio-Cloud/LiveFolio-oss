import {
  EMPTY_WATERMARK,
  normalizeWatermark,
  type InboxWatermark,
  type NormalizedInboxWatermark,
} from '@/lib/inbox';

/**
 * Read-state storage: how a watermark survives a round trip through
 * `inbox_read_state`.
 *
 * ## The problem this file solves
 *
 * `InboxWatermark` gained a fifth field, `seenGrantIds` — the share rows a
 * reader has individually marked read (`lib/inbox.ts`, and its own docstring
 * explains why grants are keyed by id and not by the comment boundary). Every
 * function in that module already carries it, `mergeWatermark` already unions it
 * and `normalizeWatermark` already coerces it.
 *
 * What nothing carries it into is the TABLE. `inbox_read_state` has exactly
 * three state columns (`last_comment_seen_at`, `seen_comment_ids`,
 * `reaction_seen`); there is no
 * `seen_grant_ids` column, no migration for one in this repo, and adding one is
 * neither this task's scope nor available to it (the database is out of bounds
 * deliberately — no DDL, no writes to the shared project). Without a bridge, a
 * grant marked read in Cloud would come back unread on the very next poll,
 * because `GET /api/inbox` returns the server's watermark as authoritative and
 * the client adopts it.
 *
 * ## The bridge
 *
 * `seen_comment_ids` is a JSONB array of opaque ids, and `lib/inbox` gives every
 * share row a namespaced id — `grant:<grantId>` — precisely so that the two id
 * namespaces can share a list without ever being mistaken for one another. So
 * the stored column holds the union of both sets, and every read splits it back
 * apart by that prefix:
 *
 *     stored  ["c1", "grant:g1"]   →   { seenCommentIds: ["c1"], seenGrantIds: ["grant:g1"] }
 *
 * The namespaces stay independent in the only place that matters: the SPLIT
 * happens before `normalizeWatermark`/`mergeWatermark` ever see the value, so
 * "mark all as read" (which clears `seenCommentIds` when the boundary moves)
 * cannot clear a grant mark, and a grant mark cannot enter the comment set. The
 * column is a serialization detail; the watermark's semantics are unchanged.
 *
 * Consequences worth stating plainly:
 *
 * - **No schema change, no backfill.** A row written before this file existed
 *   has no prefixed entries and reads back exactly as it did (empty
 *   `seenGrantIds`), which is the same backwards-compatibility story as the
 *   optional field itself.
 * - **Nothing changes for a user with no grants.** With no prefixed entries the
 *   stored value and the read value are byte-identical to before, so a
 *   no-grants request writes the same column, byte for byte, that it writes
 *   today.
 * - **It is a bridge, not the destination.** The right home is a dedicated
 *   `seen_grant_ids` column; when db-layer adds it, the split/join below becomes
 *   a one-time move of the `grant:` entries (they are self-identifying) and both
 *   routes keep calling these two functions. That is why the parsing lives here
 *   and not inline in the routes.
 * - The prefix is mirrored, not imported: `lib/inbox` builds the id inline.
 *   `GRANT_ID_PREFIX` is therefore asserted against the real producer's output
 *   in the tests, so the mirror cannot silently drift.
 */

/** The namespace `lib/inbox.grantRowFor` gives every share-row id. */
export const GRANT_ID_PREFIX = 'grant:';

/**
 * The three state columns, as a driver row. Untyped on purpose: this is exactly
 * the shape a `select('last_comment_seen_at, seen_comment_ids, reaction_seen')`
 * returns, and the row may be older than any field this module knows about.
 */
export interface StoredWatermarkRow {
  last_comment_seen_at?: unknown;
  seen_comment_ids?: unknown;
  reaction_seen?: unknown;
}

/** True when a stored id belongs to the grant namespace. */
export function isStoredGrantId(id: string): boolean {
  return id.startsWith(GRANT_ID_PREFIX);
}

/**
 * A DB row → the watermark the feed computes against.
 *
 * The only work beyond `normalizeWatermark` is the split: every `grant:`-prefixed
 * entry in the stored id list is moved into `seenGrantIds` (where `lib/inbox`
 * expects it) and out of `seenCommentIds` (where a comment mutation would
 * otherwise drop it or misread it). A missing/unreadable row is the empty
 * watermark — everything reads as new, the same fail-open-on-data posture the
 * route already documented.
 */
export function watermarkFromRow(row?: StoredWatermarkRow | null): NormalizedInboxWatermark {
  if (!row || typeof row !== 'object') return { ...EMPTY_WATERMARK };

  const stored = Array.isArray(row.seen_comment_ids) ? row.seen_comment_ids : [];
  const commentIds: string[] = [];
  const grantIds: string[] = [];
  for (const id of stored) {
    if (typeof id !== 'string' || id.length === 0) continue;
    if (isStoredGrantId(id)) grantIds.push(id);
    else commentIds.push(id);
  }

  return normalizeWatermark({
    last_comment_seen_at: row.last_comment_seen_at,
    seen_comment_ids: commentIds,
    seen_grant_ids: grantIds,
    reaction_seen: row.reaction_seen,
  });
}

/**
 * A watermark → the value for the `seen_comment_ids` column.
 *
 * The union described in the header, in one place: comment ids first (so a row
 * with no grants is byte-identical to what this column held before share rows
 * existed), then the namespaced grant ids. Both lists arrive normalized and
 * individually capped — `normalizeWatermark` applies `MAX_SEEN_COMMENT_IDS` and
 * `MAX_SEEN_GRANT_IDS` per set, which is the point of splitting before capping
 * rather than after.
 */
export function seenCommentIdsColumn(watermark: InboxWatermark): string[] {
  const normalized = normalizeWatermark(watermark);
  return [...normalized.seenCommentIds, ...normalized.seenGrantIds];
}
