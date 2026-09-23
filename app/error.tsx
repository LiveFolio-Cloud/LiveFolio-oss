'use client';

/**
 * Root route error boundary.
 *
 * Before this file existed there was no `error.tsx` anywhere in `app/`, so any
 * unhandled throw in a route segment bubbled past React to Next's built-in
 * `_global-error` page — which renders its own bare document with none of the
 * app's branding. This boundary catches those throws one level earlier and
 * shows an on-brand recovery surface instead.
 *
 * Scope: `error.tsx` wraps `loading.tsx`, `not-found.tsx`, `page.tsx` and
 * nested layouts in the same segment — but NOT the `app/layout.tsx` above it.
 * A throw inside the root layout itself still falls through to
 * `global-error`; that is intentional, since a boundary cannot render the
 * layout that is failing to render.
 *
 * `retry` (not `reset`) is the current prop: Next 16.3.0 made it stable —
 * see node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md
 * ("v16.3.0 `retry` prop became stable") and the installed implementation at
 * node_modules/next/dist/client/components/error-boundary.js:113-114, which
 * passes both. `retry()` re-fetches and re-renders the segment, which is the
 * recovery the docs recommend over the state-clearing `reset()`.
 */

import { useEffect } from 'react';
import { cn } from '@/lib/utils';
import { FONT_DISPLAY } from '@/lib/fonts';

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // Surface the failure in the console for whoever is debugging. The digest
    // is the same identifier Next logs server-side for a Server Component
    // throw, so it is the one value worth keeping visible.
    console.error('[app/error]', error);
  }, [error]);

  return (
    <div
      className={cn(
        'min-h-screen w-full flex flex-col items-center justify-center antialiased gap-6 px-6',
        'bg-[#F4F4F0] dark:bg-[#0F0F0D] text-[#0F0F0D] dark:text-[#F4F4F0]'
      )}
      role="alert"
    >
      {/* `lf-square-pulse` / `.animate-lf-square-pulse` are defined once in
          app/globals.css; this boundary renders inside the root layout, so the
          stylesheet is already loaded. */}

      {/* Same brand primitive the loading screens use — the orange square. */}
      <div className="flex items-center gap-2.5">
        <span className="inline-block h-4 w-4 bg-[#FF3B00] animate-lf-square-pulse" />
        <span
          className="text-xl tracking-tighter font-black"
          style={{ fontFamily: FONT_DISPLAY }}
        >
          LiveFolio
        </span>
      </div>

      <div className="text-center max-w-md space-y-3">
        <h1
          className="text-2xl font-black tracking-tighter"
          style={{ fontFamily: FONT_DISPLAY }}
        >
          Something went wrong
        </h1>
        <p className="text-sm leading-relaxed text-[#0F0F0D]/55 dark:text-[#F4F4F0]/55">
          This page failed to load. Trying again usually fixes it.
        </p>
        {error.digest ? (
          <p className="text-[11px] font-medium tracking-tight text-[#0F0F0D]/35 dark:text-[#F4F4F0]/35">
            Reference: {error.digest}
          </p>
        ) : null}
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => retry()}
          className={cn(
            'h-11 px-6 rounded-lg text-sm font-bold',
            'bg-[#FF3B00] text-white',
            'hover:bg-[#FF3B00]/90 transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF3B00] focus-visible:ring-offset-2',
            'focus-visible:ring-offset-[#F4F4F0] dark:focus-visible:ring-offset-[#0F0F0D]'
          )}
        >
          Try again
        </button>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a hard
            navigation is wanted here: the client router is the layer that just
            failed, so a full document load is the reliable escape hatch. */}
        <a
          href="/"
          className={cn(
            'h-11 px-6 rounded-lg text-sm font-bold inline-flex items-center',
            'ring-1 ring-[#0F0F0D]/10 dark:ring-[#F4F4F0]/15',
            'hover:bg-[#0F0F0D]/5 dark:hover:bg-[#F4F4F0]/5 transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF3B00]'
          )}
        >
          Go home
        </a>
      </div>
    </div>
  );
}
