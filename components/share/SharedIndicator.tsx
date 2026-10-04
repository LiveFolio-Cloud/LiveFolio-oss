'use client';

/**
 * Collaboration indicator — the mark for "other people are on this folio".
 *
 * Deliberately NOT the orange brand square its neighbours wear. PaidIndicator
 * and ListedIndicator are both that square because both mean "this folio is
 * sold", and a third orange square would be indistinguishable from them at a
 * glance — the badge has to answer "is this shared?" without the reader
 * comparing glyphs. Sharing is also not a monetization state, so the neutral
 * treatment is the honest one.
 *
 * The COUNT is always shown rather than a bare glyph: "shared with one person"
 * and "shared with five" are different situations, and the row has room for one
 * character. The number is what makes this a sharing mark rather than a
 * decoration — and the publish dot beside it stays, because it answers a
 * different question (can the web see it?) and the two are read together.
 *
 * The count arrives as a plain number so this file names nothing hosted: it
 * ships to the self-hosted tree, where it renders nothing at all because every
 * row's count is absent.
 */
import { Users } from 'lucide-react';
import { cn } from '@/lib/utils';

export function SharedIndicator({
  count,
  className,
}: {
  /**
   * People the folio is directly shared with — accepted or still invited.
   * Absent or zero means "not shared", and the mark is not rendered.
   */
  count?: number | null;
  className?: string;
}) {
  if (!count || count < 1) return null;

  const label = count === 1 ? 'Shared with 1 person' : `Shared with ${count} people`;

  return (
    <span
      role="img"
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-px text-[9px] font-semibold leading-tight tabular-nums text-ink/60 bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10',
        className
      )}
    >
      <Users size={9} strokeWidth={2.75} />
      {count}
    </span>
  );
}
