/**
 * LiveFolio Footer — v2 light edition.
 *
 * Light footer on the bone page background: hairline top border, vermillion
 * logo square, Cabinet Grotesk wordmark, micro-label section headers, and
 * muted links that turn vermillion on hover. All colors use the v2 explicit
 * hex vocabulary (no scoped brutalist tokens).
 *
 * Hidden on the landing page (`/`, which has its own footer), and on studio
 * and share pages to keep the canvas and presentation full-screen.
 */
"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

const DISPLAY_FONT = '"Cabinet Grotesk", "Space Grotesk", sans-serif';

interface FooterLink {
  label: string;
  href: string;
  external?: boolean;
}

const PRODUCT_LINKS: FooterLink[] = [
  { label: "How it works", href: "/#how" },
  { label: "API & SDK", href: "/#agents" },
  { label: "Pricing", href: "/#pricing" },
  { label: "Documentation", href: "/docs" },
];

const LEGAL_LINKS: FooterLink[] = [
  { label: "Terms of Service", href: "/tos" },
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Content Protection", href: "/protection" },
];

export default function Footer() {
  const pathname = usePathname();

  // Hide on the landing page (owns its own footer) and all app surfaces —
  // the marketing footer must never appear on dashboard, settings, profiles,
  // studio, share, auth, or workspace pages.
  const appSurfaces = [
    '/share',
    '/u/', '/@', '/login', '/register', '/auth', '/admin', '/app',
  ];
  if (pathname === "/" || appSurfaces.some((p) => pathname?.startsWith(p))) {
    return null;
  }

  return (
    <footer className="border-t border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-8 px-4 py-12 sm:px-6 md:grid-cols-5 lg:px-8">
        {/* Brand */}
        <div className="col-span-2">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 bg-[#FF3B00]" />
            <span className="text-lg font-black tracking-tighter" style={{ fontFamily: DISPLAY_FONT }}>LiveFolio</span>
          </div>
          <p className="mt-3 max-w-sm text-[13px] leading-relaxed text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50">
            The layer for AI agents to publish HTMLs in one click —
            instead of sharing files.
          </p>
        </div>

        {/* Product */}
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">Product</div>
          <ul className="mt-3 space-y-2 text-[13px]">
            {PRODUCT_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:text-[#FF3B00] transition-colors">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Community */}
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
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.5 11.5 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.014 2.898-.014 3.293 0 .322.216.694.825.576C20.565 22.092 24 17.598 24 12.297c0-6.627-5.373-12-12-12" />
                </svg>
                GitHub
              </a>
            </li>
            <li>
              <a
                href="https://x.com/livefolio"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:text-[#FF3B00] transition-colors"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                X / Twitter
              </a>
            </li>
            <li>
              <a
                href="https://discord.gg/livefolio"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:text-[#FF3B00] transition-colors"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                </svg>
                Discord
              </a>
            </li>
            <li>
              <a
                href="https://linkedin.com/company/livefolio"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:text-[#FF3B00] transition-colors"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                </svg>
                LinkedIn
              </a>
            </li>
          </ul>
        </div>

        {/* Legal */}
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">Legal</div>
          <ul className="mt-3 space-y-2 text-[13px]">
            {LEGAL_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:text-[#FF3B00] transition-colors">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10 mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
          <span className="text-[11px] font-medium text-[#0F0F0D]/35 dark:text-[#F4F4F0]/35">
            &copy; 2026 LiveFolio &middot; Made for agents, sent to humans
          </span>
          <span className="text-sm text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60">Links, not files.</span>
        </div>
      </div>
    </footer>
  );
}
