/**
 * OSS stub for app/(app)/_components/settings-popup/billing-section.tsx.
 *
 * The Cloud section is plan, seat and payment-billing management — it names the
 * plan tiers, their seat caps, their usage allowances and the billing portal
 * endpoints. None of that exists or belongs in an OSS install, which has no
 * accounts and no billing.
 *
 * Export surface is kept identical because `settings-registry.tsx` imports the
 * named export through `next/dynamic` at module top level — TypeScript
 * resolves string-literal dynamic imports, so the module must exist with a
 * matching `BillingSection` or the OSS type-check fails.
 *
 * The registry only registers this section under `isCloud` (`:83-110`), so the
 * component is never mounted in OSS. It returns `null` rather than throwing:
 * a section that renders nothing is the correct OSS behaviour if it is ever
 * reached, and costs the build nothing.
 */

export function BillingSection() {
  return null;
}
