'use client';

/**
 * Marketplace indicator — the glyph for "this folio is listed in Explore"
 * across creator surfaces (studio header, sidebar rows). Same brand mark as
 * the PaidIndicator ("$" = this sells): the orange LiveFolio square with a
 * white storefront glyph — no contour, no background tint.
 *
 * Hover shows the category when one is set.
 */
import { Store } from 'lucide-react';
import type { ListingMetadata } from '@/lib/listing/types';
import { CATEGORY_LABELS } from '@/lib/listing/types';
import { cn } from '@/lib/utils';

export function ListedIndicator({
  listing,
  listed,
  className,
}: {
  /** Full listing metadata when available (category for the tooltip). */
  listing?: ListingMetadata | null;
  /** Bare flag fallback for rows that only carry the boolean. */
  listed?: boolean;
  className?: string;
}) {
  const isListed = listed === true || listing?.listed === true;
  if (!isListed) return null;

  const category = listing?.category ? CATEGORY_LABELS[listing.category] : null;
  const title = category ? `Listed in Explore · ${category}` : 'Listed in Explore';

  return (
    <span
      title={title}
      aria-label="Listed in Explore"
      className={cn(
        'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] bg-[var(--app-accent)] text-white select-none',
        className
      )}
    >
      <Store size={9} strokeWidth={2.75} />
    </span>
  );
}
