import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import './globals.css';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {/* Theme bootstrap — runs before paint so the correct theme is
         * applied on first load, independent of component mounting, and no
         * light→dark flash occurs. Lives in an EXTERNAL file (/theme-
         * bootstrap.js): React 19 warns whenever it renders an inline
         * <script>, so the pre-hydration script must not be inline JSX.
         * Respects an explicit stored choice, else the OS preference. */}
        <Script
          id="theme-bootstrap"
          src="/theme-bootstrap.js"
          strategy="beforeInteractive"
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
             In OSS this is swapped for a no-op stub by bin/sync-oss.js */}
        <AnalyticsScripts />
      </body>
    </html>
  );
}
