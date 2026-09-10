'use client';

/**
 * HeaderMenuSurface — one menu chrome for every icon-triggered header menu
 * (Share, Featured, Access & payments, Marketplace). Consistency rule:
 *
 * - Desktop: floating card anchored under its trigger (right-aligned).
 * - Phones: our own modal style — mask + centered card (NOT an Apple bottom
 *   sheet), rendered via portal so no overflow-hidden studio ancestor clips
 *   it. Same pattern the Share menu already used.
 *
 * The header owns open/close state + outside-click/Escape; the surface is
 * purely presentational. Title bar spacing is uniform (pt-3.5/pb-2 + px-4)
 * so an action pill like Publish never collides with the card's top edge.
 */
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsPhone } from '@/lib/app-shell/use-phone';

export function HeaderMenuSurface({
  open,
  onClose,
  title,
  right,
  children,
  widthClass = 'w-80',
}: {
  open: boolean;
  onClose: () => void;
  /** Small-caps style label row, e.g. "Share". */
  title: string;
  /** Optional action pill rendered at the right end of the title row. */
  right?: React.ReactNode;
  children: React.ReactNode;
  widthClass?: string;
}) {
  const phone = useIsPhone();
  if (!open) return null;

  const titleBar = (
    <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-3.5 pb-2">
      <span className="text-[13px] font-semibold text-ink">{title}</span>
      <div className="flex items-center gap-1.5">
        {right}
        {phone && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ink/50 transition-colors hover:bg-black/5 hover:text-ink"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );

  const scrollBody = (
    <div
      className={cn(
        'min-h-0 flex-1 overflow-y-auto overscroll-contain',
        '[scrollbar-gutter:stable] [scrollbar-width:thin] [scrollbar-color:rgba(0,0,0,0.12)_transparent]',
        phone ? 'px-5 pb-6' : 'px-4 pb-4'
      )}
    >
      {children}
    </div>
  );

  if (!phone) {
    return (
      <div
        className={cn(
          'flex flex-col rounded-2xl bg-white dark:bg-[#1C1C19] shadow-2xl shadow-black/10 ring-1 ring-black/5 dark:ring-white/10 animate-in fade-in zoom-in-95 duration-100',
          'max-h-[min(80dvh,38rem)]',
          widthClass,
          'max-w-[calc(100vw-2rem)]'
        )}
      >
        {titleBar}
        {scrollBody}
      </div>
    );
  }

  // Phone: portal the full-screen modal to <body> — ancestors with
  // overflow-hidden / backdrop-filter must never clip or blur it.
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-[#0F0F0D]/40 dark:bg-[#0F0F0D]/60 animate-in fade-in duration-150"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative flex max-h-[min(85dvh,42rem)] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white dark:bg-[#1C1C19] shadow-2xl shadow-black/10 ring-1 ring-black/5 dark:ring-white/10 animate-in fade-in zoom-in-95 duration-100">
        {titleBar}
        {scrollBody}
      </div>
    </div>,
    document.body
  );
}
