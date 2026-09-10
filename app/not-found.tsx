'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isOSS } from '@/lib/env';

/**
 * Custom 404 — quiet dead end with a soft landing. Cloud: wrong profile or
 * folio URLs (broken @username links, moved folios) carry visitors to
 * /explore. OSS: no explore surface exists, so dead ends fall back home.
 */
const REDIRECT_AFTER_SECONDS = 5;

// Mode-aware landing target — isOSS is inlined at build time, so the cloud
// build keeps the Explore detour while OSS 404s never point at /explore
// (excluded from the OSS sync — it would bounce straight back here).
const FALLBACK_PATH = isOSS ? '/' : '/explore';
const FALLBACK_LABEL = isOSS ? 'Back to your dashboard' : 'Explore folios';
const FALLBACK_BLURB = isOSS
  ? 'That page doesn&apos;t exist — it may have moved. Your folios are one click away.'
  : 'The profile or link you followed doesn&apos;t exist — it may have moved. Folios worth exploring are one click away.';

export default function NotFound() {
  const router = useRouter();
  const [seconds, setSeconds] = useState(REDIRECT_AFTER_SECONDS);

  // Tick the countdown down…
  useEffect(() => {
    const t = setInterval(() => {
      setSeconds((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // …and navigate only when it hits zero (never inside a state updater —
  // calling router.replace there updates Router during this render).
  useEffect(() => {
    if (seconds === 0) router.replace(FALLBACK_PATH);
  }, [seconds, router]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-[#F4F4F0] px-6 dark:bg-[#0F0F0D]">
      {/* The mark — orange square, alone */}
      <span className="inline-block h-5 w-5 bg-[#FF3B00]" aria-hidden="true" />

      <div className="text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">
          404
        </p>
        <h1
          className="mt-3 text-3xl font-black tracking-tighter text-[#0F0F0D] dark:text-[#F4F4F0] md:text-4xl"
          style={{ fontFamily: '"Cabinet Grotesk", "Space Grotesk", sans-serif' }}
        >
          This page wandered off.
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50">
          {FALLBACK_BLURB}
        </p>
      </div>

      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={() => router.replace(FALLBACK_PATH)}
          className="inline-flex items-center gap-2 rounded-full bg-[#FF3B00] px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0F0F0D] dark:hover:bg-[#F4F4F0] dark:hover:text-[#0F0F0D]"
        >
          {FALLBACK_LABEL}
        </button>
        <p className="text-[11px] font-medium text-[#0F0F0D]/35 dark:text-[#F4F4F0]/35">
          {seconds > 0 ? `Taking you there in ${seconds}…` : 'Taking you there…'}
        </p>
      </div>
    </main>
  );
}
