/**
 * OSS stub for app/(app)/_components/settings-popup/purchases-section.tsx.
 *
 * The Cloud section is the buyer's purchase history — the receipt list for
 * folios bought through the marketplace, served from the Cloud billing API.
 * An OSS install has no marketplace and no purchase ledger, so there is
 * nothing to list.
 *
 * Export surface is kept identical because `settings-registry.tsx` imports the
 * named export through `next/dynamic` at module top level, and TypeScript
 * resolves string-literal dynamic imports — the module must exist with a
 * matching `PurchasesSection` or the OSS type-check fails.
 *
 * The registry only registers this section under `isCloud` (`:83-110`), so the
 * component is never mounted in OSS.
 */

export function PurchasesSection() {
  return null;
}
