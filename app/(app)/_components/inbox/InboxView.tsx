'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { CheckCheck, Inbox as InboxIcon, Search, X } from 'lucide-react';
import { useInboxUnread } from '@/hooks/use-inbox-unread';
import type { InboxCommentItem, InboxReactionDelta } from '@/lib/inbox';
import {
  applyFilter,
  filterCounts,
  groupByDay,
  moveIndex,
  searchItems,
  searchReactions,
  type InboxFilter,
} from '@/lib/inbox-view';
import InboxRow from './InboxRow';
import InboxSkeleton from './InboxSkeleton';

/** Filter pills, in display order. */
const FILTERS: { id: InboxFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'pins', label: 'Pins' },
  { id: 'comments', label: 'Comments' },
  { id: 'resolved', label: 'Resolved' },
];

/**
 * The Inbox — cross-folio feedback, newest first.
 *
 * This is the surface that makes the review loop visible: *AI publishes →
 * human pins feedback → you act on it*. It is a WORK QUEUE, not a feed you
 * skim, and two decisions follow from that:
 *
 * - **Nothing auto-clears on mount.** Opening the inbox to see what is waiting
 *   must not destroy the record of what is waiting. Items clear when you deal
 *   with them, or when you explicitly say Mark all as read.
 * - **Every action is undoable.** `e` toggles read in BOTH directions, because
 *   a queue where a stray click loses an item is a queue people stop trusting.
 *
 * Keyboard: j/↓ and k/↑ move, Enter opens, e toggles read, x selects,
 * / focuses search, Escape clears.
 */
export default function InboxView() {
  const router = useRouter();
  const {
    items,
    reactions,
    unreadIds,
    unreadCount,
    isLoading,
    markItemRead,
    markItemUnread,
    markReactionRead,
    markAllRead,
    markManyRead,
    markManyUnread,
  } = useInboxUnread();

  const [filter, setFilter] = useState<InboxFilter>('all');
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(-1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const unread = useMemo(() => new Set(unreadIds), [unreadIds]);

  // Filter → search → group. One pipeline, so the pills, the search box and the
  // day headers can never disagree about what is on screen.
  const visibleItems = useMemo(
    () => searchItems(applyFilter(items, filter, unreadIds), query),
    [items, filter, unreadIds, query],
  );
  const visibleReactions = useMemo(() => searchReactions(reactions, query), [reactions, query]);
  const groups = useMemo(() => groupByDay(visibleItems), [visibleItems]);
  const counts = useMemo(
    () => filterCounts(items, unreadIds, reactions.length),
    [items, unreadIds, reactions.length],
  );

  /** Flat row order, so the keyboard cursor maps to a group index. */
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const selectMode = selected.size > 0;

  // A changing filter invalidates the cursor — it pointed into a list that no
  // longer exists.
  useEffect(() => {
    setCursor(-1);
  }, [filter, query]);

  const open = useCallback(
    (item: InboxCommentItem) => {
      markItemRead(item);
      router.push(item.href);
    },
    [markItemRead, router],
  );

  const openReaction = useCallback(
    (delta: InboxReactionDelta) => {
      markReactionRead(delta);
      router.push(delta.href);
    },
    [markReactionRead, router],
  );

  const toggleRead = useCallback(
    (item: InboxCommentItem) => {
      if (unread.has(item.id)) markItemRead(item);
      else markItemUnread(item);
    },
    [unread, markItemRead, markItemUnread],
  );

  const toggleSelect = useCallback((item: InboxCommentItem) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  }, []);

  const selectedItems = useMemo(
    () => flat.filter((i) => selected.has(i.id)),
    [flat, selected],
  );

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // ── Keyboard ────────────────────────────────────────────────────────
  // Bound to the window rather than the list so it works wherever focus is,
  // except inside the search box or a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;

      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === 'Escape') {
        if (typing) (target as HTMLInputElement).blur();
        clearSelection();
        setCursor(-1);
        return;
      }
      // A single letter while typing is just a letter.
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => moveIndex(c, 1, flat.length));
        return;
      }
      if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => moveIndex(c, -1, flat.length));
        return;
      }
      const current = flat[cursor];
      if (!current) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        open(current);
      } else if (e.key === 'e') {
        e.preventDefault();
        toggleRead(current);
      } else if (e.key === 'x') {
        e.preventDefault();
        toggleSelect(current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flat, cursor, open, toggleRead, toggleSelect, clearSelection]);

  // Keep the keyboard cursor in view as it moves.
  useEffect(() => {
    if (cursor < 0 || !listRef.current) return;
    const row = listRef.current.querySelectorAll('[data-inbox-row]')[cursor];
    row?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const nothingAtAll = items.length === 0 && reactions.length === 0;
  const nothingVisible = !nothingAtAll && flat.length === 0 && visibleReactions.length === 0;

  return (
    // `relative` anchors the floating bulk bar; the column never scrolls as a
    // whole (only the list does), so the bar stays put while the list moves.
    <main className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 px-6 pb-3 pt-5">
        <div className="min-w-0">
          <h1 className="text-lg font-bold tracking-tight text-ink">Inbox</h1>
          <p className="text-[12px] text-ink/45">
            {isLoading
              ? 'Loading…'
              : unreadCount > 0
                ? `${unreadCount} unread`
                : 'You’re all caught up'}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search
              size={12}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/35"
            />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search feedback…"
              aria-label="Search feedback"
              className="h-8 w-44 rounded-lg border-0 bg-black/5 pl-7 pr-7 text-[12px] font-medium text-ink placeholder:text-ink/40 focus:w-56 focus:bg-black/[0.07] focus:outline-none sm:w-56 sm:focus:w-64"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center text-ink/40 hover:text-ink"
              >
                <X size={11} />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute right-1.5 top-1/2 hidden -translate-y-1/2 rounded border border-ink/15 px-1 text-[9px] font-medium text-ink/35 sm:block">
                /
              </kbd>
            )}
          </div>

          <button
            type="button"
            onClick={markAllRead}
            disabled={unreadCount === 0}
            className={cn(
              'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold transition-colors',
              unreadCount === 0
                ? 'cursor-default text-ink/25'
                : 'cursor-pointer text-ink/70 hover:bg-black/5 hover:text-ink dark:hover:bg-white/10',
            )}
          >
            <CheckCheck size={13} /> Mark all read
          </button>
        </div>
      </div>

      {/* ── Filter pills ─────────────────────────────────────────────── */}
      {!nothingAtAll && (
        <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto px-6 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FILTERS.map(({ id, label }) => {
            const count = counts[id];
            const active = filter === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                aria-pressed={active}
                className={cn(
                  'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors',
                  active
                    ? 'bg-ink text-bone'
                    : 'bg-black/[0.04] text-ink/60 hover:bg-black/[0.07] hover:text-ink dark:bg-white/[0.06] dark:hover:bg-white/10',
                )}
              >
                {label}
                <span className={cn('tabular-nums', active ? 'text-bone/70' : 'text-ink/35')}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Body ─────────────────────────────────────────────────────── */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-6 pb-24">
        {isLoading && nothingAtAll ? (
          <InboxSkeleton />
        ) : nothingAtAll ? (
          <EmptyState
            icon
            title="You’re all caught up"
            body="Feedback left on your folios lands here."
          />
        ) : nothingVisible ? (
          <EmptyState
            title={query ? 'No matches' : 'Nothing here'}
            body={
              query
                ? `Nothing matches “${query}”.`
                : 'No feedback matches this filter right now.'
            }
          />
        ) : (
          <div className="mx-auto w-full max-w-3xl">
            {/* Reactions lead: they are aggregate-only (no timestamps, no
                identity), so they cannot sit in the chronological list without
                inventing a time for them. */}
            {visibleReactions.length > 0 && (
              <section className="mb-5">
                <GroupLabel>Reactions</GroupLabel>
                <div className="overflow-hidden rounded-xl ring-1 ring-[#0F0F0D]/5 dark:ring-white/10">
                  {visibleReactions.map((delta) => (
                    <button
                      key={delta.id}
                      type="button"
                      onClick={() => openReaction(delta)}
                      className={cn(
                        'flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left transition-colors',
                        'border-b border-[#0F0F0D]/[0.04] last:border-b-0 hover:bg-[#0F0F0D]/[0.03] dark:border-white/[0.06] dark:hover:bg-white/5',
                        unread.has(delta.id) && 'bg-[var(--app-accent)]/[0.04]',
                      )}
                    >
                      <span className="text-lg leading-none">{delta.emoji}</span>
                      <span className="text-[13px] font-bold tabular-nums text-ink">
                        +{delta.delta}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12px] text-ink/60">
                        {delta.folioTitle}
                      </span>
                      {unread.has(delta.id) && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--app-accent)]" />
                      )}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {groups.map((group) => (
              <section key={group.id} className="mb-5">
                <GroupLabel sticky>{group.label}</GroupLabel>
                <div className="overflow-hidden rounded-xl ring-1 ring-[#0F0F0D]/5 dark:ring-white/10">
                  {group.items.map((item) => (
                    <div key={item.id} data-inbox-row>
                      <InboxRow
                        item={item}
                        unread={unread.has(item.id)}
                        highlighted={flat[cursor]?.id === item.id}
                        selected={selected.has(item.id)}
                        selectMode={selectMode}
                        onOpen={() => open(item)}
                        onToggleRead={() => toggleRead(item)}
                        onToggleSelect={() => toggleSelect(item)}
                      />
                    </div>
                  ))}
                </div>
              </section>
            ))}

            {/* Keyboard legend — discoverable, quiet, and only on desktop where
                the keys actually exist. */}
            {flat.length > 0 && (
              <p className="mt-6 hidden items-center justify-center gap-3 text-[11px] text-ink/30 sm:flex">
                <Key k="J" /> <Key k="K" /> move
                <Key k="Enter" /> open
                <Key k="E" /> toggle read
                <Key k="X" /> select
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Bulk bar ─────────────────────────────────────────────────── */}
      {selectMode && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 z-40 flex justify-center px-6">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-ink px-3 py-2 text-bone shadow-xl">
            <span className="px-1 text-[12px] font-semibold tabular-nums">
              {selected.size} selected
            </span>
            <span aria-hidden className="h-4 w-px bg-bone/20" />
            <BulkButton
              onClick={() => {
                markManyRead(selectedItems);
                clearSelection();
              }}
            >
              Mark read
            </BulkButton>
            <BulkButton
              onClick={() => {
                markManyUnread(selectedItems);
                clearSelection();
              }}
            >
              Mark unread
            </BulkButton>
            <BulkButton onClick={clearSelection}>Clear</BulkButton>
          </div>
        </div>
      )}
    </main>
  );
}

/* ── small pieces ────────────────────────────────────────────────────── */

function GroupLabel({ children, sticky }: { children: React.ReactNode; sticky?: boolean }) {
  return (
    <div
      className={cn(
        'mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-ink/40',
        sticky && 'sticky top-0 z-10 -mx-1 bg-bone/85 px-1 py-1 backdrop-blur-sm',
      )}
    >
      {children}
    </div>
  );
}

function BulkButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded-full px-2.5 py-1 text-[12px] font-medium text-bone/85 transition-colors hover:bg-bone/15 hover:text-bone"
    >
      {children}
    </button>
  );
}

function Key({ k }: { k: string }) {
  return (
    <kbd className="rounded border border-ink/15 px-1 py-px text-[10px] font-medium text-ink/45">
      {k}
    </kbd>
  );
}

function EmptyState({ title, body, icon }: { title: string; body: string; icon?: boolean }) {
  return (
    <div className="mx-auto mt-10 flex max-w-3xl flex-col items-center gap-2 rounded-2xl border border-dashed border-[#0F0F0D]/10 py-20 text-center dark:border-[#F4F4F0]/10">
      {icon && <InboxIcon size={20} className="text-ink/25" />}
      <p className="text-[13px] font-medium text-ink/60">{title}</p>
      <p className="text-[11px] text-ink/40">{body}</p>
    </div>
  );
}
