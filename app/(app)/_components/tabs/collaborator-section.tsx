/**
 * OSS stub for app/(app)/_components/tabs/collaborator-section.tsx.
 *
 * The Cloud section is the owner's invite control: an email + role form, one
 * row per grant carrying its pending/active/expired state, resend, revoke and
 * the Team-plan seat upsell. It talks to the collaborator API, which does not
 * exist on a self-hosted install — no accounts to invite, no org to share
 * outside of, no seats to run out of.
 *
 * Export surface: `CollaboratorSection` only — the single name the shipped
 * `share-menu.tsx:16` imports. The teammates-section twin keeps a wider surface
 * because `settings-registry` imports it through `next/dynamic`, where
 * TypeScript resolves the whole module; this one is a plain named import, so a
 * narrower surface is the honest one and the OSS type-check enforces it.
 *
 * `share-menu.tsx` renders this under `isCloud`, so the component is never
 * mounted in OSS.
 */

export function CollaboratorSection({ folioId, open }: { folioId: string; open: boolean }) {
  // Referenced so the signature stays honest about the Cloud contract.
  void folioId;
  void open;
  return null;
}
