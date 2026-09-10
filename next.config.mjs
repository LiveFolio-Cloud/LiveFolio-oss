import bundleAnalyzer from '@next/bundle-analyzer';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // ENV-GATED standalone output (P3-T00, workstream B — one-command OSS install).
  // Only `LIVEFOLIO_STANDALONE=1` (set by bin/package-standalone.js) produces
  // .next/standalone/. The default build (cloud/Render, verify_local, `npm run build`)
  // must stay byte-for-byte unchanged: with the env var absent, `output` is
  // undefined and Next falls back to the standard server build.
  output: process.env.LIVEFOLIO_STANDALONE === '1' ? 'standalone' : undefined,

  allowedDevOrigins: [
    '*.trycloudflare.com',
    '*.ngrok-free.app',
    'localhost:3000',
    'localhost:3001',
    'localhost:3002'
  ],

  // Security headers (app shell). Applied in production only so dev-mode
  // HMR/React tooling is not blocked by CSP.
  async headers() {
    if (process.env.NODE_ENV !== 'production') return [];
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; " +
              "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com https://cdn.posthog.com https://us-assets.i.posthog.com https://static.ads-twitter.com https://snap.licdn.com; " +
              // PostHog session replay spawns its recorder from a blob: worker —
              // without worker-src it falls back to script-src and gets blocked.
              "worker-src 'self' blob:; " +
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
              "img-src 'self' data: blob: https:; " +
              "font-src 'self' https://fonts.gstatic.com data:; " +
              "connect-src 'self' https: wss:; " +
              "frame-src 'self'; frame-ancestors 'self'; " +
              "base-uri 'self'; form-action 'self'; object-src 'none'",
          },
        ],
      },
    ];
  },

  typescript: {
    // We allow production builds to succeed even with warning/type issues to be robust
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Disable barrel optimization for lucide-react — prevents
  // "X is not exported from __barrel_optimize__" build errors.
  experimental: {
    optimizePackageImports: [],
  },

  // Next 16 defaults to Turbopack. The old dev-only webpack watchOptions
  // (ignoring database.json writes) is unnecessary — Turbopack only
  // recompiles modules that actually changed, not the whole graph.
  turbopack: {},
};

// Note: withSentryConfig removed for now — the v10 webpack plugin crashes
// on Render's free tier with "Cannot read properties of undefined (reading 'length')".
// Runtime Sentry SDK still works via instrumentation.ts + sentry.*.config.ts.
// Re-add withSentryConfig when SENTRY_AUTH_TOKEN is configured.

export default withBundleAnalyzer(nextConfig);
