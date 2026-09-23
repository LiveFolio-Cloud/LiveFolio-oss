/**
 * OSS stub for app/(app)/_components/settings-popup/earnings-section.tsx.
 *
 * The Cloud section is the seller's earnings dashboard — payout account
 * account status, the payout corridor rules and, in its own copy, the platform
 * take rate. An OSS install sells nothing and pays out nothing, and the take
 * rate is a commercial term that must not be published.
 *
 * Export surface is kept identical because `settings-registry.tsx` imports the
 * named export through `next/dynamic` at module top level, and TypeScript
 * resolves string-literal dynamic imports — the module must exist with a
 * matching `EarningsSection` or the OSS type-check fails.
 *
 * The registry only registers this section under `isCloud` (`:83-110`), so the
 * component is never mounted in OSS.
 */

export function EarningsSection() {
  return null;
}
