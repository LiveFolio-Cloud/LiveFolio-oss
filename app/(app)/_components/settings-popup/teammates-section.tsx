/**
 * OSS stub for app/(app)/_components/settings-popup/teammates-section.tsx.
 *
 * The Cloud section is workspace membership management — invite, seat and
 * plan-limit administration over the organization and invitation APIs. An OSS
 * install is single-user: there are no organizations, no seats and no
 * invitations, so there is no membership to administer.
 *
 * Export surface is kept identical because `settings-registry.tsx` imports the
 * named export through `next/dynamic` at module top level, and TypeScript
 * resolves string-literal dynamic imports — the module must exist with a
 * matching `TeammatesSection` or the OSS type-check fails.
 *
 * The registry only registers this section under `isCloud` (`:83-110`), so the
 * component is never mounted in OSS.
 */

export function TeammatesSection() {
  return null;
}
