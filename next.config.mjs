import bundleAnalyzer from '@next/bundle-analyzer';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // ENV-GATED standalone output — one-command self-hosted install.
  // Only `LIVEFOLIO_STANDALONE=1` (set by bin/package-standalone.js) produces
  // .next/standalone/. Every other build must stay byte-for-byte unchanged:
  // with the env var absent, `output` is undefined and Next falls back to the
  // standard server build. (This file is shared with the self-hosted
  // distribution, so keep the wording host-neutral.)
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
    // Type errors must now fail the build — the repo is type-clean (npx tsc
    // --noEmit is 0), and `ignoreBuildErrors` made the green deploy a weaker
    // signal than it looked. If a deploy ever fails on types, that is the
    // signal working; fix the types, do not re-enable this.
    ignoreBuildErrors: false,
  },
  // `eslint: { ignoreDuringBuilds: true }` was removed here: Next 16
  // deleted the key along with `next lint`. It is not merely deprecated — the
  // config schema rejects it outright, so leaving it in produced a startup
  // warning on every dev/build invocation:
  //     Invalid next.config.mjs options detected: Unrecognized key(s) 'eslint'
  // Proof: 'eslint' is absent from the 67 top-level keys of the Zod schema in
  // node_modules/next/dist/server/config-schema.js, while `typescript`,
  // `turbopack`, `output`, `headers` and `allowedDevOrigins` all remain.
  // `configSchema.safeParse({...})` returns success:false with
  // "Unrecognized key(s) in object: 'eslint'" (config.js:1790 — non-fatal, it
  // lands in `warnings`, not `fatalErrors`).
  // Removal is inert: Next 16 no longer lints during build at all. The upgrade
  // guide (node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md)
  // states "`next build` no longer runs linting" and "The `eslint` option in
  // the Next.js config file is also removed." Corroborated by the whole dist:
  // `grep -r ignoreDuringBuilds node_modules/next/dist/` returns ZERO hits, and
  // `next lint` is absent from the CLI command list.
  // Linting is unchanged and still available — it never came from Next here:
  // `npm run lint` runs the standalone ESLint CLI directly
  // (`eslint app components lib ee bin`), which is the documented replacement.

  // `experimental.optimizePackageImports: []` was removed here: it
  // did not do what its comment claimed. Setting it to an empty array cannot
  // disable barrel optimization, because Next merges user entries into the
  // built-in default list with a Set union —
  // node_modules/next/dist/server/config.js:1121-1125:
  //     const userProvidedOptimizePackageImports =
  //       (result.experimental?.optimizePackageImports) || [];
  //     result.experimental.optimizePackageImports = [
  //       ...new Set([...userProvidedOptimizePackageImports,
  //                   'lucide-react', 'date-fns', ...])];
  // `lucide-react` is added unconditionally, so passing `[]` left the default
  // behaviour fully intact. The option is also a webpack-only transform, and
  // this build runs Turbopack (`turbopack: {}` below), which never reads it.
  // The build prerenders fine without it.

  // Next 16 defaults to Turbopack. The old dev-only webpack watchOptions
  // (ignoring database.json writes) is unnecessary — Turbopack only
  // recompiles modules that actually changed, not the whole graph.
  turbopack: {},
};

// Note: no Sentry build integration. The v10 webpack plugin crashes with
// "Cannot read properties of undefined (reading 'length')", so withSentryConfig
// is not wired in. The runtime SDK only activates where `instrumentation.ts`
// and `sentry.*.config.ts` are present, so a tree without those files is
// unaffected. Re-add withSentryConfig when SENTRY_AUTH_TOKEN is configured.
// (This file is shared with the self-hosted distribution — keep it host-neutral
// and do not assume those Sentry files exist.)

export default withBundleAnalyzer(nextConfig);
