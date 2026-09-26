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
 *           seenGrantIds:     string[],                  // individual marks (capped)
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
 *     A grant is read by ID alone, and is deliberately immune to the comment
 *     boundary: `lastCommentSeenAt` means "I have seen the feedback up to
 *     here", and someone else's new share is not feedback. The two namespaces
 *     never cross — a share never marks a comment read, and a comment arriving
 *     never silently swallows a share row.
 *
 * **A third row kind: the grant.** This feed is DERIVED, not an event log —
 * there is no events table, and nothing writes a row when something happens.
 * `buildInbox` recomputes on read, so the granted-access row *is* the
 * event: "X shared a folio with you" is a projection of an ACTIVE grant, in
 * exactly the way a comment item is a projection of a comment. A grant row is
 * built from the folio's TITLE and the sharer's NAME — `InboxGrantInput`
 * carries no address field at all, and a display name that looks like one is
 * reduced to the part a person reads (`sharerDisplayName`).
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
 * Cap on individually-marked grant ids.
 *
 * Much lower than the comment cap on purpose: a person's grants are bounded by
 * the seats the workspaces sharing with them have bought (a handful, not
 * hundreds), so 200 is already generous headroom. Eviction is FIFO and the
 * failure mode is the same benign one — an evicted id belongs to an old share,
 * and the worst case is that one old row reads as new again.
 */
export const MAX_SEEN_GRANT_IDS = 200;

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

/**
 * One grant, as the feed sees it.
 *
 * `id` is `grant:<grantId>` — the folio's collaborator-row id, namespaced the
 * way a comment item is namespaced by its folio. The prefix is load-bearing:
 * `unreadIds` mixes comment ids, grant ids and reaction ids in one flat list,
 * and a raw grant id must never be mistaken for a comment id
 * by a read-state mutation.
 */
export interface InboxGrantItem {
  /** Discriminant — a grant row is deliberately NOT an `InboxCommentItem`. */
  kind: 'grant';
  id: string;
  /** The granted-access record this row is a projection of. */
  grantId: string;
  folioId: string;
  folioTitle: string;
  /** Where clicking the row goes — the folio itself, not a pin. */
  href: string;
  /** The sharer's display name. Never an address (see `sharerDisplayName`). */
  sharer: string;
  /** The role the grant was extended at, as the share menu names it. */
  role: InboxGrantRole;
  /** Display label for that role — "Can edit". */
  roleLabel: string;
  /** When access began (the grant's `accepted_at`, else its `created_at`). */
  createdAt: string;
}

/** Any row the Inbox renders in its chronological list. Discriminated by
 *  `kind` (`'pin' | 'comment'` are the comment items, `'grant'` the shares). */
export type InboxItem = InboxCommentItem | InboxGrantItem;

/**
 * The three roles a grant row can carry — mirrors the CHECK constraint on
 * the shared-access role vocabulary.
 *
 * Duplicated here rather than imported from `lib/collaborators`: that module is
 * the Cloud-only grant engine and does not exist in the self-hosted tree, while
 * this file ships to both. The vocabulary is three strings; the coupling of a
 * cross-boundary import would cost more than the duplication.
 */
export type InboxGrantRole = 'viewer' | 'commenter' | 'editor';

/** Every grant role, for runtime validation of a value off the wire. */
export const INBOX_GRANT_ROLES: readonly InboxGrantRole[] = ['viewer', 'commenter', 'editor'];

/**
 * One grant as the Inbox API hands it over — the recipient's OWN rows only.
 *
 * Produced by the caller: `GET /api/inbox` maps the caller's own
 * granted-access rows (joined to their folios) into this shape. It has
 * no `invited_email` field, and the row that comes out the other side has
 * nowhere to put one — the shared folio's TITLE and the sharer's display NAME
 * are the whole vocabulary of a share row.
 */
export interface InboxGrantInput {
  /** The granted-access record's id. */
  id: string;
  folioId: string;
  folioTitle?: string | null;
  folioSlug?: string | null;
  /** The folio's publish state — decides whether the row links to the viewer
   *  or to the in-app editor. */
  folioStatus?: string | null;
  /** Archived folios are excluded, exactly as they are for feedback. */
  folioArchivedAt?: string | null;
  /** The sharer's display name. An address here is reduced to its local part. */
  sharerName?: string | null;
  role?: string | null;
  /**
   * The grant's lifecycle. ONLY `'active'` produces a row — see
   * `grantRowFor`. Missing or unknown fails closed, so a caller that forgets to
   * map this field gets no row rather than a row claiming access that may not
   * exist.
   */
  status?: string | null;
  /** When access began. Falls back to `createdAt`. */
  acceptedAt?: string | null;
  /** When the grant row was written. */
  createdAt?: string | null;
}

export interface InboxWatermark {
  /** Boundary set by "mark all as read" — everything at or before this instant. */
  lastCommentSeenAt: string | null;
  /** Ids marked read one at a time (capped at MAX_SEEN_COMMENT_IDS). */
  seenCommentIds: string[];
  /**
   * Grant ids marked read one at a time (capped at MAX_SEEN_GRANT_IDS).
   *
   * OPTIONAL, and that is the whole migration story: watermarks written before
   * grant rows existed (every row in `inbox_read_state` today, and every OSS
   * localStorage blob) simply lack the key, and `normalizeWatermark` fills it
   * with an empty list. No schema change, no backfill, and an old client
   * writing a body without the field cannot break a new one.
   */
  seenGrantIds?: string[];
  reactionSeen: Record<string, Record<string, number>>;
}

/**
 * A watermark as `normalizeWatermark` produces it: every list present.
 *
 * Public `InboxWatermark` keeps `seenGrantIds` optional so stored/older shapes
 * stay assignable; every function here normalizes first and can then index it
 * without a guard.
 */
export interface NormalizedInboxWatermark extends InboxWatermark {
  seenGrantIds: string[];
}

export interface InboxFeed {
  items: InboxCommentItem[];
  reactions: InboxReactionDelta[];
  /**
   * Share rows, newest first. OPTIONAL so an `InboxFeed` literal written before
   * grant rows existed still satisfies the type — the same backwards-compatible
   * move as `seenGrantIds` above. `buildInbox`, `resolveFeed` and
   * `recomputeOssFeed` always produce it.
   */
  grants?: InboxGrantItem[];
  /** Ids (of items, reaction rows and grant rows) the user has not seen yet. */
  unreadIds: string[];
  unreadCount: number;
}

/** Nothing marked read, every list present — the value `normalizeWatermark`
 *  falls back to, and the value a caller starts from. Typed as the NORMALIZED
 *  shape so spreading it always satisfies a `NormalizedInboxWatermark`. */
export const EMPTY_WATERMARK: NormalizedInboxWatermark = {
  lastCommentSeenAt: null,
  seenCommentIds: [],
  seenGrantIds: [],
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
function capSeenIds(ids: string[], cap: number = MAX_SEEN_COMMENT_IDS): string[] {
  const unique = uniqueStrings(ids);
  return unique.length > cap ? unique.slice(unique.length - cap) : unique;
}

/** One string-id list out of a stored/raw value, dropping anything unusable and
 *  capping the tail. Shared by the comment and grant sets so their defences
 *  cannot drift apart. */
function coerceSeenIds(value: unknown, cap: number): string[] {
  return Array.isArray(value)
    ? capSeenIds(value.filter((id): id is string => typeof id === 'string' && id.length > 0), cap)
    : [];
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

/**
 * Coerce anything (DB row, localStorage JSON, request body) into a valid
 * watermark. Never throws, never returns null, and tolerates every shape that
 * has ever been stored — including one written before grant rows existed,
 * which simply has no `seenGrantIds` and gets an empty list.
 */
export function normalizeWatermark(raw: unknown): NormalizedInboxWatermark {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_WATERMARK };
  const r = raw as {
    lastCommentSeenAt?: unknown;
    last_comment_seen_at?: unknown;
    seenCommentIds?: unknown;
    seen_comment_ids?: unknown;
    seenGrantIds?: unknown;
    seen_grant_ids?: unknown;
    reactionSeen?: unknown;
    reaction_seen?: unknown;
  };
  const last = r.lastCommentSeenAt ?? r.last_comment_seen_at;
  const seenIdsRaw = r.seenCommentIds ?? r.seen_comment_ids;
  const seenGrantIdsRaw = r.seenGrantIds ?? r.seen_grant_ids;
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
    seenCommentIds: coerceSeenIds(seenIdsRaw, MAX_SEEN_COMMENT_IDS),
    seenGrantIds: coerceSeenIds(seenGrantIdsRaw, MAX_SEEN_GRANT_IDS),
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
 *
 * The two id sets are unioned independently, and that is not symmetry for its
 * own sake: the boundary is a COMMENT concept, so a moved boundary retires the
 * comment id list but must leave `seenGrantIds` alone. A "mark all as read"
 * therefore still has to name every grant it covered (see `markAllRead`) —
 * otherwise the next merge would resurrect exactly the shares it just closed.
 */
export function mergeWatermark(current: InboxWatermark, patch: InboxWatermark): InboxWatermark {
  // The grant lists are read through the normalizer because they are optional
  // on the public shape — a watermark stored before grant rows existed has no
  // list, and a merge against it must union with "empty", not crash.
  const currentSeen = normalizeWatermark(current);
  const patchSeen = normalizeWatermark(patch);

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
    // Grants have no boundary to be superseded by, so this list only grows.
    seenGrantIds: capSeenIds([...currentSeen.seenGrantIds, ...patchSeen.seenGrantIds], MAX_SEEN_GRANT_IDS),
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

/* ── grants ──────────────────────────────────────────────────────────── */

/**
 * The one string the module will accept as a sharer's name.
 *
 * A display name is not identity, and an inbox row is a place an address must
 * never surface: the row is read over a shoulder, screenshotted and shared, and
 * the reader already knows who shared with them. The rule is therefore
 * structural — `InboxGrantInput` has no address field, and anything that still
 * *looks* like an address is reduced to the part a person reads (the local
 * part, which is also what the invite mail shows as the inviter's name).
 *
 * Never returns '': a row with an empty author slot would render as a bare
 * "shared a folio with you" with no actor, so the fallback is `Someone`, the
 * same word the row component uses for a nameless commenter.
 */
export function sharerDisplayName(value: unknown): string {
  if (typeof value !== 'string') return 'Someone';
  const trimmed = value.trim();
  if (!trimmed) return 'Someone';
  const at = trimmed.indexOf('@');
  // Everything before the '@' — the domain never survives, so no row this
  // module builds can carry a routable address.
  const localPart = (at === -1 ? trimmed : trimmed.slice(0, at)).trim();
  return localPart.length > 0 ? localPart : 'Someone';
}

/** Display label for a grant role — the share menu's own vocabulary, so the
 *  owner who picked "Can edit" and the collaborator who reads it agree. */
const GRANT_ROLE_LABELS: Readonly<Record<InboxGrantRole, string>> = {
  viewer: 'Can view',
  commenter: 'Can comment',
  editor: 'Can edit',
};

/** Runtime membership test for the grant role union — fails closed. */
export function isInboxGrantRole(value: unknown): value is InboxGrantRole {
  return typeof value === 'string' && (INBOX_GRANT_ROLES as readonly string[]).includes(value);
}

/**
 * Project one grant row into an inbox row, or `null` when it must not appear.
 *
 * Returning `null` rather than throwing is the module's usual posture, and here
 * it also carries the access rule: a row is a claim that the reader has access,
 * so every way of being unsure resolves to "no row":
 *
 * - **Only `status === 'active'` produces a row.** Pending is not access yet
 *   (the invitee may never accept, and the seat is not theirs); revoked is not
 *   access at all. Anything else — a missing status, a future value — is
 *   treated the same way. The route is expected to filter too; this is the
 *   second lock on the same door, and the one the unit tests pin.
 * - **An unknown role produces no row.** The role is what the row promises the
 *   reader they may do; a role this module cannot label is a promise it cannot
 *   keep, and guessing at it would be worse than silence.
 * - **An archived folio produces no row**, matching the feedback rules above —
 *   the shelf is out of the way, and the link would dead-end at a folio only an
 *   owner can open.
 * - **A row with no grant id or no folio id produces no row**: without them
 *   there is no stable identity to mark read and no page to open.
 */
export function grantRowFor(grant: InboxGrantInput): InboxGrantItem | null {
  if (!grant || typeof grant !== 'object') return null;
  if (!grant.id || !grant.folioId) return null;
  if (grant.status !== 'active') return null;
  if (!isInboxGrantRole(grant.role)) return null;
  if (grant.folioArchivedAt) return null;

  const { href } = hrefFor({
    id: grant.folioId,
    title: grant.folioTitle ?? '',
    slug: grant.folioSlug ?? null,
    status: grant.folioStatus ?? 'published',
  });

  return {
    kind: 'grant',
    id: `grant:${grant.id}`,
    grantId: grant.id,
    folioId: grant.folioId,
    folioTitle: grant.folioTitle || 'Untitled',
    href,
    sharer: sharerDisplayName(grant.sharerName),
    role: grant.role,
    roleLabel: GRANT_ROLE_LABELS[grant.role],
    // Access began when the grant was accepted; a grant bound straight to an
    // existing account is written active with `accepted_at` set, so the
    // fallback only covers a row that predates that write.
    createdAt: firstTime(grant.acceptedAt) ?? firstTime(grant.createdAt) ?? '',
  };
}

/** The first non-empty string of a candidate pair, else null. */
function firstTime(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * True when this grant reads as unread under the watermark.
 *
 * By id alone, deliberately: the comment boundary means "I have seen the
 * feedback up to here", and a shared folio is not feedback. Sharing a folio
 * with someone must not mark their older comments read, and their next comment
 * must not silently swallow the share row.
 */
export function isGrantUnread(grant: { id: string }, watermark: InboxWatermark): boolean {
  // `?? []` and not a normalize call: this runs once per grant row in the hot
  // path, and the only field at risk here is the one that is optional by design.
  const seen = watermark.seenGrantIds ?? [];
  return !seen.includes(grant.id);
}

/**
 * Case-insensitive search over the three things a share row can be found by:
 * who shared it, which folio, and what it lets you do. There is no comment text
 * and no pinned element on a grant row, so those arms of `searchItems` have no
 * counterpart here.
 */
export function grantMatchesQuery(grant: InboxGrantItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    grant.sharer.toLowerCase().includes(q) ||
    grant.folioTitle.toLowerCase().includes(q) ||
    grant.roleLabel.toLowerCase().includes(q)
  );
}

/**
 * Build the inbox feed from the caller's folios (and, for a collaborator, the
 * grants that were extended to them).
 *
 * Rules that matter for how the inbox *feels*:
 * - **Archived folios are excluded entirely.** Archiving is the "out of the way,
 *   not gone" shelf; nagging about feedback on a shelved folio is noise.
 * - **Resolved comments stay in the feed but never count as unread** (history,
 *   not a demand).
 * - **Replies are included** (they carry `parentId`) but flagged, so the UI can
 *   render them as part of a thread.
 * - **Reaction rows only exist when something new arrived** (delta > 0).
 * - **Grant rows exist only for ACTIVE grants** — see `grantRowFor` for the
 *   complete list of ways a grant fails to become a row.
 *
 * `grants` defaults to empty, which is the whole backwards-compatibility
 * contract: every caller written before share rows existed — the owner who has
 * no grants, the self-hosted install with no grant table at all — builds the
 * identical feed it built before, because the loop simply has nothing to add.
 */
export function buildInbox(
  folios: InboxFolioInput[],
  watermark: InboxWatermark,
  grants: InboxGrantInput[] = [],
): InboxFeed {
  const seen = normalizeWatermark(watermark);

  const items: InboxCommentItem[] = [];
  const reactions: InboxReactionDelta[] = [];
  const grantItems: InboxGrantItem[] = [];

  for (const grant of grants) {
    // Malformed entries are skipped, not thrown on — a grant the route could
    // not fully map must not take the whole feed down with it.
    const row = grantRowFor(grant);
    if (row) grantItems.push(row);
  }

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
  // Shares read newest first, like the feedback above. Same comparator, so the
  // two lists can never disagree about which end is "new".
  grantItems.sort((a, b) => parseTime(b.createdAt) - parseTime(a.createdAt));
  // Reactions have no timestamps; order by delta size (biggest response first),
  // then by folio title for a stable, non-flickering list.
  reactions.sort((a, b) => b.delta - a.delta || a.folioTitle.localeCompare(b.folioTitle));

  const unreadIds = [
    ...items.filter((i) => isCommentUnread({ id: i.commentId, createdAt: i.createdAt, resolved: i.resolved }, seen)).map((i) => i.id),
    ...reactions.map((r) => r.id),
    ...grantItems.filter((g) => isGrantUnread(g, seen)).map((g) => g.id),
  ];

  return { items, reactions, grants: grantItems, unreadIds, unreadCount: unreadIds.length };
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
    ...(feed.grants ?? []).filter((g) => isGrantUnread(g, seen)).map((g) => g.id),
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

/**
 * Record ONE share row as read. Adds its id, exactly as `markItemRead` does for
 * a comment — and, like it, never touches the comment boundary.
 *
 * Takes the row rather than a bare id so the two read-state entry points have
 * the same shape; the id it stores is the NAMESPACED one (`grant:<grantId>`),
 * which is what a feed's `unreadIds` carries.
 */
export function markGrantRead(watermark: InboxWatermark, grant: InboxGrantItem): InboxWatermark {
  const current = normalizeWatermark(watermark);
  if (current.seenGrantIds.includes(grant.id)) return current;
  return {
    ...current,
    seenGrantIds: capSeenIds([...current.seenGrantIds, grant.id], MAX_SEEN_GRANT_IDS),
  };
}

/** Undo a read on a share row — the deliberate removal route, mirroring
 *  `markItemUnread`. Nothing else can un-read a grant, because a union merge
 *  only ever adds. */
export function markGrantUnread(watermark: InboxWatermark, grant: InboxGrantItem): InboxWatermark {
  const current = normalizeWatermark(watermark);
  return {
    ...current,
    seenGrantIds: current.seenGrantIds.filter((id) => id !== grant.id),
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
 * Mark the whole feed read: the boundary jumps to the newest item present,
 * every reaction row records its current count, and every share row is named
 * in `seenGrantIds`.
 *
 * "Newest item present" (max createdAt) rather than `new Date()` on purpose — a
 * client clock running fast would otherwise silently mark future feedback read
 * the next time the feed loads.
 *
 * Share rows are recorded BY ID, and deliberately do not take part in the
 * boundary computation. Two reasons, and they point the same way: a boundary
 * includes everything at or before its instant, so letting a share set it would
 * mark every older COMMENT read (a share is not feedback, and it must not close
 * feedback); and a share that merely arrived earlier than the boundary would
 * otherwise be impossible to leave unread. Ids cost a few bytes and keep the
 * two namespaces independent.
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

  const grantIds = (feed.grants ?? []).map((g) => g.id);

  return {
    lastCommentSeenAt: newestIso ?? null,
    // The boundary now covers everything listed; individual marks are redundant.
    seenCommentIds: [],
    // Grants are NOT covered by that reasoning (see above), so "mark all" names
    // each one it just closed. Unioned rather than replaced, so a share row
    // already marked read — or on a folio no longer in this feed — stays read.
    seenGrantIds: capSeenIds([...current.seenGrantIds, ...grantIds], MAX_SEEN_GRANT_IDS),
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
  /** Share rows — absent from a response written before they existed, and from
   *  any install with no grant table. */
  grants?: InboxGrantItem[];
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
      grants: Array.isArray(response.grants) ? response.grants : [],
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
  const grants = Array.isArray(response.grants) ? response.grants : [];

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
    ...grants.filter((g) => isGrantUnread(g, seen)).map((g) => g.id),
  ];

  return { items, reactions, grants, unreadIds, unreadCount: unreadIds.length };
}
