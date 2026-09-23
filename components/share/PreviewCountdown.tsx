'use client';

import React, { useEffect, useRef, useState } from 'react';

interface PreviewCountdownProps {
  seconds: number;
  accent?: string | null;
  onExpire: () => void;
}

/**
 * Timed-preview overlay: a bottom pill with a live countdown. Fires
 * `onExpire` at zero so the parent can swap in the paywall.
 *
 * Marketing-grade by design — the raw route's signed preview cookie is the
 * real enforcement; this overlay is the in-page UX around it.
 */
export default function PreviewCountdown({ seconds, accent, onExpire }: PreviewCountdownProps) {
  const [remaining, setRemaining] = useState(seconds);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    setRemaining(seconds);
    const timer = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(timer);
          onExpireRef.current();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [seconds]);

  const safe = Math.max(0, remaining);
  const mm = Math.floor(safe / 60);
  const ss = String(safe % 60).padStart(2, '0');

  return (
    <div
      style={{ '--lf-accent': accent || '#FF3B00' } as React.CSSProperties}
      className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2 select-none"
    >
      <div className="flex items-center gap-3 rounded-full bg-[#0F0F0D]/90 px-4 py-2.5 text-[#F4F4F0] shadow-lg ring-1 ring-white/10 backdrop-blur-md">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#F4F4F0]/70">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--lf-accent)]" />
          Preview
        </span>
        <span className="text-sm font-bold tabular-nums text-[var(--lf-accent)]">
          {mm}:{ss}
        </span>
      </div>
    </div>
  );
}
