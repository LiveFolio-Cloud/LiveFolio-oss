'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { MapPin, MessageCircle, Check, CornerDownRight, ArrowUpRight, Circle, Users } from 'lucide-react';
import {
  formatRelativeTime,
  type InboxCommentItem,
  type InboxGrantItem,
  type InboxItem,
} from '@/lib/inbox';
import { avatarHue, elementSnippet, initials } from '@/lib/inbox-view';

/**
 * One inbox row — feedback, or a folio that was shared with you.
 *
 * Both kinds read top-to-bottom the same way: who → on what → what happened →
 * when, with a read toggle on the right. The frame (spine, avatar slot, hover
 * actions, the click-to-open behaviour) is shared by construction rather than
 * copied, so a row added later cannot drift into a second visual language: the
 * only thing a kind supplies is its middle column.
 *
 * The feedback row additionally shows the pinned element's own text, because a
 * pin note like "make this taller" is meaningless without seeing WHICH thing it
 * refers to — that snippet is the single most useful thing this row can show.
 */
interface RowProps {
  unread: boolean;
  /** Keyboard cursor is on this row. */
  highlighted: boolean;
  selected: boolean;
  onOpen: () => void;
  onToggleRead: () => void;
  onToggleSelect: () => void;
  /** True once any row is selected — checkboxes stay visible while it is. */
  selectMode: boolean;
}

export default function InboxRow({ item, ...row }: RowProps & { item: InboxItem }) {
  return item.kind === 'grant' ? <GrantRow item={item} {...row} /> : <FeedbackRow item={item} {...row} />;
}

/* ── the frame both kinds sit in ─────────────────────────────────────── */

function Frame({
  unread,
  highlighted,
  dimmed,
  avatar,
  selectable,
  selected,
  selectMode,
  onOpen,
  onToggleSelect,
  onToggleRead,
  trailing,
  children,
}: RowProps & {
  /** Faded because the row is handled — feedback only; a share is never done. */
  dimmed?: boolean;
  avatar: React.ReactNode;
  /** No checkbox where there is no bulk action (a share row) — the slot stays,
   *  so the avatar keeps the same x as every other row's. */
  selectable: boolean;
  /** The icon on the right edge: a pin it will focus, or a page it will open. */
  trailing: React.ReactNode;
  children: React.ReactNode;
}) {
  const showCheckbox = selectMode || selected;

  return (
    <div
      role="button"
      tabIndex={-1}
      aria-current={highlighted ? 'true' : undefined}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        'group relative flex w-full cursor-pointer items-start gap-3 border-b border-[#0F0F0D]/[0.04] px-3 py-3 text-left transition-colors last:border-b-0 dark:border-white/[0.06]',
        'hover:bg-[#0F0F0D]/[0.03] dark:hover:bg-white/5',
        unread && 'bg-[var(--app-accent)]/[0.04]',
        highlighted && 'bg-[var(--app-accent)]/[0.07] ring-1 ring-inset ring-[var(--app-accent)]/25',
        dimmed && 'opacity-55',
      )}
    >
      {/* Unread spine — the first thing the eye should catch */}
      <span
        aria-hidden
        className={cn(
          'absolute left-0 top-0 h-full w-[2px]',
          unread ? 'bg-[var(--app-accent)]' : 'bg-transparent',
        )}
      />

      {/* Selection — appears on hover, stays once anything is selected */}
      {selectable ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
          aria-label={selected ? 'Deselect' : 'Select'}
          aria-pressed={selected}
          className={cn(
            'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-opacity',
            showCheckbox ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            selected
              ? 'bg-[var(--app-accent)] text-bone'
              : 'ring-1 ring-inset ring-ink/25 hover:ring-ink/50',
          )}
        >
          {selected && <Check size={10} strokeWidth={3} />}
        </button>
      ) : (
        <span aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      )}

      {avatar}

      <span className="min-w-0 flex-1">{children}</span>

      {/* Hover actions — the two things you actually do from a list */}
      <span className="mt-0.5 flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleRead();
          }}
          title={unread ? 'Mark as read' : 'Mark as unread'}
          aria-label={unread ? 'Mark as read' : 'Mark as unread'}
          className="flex h-6 w-6 items-center justify-center rounded-md text-ink/35 opacity-0 transition-opacity hover:text-[var(--app-accent)] group-hover:opacity-100 focus:opacity-100"
        >
          {unread ? <Check size={13} /> : <Circle size={11} />}
        </button>
        <span className="flex h-6 w-6 items-center justify-center text-ink/25">{trailing}</span>
      </span>
    </div>
  );
}

/** Author bubble — initial + a hue derived from the name, so the same person
 *  keeps the same colour with nothing stored. */
function Avatar({ name }: { name: string }) {
  return (
    <span
      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
      style={{ background: `hsl(${avatarHue(name)},45%,52%)` }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

/** The "who · what" line every row starts with. */
function WhoWhat({ who, what, children }: { who: string; what: string; children?: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="truncate text-[12px] font-semibold text-ink/85">{who}</span>
      <span className="shrink-0 text-ink/30" aria-hidden>
        ·
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink/55">{what}</span>
      {children}
    </span>
  );
}

/* ── kind: feedback (pin / comment) ──────────────────────────────────── */

function FeedbackRow({ item, ...row }: RowProps & { item: InboxCommentItem }) {
  const snippet = elementSnippet(item.elementHtml);

  return (
    <Frame
      {...row}
      dimmed={item.resolved && !row.unread}
      avatar={<Avatar name={item.author} />}
      selectable
      trailing={item.deepLinkable ? <MapPin size={11} /> : <ArrowUpRight size={11} />}
    >
      <WhoWhat who={item.author || 'Someone'} what={item.folioTitle}>
        {item.isReply && (
          <CornerDownRight size={10} className="shrink-0 text-ink/30" aria-label="Reply" />
        )}
        {item.resolved && (
          <span
            className="inline-flex shrink-0 items-center gap-0.5 rounded bg-emerald-500/10 px-1 text-[9px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400"
            title="Resolved — no longer counted as unread"
          >
            <Check size={8} /> resolved
          </span>
        )}
      </WhoWhat>

      {/* what they said */}
      <span className="mt-0.5 block text-[13px] leading-snug text-ink">
        {item.text || <span className="text-ink/40">Pinned an element</span>}
      </span>

      {/* the element they pinned — the context that makes the note readable */}
      {snippet && (
        <span className="mt-1 flex items-start gap-1 text-[11px] leading-snug text-ink/40">
          <span className="mt-px shrink-0 font-mono text-[10px] text-ink/30" aria-hidden>
            {item.kind === 'pin' ? <MapPin size={9} className="mt-0.5" /> : null}
          </span>
          <span className="line-clamp-1 italic">{snippet}</span>
        </span>
      )}

      {/* when · where */}
      <span className="mt-1 flex items-center gap-1.5 text-[11px] text-ink/40">
        <span title={item.createdAt}>{formatRelativeTime(item.createdAt)}</span>
        {item.sectionLabel && (
          <>
            <span aria-hidden>·</span>
            <span className="truncate">{item.sectionLabel}</span>
          </>
        )}
        {item.kind === 'comment' && (
          <>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-0.5">
              <MessageCircle size={9} /> comment
            </span>
          </>
        )}
      </span>
    </Frame>
  );
}

/* ── kind: grant (a folio shared with you) ───────────────────────────── */

/**
 * "X shared a folio with you" — the one row here that reports ACCESS rather
 * than feedback.
 *
 * There is no bulk-select on it: the store's bulk actions speak comment items,
 * and a checkbox that silently did nothing would be worse than none. Everything
 * else — click to open, the read toggle, the unread spine — behaves exactly as
 * it does on a feedback row, because to the reader it is the same kind of
 * object: something waiting for them.
 */
function GrantRow({ item, ...row }: RowProps & { item: InboxGrantItem }) {
  return (
    <Frame
      {...row}
      avatar={<Avatar name={item.sharer} />}
      selectable={false}
      trailing={<ArrowUpRight size={11} />}
    >
      <WhoWhat who={item.sharer} what={item.folioTitle} />

      {/* what happened — the row's whole point */}
      <span className="mt-0.5 flex items-center gap-1.5 text-[13px] leading-snug text-ink">
        <Users size={12} className="shrink-0 text-ink/40" aria-hidden />
        <span>Shared a folio with you</span>
        <span
          className="inline-flex shrink-0 items-center rounded bg-[var(--app-accent)]/10 px-1 text-[9px] font-bold uppercase tracking-wide text-[var(--app-accent)]"
          title={item.roleLabel}
        >
          {item.roleLabel}
        </span>
      </span>

      {/* when */}
      <span className="mt-1 flex items-center gap-1.5 text-[11px] text-ink/40">
        <span title={item.createdAt}>{formatRelativeTime(item.createdAt)}</span>
      </span>
    </Frame>
  );
}
