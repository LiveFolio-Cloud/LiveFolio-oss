/**
 * Inbox — cross-folio feedback aggregation + read-state math.
 *
 * LiveFolio's core loop is *AI publishes → human pins feedback → AI iterates*.
 * Feedback lives inside each folio (a JSONB `comments` array and an aggregate
 * `reactions` map — see `lib/db.ts`), so nothing could answer "what arrived
 * across MY folios, and what haven't I seen yet?" before this module.
 *
 * Two halves, deliberately separated:
 *
 *  1. **Aggregation** (`buildInbox`) — pure, mode-agnostic. Both operating
 *     modes hand it the same minimal folio shape and get the same feed back.
 *  2. **Read-state** — one shape used by both modes:
 *
 *         {
 *           lastCommentSeenAt: string | null,            // boundary ("mark all")
 *           seenCommentIds:   string[],                  // individual marks (capped)
 *           reactionSeen:     { [folioId]: { [emoji]: number } }
 *         }
 *
 *     Why three fields instead of a single timestamp:
 *
 *     A timestamp alone can only express "everything at or before this is read",
 *     which is wrong for per-item clicks — clicking the NEWEST row in the feed
 *     would silently mark every older unread row read, so the badge and the
 *     server would disagree on the next poll. Individual clicks therefore record
 *     ids; the timestamp is reserved for the explicit "mark all as read" action,
 *     which genuinely does mean "everything up to here".
 *
 *     Reactions are AGGREGATE ONLY (`{emoji: count}`, no identity and no
 *     timestamps — the stored shape is a plain `{emoji: count}` map), so they can be neither ordered
 *     nor individually identified. Storing the last-seen count per (folio,
 *     emoji) turns "3 more 👍 since you looked" into a subtraction.
 *
 * Cloud persists this in the `inbox_read_state` table; OSS keeps it in
 * localStorage (`readOssWatermark`/`writeOssWatermark`) because it is a
 * single-user local instance with no server-side identity.
 *
 * Everything here is pure and dependency-free so it can be unit-tested without
 * a database, a DOM, or a running Next server.
 */
import type { HTMLComment } from './db';

/** localStorage key for the OSS watermark. */
export const OSS_WATERMARK_KEY = 'LiveFolio_inbox_read';

/** The emoji set the reactions route accepts (`files/[id]/reactions`). */
export const INBOX_EMOJI = ['👍', '❤️', '💡', '🔥'] as const;

/**
 * Cap on individually-marked comment ids. Reaching it means someone has clicked
 * 500 inbox rows without ever hitting "mark all" — at which point the oldest
 * ids are dropped (FIFO). The failure mode is benign: an evicted id belongs to
 * an old comment, and the worst case is that one old row reads as new again.
 */
export const MAX_SEEN_COMMENT_IDS = 500;

/**
 * The minimal folio shape both modes can produce. Cloud maps rows from
 * `folios_metadata`; OSS maps flat-file projects. Everything else in a folio
 * (versions, files, design prefs) is irrelevant here — and deliberately not
 * part of this type, so a caller cannot accidentally ship megabytes of version
 * bodies to the client.
 */
export interface InboxFolioInput {
  id: string;
  title: string;
  slug?: string | null;
  status?: string;
  /** ISO timestamp — the folio's own updatedAt, used for reaction-row ordering. */
  updatedAt?: string;
  archivedAt?: string | null;
  comments?: HTMLComment[] | null;
  reactions?: { [emoji: string]: number } | null;
}

export interface InboxCommentItem {
  /** Stable identity across fetches — `${folioId}:${commentId}`. */
  id: string;
  kind: 'pin' | 'comment';
  commentId: string;
  folioId: string;
  folioTitle: string;
  /** Where clicking the row goes: `/share/<slug>?pin=<id>` for a published pin, else the editor. */
  href: string;
  /** True when `href` actually focuses a pin (published + slug + spatial pin). */
  deepLinkable: boolean;
  text: string;
  author: string;
  createdAt: string;
  resolved: boolean;
  isReply: boolean;
  x?: number;
  y?: number;
  selector?: string;
  elementHtml?: string;
  slideIndex?: number;
  sectionLabel?: string;
}

export interface InboxReactionDelta {
  /** Stable identity — `${folioId}:${emoji}`. */
  id: string;
  folioId: string;
  folioTitle: string;
  href: string;
  emoji: string;
  /** Current total on the folio. */
  count: number;
  /** What the watermark recorded last time we looked. */
  seen: number;
  /** count - seen — always > 0 for rows that exist. */
  delta: number;
}

export interface InboxWatermark {
  /** Boundary set by "mark all as read" — everything at or before this instant. */
  lastCommentSeenAt: string | null;
  /** Ids marked read one at a time (capped at MAX_SEEN_COMMENT_IDS). */
  seenCommentIds: string[];
  reactionSeen: Record<string, Record<string, number>>;
}

export interface InboxFeed {
  items: InboxCommentItem[];
  reactions: InboxReactionDelta[];
  /** Ids (of items and reaction rows) the user has not seen yet. */
  unreadIds: string[];
  unreadCount: number;
}

export const EMPTY_WATERMARK: InboxWatermark = {
  lastCommentSeenAt: null,
  seenCommentIds: [],
  reactionSeen: {},
};

/* ── time ────────────────────────────────────────────────────────────── */

/**
 * Parse a timestamp to epoch ms, tolerating both the ISO form the app writes
 * (`2026-09-23T03:36:15.133Z`) and the Postgres form a raw JSONB read can carry
 * (`2026-09-23 03:36:15.133+00`, note the space). Unparseable → 0, which sorts
 * oldest rather than throwing.
 */
export function parseTime(value: unknown): number {
  if (typeof value !== 'string' || value.length === 0) return 0;
  let normalized = value.trim();
  // Postgres renders timestamps with a space instead of the ISO "T".
  if (normalized.includes(' ') && !normalized.includes('T')) {
    normalized = normalized.replace(' ', 'T');
  }
  // …and its hour-only offset (`+00`) is not a form Date.parse accepts — it
  // wants `+00:00`. Only applied to time-bearing strings: the guard keeps a
  // bare date like "2026-09-23" from being mangled into "2026-09-23:00".
  if (normalized.includes('T')) {
    normalized = normalized.replace(/([+-]\d{2})$/, '$1:00');
  }
  const t = Date.parse(normalized);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Relative time for inbox/recents rows — "just now", "3h ago", "12 Aug".
 *
 * Returns '' for a missing/unparseable value rather than "Invalid Date": these
 * rows render in dense lists where a broken timestamp should collapse, not
 * shout. Shared by the Inbox page and the Home recents grid so the two surfaces
 * cannot drift.
 */
export function formatRelativeTime(iso?: string | null): string {
  if (!iso) return '';
  const t = parseTime(iso);
  if (t === 0) return '';
  const diffMs = Date.now() - t;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/* ── watermark ───────────────────────────────────────────────────────── */

/** Keep only the newest ids, capped. Input order is untrusted, so sort by the
 *  numeric suffix-free rule the id encodes: `${folioId}:${commentId}` has no
 *  ordering information, so FIFO by array position (oldest first) is kept —
 *  callers push, this trims the head. */
function capSeenIds(ids: string[]): string[] {
  const unique = uniqueStrings(ids);
  return unique.length > MAX_SEEN_COMMENT_IDS ? unique.slice(unique.length - MAX_SEEN_COMMENT_IDS) : unique;
}

/**
 * Dedupe preserving order.
 *
 * Deliberately not `[...new Set(x)]`: this tsconfig's target cannot
 * downlevel-iterate a Set (the same constraint `lib/auth.ts` documents), so
 * every Set spread in this file is a compile error.
 */
function uniqueStrings(values: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < values.length; i++) {
    if (out.indexOf(values[i]) === -1) out.push(values[i]);
  }
  return out;
}

/** Coerce anything (DB row, localStorage JSON, request body) into a valid watermark. */
export function normalizeWatermark(raw: unknown): InboxWatermark {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_WATERMARK };
  const r = raw as {
    lastCommentSeenAt?: unknown;
    last_comment_seen_at?: unknown;
    seenCommentIds?: unknown;
    seen_comment_ids?: unknown;
    reactionSeen?: unknown;
    reaction_seen?: unknown;
  };
  const last = r.lastCommentSeenAt ?? r.last_comment_seen_at;
  const seenIdsRaw = r.seenCommentIds ?? r.seen_comment_ids;
  const seenRaw = r.reactionSeen ?? r.reaction_seen;

  const reactionSeen: Record<string, Record<string, number>> = {};
  if (seenRaw && typeof seenRaw === 'object') {
    for (const [folioId, counts] of Object.entries(seenRaw as Record<string, unknown>)) {
      if (!counts || typeof counts !== 'object') continue;
      const clean: Record<string, number> = {};
      for (const [emoji, n] of Object.entries(counts as Record<string, unknown>)) {
        const num = typeof n === 'number' ? n : Number(n);
        if (Number.isFinite(num) && num > 0) clean[emoji] = num;
      }
      reactionSeen[folioId] = clean;
    }
  }

  return {
    lastCommentSeenAt: typeof last === 'string' && last.length > 0 ? last : null,
    seenCommentIds: Array.isArray(seenIdsRaw)
      ? capSeenIds(seenIdsRaw.filter((id): id is string => typeof id === 'string' && id.length > 0))
      : [],
    reactionSeen,
  };
}

/**
 * Merge a partial patch into a watermark. Used by the POST /read route so the
 * client can advance the comment boundary, record individual marks, clear one
 * reaction row, or any combination, without sending the whole object back.
 *
 * Both sides only ever ratchet:
 * - the boundary moves forward (max),
 * - seen ids union,
 * - reaction counts take the max of old/new (so a stale client cannot resurrect
 *   a delta the user already dismissed).
 */
export function mergeWatermark(current: InboxWatermark, patch: InboxWatermark): InboxWatermark {
  const reactionSeen: Record<string, Record<string, number>> = {};
  const folioIds = uniqueStrings([...Object.keys(current.reactionSeen), ...Object.keys(patch.reactionSeen)]);
  for (const folioId of folioIds) {
    const before = current.reactionSeen[folioId] ?? {};
    const after = patch.reactionSeen[folioId] ?? {};
    const merged: Record<string, number> = {};
    for (const emoji of uniqueStrings([...Object.keys(before), ...Object.keys(after)])) {
      merged[emoji] = Math.max(before[emoji] ?? 0, after[emoji] ?? 0);
    }
    reactionSeen[folioId] = merged;
  }

  const currentT = parseTime(current.lastCommentSeenAt);
  const patchT = parseTime(patch.lastCommentSeenAt);
  const winner = patchT > currentT ? patch.lastCommentSeenAt : current.lastCommentSeenAt;

  return {
    lastCommentSeenAt: winner ?? null,
    // "Mark all" supersedes individual marks — when the boundary moved, the
    // explicit id list has done its job and is dropped rather than carried.
    seenCommentIds: patchT > currentT ? [] : capSeenIds([...current.seenCommentIds, ...patch.seenCommentIds]),
    reactionSeen,
  };
}

/* ── aggregation ─────────────────────────────────────────────────────── */

/** Editor deep-link vs public share link. Only published folios with a slug are
 *  reachable publicly; pins exist on the public viewer, so only those get the
 *  `?pin=` suffix. */
function hrefFor(folio: InboxFolioInput, pinId?: string): { href: string; deepLinkable: boolean } {
  const published = folio.status !== 'draft';
  if (published && folio.slug) {
    const base = `/share/${folio.slug}`;
    return pinId
      ? { href: `${base}?pin=${encodeURIComponent(pinId)}`, deepLinkable: true }
      : { href: base, deepLinkable: false };
  }
  return { href: `/app/${folio.id}`, deepLinkable: false };
}

/** True when this comment reads as unread under the watermark.
 *  Resolved comments are never unread — a resolved pin is handled work, and
 *  keeping it flagged would be nagging, not informing. */
export function isCommentUnread(
  comment: { id: string; createdAt: string; resolved?: boolean },
  watermark: InboxWatermark,
): boolean {
  if (comment.resolved) return false;
  if (watermark.seenCommentIds.includes(comment.id)) return false;
  return parseTime(comment.createdAt) > parseTime(watermark.lastCommentSeenAt);
}

/**
 * Build the inbox feed from the caller's folios.
 *
 * Rules that matter for how the inbox *feels*:
 * - **Archived folios are excluded entirely.** Archiving is the "out of the way,
 *   not gone" shelf; nagging about feedback on a shelved folio is noise.
 * - **Resolved comments stay in the feed but never count as unread** (history,
 *   not a demand).
 * - **Replies are included** (they carry `parentId`) but flagged, so the UI can
 *   render them as part of a thread.
 * - **Reaction rows only exist when something new arrived** (delta > 0).
 */
export function buildInbox(folios: InboxFolioInput[], watermark: InboxWatermark): InboxFeed {
  const seen = normalizeWatermark(watermark);

  const items: InboxCommentItem[] = [];
  const reactions: InboxReactionDelta[] = [];

  for (const folio of folios) {
    if (folio.archivedAt) continue;

    for (const comment of folio.comments ?? []) {
      if (!comment || typeof comment !== 'object' || !comment.id) continue;
      const kind: 'pin' | 'comment' = comment.type === 'comment' ? 'comment' : 'pin';
      // Only spatial pins can be focused in the viewer; a general comment has
      // no anchor to scroll to.
      const { href, deepLinkable } = hrefFor(folio, kind === 'pin' ? comment.id : undefined);
      items.push({
        id: `${folio.id}:${comment.id}`,
        kind,
        commentId: comment.id,
        folioId: folio.id,
        folioTitle: folio.title || 'Untitled',
        href,
        deepLinkable,
        text: comment.text ?? '',
        author: comment.author ?? '',
        createdAt: comment.createdAt ?? '',
        resolved: comment.resolved === true,
        isReply: !!comment.parentId,
        x: comment.x,
        y: comment.y,
        selector: comment.selector,
        elementHtml: comment.elementHtml,
        slideIndex: comment.slideIndex,
        sectionLabel: comment.sectionLabel,
      });
    }

    const folioReactionSeen = seen.reactionSeen[folio.id] ?? {};
    for (const [emoji, count] of Object.entries(folio.reactions ?? {})) {
      if (typeof count !== 'number' || count <= 0) continue;
      const previouslySeen = folioReactionSeen[emoji] ?? 0;
      const delta = count - previouslySeen;
      if (delta <= 0) continue;
      const { href } = hrefFor(folio);
      reactions.push({
        id: `${folio.id}:${emoji}`,
        folioId: folio.id,
        folioTitle: folio.title || 'Untitled',
        href,
        emoji,
        count,
        seen: previouslySeen,
        delta,
      });
    }
  }

  // Newest first — the whole point of an inbox.
  items.sort((a, b) => parseTime(b.createdAt) - parseTime(a.createdAt));
  // Reactions have no timestamps; order by delta size (biggest response first),
  // then by folio title for a stable, non-flickering list.
  reactions.sort((a, b) => b.delta - a.delta || a.folioTitle.localeCompare(b.folioTitle));

  const unreadIds = [
    ...items.filter((i) => isCommentUnread({ id: i.commentId, createdAt: i.createdAt, resolved: i.resolved }, seen)).map((i) => i.id),
    ...reactions.map((r) => r.id),
  ];

  return { items, reactions, unreadIds, unreadCount: unreadIds.length };
}

/** The unread subset of a feed — what the sidebar badge and the page header count. */
export function computeUnread(feed: InboxFeed): { unreadIds: string[]; unreadCount: number } {
  return { unreadIds: feed.unreadIds, unreadCount: feed.unreadCount };
}

/**
 * Recompute the unread set for an ALREADY-BUILT feed under a new watermark.
 *
 * `buildInbox` derives unread while aggregating; this does the same against an
 * existing feed, which is what a client needs after a mutation. It matters for
 * "mark unread": un-reading ADDS to the unread set, so a mutation can no longer
 * be expressed as "remove one id from the list" — the set has to be rederived.
 * One implementation, so the two directions cannot disagree.
 */
export function unreadFromFeed(feed: InboxFeed, watermark: InboxWatermark): string[] {
  const seen = normalizeWatermark(watermark);
  return [
    ...feed.items
      .filter((i) => isCommentUnread({ id: i.commentId, createdAt: i.createdAt, resolved: i.resolved }, seen))
      .map((i) => i.id),
    ...feed.reactions
      .filter((r) => r.count > (seen.reactionSeen[r.folioId]?.[r.emoji] ?? 0))
      .map((r) => r.id),
  ];
}

/* ── read-state mutations (each returns the next watermark) ───────────── */

/** Record ONE comment/pin as read. Adds its id — never moves the boundary,
 *  which would drag older unread rows along with it. */
export function markItemRead(watermark: InboxWatermark, item: InboxCommentItem): InboxWatermark {
  const current = normalizeWatermark(watermark);
  if (current.seenCommentIds.includes(item.commentId)) return current;
  return {
    ...current,
    seenCommentIds: capSeenIds([...current.seenCommentIds, item.commentId]),
  };
}

/**
 * Undo a read: drop this comment's id from the seen set.
 *
 * Exists as a separate operation because `mergeWatermark` can only ADD to the
 * set (that union is what stops a stale client from resurrecting dismissed
 * items). Removal therefore has to be explicit and deliberate rather than
 * arriving as a side effect of a merge — see `applyUnread`.
 *
 * An item inside the "mark all as read" boundary cannot be un-read this way:
 * the boundary is a single timestamp, and there is no per-item record to
 * restore. `markAllRead` clears `seenCommentIds`, so nothing is lost — the item
 * simply stays read, which matches what "mark all" meant.
 */
export function markItemUnread(watermark: InboxWatermark, item: InboxCommentItem): InboxWatermark {
  const current = normalizeWatermark(watermark);
  return {
    ...current,
    seenCommentIds: current.seenCommentIds.filter((id) => id !== item.commentId),
  };
}

/** Remove several comment ids from the seen set at once (bulk un-read). */
export function applyUnread(watermark: InboxWatermark, commentIds: string[]): InboxWatermark {
  const current = normalizeWatermark(watermark);
  if (commentIds.length === 0) return current;
  const drop = new Set(commentIds);
  return {
    ...current,
    seenCommentIds: current.seenCommentIds.filter((id) => !drop.has(id)),
  };
}

/** Record one reaction row as read by storing its current count. */
export function markReactionRead(watermark: InboxWatermark, delta: InboxReactionDelta): InboxWatermark {
  const current = normalizeWatermark(watermark);
  return {
    ...current,
    reactionSeen: {
      ...current.reactionSeen,
      [delta.folioId]: { ...(current.reactionSeen[delta.folioId] ?? {}), [delta.emoji]: delta.count },
    },
  };
}

/**
 * Mark the whole feed read: the boundary jumps to the newest item present and
 * every reaction row records its current count.
 *
 * "Newest item present" (max createdAt) rather than `new Date()` on purpose — a
 * client clock running fast would otherwise silently mark future feedback read
 * the next time the feed loads.
 */
export function markAllRead(watermark: InboxWatermark, feed: InboxFeed): InboxWatermark {
  const current = normalizeWatermark(watermark);
  let newest = parseTime(current.lastCommentSeenAt);
  let newestIso = current.lastCommentSeenAt;
  for (const item of feed.items) {
    const t = parseTime(item.createdAt);
    if (t > newest) {
      newest = t;
      newestIso = item.createdAt;
    }
  }

  const reactionSeen = { ...current.reactionSeen };
  for (const delta of feed.reactions) {
    reactionSeen[delta.folioId] = { ...(reactionSeen[delta.folioId] ?? {}), [delta.emoji]: delta.count };
  }

  return {
    lastCommentSeenAt: newestIso ?? null,
    // The boundary now covers everything listed; individual marks are redundant.
    seenCommentIds: [],
    reactionSeen,
  };
}

/* ── OSS persistence (localStorage) ──────────────────────────────────── */

/** Read the OSS watermark. Safe on the server and when storage is blocked. */
export function readOssWatermark(): InboxWatermark {
  if (typeof window === 'undefined') return { ...EMPTY_WATERMARK };
  try {
    const raw = window.localStorage.getItem(OSS_WATERMARK_KEY);
    if (!raw) return { ...EMPTY_WATERMARK };
    return normalizeWatermark(JSON.parse(raw));
  } catch {
    return { ...EMPTY_WATERMARK };
  }
}

/** Persist the OSS watermark. Storage failures are non-fatal (read-state just
 *  does not survive the session). */
export function writeOssWatermark(watermark: InboxWatermark): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(OSS_WATERMARK_KEY, JSON.stringify(normalizeWatermark(watermark)));
  } catch {
    // storage unavailable — read-state is best-effort in OSS.
  }
}

/* ── deep-link parsing ───────────────────────────────────────────────── */

/**
 * Read the `?pin=` focus target out of a URL (or a bare query string).
 *
 * The inverse of the `href` builder in `buildInbox`: the viewer calls this to
 * decide which pin, if any, to focus on load. Accepts either form so it is
 * callable from a route handler (`request.url`) and from the browser
 * (`window.location.href`) without the caller having to construct a URL object.
 *
 * Returns null for anything unusable — a missing param, an empty value, or a
 * malformed URL. A bad deep link must degrade to "no focus", never to an error
 * on someone else's shared page.
 */
export function parsePinFocusParam(urlOrSearch: string | null | undefined): string | null {
  if (!urlOrSearch) return null;
  try {
    // A full URL carries its own query; anything else is reduced to its query
    // part — which also covers a path-like value (`/share/x?pin=c1`), the exact
    // shape the inbox writes into `href`. A value with no `?` at all is treated
    // as a bare query string.
    let search: string;
    if (/^https?:\/\//i.test(urlOrSearch)) {
      search = new URL(urlOrSearch).search;
    } else if (urlOrSearch.startsWith('?')) {
      search = urlOrSearch;
    } else if (urlOrSearch.includes('?')) {
      search = urlOrSearch.slice(urlOrSearch.indexOf('?'));
    } else {
      search = `?${urlOrSearch}`;
    }
    const raw = new URL(search, 'https://livefolio.local').searchParams.get('pin');
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

/* ── transport ───────────────────────────────────────────────────────── */

/**
 * `GET /api/inbox` response.
 *
 * In Cloud the server owns the watermark and returns both the computed unread
 * set AND the watermark itself (so a client mutation can merge precisely
 * instead of guessing). In OSS `unreadCount` is null and `watermark` is
 * whatever the caller passes to `resolveFeed`.
 */
export interface InboxApiResponse {
  items: InboxCommentItem[];
  reactions: InboxReactionDelta[];
  unreadIds: string[];
  /** null in OSS — no server-side identity there, so the browser computes it. */
  unreadCount: number | null;
  /** Present in Cloud only. */
  watermark?: InboxWatermark;
}

/**
 * Normalize a server response into a feed, in whichever mode returned it.
 *
 * Cloud: the response is already authoritative — pass it through (and keep the
 * server's watermark so later mutations merge against the true state).
 * OSS: `unreadCount` is null; recompute from the browser's local watermark.
 */
export function resolveFeed(response: InboxApiResponse, localWatermark: InboxWatermark): InboxFeed {
  if (response.unreadCount !== null) {
    return {
      items: Array.isArray(response.items) ? response.items : [],
      reactions: Array.isArray(response.reactions) ? response.reactions : [],
      unreadIds: Array.isArray(response.unreadIds) ? response.unreadIds : [],
      unreadCount: response.unreadCount,
    };
  }
  return recomputeOssFeed(response, localWatermark);
}

/** OSS unread recomputation: apply the browser's watermark to the raw feed. */
export function recomputeOssFeed(response: InboxApiResponse, localWatermark: InboxWatermark): InboxFeed {
  const seen = normalizeWatermark(localWatermark);
  const items = Array.isArray(response.items) ? response.items : [];
  const allReactions = Array.isArray(response.reactions) ? response.reactions : [];

  const reactions = allReactions
    .map((r) => {
      const previouslySeen = seen.reactionSeen[r.folioId]?.[r.emoji] ?? 0;
      return { ...r, seen: previouslySeen, delta: r.count - previouslySeen };
    })
    .filter((r) => r.delta > 0);

  const unreadIds = [
    ...items
      .filter((i) => isCommentUnread({ id: i.commentId, createdAt: i.createdAt, resolved: i.resolved }, seen))
      .map((i) => i.id),
    ...reactions.map((r) => r.id),
  ];

  return { items, reactions, unreadIds, unreadCount: unreadIds.length };
}
