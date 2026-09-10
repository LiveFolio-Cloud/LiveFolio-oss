'use client';

import { useState } from 'react';
import { Check, Link2 } from 'lucide-react';

/** Copies the current page URL — used by the workspace page header. */
export default function CopyLinkButton({ label = 'Copy link' }: { label?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // clipboard unavailable — ignore
        }
      }}
      className="flex h-8 items-center gap-1.5 rounded-full border border-ink/15 px-3.5 text-xs font-medium text-ink/70 transition-colors hover:border-ink/30 hover:text-ink"
    >
      {copied ? <Check size={12} className="text-emerald-600" /> : <Link2 size={12} />}
      {copied ? 'Copied!' : label}
    </button>
  );
}
