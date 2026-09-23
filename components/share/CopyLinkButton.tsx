'use client';

import { Check, Link2 } from 'lucide-react';
import { useCopyToClipboard } from '@/lib/use-copy-to-clipboard';

/** Copies the current page URL — used by the workspace page header. */
export default function CopyLinkButton({ label = 'Copy link' }: { label?: string }) {
  // 1500ms dwell — shorter than ShareProfileButton's 2000ms on purpose.
  const { copied, copy } = useCopyToClipboard(1500);

  return (
    <button
      type="button"
      onClick={() => copy(window.location.href)}
      className="flex h-8 items-center gap-1.5 rounded-full border border-ink/15 px-3.5 text-xs font-medium text-ink/70 transition-colors hover:border-ink/30 hover:text-ink"
    >
      {copied ? <Check size={12} className="text-emerald-600" /> : <Link2 size={12} />}
      {copied ? 'Copied!' : label}
    </button>
  );
}
