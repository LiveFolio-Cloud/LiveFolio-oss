import type { Metadata, Viewport } from 'next';
import './globals.css';
import { plusJakarta, spaceGrotesk } from './fonts';
import Footer from '@/components/Footer';
import Providers from '@/components/Providers';
import CookieConsent from '@/components/CookieConsent';
import AnalyticsScripts from '@/components/AnalyticsScripts';
import {
  SettingsPopupModal,
  SettingsPopupProvider,
} from '@/app/(app)/_components/settings-popup';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://livefolio.cloud';

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: 'LiveFolio — Your Ideas, Alive',
    template: '%s | LiveFolio',
  },
  description: 'The universal AI-native publishing platform. Overthrow slides, PDFs, and static docs with living, interactive web folios published in seconds by AI agents.',
  keywords: ['LiveFolio', 'AI publishing', 'HTML folios', 'MCP server', 'AI agent', 'interactive documents', 'versioning', 'folio sharing'],
  authors: [{ name: 'LiveFolio' }],
  creator: 'LiveFolio',
  publisher: 'LiveFolio',
  robots: {
    index: true,
    follow: true,
    'max-image-preview': 'large',
    'max-snippet': -1,
    'max-video-preview': -1,
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: BASE_URL,
    siteName: 'LiveFolio',
    title: 'LiveFolio — Your Ideas, Alive',
    description: 'The universal AI-native publishing platform. AI agents publish interactive HTML folios in seconds. Share, version, and collaborate.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'LiveFolio — Your Ideas, Alive',
    description: 'AI agents publish interactive HTML folios in seconds. Share, version, and collaborate.',
  },
  alternates: {
    canonical: BASE_URL,
  },
  icons: {
    // Favicon = the plain orange square (favicon-mark.svg), NOT the framed
    // brand mark (logo-v2.svg stays the in-app logo). Apple touch icons must
    // be PNG (iOS Safari ignores SVG).
    icon: [
      { url: '/favicon-mark.svg', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/apple-icon.png' }],
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'LiveFolio',
  url: BASE_URL,
  description: 'AI-native publishing platform. AI agents create, share, and version interactive HTML folios in seconds.',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Web',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
  author: {
    '@type': 'Organization',
    name: 'LiveFolio',
    url: BASE_URL,
    logo: `${BASE_URL}/logo-v2.svg`,
    sameAs: [
      'https://github.com/LiveFolio-Cloud/LiveFolio-oss',
    ],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F4F4F0' },
    { media: '(prefers-color-scheme: dark)', color: '#0F0F0D' },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${spaceGrotesk.variable} ${plusJakarta.variable}`}
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {/* Theme bootstrap — runs before paint so the correct theme is
         * applied on first load, independent of component mounting, and no
         * light→dark flash occurs. Respects an explicit stored choice, else
         * the OS preference.
         *
         * INLINED (was an external /theme-bootstrap.js + next/script
         * beforeInteractive, which emitted a <link rel=preload> plus a
         * blocking script tag — an extra round trip on the critical path for
         * ~550 bytes). A raw <script> with dangerouslySetInnerHTML in <head>
         * needs no request and executes synchronously during HTML parsing,
         * before first paint — the exact pattern Next 16 prescribes for
         * flash-free theming in the root layout:
         * node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md
         * ("The script runs in <head>, so the correct theme is applied before
         * any content is painted" / "The inline script runs during HTML
         * parsing, before React is involved").
         *
         * The old comment claimed React 19 forbids inline scripts here. It
         * does not: React warns for <script> elements it CREATES during
         * client render (scripts inserted via DOM APIs never execute). This
         * is a raw element inside <head> of the root layout, which React
         * hydrates rather than creates, and the root layout's <head> is
         * never re-rendered on soft navigation. The docs' own theme example
         * uses this exact shape. `suppressHydrationWarning` on <html> (below)
         * covers the class the script sets.
         *
         * CSP-safe: next.config.mjs `script-src` already carries
         * 'unsafe-inline' for the analytics tags.
         *
         * Keep the body byte-identical to the frozen public/theme-bootstrap.js
         * if you touch it — that file is left on disk for older cached
         * documents that still request it. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('livefolio-theme');var dark=t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(dark)document.documentElement.classList.add('dark');else document.documentElement.classList.remove('dark');}catch(e){}})();`,
          }}
        />
      </head>
      <body className="bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 selection:bg-[#FF3B00]/20 selection:text-[#0F0F0D] antialiased font-sans">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[200] focus:px-4 focus:py-2.5 focus:bg-[#FF3B00] focus:text-white focus:rounded-lg focus:text-sm focus:font-bold focus:shadow-lg focus:outline-none"
        >
          Skip to content
        </a>
        <SettingsPopupProvider>
          <Providers>
            <div id="main-content" className="contents">
              {children}
            </div>
            <Footer />
          </Providers>
          <CookieConsent />
          {/* Settings popup is app-wide — available on every route */}
          <SettingsPopupModal />
        </SettingsPopupProvider>
        {/* Analytics — PostHog is in Providers; GA4/Meta/LinkedIn via AnalyticsScripts.
             In OSS this is swapped for a no-op stub */}
        <AnalyticsScripts />
      </body>
    </html>
  );
}
