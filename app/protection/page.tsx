import type { Metadata } from 'next';
import Link from 'next/link';
import { isOSS } from '@/lib/env';

const DISPLAY_FONT = '"Cabinet Grotesk", "Space Grotesk", sans-serif';

export const metadata: Metadata = {
  title: 'Content Protection — LiveFolio',
  description:
    'How LiveFolio protects creators: watermarking, buyer tracing, takedown reporting and the honest limits of protecting content on the open web.',
};

/**
 * /protection — the public trust page (footer → Content Protection).
 *
 * States what the platform actually does when content is copied: the
 * watermark policy, what is traceable back to a buyer, how takedown
 * reports are handled — and what is NOT promised (no DRM magic on the
 * open web). A community trusts documented process, not marketing claims.
 */
export default function ProtectionPage() {
  return (
    <div className="lf-tokens public-light min-h-screen bg-[#F4F4F0] text-[#0F0F0D] antialiased">
      <header className="sticky top-0 z-40 border-b border-[#0F0F0D]/5 bg-[#F4F4F0]/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5" aria-label="LiveFolio home">
            <span className="flex h-5 w-5 items-center justify-center">
              <span className="block h-3 w-3 bg-[#FF3B00]" />
            </span>
            <span
              className="text-[17px] font-black tracking-tighter text-[#0F0F0D]"
              style={{ fontFamily: DISPLAY_FONT }}
            >
              LiveFolio
            </span>
          </Link>
          <div className="flex items-center gap-5 text-[13px] font-medium text-[#0F0F0D]/50">
            <Link href="/tos" className="transition-colors hover:text-[#0F0F0D]">
              Terms
            </Link>
            <Link href="/privacy" className="transition-colors hover:text-[#0F0F0D]">
              Privacy
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-24 pt-12 sm:px-6 sm:pt-16">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#FF3B00]">
          Creators first
        </p>
        <h1
          className="mt-4 font-black tracking-tighter text-[40px] leading-[0.98] text-[#0F0F0D] md:text-[56px]"
          style={{ fontFamily: DISPLAY_FONT }}
        >
          How we protect
          <br />
          your work<span className="text-[#FF3B00]">.</span>
        </h1>
        <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-[#0F0F0D]/60">
          A folio is a living document — its value is the live, versioned, interactive original,
          not a frozen snapshot. That&apos;s the foundation of our protection story, and
          everything below builds on it.
        </p>

        <div className="mt-12 space-y-12">
          <section>
            <h2 className="text-xl font-bold tracking-tight">The honest limit first</h2>
            <p className="mt-3 text-sm leading-relaxed text-[#0F0F0D]/65">
              Anything that renders in a browser can be copied — Ctrl&#8209;S, view-source,
              screenshots, a camera. No DRM on the open web changes that, and we will never
              pretend otherwise. What LiveFolio actually does is layer deterrence, attribution,
              traceability and takedown enforcement on top, so copying has a cost and a trail —
              while your live folio keeps its versions, feedback loop and AI features that no
              snapshot can replicate.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold tracking-tight">Attribution (free folios)</h2>
            <p className="mt-3 text-sm leading-relaxed text-[#0F0F0D]/65">
              Public folios from free workspaces carry a small &ldquo;Made with LiveFolio&rdquo;
              watermark on shared pages. It is branding and attribution — it is not protection.
              {!isOSS && (
                <>
                  {' '}
                  Creators on paid plans publish watermark-free; the watermark never appears in
                  Studio previews.
                </>
              )}
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold tracking-tight">Gate &amp; source protection (paid folios)</h2>
            <p className="mt-3 text-sm leading-relaxed text-[#0F0F0D]/65">
              Sellers choose who sees their folio and how. Paid content can be hard-paywalled
              (nothing before purchase) or previewed on a timer or first page. Sellers can
              additionally enable <strong>source protection</strong>: the page then loads through
              a short-lived token, so save-as and view-source yield an empty shell, and copy
              friction (selection, context menu, save keys) raises the bar for casual copiers.
              Studio previews and the seller&apos;s own team always receive full source.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold tracking-tight">Buyer tracing (copies)</h2>
            <p className="mt-3 text-sm leading-relaxed text-[#0F0F0D]/65">
              Every page a buyer receives — live views, duplicated copies and ZIP downloads — is
              stamped with an invisible, per-buyer marker. If a copy leaks onto a website,
              GitHub or an AI agent&apos;s output, the seller can run a trace on it from the
              studio and learn who bought it, when, and through which channel. Leaking has a
              personal cost and an audit trail.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold tracking-tight">Takedown &amp; reports</h2>
            <p className="mt-3 text-sm leading-relaxed text-[#0F0F0D]/65">
              Every folio carries a Report button. Signed-in viewers file abuse, spam and
              copyright reports in-app; guests file by email to{' '}
              <a href="mailto:legal@livefolio.cloud" className="font-semibold text-[#FF3B00] hover:underline">
                legal@livefolio.cloud
              </a>{' '}
              — a legal trail for rights claims. The moderation team reviews the queue and can
              take a folio or account down platform-wide. Reporting never auto-takedowns, and
              creators are never notified of reports against them.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold tracking-tight">What we don&apos;t do</h2>
            <p className="mt-3 text-sm leading-relaxed text-[#0F0F0D]/65">
              We don&apos;t block developer tools, we don&apos;t claim unbreakable encryption of
              published pages, and we don&apos;t chase every screenshot. Protection that breaks
              the legitimate experience — your own users, your agents, accessibility — costs
              more than it saves. If you need that level of secrecy, keep the folio private and
              share it only with people you trust.
            </p>
          </section>
        </div>

        <div className="mt-16 flex flex-col items-start justify-between gap-4 rounded-2xl bg-white p-6 ring-1 ring-black/5 sm:flex-row sm:items-center">
          <div>
            <p className="text-[15px] font-bold tracking-tight">Still have questions?</p>
            <p className="mt-1 text-[13px] text-[#0F0F0D]/55">
              Write to us — we answer creators personally.
            </p>
          </div>
          <a
            href="mailto:legal@livefolio.cloud"
            className="inline-flex h-9 items-center rounded-full bg-[#0F0F0D] px-5 text-[13px] font-semibold text-white transition-opacity hover:opacity-85"
          >
            legal@livefolio.cloud
          </a>
        </div>
      </main>

      <footer className="border-t border-[#0F0F0D]/5">
        <div className="mx-auto flex max-w-3xl flex-col items-center justify-between gap-3 px-4 py-8 text-[11px] font-medium text-[#0F0F0D]/35 sm:flex-row sm:px-6">
          <Link href="/" className="flex items-center gap-1.5 transition-colors hover:text-[#0F0F0D]">
            <span className="inline-block h-2 w-2 bg-[#FF3B00]" />
            LiveFolio · Content Protection
          </Link>
          <p>Made by people — published with AI.</p>
        </div>
      </footer>
    </div>
  );
}
