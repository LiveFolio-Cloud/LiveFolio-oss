'use client';

/**
 * OSS stub for app/landing/CloudLanding.tsx.
 *
 * The Cloud landing is the hosted product's marketing page. Its pricing
 * section carries the full commercial table — plan names, per-month and
 * per-seat prices, storage allowances and AI message quotas — none of which
 * may be published in the OSS tree.
 *
 * The pricing table is gone; the page is NOT. `LandingSwitch.tsx` picks
 * between this and `OSSLanding` on the build-time `isOSS` constant
 * (`dynamic(() => import('./CloudLanding'))`, top-level, so the module must
 * exist and default-export a component either way). Under OSS the switch
 * selects `OSSLanding` — this file is the safety net for the other branch, and
 * it deliberately renders an honest, self-hosted pitch rather than `null`, so
 * a misdetected mode degrades to a truthful page instead of a blank one.
 *
 * Nothing here states a price, a plan, a tier, a quota or an allowance.
 */

import Link from 'next/link';

export default function CloudLanding() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#F4F4F0] px-6 text-center dark:bg-[#0F0F0D]">
      <div className="max-w-xl">
        <div className="flex items-center justify-center gap-2">
          <span className="inline-block h-2.5 w-2.5 bg-[#FF3B00]" />
          <span className="text-lg font-black tracking-tighter text-[#0F0F0D] dark:text-[#F4F4F0]">
            LiveFolio
          </span>
        </div>

        <h1 className="mt-6 text-4xl font-black tracking-tighter text-[#0F0F0D] dark:text-[#F4F4F0] sm:text-5xl">
          Self-hosted. Yours.
        </h1>

        <p className="mt-4 text-sm leading-relaxed text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60">
          This instance runs the open-source core: publish, version and collect feedback on
          AI-generated HTML documents, on your own machine, with your own storage and no account.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/app"
            className="inline-flex h-11 items-center rounded-full bg-[#FF3B00] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#0F0F0D]"
          >
            Open the app
          </Link>
          <a
            href="https://github.com/LiveFolio-Cloud/LiveFolio-oss"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center rounded-full bg-black/5 px-6 text-sm font-medium text-[#0F0F0D] ring-1 ring-black/10 transition-colors hover:bg-black/10 dark:bg-white/10 dark:text-[#F4F4F0] dark:ring-white/15"
          >
            View the source
          </a>
        </div>
      </div>
    </div>
  );
}
