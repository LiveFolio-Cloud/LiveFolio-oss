'use client';

import React, { useState, useEffect } from 'react';
import HeroAnimation from '@/components/hero/HeroAnimation';
import Link from 'next/link';
import {
  ArrowRight,
  Check,
  X,
  Copy,
  Key,
  GithubIcon as Github,
  Menu,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import ThemeToggle from '@/components/ui/theme-toggle';
import { SlackMark, DiscordMark } from './BrandIcons';

/* ------------------------------------------------------------------ */
/*  Data                                                               */
/* ------------------------------------------------------------------ */

const DISPLAY_FONT = '"Cabinet Grotesk", "Space Grotesk", sans-serif';

const STEPS = [
  { label: '01', t: 'Create', d: 'Your agent generates the HTML — Claude, GPT, Cursor, any of them.' },
  { label: '02', t: 'Publish', d: 'One call gives you a live @you page. Versioned, analytics built in.' },
  { label: '03', t: 'Discover', d: 'Opt in and your folio joins Explore — categories, tags and a license.' },
  { label: '04', t: 'Sell', d: 'Put a price on it and your page becomes a storefront. You keep the rights.' },
];

const INTEGRATIONS = [
  {
    name: 'MCP',
    badge: 'JSON-RPC 2.0',
    code: `{
  "method": "tools/call",
  "params": {
    "name": "create_project",
    "arguments": {
      "title": "Q4 Report",
      "initial_html": "<section>...</section>",
      "project_mode": "deck"
    }
  }
}`,
  },
  {
    name: 'Python',
    badge: 'pip install livefolio',
    code: `from livefolio import LiveFolio

lf = LiveFolio(api_key="lf_live_…")

folio = lf.create_folio(
    title="Q4 Report",
    initial_html=agent_output,
    project_mode="deck",
)

print(folio.url)
# → livefolio.cloud/share/q4-report`,
  },
  {
    name: 'TypeScript',
    badge: 'npm install livefolio',
    code: `import { LiveFolio } from "livefolio";

const lf = new LiveFolio({ apiKey: "lf_live_…" });

const folio = await lf.create({
  title: "Q4 Report",
  initial_html: agentOutput,
  project_mode: "deck",
});

console.log(folio.url);
// → livefolio.cloud/share/q4-report`,
  },
  {
    name: 'REST',
    badge: 'OpenAPI 3.1',
    code: `curl -X POST https://api.livefolio.cloud/files \\
  -H "Authorization: Bearer lf_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Q4 Report","initial_html":"<section>...</section>"}'

# → { "url": "livefolio.cloud/share/q4-report" }`,
  },
];

const PRICING_PLANS = [
  { name: 'Free', price: '$0', cta: 'Start Free', features: ['Unlimited publishing via MCP', 'Public sharing (watermarked)', '100 MB storage', '60 AI assistant msgs/mo', 'Explore & marketplace'] },
  { name: 'Pro', price: '$8', period: '/mo', cta: 'Get Started', highlight: true, features: ['No watermark — your brand', '1 GB storage · full history', 'Private folios & full analytics', '1,000 AI assistant msgs/mo', 'Sell on the marketplace'] },
  { name: 'Team', price: '$15', period: '/seat/mo', cta: 'Start Team', features: ['Everything in Pro', '2 GB storage per seat', 'Unlimited teammates', '1,000 AI assistant msgs/seat', 'Org analytics & priority support'] },
];

/* The one-click install path: the hero's copy-prompt button ships this
   text. The skill carries all client-specific install logic, so the prompt
   stays short — it only needs to survive being pasted into any agent. */
const HERO_PROMPT = `I'd like you to set up LiveFolio: the publishing and feedback layer for AI agents.

Install the skill if you have npm:
npx skills add LiveFolio-Cloud/livefolio-skill --skill livefolio -g

If not, connect the MCP server instead — https://livefolio.cloud/api/mcp
(setup steps: livefolio.cloud/docs/mcp-agent).

After installing, review the docs at livefolio.cloud/docs/mcp-agent and
ask me what I'd like to publish — a report, deck, dashboard, or page.
Don't install or publish anything else — this is setup only.`;

const sectionLabel = 'text-[10px] font-bold uppercase tracking-[0.16em] text-[#FF3B00]';

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function CloudLanding() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeIntegration, setActiveIntegration] = useState(0);
  const [promptCopied, setPromptCopied] = useState(false);

  const copyHeroPrompt = async () => {
    try {
      await navigator.clipboard?.writeText(HERO_PROMPT);
    } catch {
      /* clipboard unavailable — keep the card readable/selectable */
    }
    setPromptCopied(true);
    window.setTimeout(() => setPromptCopied(false), 2000);
  };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#F4F4F0] dark:bg-[#0F0F0D] text-[#0F0F0D] dark:text-[#F4F4F0] antialiased">
      <a href="#hero" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[200] focus:px-4 focus:py-2 focus:bg-[#FF3B00] focus:text-white focus:rounded-lg">Skip to content</a>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  NAV — floating, hairline, soft                                 */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <header
        className={cn(
          'sticky top-0 z-50 border-b transition-shadow',
          scrolled ? 'shadow-sm' : '',
          'border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10 bg-[#F4F4F0]/85 dark:bg-[#0F0F0D]/85 backdrop-blur-md',
        )}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <span className="inline-block h-2.5 w-2.5 bg-[#FF3B00]" />
            <span className="text-lg font-black tracking-tighter" style={{ fontFamily: DISPLAY_FONT }}>LiveFolio</span>
          </Link>
          <nav className="hidden items-center gap-7 md:flex">
            {[['Explore', '/explore'], ['Pricing', '#pricing'], ['Docs', '/docs']].map(([label, href]) => (
              <a key={label} href={href} className="text-sm font-medium text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 transition-colors hover:text-[#FF3B00]">{label}</a>
            ))}
            <a href="https://github.com/LiveFolio-Cloud/LiveFolio-oss" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 transition-colors hover:text-[#FF3B00]">
              <Github className="h-3.5 w-3.5" />OSS
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle compact />
            <Link
              href="/explore"
              className="md:hidden inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70 transition-colors hover:text-[#FF3B00]"
              aria-label="Explore folios"
            >
              <span className="inline-block h-2 w-2 bg-[#FF3B00]" aria-hidden="true" />
              Explore
            </Link>
            <div className="hidden md:flex items-center gap-2">
              <Link href="/login" className="h-9 px-4 inline-flex items-center rounded-lg text-sm font-medium text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70 hover:bg-black/5 dark:hover:bg-white/10 transition-colors">Sign In</Link>
              <Link href="/login?signup=true" className="h-9 px-4 inline-flex items-center rounded-lg bg-[#FF3B00] text-white text-sm font-semibold hover:bg-[#0F0F0D] dark:hover:bg-[#F4F4F0] dark:hover:text-[#0F0F0D] transition-colors">Get Started</Link>
            </div>
            <button onClick={() => setMobileOpen(!mobileOpen)} className="md:hidden flex h-9 w-9 items-center justify-center rounded-lg text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:bg-black/5 dark:hover:bg-white/10" aria-label={mobileOpen ? 'Close menu' : 'Open menu'}>
              {mobileOpen ? <X className="h-4 w-4" strokeWidth={2.5} /> : <Menu className="h-4 w-4" strokeWidth={2.5} />}
            </button>
          </div>
        </div>
        {mobileOpen && (
          <div className="md:hidden border-t border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10 bg-[#F4F4F0] dark:bg-[#0F0F0D]">
            {[['Documentation', '/docs'], ['Pricing', '#pricing']].map(([label, href]) => (
              <a key={label} href={href} onClick={() => setMobileOpen(false)} className="block px-6 py-3 text-sm font-medium text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70 hover:text-[#FF3B00] transition-colors">{label}</a>
            ))}
            <a href="https://github.com/LiveFolio-Cloud/LiveFolio-oss" target="_blank" rel="noopener noreferrer" onClick={() => setMobileOpen(false)} className="flex items-center gap-2 px-6 py-3 text-sm font-medium text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70 hover:text-[#FF3B00] transition-colors"><Github className="h-3.5 w-3.5" />GitHub</a>
            <div className="px-6 py-4 flex gap-3">
              <Link href="/login" onClick={() => setMobileOpen(false)} className="flex-1 h-10 inline-flex items-center justify-center rounded-lg text-sm font-medium text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70 hover:bg-black/5 dark:hover:bg-white/10 transition-colors">Sign In</Link>
              <Link href="/login?signup=true" onClick={() => setMobileOpen(false)} className="flex-1 h-10 inline-flex items-center justify-center rounded-lg bg-[#FF3B00] text-white text-sm font-semibold transition-colors">Get Started</Link>
            </div>
          </div>
        )}
      </header>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  HERO — the brand film, soft CTA row overlaid                     */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section id="hero" className="relative overflow-hidden h-[calc(100dvh-56px)] min-h-[500px]">
        <HeroAnimation />
                                      {/* Story bar — scrim rises from the film's floor so nothing overlaps
              on any viewport; content sits clear of the animation's words */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-[#0F0F0D] via-[#0F0F0D]/75 to-transparent pt-16 sm:pt-24">
            <div className="pointer-events-auto mx-auto flex w-full max-w-2xl flex-col items-center gap-3 px-4 pb-5 text-center sm:pb-7">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#FF3B00] sm:text-[11px] sm:tracking-[0.22em]">
                Publish &middot; Discover &middot; Sell
              </p>

              {/* Copy prompt — one click, pasted into any agent. No text over the film. */}
              <div className="flex flex-col items-center gap-2.5">
                <button
                  onClick={copyHeroPrompt}
                  className={cn(
                    'group inline-flex h-10 cursor-pointer items-center gap-2 rounded-full px-6 text-[13px] font-semibold transition-all duration-300 sm:h-11 sm:px-7 sm:text-sm',
                    promptCopied
                      ? 'bg-[#F4F4F0] text-[#0F0F0D]'
                      : 'bg-[#FF3B00] text-white shadow-lg shadow-[#FF3B00]/25 hover:bg-[#F4F4F0] hover:text-[#0F0F0D]',
                  )}
                  aria-label="Copy the agent setup prompt"
                >
                  {promptCopied ? (
                    <Check className="h-4 w-4" strokeWidth={2.5} />
                  ) : (
                    <Copy className="h-4 w-4" strokeWidth={2.5} />
                  )}
                  {promptCopied ? 'Copied' : 'Copy prompt'}
                </button>
                <p className="text-[12px] font-medium text-[#F4F4F0]/45">
                  Paste into Claude, Cursor, or any agent &mdash; then ask it what to publish.
                </p>
              </div>
            </div>
          </div>
</section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  HOW IT WORKS                                                    */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section id="how" className="border-b border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20 md:py-28">
          <span className={sectionLabel}>How it works</span>
          <h2 className="mt-3 max-w-3xl text-4xl md:text-5xl font-black tracking-tighter leading-[1.05]" style={{ fontFamily: DISPLAY_FONT }}>
            Publish once. <span className="text-[#FF3B00]">Get found.</span>
          </h2>
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {STEPS.map((s) => (
              <div key={s.label} className="rounded-2xl bg-white dark:bg-[#171714] ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 p-6">
                <span className="text-3xl font-black tracking-tighter text-[#0F0F0D]/10 dark:text-[#F4F4F0]/10" style={{ fontFamily: DISPLAY_FONT }}>{s.label}</span>
                <div className="mt-5 text-lg font-bold tracking-tight" style={{ fontFamily: DISPLAY_FONT }}>{s.t}</div>
                <p className="mt-1.5 text-sm leading-relaxed text-[#0F0F0D]/55 dark:text-[#F4F4F0]/55">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  INTEGRATE — dark code panel, segmented tabs                      */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section id="presence" className="border-b border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20 md:py-28">
          <span className={sectionLabel}>Your public presence</span>
          <h2 className="mt-3 max-w-3xl text-4xl md:text-5xl font-black tracking-tighter leading-[1.05]" style={{ fontFamily: DISPLAY_FONT }}>
            Your work, on your page.
          </h2>

          <div className="mt-12 grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Advantages */}
            <div>
              <p className="text-sm leading-relaxed text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50 max-w-md">
                Publish a folio and it&rsquo;s instantly part of your public profile — one link that carries your identity, your best work, your audience, and the work you sell.
              </p>
              <ul className="mt-8 space-y-6">
                <li className="flex gap-3.5">
                  <span className="mt-1.5 h-2 w-2 shrink-0 bg-[#FF3B00]" />
                  <div>
                    <div className="text-base font-bold tracking-tight" style={{ fontFamily: DISPLAY_FONT }}>Your page, your handle</div>
                    <p className="mt-1 text-sm leading-relaxed text-[#0F0F0D]/55 dark:text-[#F4F4F0]/55">
                      A public livefolio.cloud/@you page with the banner you choose, your bio, your pinned hero folio — and your followers and following, one click from the page.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3.5">
                  <span className="mt-1.5 h-2 w-2 shrink-0 bg-[#FF3B00]" />
                  <div>
                    <div className="text-base font-bold tracking-tight" style={{ fontFamily: DISPLAY_FONT }}>An audience that comes back</div>
                    <p className="mt-1 text-sm leading-relaxed text-[#0F0F0D]/55 dark:text-[#F4F4F0]/55">
                      Visitors follow you, react, and pin comments on the exact element they mean — and your follower counts open into real lists, on the page and in the studio.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3.5">
                  <span className="mt-1.5 h-2 w-2 shrink-0 bg-[#FF3B00]" />
                  <div>
                    <div className="text-base font-bold tracking-tight" style={{ fontFamily: DISPLAY_FONT }}>Found in Explore, sold when you want</div>
                    <p className="mt-1 text-sm leading-relaxed text-[#0F0F0D]/55 dark:text-[#F4F4F0]/55">
                      One toggle lists any folio on livefolio.cloud/explore with a category, tags and license — add a price and your page becomes a storefront visitors can buy from directly.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3.5">
                  <span className="mt-1.5 h-2 w-2 shrink-0 bg-[#FF3B00]" />
                  <div>
                    <div className="text-base font-bold tracking-tight" style={{ fontFamily: DISPLAY_FONT }}>Analytics that tell you what landed</div>
                    <p className="mt-1 text-sm leading-relaxed text-[#0F0F0D]/55 dark:text-[#F4F4F0]/55">
                      Per-view analytics, audience and earnings KPIs side by side: what opened, what was read, what sold.
                    </p>
                  </div>
                </li>
              </ul>
            </div>

            {/* Profile mockup — the actual link shape */}
            <div className="rounded-2xl bg-white dark:bg-[#171714] ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 shadow-lg shadow-black/[0.04] overflow-hidden">
              {/* Browser bar */}
              <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10">
                <span className="h-2 w-2 rounded-full bg-[#0F0F0D]/10 dark:bg-[#F4F4F0]/15" />
                <span className="h-2 w-2 rounded-full bg-[#0F0F0D]/10 dark:bg-[#F4F4F0]/15" />
                <span className="h-2 w-2 rounded-full bg-[#0F0F0D]/10 dark:bg-[#F4F4F0]/15" />
                <span className="ml-2 flex-1 h-6 rounded-md bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 flex items-center justify-center gap-1 text-[11px] font-medium text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50">
                  <span className="inline-block h-1.5 w-1.5 bg-[#FF3B00]" />
                  livefolio.cloud/@you
                </span>
              </div>
              {/* Banner — the real library image */}
              <div className="relative h-24 sm:h-28 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/profile-banners/banner-1.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" />
                <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-transparent to-white dark:to-[#171714]" />
              </div>
              {/* Identity — relative so it paints above the banner's
                  absolutely-positioned image (avatar overlaps it cleanly) */}
              <div className="relative px-5 pb-5">
                <div className="-mt-6 h-14 w-14 rounded-full ring-4 ring-white dark:ring-[#171714] bg-[#FF3B00]/10 text-[#FF3B00] flex items-center justify-center text-lg font-bold">
                  Y
                </div>
                <div className="mt-2.5 flex items-center gap-2">
                  <span className="text-base font-black tracking-tighter" style={{ fontFamily: DISPLAY_FONT }}>Your Name</span>
                  <span className="text-xs font-medium text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">@you</span>
                  <span className="ml-auto inline-flex h-7 items-center px-3 rounded-lg bg-[#FF3B00] text-white text-xs font-semibold">
                    Follow
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-[#0F0F0D]/55 dark:text-[#F4F4F0]/55">
                  Your bio — one line about what you build. Your followers see everything you publish here.
                </p>
                <div className="mt-2.5 text-[11px] font-medium text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">
                  1.2k followers &middot; 312 reactions &middot; 89 comments
                </div>
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-black/[0.04] dark:bg-white/10 px-2.5 py-1 text-[10px] font-semibold text-[#0F0F0D]/55 dark:text-[#F4F4F0]/55">
                  <span className="inline-block h-2 w-2 bg-[#FF3B00]" aria-hidden="true" />
                  Listed in Explore
                </div>
                {/* Folio tiles — one gated/for-sale, matching the storefront */}
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {[
                    ['bg-[#FF3B00]/10', 'Q4 Report', '$9'],
                    ['bg-[#6366F1]/10', 'Roadmap', 'Free'],
                    ['bg-emerald-500/10', 'Pitch deck', 'Free'],
                  ].map(([tone, title, tag]) => (
                    <div key={title} className="rounded-lg ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 overflow-hidden">
                      <div className={`aspect-[4/3] ${tone} flex items-center justify-center`}>
                        <span className="inline-block h-2 w-2 bg-[#FF3B00]" />
                      </div>
                      <div className="px-1.5 py-1.5">
                        <div className="text-[10px] font-semibold text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70 truncate">{title}</div>
                        <div className="text-[9px] font-medium text-[#FF3B00]">{tag}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="integrate" className="border-b border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10 bg-[#0F0F0D] dark:bg-[#171714] text-[#F4F4F0]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16 md:py-24">
          <span className={sectionLabel}>Built for agents</span>
          <h2 className="mt-3 max-w-3xl text-4xl md:text-5xl font-black tracking-tighter leading-[1.05] text-[#F4F4F0]">
            Your agent calls. Your page lives.
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-[#F4F4F0]/50">
            MCP-native, REST-native, SDKs in Python and TypeScript — your agent picks the interface, you get the live URL.
          </p>

          {/* Segmented tabs */}
          <div className="mt-10 inline-flex gap-0.5 rounded-lg bg-[#F4F4F0]/10 p-0.5">
            {INTEGRATIONS.map((item, i) => (
              <button
                key={item.name}
                onClick={() => setActiveIntegration(i)}
                className={cn(
                  'px-4 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer',
                  activeIntegration === i
                    ? 'bg-[#F4F4F0] text-[#0F0F0D]'
                    : 'text-[#F4F4F0]/60 hover:text-[#F4F4F0]',
                )}
              >
                {item.name}
              </button>
            ))}
          </div>

          {/* Code panel */}
          <div className="mt-4 overflow-hidden rounded-2xl bg-[#0A0A09] ring-1 ring-[#F4F4F0]/10">
            <div className="flex items-center justify-between border-b border-[#F4F4F0]/10 px-4 py-2.5">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[#F4F4F0]/40">
                <span className="h-1.5 w-1.5 rounded-full bg-[#FF3B00]" />
                {INTEGRATIONS[activeIntegration].badge}
              </div>
              <button onClick={() => navigator.clipboard?.writeText(INTEGRATIONS[activeIntegration].code.trim())} className="text-[#F4F4F0]/40 hover:text-[#FF3B00] transition-colors cursor-pointer" aria-label="Copy snippet">
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
            <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-relaxed text-[#F4F4F0]/85">
              <code>{INTEGRATIONS[activeIntegration].code}</code>
            </pre>
          </div>

          {/* Auth callout */}
          <div className="mt-4 rounded-2xl bg-[#FF3B00]/10 ring-1 ring-[#FF3B00]/20 p-4">
            <div className="flex items-start gap-3">
              <Key className="h-5 w-5 text-[#FF3B00] shrink-0 mt-0.5" strokeWidth={2.5} />
              <div>
                <div className="text-sm font-semibold">Agent-native auth</div>
                <p className="mt-1 text-[13px] leading-relaxed text-[#F4F4F0]/55">
                  Agents discover auth at <code className="font-mono text-[#FF3B00]">/.well-known/oauth-protected-resource</code>.{' '}
                  OAuth 2.0 + OIDC. Zero human intervention.{' '}
                  <a href="/auth.md" className="text-[#FF3B00] hover:underline">Read auth.md →</a>
                </p>
              </div>
            </div>
          </div>

          {/* Chat platforms — publish straight from the conversation */}
          <div className="mt-4 rounded-2xl bg-[#F4F4F0]/10 ring-1 ring-[#F4F4F0]/10 p-4">
            <div className="flex items-start gap-3">
              <span className="mt-1 inline-block h-4 w-4 shrink-0 bg-[#FF3B00]" />
              <div>
                <div className="text-sm font-semibold">Publish from your team&rsquo;s chat</div>
                <p className="mt-1 text-[13px] leading-relaxed text-[#F4F4F0]/55">
                  Connect Slack or Discord and your agents publish folios straight from the conversation —
                  a thread turns into a live URL. No dashboard required.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.08] ring-1 ring-white/10 text-[#F4F4F0]/85 text-xs font-medium">
                    <SlackMark className="h-3.5 w-3.5 shrink-0" />
                    Slack
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.08] ring-1 ring-white/10 text-[#F4F4F0]/85 text-xs font-medium">
                    <DiscordMark className="h-3.5 w-3.5 shrink-0" />
                    Discord
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.08] ring-1 ring-white/10 text-[#F4F4F0]/60 text-xs font-medium">
                    + MCP &middot; REST &middot; SDKs
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  PRICING                                                          */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  YOUR PUBLIC PRESENCE — profile, reactions, analytics             */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section id="pricing" className="border-b border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10 bg-[#0F0F0D] dark:bg-[#171714] text-[#F4F4F0]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20 md:py-28">
          <span className={sectionLabel}>Pricing</span>
          <h2 className="mt-3 max-w-3xl text-4xl md:text-5xl font-black tracking-tighter leading-[1.05] text-[#F4F4F0]" style={{ fontFamily: DISPLAY_FONT }}>
            Start free. Scale when ready.
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-[#F4F4F0]/50">
            No credit card required. Enterprise plans with SSO and dedicated infrastructure available.
          </p>

          <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {PRICING_PLANS.map((plan) => (
              <div key={plan.name} className={cn(
                'flex flex-col rounded-2xl p-7 ring-1 transition-all',
                plan.highlight
                  ? 'bg-[#FF3B00]/10 ring-[#FF3B00]/30 shadow-lg shadow-[#FF3B00]/10'
                  : 'bg-[#171714] dark:bg-[#0A0A09] ring-[#F4F4F0]/10',
              )}>
                {plan.highlight && <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#FF3B00] mb-3">Most popular</div>}
                <div className="text-lg font-bold tracking-tight text-[#F4F4F0]" style={{ fontFamily: DISPLAY_FONT }}>{plan.name}</div>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-4xl font-black tracking-tighter text-[#F4F4F0]" style={{ fontFamily: DISPLAY_FONT }}>{plan.price}</span>
                  {plan.period && <span className="text-xs text-[#F4F4F0]/45">{plan.period}</span>}
                </div>
                <ul className="mt-5 flex-1 space-y-2 text-[13px] text-[#F4F4F0]/70">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[#FF3B00]" strokeWidth={3} />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link href="/login?signup=true" className={cn(
                  'mt-6 h-10 inline-flex items-center justify-center rounded-lg text-sm font-semibold transition-colors',
                  plan.highlight
                    ? 'bg-[#FF3B00] text-white hover:bg-[#F4F4F0] hover:text-[#0F0F0D]'
                    : 'bg-[#F4F4F0]/10 text-[#F4F4F0]/80 hover:bg-[#F4F4F0]/15',
                )}>
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-[13px] text-[#F4F4F0]/40">
            The built-in AI assistant has message allowances on each plan — but connect your own agent (Claude, GPT, Cursor, any MCP client) and it publishes <span className="text-[#F4F4F0]/70 font-medium">unlimited folios</span> on every plan.
          </p>
          <p className="mt-2 text-center text-[13px] text-[#F4F4F0]/40">
            Need SSO or custom domains? <a href="mailto:hello@livefolio.cloud" className="text-[#FF3B00] hover:underline font-semibold">Contact us</a>
          </p>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  FINAL CTA                                                        */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="bg-[#0F0F0D] dark:bg-[#171714] text-[#F4F4F0]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-24 md:py-32">
          <h2 className="text-5xl sm:text-6xl lg:text-7xl font-black tracking-tighter leading-[0.9] text-[#F4F4F0]" style={{ fontFamily: DISPLAY_FONT }}>
            Make it.
            <br />
            Find them.
          </h2>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-[#F4F4F0]/55">
            One publish gives you a live @you page — from there it can be found in Explore and sold to the people who want it. Start free.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link href="/login?signup=true" className="group flex items-center gap-2.5 h-11 px-6 rounded-full bg-[#FF3B00] text-white text-sm font-semibold shadow-lg shadow-[#FF3B00]/25 transition-colors hover:bg-[#F4F4F0] hover:text-[#0F0F0D]">
              Start publishing
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" strokeWidth={2.5} />
            </Link>
            <Link href="/explore" className="flex items-center gap-2 h-11 px-6 rounded-full bg-[#F4F4F0]/10 text-[#F4F4F0] text-sm font-medium ring-1 ring-[#F4F4F0]/15 transition-colors hover:bg-[#F4F4F0]/15">
              <span className="inline-block h-2 w-2 bg-[#FF3B00]" aria-hidden="true" />
              Explore the gallery
            </Link>
          </div>
          <p className="mt-5 text-[13px] text-[#F4F4F0]/40">
            Free to start &middot; <a href="https://github.com/LiveFolio-Cloud/LiveFolio-oss" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#F4F4F0]/60 hover:text-[#FF3B00] transition-colors"><Github className="h-3.5 w-3.5" /> Self-host OSS</a>
          </p>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  FOOTER — light, hairline                                         */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <footer className="border-t border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-8 px-4 py-12 sm:px-6 md:grid-cols-4 lg:px-8">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 bg-[#FF3B00]" />
              <span className="text-lg font-black tracking-tighter" style={{ fontFamily: DISPLAY_FONT }}>LiveFolio</span>
            </div>
            <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50">
              The publishing layer for AI agents. MCP-native, REST-native, open source.
            </p>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">Product</div>
            <ul className="mt-3 space-y-2 text-[13px]">
              <li><Link href="/explore" className="text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:text-[#FF3B00] transition-colors">Explore folios</Link></li>
              <li><a href="#pricing" className="text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:text-[#FF3B00] transition-colors">Pricing</a></li>
              <li><Link href="/docs" className="text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:text-[#FF3B00] transition-colors">Documentation</Link></li>
              <li><a href="#integrate" className="text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:text-[#FF3B00] transition-colors">For agents</a></li>
            </ul>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">Developers</div>
            <ul className="mt-3 space-y-2 text-[13px]">
              <li><Link href="/docs/mcp-agent" className="text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:text-[#FF3B00] transition-colors">MCP Guide</Link></li>
              <li><Link href="/docs/api-reference" className="text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:text-[#FF3B00] transition-colors">API Reference</Link></li>
              <li><a href="/auth.md" className="text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:text-[#FF3B00] transition-colors">auth.md</a></li>
              <li><a href="https://github.com/LiveFolio-Cloud/LiveFolio-oss" target="_blank" rel="noopener noreferrer" className="text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:text-[#FF3B00] transition-colors inline-flex items-center gap-1.5"><Github className="h-3.5 w-3.5" />GitHub</a></li>
            </ul>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">Legal</div>
            <ul className="mt-3 space-y-2 text-[13px]">
              <li><Link href="/tos" className="text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:text-[#FF3B00] transition-colors">Terms of Service</Link></li>
              <li><Link href="/privacy" className="text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:text-[#FF3B00] transition-colors">Privacy Policy</Link></li>
            </ul>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8 border-t border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10">
          <span className="text-[11px] font-medium text-[#0F0F0D]/35 dark:text-[#F4F4F0]/35">
            &copy; {new Date().getFullYear()} LiveFolio &middot; Links, not files.
          </span>
        </div>
      </footer>
    </div>
  );
}
