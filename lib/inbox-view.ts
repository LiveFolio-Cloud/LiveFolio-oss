/**
 * Inbox VIEW logic — the pure half of the Inbox UI.
 *
 * Grouping, filtering, searching and snippet extraction are the parts of an
 * inbox that are easy to get subtly wrong (off-by-one day boundaries, a filter
 * that hides unread items, a snippet that leaks markup into the UI) and
 * impossible to eyeball. Keeping them here, dependency-free, means they can be
 * unit-tested without a DOM or a running server — and the component stays a
 * rendering concern.
 *
 * Nothing here fetches, mutates, or knows about React.
 */
import { parseTime, type InboxCommentItem, type InboxReactionDelta } from './inbox';

/* ── snippets ────────────────────────────────────────────────────────── */

/** Tags out, entities decoded, whitespace collapsed. */
export function stripHtml(html: string | undefined | null): string {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Max characters of an element preview before it is clipped. */
export const SNIPPET_MAX = 140;

/**
 * The preview text for a row: the pinned element's own content, clipped.
 *
 * This is what makes a pin row legible at a glance — "Make this row taller"
 * means little without seeing which row. Returns '' when there is nothing
 * usable, so the caller can fall back to the comment text alone.
 */
export function elementSnippet(html: string | undefined | null, max = SNIPPET_MAX): string {
  const text = stripHtml(html);
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** First letter of an author name, for the avatar bubble. */
export function initials(name: string | undefined | null): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '?';
  return trimmed.slice(0, 1).toUpperCase();
}

/**
 * A stable hue per author, so the same person keeps the same avatar colour
 * across rows and sessions without storing anything.
 */
export function avatarHue(name: string | undefined | null): number {
  const s = (name ?? '').trim().toLowerCase();
  if (!s) return 210;
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) % 360;
  return hash;
}

/* ── day grouping ────────────────────────────────────────────────────── */

export type DayGroupId = 'today' | 'yesterday' | 'week' | 'earlier';

export const DAY_GROUP_LABELS: Record<DayGroupId, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'This week',
  earlier: 'Earlier',
};

export interface DayGroup<T> {
  id: DayGroupId;
  label: string;
  items: T[];
}

/** Midnight-to-midnight difference in days, in LOCAL time (an inbox groups by
 *  the day the reader experienced, not by UTC). */
function dayDelta(then: number, now: number): number {
  const a = new Date(then);
  const b = new Date(now);
  const aMid = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const bMid = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((bMid - aMid) / 86_400_000);
}

/**
 * Group items into Today / Yesterday / This week / Earlier, preserving the
 * input order within each group and dropping empty groups.
 *
 * `now` is injected so the grouping is testable without freezing the clock.
 */
export function groupByDay(
  items: InboxCommentItem[],
  now: number = Date.now(),
): DayGroup<InboxCommentItem>[] {
  const buckets: Record<DayGroupId, InboxCommentItem[]> = {
    today: [],
    yesterday: [],
    week: [],
    earlier: [],
  };

  for (const item of items) {
    const t = parseTime(item.createdAt);
    // An unparseable timestamp is not "today by accident" — it belongs with the
    // oldest things, where it is least likely to mislead.
    const delta = t === 0 ? Number.POSITIVE_INFINITY : dayDelta(t, now);
    if (delta <= 0) buckets.today.push(item);
    else if (delta === 1) buckets.yesterday.push(item);
    else if (delta <= 7) buckets.week.push(item);
    else buckets.earlier.push(item);
  }

  return (['today', 'yesterday', 'week', 'earlier'] as DayGroupId[])
    .filter((id) => buckets[id].length > 0)
    .map((id) => ({ id, label: DAY_GROUP_LABELS[id], items: buckets[id] }));
}

/* ── filtering + search ──────────────────────────────────────────────── */

export type InboxFilter = 'all' | 'unread' | 'pins' | 'comments' | 'resolved';

export interface InboxFilterCounts {
  all: number;
  unread: number;
  pins: number;
  comments: number;
  resolved: number;
}

/** Counts for the filter pills. Unread counts only UNRESOLVED items, matching
 *  what `buildInbox` treats as unread. */
export function filterCounts(
  items: InboxCommentItem[],
  unreadIds: string[],
  reactionCount: number,
): InboxFilterCounts {
  const unread = new Set(unreadIds);
  return {
    all: items.length,
    // Reaction deltas are unread too — the pill should not say "3 unread" when
    // the header says 5.
    unread: items.filter((i) => unread.has(i.id)).length + reactionCount,
    pins: items.filter((i) => i.kind === 'pin').length,
    comments: items.filter((i) => i.kind === 'comment').length,
    resolved: items.filter((i) => i.resolved).length,
  };
}

/**
 * Apply the active filter pill.
 *
 * `unread` deliberately includes resolved items that are somehow still unread
 * (they should not be, but if one slips through it must be visible rather than
 * hidden behind a filter that claims to show unread things).
 */
export function applyFilter(items: InboxCommentItem[], filter: InboxFilter, unreadIds: string[]): InboxCommentItem[] {
  if (filter === 'all') return items;
  const unread = new Set(unreadIds);
  switch (filter) {
    case 'unread':
      return items.filter((i) => unread.has(i.id));
    case 'pins':
      return items.filter((i) => i.kind === 'pin');
    case 'comments':
      return items.filter((i) => i.kind === 'comment');
    case 'resolved':
      return items.filter((i) => i.resolved);
    default:
      return items;
  }
}

/**
 * Case-insensitive search across everything a person would plausibly search by:
 * the comment text, the author, the folio title, the section label, and the
 * TEXT of the pinned element (not its markup — searching `<div class="row">`
 * would be useless and would match everything).
 */
export function searchItems(items: InboxCommentItem[], query: string): InboxCommentItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    if (item.text.toLowerCase().includes(q)) return true;
    if (item.author.toLowerCase().includes(q)) return true;
    if (item.folioTitle.toLowerCase().includes(q)) return true;
    if (item.sectionLabel && item.sectionLabel.toLowerCase().includes(q)) return true;
    return stripHtml(item.elementHtml).toLowerCase().includes(q);
  });
}

/** Reactions filtered by the same query, so search does not lie about the feed. */
export function searchReactions(reactions: InboxReactionDelta[], query: string): InboxReactionDelta[] {
  const q = query.trim().toLowerCase();
  if (!q) return reactions;
  return reactions.filter((r) => r.folioTitle.toLowerCase().includes(q) || r.emoji.includes(q));
}

/* ── keyboard ────────────────────────────────────────────────────────── */

/**
 * Move a highlighted index by `delta`, clamped to the list.
 *
 * Clamping rather than wrapping: in a list that is being marked read as you
 * move, wrapping from the top to the bottom silently skips everything in
 * between, which loses work rather than saving keystrokes.
 */
export function moveIndex(current: number, delta: number, length: number): number {
  if (length === 0) return -1;
  if (current < 0) return delta > 0 ? 0 : length - 1;
  return Math.max(0, Math.min(length - 1, current + delta));
}
