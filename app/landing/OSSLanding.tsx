'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import {
  Terminal,
  GithubIcon as Github,
  ArrowRight,
  Cpu,
  Layers,
  Globe,
  Package,
  Download,
  Copy,
  Check,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import ThemeToggle from '@/components/ui/theme-toggle';

/* ------------------------------------------------------------------ */
/*  Design tokens (v2)                                                */
/* ------------------------------------------------------------------ */

const DISPLAY_FONT = '"Cabinet Grotesk", "Space Grotesk", sans-serif';
const sectionLabel = 'text-[10px] font-bold uppercase tracking-[0.16em] text-[#FF3B00]';

/* ------------------------------------------------------------------ */
/*  Reveal — framer-motion scroll reveal                               */
/* ------------------------------------------------------------------ */

function Reveal({
  children,
  className = '',
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  CopyButton — copy-to-clipboard for code panels                     */
/* ------------------------------------------------------------------ */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={copy}
      className="text-[#F4F4F0]/40 hover:text-[#FF3B00] transition-colors cursor-pointer"
      aria-label="Copy to clipboard"
    >
      {copied ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : <Copy className="h-3.5 w-3.5" strokeWidth={2.5} />}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Data                                                               */
/* ------------------------------------------------------------------ */

const INCLUDED = [
  {
    icon: Cpu,
    title: 'MCP Server',
    body: 'Full JSON-RPC 2.0 MCP server at /api/mcp. list_projects, create_project, update_project, get_curated_brief, and more.',
  },
  {
    icon: Layers,
    title: 'Version History',
    body: 'Every publish creates a named checkpoint. Diff, rollback, or branch any folio. Full snapshot history.',
  },
  {
    icon: Globe,
    title: 'Cloudflare Tunnels',
    body: 'Share your local folios publicly via built-in Cloudflare Quick Tunnels. No deployment needed.',
  },
  {
    icon: Terminal,
    title: 'CLI Tooling',
    body: 'Push changes via the livefolio CLI. Authenticate with API tokens. Script your publishing workflow.',
  },
  {
    icon: Package,
    title: 'Flat-File Database',
    body: 'Single database.json file. No Postgres, no Docker, no cloud services. Back up by copying a file.',
  },
  {
    icon: Download,
    title: 'Zero Telemetry',
    body: 'No analytics, no tracking, no phone-home. Your data stays on your machine. Audit every line.',
  },
];

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function OSSLanding() {
  const [scrolled, setScrolled] = useState(false);
  // Resolve the runtime port after mount to avoid an SSR/client hydration
  // mismatch (server has no window; the port only exists client-side).
  // Default 3001 matches the package.json dev script (`next dev -p 3001`)
  // and the standalone release default.
  const [port, setPort] = useState('3001');
  const mcpConfig = `{
  "mcpServers": {
    "livefolio": {
      "url": "http://localhost:${port}/api/mcp"
    }
  }
}`;
  const reduce = useReducedMotion();
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    if (window.location.port) setPort(window.location.port);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#F4F4F0] dark:bg-[#0F0F0D] text-[#0F0F0D] dark:text-[#F4F4F0] antialiased">
      <a href="#top" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[200] focus:px-4 focus:py-2 focus:bg-[#FF3B00] focus:text-white focus:rounded-lg">Skip to content</a>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  NAV — sticky, hairline, soft                                    */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <header
        className={cn(
          'sticky top-0 z-50 border-b transition-shadow',
          scrolled ? 'shadow-sm' : '',
          'border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10 bg-[#F4F4F0]/85 dark:bg-[#0F0F0D]/85 backdrop-blur-md',
        )}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          {/* Logo — vermillion square + OSS marker */}
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <span className="inline-block h-2.5 w-2.5 bg-[#FF3B00]" />
            <span className="text-lg font-black tracking-tighter" style={{ fontFamily: DISPLAY_FONT }}>LiveFolio</span>
            <span className="ml-1 rounded-md bg-[#FF3B00]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#FF3B00]">OSS</span>
          </Link>

          {/* Nav links */}
          <nav className="hidden items-center gap-7 md:flex">
            {[
              ['Included', '#included'],
              ['Quickstart', '#quickstart'],
              ['Connect', '#connect'],
              ['Cloud', '#upgrade'],
            ].map(([label, href]) => (
              <a
                key={href}
                href={href}
                className="text-sm font-medium text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 transition-colors hover:text-[#FF3B00]"
              >
                {label}
              </a>
            ))}
          </nav>

          {/* CTAs */}
          <div className="flex items-center gap-2">
            <ThemeToggle compact />
            <a
              href="https://github.com/LiveFolio-Cloud/LiveFolio-oss"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70 hover:bg-[#0F0F0D]/10 dark:hover:bg-[#F4F4F0]/15 text-sm font-medium transition-colors"
            >
              <Github className="h-3.5 w-3.5" strokeWidth={2.5} />
              <span className="hidden sm:inline">GitHub</span>
            </a>
            <Link
              href="/app"
              className="group inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-[#FF3B00] text-white text-sm font-semibold hover:bg-[#0F0F0D] dark:hover:bg-[#F4F4F0] dark:hover:text-[#0F0F0D] transition-colors"
            >
              Launch Dashboard
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={2.5} />
            </Link>
          </div>
        </div>
      </header>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  HERO — copy left, terminal card right                           */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section id="top" className="border-b border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-0 px-4 sm:px-6 lg:grid-cols-12 lg:px-8">
          {/* Left: text */}
          <div className="col-span-1 border-[#0F0F0D]/5 py-16 pr-0 dark:border-[#F4F4F0]/10 lg:col-span-7 lg:border-r lg:py-24 lg:pr-12">
            <Reveal>
              <div className="mb-8 flex items-center gap-3">
                <span className="inline-block h-2 w-2 animate-pulse bg-[#FF3B00]" />
                <span className={sectionLabel}>OPEN SOURCE CORE · LOCAL-FIRST</span>
              </div>
            </Reveal>

            <Reveal delay={0.1}>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tighter leading-[0.95]" style={{ fontFamily: DISPLAY_FONT }}>
                The sharing layer
                <br />
                for AI HTML.
                <br />
                <span className="text-[#FF3B00]">Free. Local. Yours.</span>
              </h1>
            </Reveal>

            <Reveal delay={0.2}>
              <p className="mt-6 max-w-xl text-sm leading-relaxed text-[#0F0F0D]/55 dark:text-[#F4F4F0]/55">
                LiveFolio OSS hosts, versions, and collects feedback on AI-generated HTML pages.
                Runs entirely on your machine with a flat-file database.{' '}
                <span className="font-semibold">
                  Zero telemetry, zero cloud dependencies.
                </span>{' '}
                Connect any AI agent via the built-in MCP server.
              </p>
            </Reveal>

            <Reveal delay={0.3}>
              <div className="mt-10 flex flex-wrap items-center gap-3">
                <Link
                  href="/app"
                  className="group flex items-center gap-2 h-11 px-6 rounded-full bg-[#FF3B00] text-white text-sm font-semibold shadow-lg shadow-[#FF3B00]/25 transition-all hover:bg-[#0F0F0D] dark:hover:bg-[#F4F4F0] dark:hover:text-[#0F0F0D]"
                >
                  Launch Dashboard
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" strokeWidth={2.5} />
                </Link>
                <a
                  href="https://github.com/LiveFolio-Cloud/LiveFolio-oss"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 h-11 px-6 rounded-full bg-white/90 dark:bg-[#171714]/90 backdrop-blur-sm text-sm font-medium text-[#0F0F0D] dark:text-[#F4F4F0] ring-1 ring-black/5 dark:ring-white/10 hover:bg-white dark:hover:bg-[#171714] transition-colors"
                >
                  <Github className="h-4 w-4" strokeWidth={2.5} />
                  Star on GitHub
                </a>
              </div>
            </Reveal>

            {/* Stat bar */}
            <Reveal delay={0.4}>
              <div className="mt-14 grid grid-cols-3 border-t border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10">
                {[
                  { k: '0', v: 'Telemetry events' },
                  { k: '1 file', v: 'database.json' },
                  { k: 'AGPL-3.0', v: 'Open-source license' },
                ].map((s) => (
                  <div key={s.v} className="border-r border-[#0F0F0D]/5 py-4 pr-4 last:border-r-0 dark:border-[#F4F4F0]/10">
                    <div className="text-3xl font-black tracking-tighter" style={{ fontFamily: DISPLAY_FONT }}>{s.k}</div>
                    <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">{s.v}</div>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>

          {/* Right: terminal quick-start card */}
          <div className="col-span-1 py-10 lg:col-span-5 lg:py-24 lg:pl-12">
            <Reveal delay={0.2}>
              <div className="overflow-hidden rounded-2xl bg-[#0A0A09] ring-1 ring-[#F4F4F0]/10 text-[#F4F4F0]">
                {/* Terminal chrome */}
                <div className="flex items-center justify-between border-b border-[#F4F4F0]/10 px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#FF3B00]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#F4F4F0]/30" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#F4F4F0]/30" />
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#F4F4F0]/40">oss-local</span>
                </div>

                {/* Terminal body */}
                <div className="space-y-3 p-5 font-mono text-[13px] leading-relaxed">
                  <div>
                    <span className="text-[#FF3B00]">$</span>{' '}
                    <span className="text-[#F4F4F0]">git clone https://github.com/LiveFolio-Cloud/LiveFolio-oss</span>
                  </div>
                  <div className="text-[#F4F4F0]/50">
                    Cloning into &apos;LiveFolio&apos;... done.
                  </div>
                  <div>
                    <span className="text-[#FF3B00]">$</span>{' '}
                    <span className="text-[#F4F4F0]">cd LiveFolio &amp;&amp; npm install &amp;&amp; npm run dev</span>
                  </div>
                  <div className="text-[#F4F4F0]/50">
                    LiveFolio OSS ready on http://localhost:{port}
                  </div>
                  <div className="text-[#F4F4F0]/50">
                    MCP server listening on http://localhost:{port}/api/mcp
                  </div>
                  <div className="flex items-center gap-2 border-t border-[#F4F4F0]/10 pt-3 text-[#F4F4F0]/70">
                    <span className="h-1.5 w-1.5 bg-[#FF3B00] animate-pulse" />
                    <span>Ready. Connect any MCP-compatible AI agent.</span>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  MARQUEE — dark band                                             */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="overflow-hidden border-b border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10 bg-[#0F0F0D] dark:bg-[#171714] py-6 text-[#F4F4F0]">
        <div
          className="whitespace-nowrap text-2xl md:text-3xl font-black tracking-tighter"
          style={{
            fontFamily: DISPLAY_FONT,
            display: 'flex',
            animation: reduce ? 'none' : 'lf-marquee 60s linear infinite',
            willChange: 'transform',
          }}
        >
          {Array.from({ length: 16 }, (_, i) => (
            <span key={i} className="mx-6 inline-flex items-center gap-6">
              Local-first — Open source — Self-hosted — Zero telemetry — MCP-native
              <span className="inline-block h-2 w-2 rounded-full bg-[#FF3B00]" />
            </span>
          ))}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  WHAT YOU GET / INCLUDED                                         */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section id="included" className="border-b border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20 md:py-28">
          <Reveal>
            <span className={sectionLabel}>§ 01 — WHAT&rsquo;S INCLUDED</span>
            <h2 className="mt-3 max-w-3xl text-4xl md:text-5xl font-black tracking-tighter leading-[1.05]" style={{ fontFamily: DISPLAY_FONT }}>
              Everything included. Nothing hidden.
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50">
              The OSS core ships with the full MCP server, versioning engine, and annotation
              system. No feature gates. Audit every line.
            </p>
          </Reveal>

          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {INCLUDED.map((item, i) => {
              const Icon = item.icon;
              return (
                <Reveal key={item.title} delay={(i % 3) * 0.06}>
                  <div className="h-full rounded-2xl bg-white dark:bg-[#171714] ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 p-6 md:p-7">
                    <Icon className="h-6 w-6 text-[#FF3B00]" strokeWidth={2.5} />
                    <div className="mt-4 text-lg font-bold tracking-tight" style={{ fontFamily: DISPLAY_FONT }}>{item.title}</div>
                    <p className="mt-1.5 text-sm leading-relaxed text-[#0F0F0D]/55 dark:text-[#F4F4F0]/55">
                      {item.body}
                    </p>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  QUICKSTART                                                      */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section id="quickstart" className="border-b border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10">
        <div className="mx-auto grid max-w-7xl grid-cols-1 px-4 sm:px-6 lg:grid-cols-12 lg:px-8">
          <div className="col-span-1 border-[#0F0F0D]/5 py-20 dark:border-[#F4F4F0]/10 lg:col-span-5 lg:border-r lg:py-24 lg:pr-12">
            <Reveal>
              <span className={sectionLabel}>§ 02 — QUICKSTART</span>
              <h2 className="mt-3 text-4xl md:text-5xl font-black tracking-tighter leading-[1.05]" style={{ fontFamily: DISPLAY_FONT }}>
                Clone. Install.{' '}
                <span className="text-[#FF3B00]">Publish.</span>
              </h2>
              <p className="mt-6 max-w-md text-sm leading-relaxed text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50">
                No Postgres. No Docker. No cloud account. One clone and an{' '}
                <code className="font-mono text-[#0F0F0D] dark:text-[#F4F4F0]">npm install</code> away from a running MCP server on
                your own machine.
              </p>
              <div className="mt-10 inline-flex items-center rounded-lg bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70">
                Runs on localhost:{port}
              </div>
            </Reveal>
          </div>

          <div className="col-span-1 py-10 lg:col-span-7 lg:py-24 lg:pl-12">
            <Reveal delay={0.1}>
              <div className="overflow-hidden rounded-2xl bg-[#0A0A09] ring-1 ring-[#F4F4F0]/10">
                <div className="flex items-center justify-between border-b border-[#F4F4F0]/10 px-4 py-2.5">
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[#F4F4F0]/40">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#FF3B00]" />
                    install.sh
                  </div>
                  <CopyButton text="git clone https://github.com/LiveFolio-Cloud/LiveFolio-oss && cd LiveFolio && npm install && npm run dev" />
                </div>
                <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-relaxed text-[#F4F4F0]/85">
                  <code>
                    <span className="text-[#FF3B00]"># 1. clone the repo</span>
                    {'\n'}git clone https://github.com/LiveFolio-Cloud/LiveFolio-oss
                    {'\n\n'}
                    <span className="text-[#FF3B00]"># 2. install deps</span>
                    {'\n'}cd LiveFolio &amp;&amp; npm install
                    {'\n\n'}
                    <span className="text-[#FF3B00]"># 3. run — flat-file DB, no config</span>
                    {'\n'}npm run dev
                    {'\n\n'}
                    <span className="text-[#F4F4F0]/50">
                      # → dashboard  http://localhost:{port}
                      {'\n'}# → mcp       http://localhost:{port}/api/mcp
                    </span>
                  </code>
                </pre>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  CONNECT YOUR AGENT (MCP)                                        */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section id="connect" className="border-b border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10 bg-[#0F0F0D] dark:bg-[#171714] text-[#F4F4F0]">
        <div className="mx-auto grid max-w-7xl grid-cols-1 lg:grid-cols-2">
          {/* Left: copy */}
          <div className="border-[#F4F4F0]/10 p-8 md:p-14 lg:border-r">
            <Reveal>
              <div className="flex items-center gap-3">
                <Cpu className="h-5 w-5 text-[#FF3B00]" strokeWidth={2.5} />
                <span className={sectionLabel}>§ 03 — CONNECT YOUR AGENT</span>
              </div>
              <h2 className="mt-6 text-3xl md:text-5xl font-black tracking-tighter leading-[1.05] text-[#F4F4F0]" style={{ fontFamily: DISPLAY_FONT }}>
                MCP-native. No cloud lock-in.
              </h2>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-[#F4F4F0]/50">
                Point any MCP-compatible agent — Claude, your own, anything — at your local
                endpoint. The full JSON-RPC 2.0 toolset runs on your machine.
              </p>
              <div className="mt-8 space-y-3">
                {[
                  'list_projects · create_project · update_project',
                  'get_curated_brief · get_active_design_system',
                  'Served at /api/mcp — SSE + JSON-RPC 2.0',
                ].map((line) => (
                  <div key={line} className="flex items-start gap-3 rounded-xl bg-[#F4F4F0]/5 ring-1 ring-[#F4F4F0]/10 p-3">
                    <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-[#FF3B00]" strokeWidth={2.5} />
                    <span className="font-mono text-xs text-[#F4F4F0]">{line}</span>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>

          {/* Right: mcp.json config */}
          <div className="p-8 md:p-14">
            <Reveal delay={0.1}>
              <div className="overflow-hidden rounded-2xl bg-[#0A0A09] ring-1 ring-[#F4F4F0]/10">
                <div className="flex items-center justify-between border-b border-[#F4F4F0]/10 px-4 py-2.5">
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[#F4F4F0]/40">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#FF3B00]" />
                    mcp.json
                  </div>
                  <CopyButton text={mcpConfig} />
                </div>
                <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-relaxed text-[#F4F4F0]/85">
                  <code>{mcpConfig}</code>
                </pre>
              </div>
              <p className="mt-6 text-sm leading-relaxed text-[#F4F4F0]/55">
                Your data never leaves your machine. Audit every request.
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  UPGRADE PATH                                                    */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section id="upgrade" className="border-b border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10">
        <div className="mx-auto max-w-4xl px-4 py-24 text-center sm:px-6 md:py-32 lg:px-8">
          <Reveal>
            <span className={sectionLabel}>§ 04 — SCALE UP</span>
            <h2 className="mt-6 text-4xl md:text-5xl font-black tracking-tighter leading-[1.05]" style={{ fontFamily: DISPLAY_FONT }}>
              Need teams, custom domains, and Slack?
            </h2>
            <p className="mx-auto mt-6 max-w-lg text-sm leading-relaxed text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50">
              LiveFolio Cloud adds team workspaces, Slack/Discord integrations, custom domains,
              analytics, and managed hosting. Same MCP protocol. Zero migration.
            </p>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <a
                href="https://livefolio.cloud"
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex items-center gap-2.5 h-11 px-6 rounded-full bg-[#FF3B00] text-white text-sm font-semibold transition-colors hover:bg-[#0F0F0D] dark:hover:bg-[#F4F4F0] dark:hover:text-[#0F0F0D]"
              >
                Explore LiveFolio Cloud
                <ExternalLink className="h-4 w-4" strokeWidth={2.5} />
              </a>
              <Link
                href="/app"
                className="inline-flex items-center gap-2.5 h-11 px-6 rounded-full bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70 hover:bg-[#0F0F0D]/10 dark:hover:bg-[#F4F4F0]/15 text-sm font-medium transition-colors"
              >
                Stay Local
                <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  FINAL CTA                                                       */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="bg-[#0F0F0D] dark:bg-[#171714] text-[#F4F4F0]">
        <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 md:py-36 lg:px-8">
          <span className={sectionLabel}>§ 05 — SELF-HOST NOW</span>
          <h2 className="mt-8 text-5xl sm:text-6xl lg:text-7xl font-black tracking-tighter leading-[0.9] text-[#F4F4F0]" style={{ fontFamily: DISPLAY_FONT }}>
            Free. Local.
            <br />
            <span className="text-[#FF3B00]">Yours.</span>
          </h2>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-[#F4F4F0]/55">
            Clone the repo, run one command, and own the entire stack — MCP server, versioning,
            and feedback. No account. No telemetry. No lock-in.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              href="/app"
              className="group flex items-center gap-2.5 h-11 px-6 rounded-full bg-[#FF3B00] text-white text-sm font-semibold shadow-lg shadow-[#FF3B00]/25 transition-colors hover:bg-[#F4F4F0] hover:text-[#0F0F0D]"
            >
              Launch Dashboard
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" strokeWidth={2.5} />
            </Link>
            <a
              href="https://github.com/LiveFolio-Cloud/LiveFolio-oss"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 h-11 px-6 rounded-full bg-[#F4F4F0]/10 text-[#F4F4F0] text-sm font-medium ring-1 ring-[#F4F4F0]/15 transition-colors hover:bg-[#F4F4F0]/15"
            >
              <Github className="h-4 w-4" strokeWidth={2.5} />
              Star on GitHub
            </a>
          </div>
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
              <span className="ml-1 rounded-md bg-[#FF3B00]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#FF3B00]">OSS</span>
            </div>
            <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50">
              The open-source sharing layer for AI-generated HTML. Local-first, self-hosted,
              zero telemetry.
            </p>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">Project</div>
            <ul className="mt-3 space-y-2 text-[13px]">
              <li><a href="#included" className="text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:text-[#FF3B00] transition-colors">What&rsquo;s included</a></li>
              <li><a href="#quickstart" className="text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:text-[#FF3B00] transition-colors">Quickstart</a></li>
              <li><a href="#connect" className="text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:text-[#FF3B00] transition-colors">Connect an agent</a></li>
              <li><Link href="/app" className="text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:text-[#FF3B00] transition-colors">Dashboard</Link></li>
            </ul>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">Community</div>
            <ul className="mt-3 space-y-2 text-[13px]">
              <li>
                <a
                  href="https://github.com/LiveFolio-Cloud/LiveFolio-oss"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:text-[#FF3B00] transition-colors"
                >
                  <Github className="h-3.5 w-3.5" strokeWidth={2.5} />GitHub
                </a>
              </li>
              <li>
                <a
                  href="https://livefolio.cloud"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:text-[#FF3B00] transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5" strokeWidth={2.5} />LiveFolio Cloud
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="mx-auto max-w-7xl border-t border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
            <span className="text-[11px] font-medium text-[#0F0F0D]/35 dark:text-[#F4F4F0]/35">
              &copy; 2026 LiveFolio OSS &middot; Runs on your machine
            </span>
            <span className="text-sm text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60">
              Free. Local. Yours.
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
