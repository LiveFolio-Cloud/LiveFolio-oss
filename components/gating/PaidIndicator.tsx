'use client';

/**
 * Monetization indicator — the ONE glyph for "this sells" across creator
 * surfaces (sidebar folio/workspace rows, the studio header). Buyer-side
 * surfaces keep the lock badge (paid = locked to them); creators see the
 * dollar badge (paid = earns money). Hover shows type + price + preview.
 *
 * The mark is the brand square: a "$" inside the orange square — the same
 * shape as the LiveFolio logo tile, so it reads as "this is sold via
 * LiveFolio" at a glance.
 */
import type { PaidAccessConfig } from '@/lib/gating/types';
import { priceLabel } from '@/lib/gating/paywall-html';
import { cn } from '@/lib/utils';

export function paidIndicatorLabel(config: PaidAccessConfig): string {
  const preview =
    config.previewMode === 'timed'
      ? `Timed preview (${config.previewSeconds ?? 30}s)`
      : config.previewMode === 'first_page'
        ? 'First-page preview'
        : 'No preview';
  return `${priceLabel(config)} · ${preview}`;
}

export function PaidIndicator({
  config,
  className,
}: {
  config?: PaidAccessConfig | null;
  className?: string;
}) {
  if (!config?.enabled) return null;
  return (
    <span
      title={paidIndicatorLabel(config)}
      aria-label="Paid access"
      className={cn(
        'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] bg-[var(--app-accent)] text-[10px] font-bold leading-none text-white select-none',
        className
      )}
    >
      $
    </span>
  );
}
