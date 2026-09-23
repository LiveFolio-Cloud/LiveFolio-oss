import LandingSwitch from './LandingSwitch';

// Statically prerendered. This page is pure marketing copy with no
// per-user data — the only input is `isOSS`, which comes from the build-time
// `NEXT_PUBLIC_APP_ENV` env var (lib/env.ts), so the variant is fixed at
// build time and nothing here is request-scoped. The old `force-dynamic` was
// justified by "barrel optimizer issues during SSG"; that rationale was
// stale. `optimizePackageImports` is a webpack feature that Next 16 always
// populates with `lucide-react` regardless of user config, and this project
// builds with Turbopack, which does not consult the option at all. The build
// prerenders this route with no barrel errors.
//
// The variant choice + code-split live in LandingSwitch (a client component):
// `next/dynamic` does not code-split a Client Component imported from a Server
// Component, so the switch cannot be made here without shipping both variants.
export default function LandingRouter() {
  return <LandingSwitch />;
}
