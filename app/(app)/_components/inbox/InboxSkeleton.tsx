import React from 'react';

/**
 * Loading placeholder for the Inbox.
 *
 * Deliberately shaped like the real rows (spine, avatar, two text lines) rather
 * than generic bars: the list does not jump when content lands, and the reader
 * can see what is coming. A centred spinner tells someone only that something is
 * happening; this tells them what.
 */
export default function InboxSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="mx-auto w-full max-w-3xl" aria-hidden>
      <div className="mb-1.5 h-3 w-16 animate-pulse rounded bg-ink/[0.06]" />
      <div className="overflow-hidden rounded-xl ring-1 ring-[#0F0F0D]/5 dark:ring-white/10">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex items-start gap-3 border-b border-[#0F0F0D]/[0.04] px-3 py-3 last:border-b-0 dark:border-white/[0.06]"
          >
            <div className="mt-1 h-4 w-4 shrink-0 animate-pulse rounded-full bg-ink/[0.06]" />
            <div className="mt-0.5 h-6 w-6 shrink-0 animate-pulse rounded-full bg-ink/[0.06]" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3 w-2/5 animate-pulse rounded bg-ink/[0.06]" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-ink/[0.05]" />
              <div className="h-2.5 w-1/4 animate-pulse rounded bg-ink/[0.04]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
