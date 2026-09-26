'use client';

/**
 * useInboxUnread — the Inbox's single client entry point, backed by a SHARED
 * module-level store.
 *
 * Why shared state and not per-component `useState`: this hook has several
 * simultaneous consumers — the sidebar's unread badge and the Inbox page
 * itself, at minimum. With per-instance state, clicking a row in the Inbox
 * updated that copy only; the sidebar badge kept its own stale copy until its
 * next poll, so the counter visibly refused to move. One store, one poll, one
 * watermark: every consumer re-renders together.
 *
 * The store owns three things:
 *
 *  1. **Fetching** `/api/inbox`, on the first subscriber, every 60s, and on
 *     window focus. Polling rather than realtime on purpose: the payload is
 *     tiny, the write path is a JSONB append that would need a channel per
 *     folio, and focus-refetch is what makes it feel live.
 *
 *  2. **The mode branch.** Cloud returns a server-computed unread count and the
 *     server's watermark (read-state lives in `inbox_read_state`). OSS returns
 *     `unreadCount: null` because a local instance has no server-side identity —
 *     there the browser owns the watermark in localStorage.
 *
 *  3. **Read-state writes.** Mutations update the store immediately (the badge
 *     must drop the instant you click) and persist: POST in Cloud, localStorage
 *     in OSS. A failed POST leaves the optimistic state in place; the next poll
 *     reconciles, and the worst case is a badge that reappears.
 *
 * It carries both feed kinds the same way. Feedback rows and **share rows**
 * ("X shared a folio with you", `InboxGrantItem`) live in the same store, are
 * unread by the same watermark, and are cleared by the same two verbs — with one
 * asymmetry the data forces: a share is marked read BY ID only and never by the
 * comment boundary, because the boundary means "I have seen the feedback up to
 * here" and someone else's share is not feedback. `markGrantRead` /
 * `markGrantUnread` are that pair; `lib/inbox.ts` documents the reasoning.
 *
 * Failures are deliberately silent, matching `useDesignSystems`: an inbox that
 * cannot load should not toast at someone who never opened it. The badge simply
 * does not render.
 */
import { useSyncExternalStore } from 'react';
import { isOSS } from '@/lib/env';
import {
  EMPTY_WATERMARK,
  applyUnread,
  markAllRead as markAllReadPure,
  markGrantRead as markGrantReadPure,
  markGrantUnread as markGrantUnreadPure,
  markItemRead as markItemReadPure,
  markItemUnread as markItemUnreadPure,
  markReactionRead as markReactionReadPure,
  readOssWatermark,
  resolveFeed,
  unreadFromFeed,
  writeOssWatermark,
  type InboxApiResponse,
  type InboxCommentItem,
  type InboxFeed,
  type InboxGrantItem,
  type InboxReactionDelta,
  type InboxWatermark,
} from '@/lib/inbox';

/** How often to re-poll the feed while a subscriber is mounted. */
const POLL_INTERVAL_MS = 60_000;

interface InboxStore {
  feed: InboxFeed;
  isLoading: boolean;
}

const EMPTY_FEED: InboxFeed = { items: [], reactions: [], grants: [], unreadIds: [], unreadCount: 0 };
/** Stable identity for "nothing is shared with this caller", so a consumer that
 *  reads `grants` cannot recompute on every render while the feed carries none.
 *  (`InboxFeed.grants` is optional so pre-grant literals still compile; this is
 *  what an absent list resolves to.) */
const NO_GRANTS: InboxGrantItem[] = [];
/** Stable identity: `useSyncExternalStore` re-renders forever if the server
 *  snapshot is a fresh object on each call. */
const SERVER_SNAPSHOT: InboxStore = { feed: EMPTY_FEED, isLoading: true };

let store: InboxStore = SERVER_SNAPSHOT;
const listeners = new Set<() => void>();

/**
 * The current watermark. Module-level rather than React state:
 * - OSS owns it (localStorage is the source of truth there),
 * - Cloud receives it from the server with each feed and sends patches back.
 * Either way a mutation reads the latest value synchronously.
 */
let watermark: InboxWatermark = EMPTY_WATERMARK;
/** OSS only: true once the localStorage watermark has been read this session. */
let ossWatermarkHydrated = false;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

function emit(next: InboxStore): void {
  store = next;
  listeners.forEach((listener) => listener());
}

function setFeed(feed: InboxFeed, isLoading = false): void {
  emit({ feed, isLoading });
}

async function load(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const res = await fetch('/api/inbox', { cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as InboxApiResponse;
    if (data.watermark) {
      // Cloud: adopt the server's watermark so later mutations merge against
      // real state rather than a reconstruction.
      watermark = data.watermark;
    }
    setFeed(resolveFeed(data, watermark), false);
  } catch {
    // Best-effort — keep whatever we had.
  } finally {
    inFlight = false;
    // First load settles the spinner even on failure.
    if (store.isLoading) emit({ feed: store.feed, isLoading: false });
  }
}

function onFocus(): void {
  void load();
}

function startPolling(): void {
  if (pollTimer !== null) return;
  // OSS hydrates its watermark from storage before the first fetch so the very
  // first render already reflects what this browser has seen.
  if (isOSS && !ossWatermarkHydrated) {
    watermark = readOssWatermark();
    ossWatermarkHydrated = true;
  }
  void load();
  pollTimer = setInterval(() => void load(), POLL_INTERVAL_MS);
  window.addEventListener('focus', onFocus);
}

function stopPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  window.removeEventListener('focus', onFocus);
}

/**
 * Persist the watermark: POST in Cloud, localStorage in OSS. Fire-and-forget.
 *
 * The two `unread*Ids` lists are the explicit un-read instructions, one per id
 * namespace (comments and share rows). The server merges the watermark by union
 * (so additions are idempotent and a stale client cannot resurrect dismissed
 * items), which means REMOVAL has to travel separately. OSS has no server to
 * tell, so a local write covers both directions — and it is the same write: the
 * stored blob is the watermark, `seenGrantIds` included.
 *
 * The body is the bare watermark when there is nothing to remove, which keeps
 * the comment-only path byte-identical to what this hook has always sent.
 */
function persist(next: InboxWatermark, unreadCommentIds: string[] = [], unreadGrantIds: string[] = []): void {
  watermark = next;
  if (isOSS) {
    writeOssWatermark(next);
    return;
  }
  const body: Record<string, unknown> = { ...next };
  if (unreadCommentIds.length > 0) body.unreadCommentIds = unreadCommentIds;
  if (unreadGrantIds.length > 0) body.unreadGrantIds = unreadGrantIds;
  void fetch('/api/inbox/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {
    // Optimistic state stands; the next poll reconciles.
  });
}

/**
 * Commit a watermark change: store it, persist it, and rederive the unread set.
 *
 * Rederiving (rather than adding/removing ids) is what makes "mark unread"
 * possible at all — the unread set is a function of the watermark, not a list
 * that can only shrink. It also means a grant un-read is picked up by the same
 * recompute the comments use (`unreadFromFeed` reads the store's share rows).
 */
function commit(next: InboxWatermark, unreadCommentIds: string[] = [], unreadGrantIds: string[] = []): void {
  persist(next, unreadCommentIds, unreadGrantIds);
  const unreadIds = unreadFromFeed(store.feed, next);
  emit({ feed: { ...store.feed, unreadIds, unreadCount: unreadIds.length }, isLoading: store.isLoading });
}

/* ── external-store plumbing ─────────────────────────────────────────── */

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) startPolling();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopPolling();
  };
}

function getSnapshot(): InboxStore {
  return store;
}

function getServerSnapshot(): InboxStore {
  return SERVER_SNAPSHOT;
}

/* ── mutations (shared by every consumer) ────────────────────────────── */

function markItemRead(item: InboxCommentItem): void {
  commit(markItemReadPure(watermark, item));
}

function markReactionRead(delta: InboxReactionDelta): void {
  commit(markReactionReadPure(watermark, delta));
}

/** Undo a read. The ids travel separately — see `persist`. */
function markItemUnread(item: InboxCommentItem): void {
  commit(markItemUnreadPure(watermark, item), [item.commentId]);
}

function markAllRead(): void {
  commit(markAllReadPure(watermark, store.feed));
}

/** Bulk: mark a selection read (union — the safe direction). */
function markManyRead(items: InboxCommentItem[]): void {
  let next = watermark;
  for (const item of items) next = markItemReadPure(next, item);
  commit(next);
}

/** Bulk: mark a selection unread (explicit removal). */
function markManyUnread(items: InboxCommentItem[]): void {
  const ids = items.map((i) => i.commentId);
  commit(applyUnread(watermark, ids), ids);
}

/** Record ONE share row as read — the same "add by id, never move the boundary"
 *  move `markItemRead` makes for a comment, in the grant namespace. */
function markGrantRead(grant: InboxGrantItem): void {
  commit(markGrantReadPure(watermark, grant));
}

/** Undo a read on a share row. As with comments, the removal travels in its own
 *  list because the merge can only add. */
function markGrantUnread(grant: InboxGrantItem): void {
  commit(markGrantUnreadPure(watermark, grant), [], [grant.id]);
}

function refresh(): void {
  void load();
}

export interface UseInboxUnreadResult {
  items: InboxCommentItem[];
  reactions: InboxReactionDelta[];
  /**
   * The folios other people shared with this caller, newest first — the
   * "Shared with you" section. Always an array (empty when nothing is shared),
   * never undefined: the store owns the list, so a consumer never has to decide
   * what an absent one means.
   */
  grants: InboxGrantItem[];
  unreadIds: string[];
  unreadCount: number;
  /** True only until the first load settles. */
  isLoading: boolean;
  /** Re-fetch on demand (e.g. after leaving a comment elsewhere). */
  refresh: () => void;
  markItemRead: (item: InboxCommentItem) => void;
  /** Undo a read — the reader clicked something by accident. */
  markItemUnread: (item: InboxCommentItem) => void;
  markReactionRead: (delta: InboxReactionDelta) => void;
  markAllRead: () => void;
  /** Bulk selection actions, used by the Inbox's multi-select bar. */
  markManyRead: (items: InboxCommentItem[]) => void;
  markManyUnread: (items: InboxCommentItem[]) => void;
  /** Mark one share row read (by id — a share never moves the comment boundary). */
  markGrantRead: (grant: InboxGrantItem) => void;
  /** Undo that read. */
  markGrantUnread: (grant: InboxGrantItem) => void;
}

export function useInboxUnread(): UseInboxUnreadResult {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return {
    items: snapshot.feed.items,
    reactions: snapshot.feed.reactions,
    grants: snapshot.feed.grants ?? NO_GRANTS,
    unreadIds: snapshot.feed.unreadIds,
    unreadCount: snapshot.feed.unreadCount,
    isLoading: snapshot.isLoading,
    refresh,
    markItemRead,
    markItemUnread,
    markReactionRead,
    markAllRead,
    markManyRead,
    markManyUnread,
    markGrantRead,
    markGrantUnread,
  };
}
