'use client';

import React from 'react';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface UnlockOverlayProps {
  /** Pre-formatted price, e.g. "One-time $12" (from lib/gating/paywall-html priceLabel). */
  priceLabel: string;
  accent?: string | null;
  onUnlock: () => void;
}

/**
 * First-page preview CTA: pinned bottom banner with the real unlock button.
 *
 * The folio iframe is sandboxed with an opaque origin and only
 * user-activation top-navigation, so the actionable CTA lives in the PARENT
 * viewer — the banner the raw route injects into the iframe is decoration
 * only (aria-hidden). `onUnlock` swaps the viewer to the paywall.
 */
export default function UnlockOverlay({ priceLabel, accent, onUnlock }: UnlockOverlayProps) {
  return (
    <div style={{ '--lf-accent': accent || '#FF3B00' } as React.CSSProperties} className="fixed bottom-0 left-0 right-0 z-30">
      <div className="flex flex-col items-center justify-center gap-2.5 border-t border-white/10 bg-[#0F0F0D]/90 px-4 py-3.5 text-center backdrop-blur-md sm:flex-row sm:gap-4">
        <span className="flex items-center gap-2 text-xs font-semibold text-[#F4F4F0] sm:text-[13px]">
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--lf-accent)] text-white">
            <Lock size={10} strokeWidth={2.5} />
          </span>
          <span>
            Unlock the full folio — <span className="font-bold text-[var(--lf-accent)]">{priceLabel}</span>
          </span>
        </span>
        <Button
          onClick={onUnlock}
          className="h-9 shrink-0 rounded-full bg-[var(--lf-accent)] px-5 text-xs font-semibold text-white hover:bg-[#0F0F0D]:bg-[#F4F4F0]:text-[#0F0F0D] transition-colors cursor-pointer"
        >
          Unlock
        </Button>
      </div>
    </div>
  );
}
