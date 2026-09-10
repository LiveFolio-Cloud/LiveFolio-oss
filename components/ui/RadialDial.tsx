'use client';

/**
 * RadialDial — a round trigger whose tap fans a grid of action wedges around
 * it (AnyDesk-style), replacing the old "⋯ → list popover" FAB. Used by the
 * Studio canvas tools (Comment / Edit / Fix with AI) and by the public
 * share/@user viewer (react picker, page browsing, pin, discuss).
 *
 * Behavior shared by every consumer:
 * - The trigger wears the icon of the ACTIVE wedge when the fan is closed, so
 *   one tap stops that mode.
 * - Tapping outside or pressing the trigger again closes fan + sheet.
 * - Wedges + sheet mount always (entry/exit transitions) but are inert and
 *   unfocusable while closed.
 *
 * Wedge anatomy: icon (or emoji `glyph`), optional micro label, optional
 * count `badge` pill on the circle's top-right edge, optional `active`
 * accent state. Consumers may swap the whole `items` array (a sub-fan — the
 * share dial drills from main actions into the 4-emoji reaction picker) and
 * assign explicit `slot`s.
 *
 * Geometry: the bottom-right anchor leaves only leftward/upward room, so
 * wedges fan as a staggered grid above the trigger:
 *   far row  (dy -164):  outer / inner columns   (76px column pitch)
 *   near row (dy -86):   outer / inner columns
 *   chip     (dx -104, dy -28): smaller 5th target at thumb height
 * Rows are 78px apart and columns 76px apart, engineered so no circle ever
 * overlaps a neighbor's label (a tight-arc predecessor overlapped up to
 * 36px and covered its own labels).
 *
 * Slots (by number — 1-based not needed; caller orders or sets `slot`):
 *   slot 0  near-inner (bottom-right, thumb-closest)
 *   slot 1  near-outer (bottom-left of the pair)
 *   slot 2  far-inner (top-right of the pair)
 *   slot 3  far-outer (top-left)
 *   slot 4  low chip (44px, at thumb height, left of the trigger)
 */
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Ellipsis, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface RadialDialItem {
  /** Stable id; passed back through onSelect. */
  id: string;
  /** Micro label under the wedge; omit for self-evident wedges (emoji). */
  label?: string;
  /** Full description — aria-label / tooltip. */
  title: string;
  /** Icon, or `glyph` (text/emoji) when the wedge has no icon. */
  icon?: LucideIcon;
  glyph?: string;
  /** Count pill on the circle's top-right edge. */
  badge?: number | string;
  /** Accent-filled while true (mode active / selected). */
  active?: boolean;
  /** Explicit fan slot (0–4); defaults to the item's array position. */
  slot?: number;
}

interface Slot {
  dx: number;
  dy: number;
  size: number;
}

/** Slot geometry — see header. */
const SLOTS: readonly Slot[] = [
  { dx: -36, dy: -86, size: 52 }, // near, inner column
  { dx: -112, dy: -86, size: 52 }, // near, outer column
  { dx: -36, dy: -164, size: 52 }, // far, inner column
  { dx: -112, dy: -164, size: 52 }, // far, outer column
  { dx: -104, dy: -28, size: 44 }, // low chip
];

const TRIGGER_SIZE = 56;

export interface RadialDialProps {
  /** Fan wedges (icon/glyph + optional label + optional badge). */
  items: readonly RadialDialItem[];
  /** Fan open (wedges visible). */
  fanOpen: boolean;
  /** More sheet open (replaces the fan). */
  moreOpen: boolean;
  /** Wedge id the trigger should wear while the fan is closed (mode active). */
  activeWedgeId?: string | null;
  /** Trigger tap — the consumer decides (exit active mode first, else toggle). */
  onTrigger: () => void;
  /** Wedge / chip tapped. */
  onSelect: (id: string) => void;
  /** Outside tap / dismissal. */
  onCloseAll: () => void;
  /** Rendered inside the More sheet popover. */
  panel?: ReactNode;
  /** Extra class — e.g. '' when the dial must show on desktop too. */
  className?: string;
  /** aria-label for the trigger (defaults to 'Open tools'). */
  triggerAriaLabel?: string;
}

export function RadialDial({
  items,
  fanOpen,
  moreOpen,
  activeWedgeId,
  onTrigger,
  onSelect,
  onCloseAll,
  panel,
  className,
  triggerAriaLabel,
}: RadialDialProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const anythingOpen = fanOpen || moreOpen;
  const activeItem =
    activeWedgeId != null ? (items.find((i) => i.id === activeWedgeId) ?? null) : null;
  const triggerItem = activeItem ?? items[0] ?? null;

  // Close on outside click while any surface is open.
  useEffect(() => {
    if (!anythingOpen) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onCloseAll();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [anythingOpen, onCloseAll]);

  return (
    <div
      ref={rootRef}
      className={cn('fixed right-6 z-50 transition-all duration-300', className)}
      style={{ bottom: 'max(24px, calc(env(safe-area-inset-bottom, 0px) + 16px))' }}
    >
      {/* More sheet — replaces the fan while open */}
      <div
        className={cn(
          'absolute bottom-[68px] right-0 mb-1 w-60 overflow-hidden max-h-[70vh] overflow-y-auto',
          'transition-all duration-200 ease-out origin-bottom-right',
          'bg-white dark:bg-[#171714] ring-1 ring-black/5 dark:ring-white/10 rounded-lg shadow-md',
          moreOpen
            ? 'opacity-100 scale-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 scale-95 translate-y-2 pointer-events-none'
        )}
      >
        {panel}
      </div>

      {/* Fan wedges + optional low chip — staggered entrance */}
      {items.map((item, i) => {
        const slot = SLOTS[item.slot ?? i];
        if (!slot) return null;
        const open = fanOpen && !moreOpen;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            aria-hidden={!open || undefined}
            aria-label={item.title}
            tabIndex={open ? 0 : -1}
            onClick={() => onSelect(item.id)}
            className={cn(
              'group absolute flex flex-col items-center transition-all duration-200 ease-out origin-bottom-right cursor-pointer',
              open
                ? 'opacity-100 scale-100 translate-y-0 pointer-events-auto'
                : 'opacity-0 scale-50 translate-y-2 pointer-events-none'
            )}
            style={{
              left: TRIGGER_SIZE / 2 + slot.dx - slot.size / 2,
              top: TRIGGER_SIZE / 2 + slot.dy - slot.size / 2,
              ...(open ? { transitionDelay: `${i * 45}ms` } : {}),
            }}
          >
            <span
              className={cn(
                'relative rounded-full grid place-items-center shadow-lg ring-1 transition-colors',
                item.active
                  ? 'bg-[var(--app-accent)] text-white ring-[var(--app-accent)]/40'
                  : // Explicit ink pairs, NOT .lf-tokens-scoped utilities: the
                    // share viewer mounts this dial outside any .lf-tokens
                    // scope, where text-ink silently no-ops and the glyphs
                    // would inherit the page's hardcoded black — invisible
                    // on the dark: bubble. With explicit dark: pairs every
                    // surface (studio + share) reads correctly.
                    'bg-white/95 dark:bg-[#171714]/95 text-[#0F0F0D]/80 dark:text-[#F4F4F0]/80 ring-black/10 dark:ring-white/10 group-hover:text-[var(--app-accent)]'
              )}
              style={{ width: slot.size, height: slot.size }}
            >
              {Icon ? (
                <Icon size={slot.size <= 44 ? 18 : 20} strokeWidth={2} />
              ) : (
                <span className="text-[17px] leading-none">{item.glyph}</span>
              )}
              {item.badge != null && item.badge !== '' && item.badge !== 0 && (
                <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-[17px] h-[17px] items-center justify-center rounded-full bg-[var(--app-accent)] px-1 text-[9px] font-bold leading-none text-white ring-2 ring-white dark:ring-[#171714]">
                  {item.badge}
                </span>
              )}
            </span>
            {item.label ? (
              <span className="mt-[3px] max-w-[76px] truncate text-[10px] font-semibold tracking-tight text-[#0F0F0D] dark:text-[#F4F4F0] drop-shadow-sm">
                {item.label}
              </span>
            ) : null}
          </button>
        );
      })}

      {/* Trigger — wears the active wedge's icon while the fan is closed */}
      <button
        type="button"
        onClick={onTrigger}
        aria-label={
          triggerItem && activeItem && !anythingOpen
            ? `${triggerItem.label ?? triggerItem.title} — tap to stop`
            : triggerAriaLabel ?? 'Open tools'
        }
        aria-expanded={anythingOpen}
        className={cn(
          'h-14 w-14 rounded-full grid place-items-center cursor-pointer transition-all duration-200 select-none',
          'bg-[var(--app-accent)] text-white shadow-lg hover:shadow-xl active:scale-95',
          activeItem && !anythingOpen && 'ring-[3px] ring-[var(--app-accent)]/25'
        )}
      >
        <div className={cn('transition-transform duration-300', anythingOpen && 'rotate-90')}>
          {anythingOpen ? (
            <X size={22} strokeWidth={2.5} />
          ) : triggerItem ? (
            triggerItem.icon ? (
              (() => {
                const Icon = triggerItem.icon;
                return <Icon size={20} strokeWidth={2.25} />;
              })()
            ) : (
              <span className="text-[19px] leading-none">{triggerItem.glyph}</span>
            )
          ) : (
            <Ellipsis size={24} strokeWidth={2.5} />
          )}
        </div>
      </button>
    </div>
  );
}
