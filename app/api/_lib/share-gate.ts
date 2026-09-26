import { isOSS, FEATURES } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase';
import { resolveGateConfig } from '@/lib/gating/config';
import { sessionSupabaseClient } from '@/lib/api/session';
import { can, resolveFolioRole } from '@/app/api/files/_lib/role-gate';
import type { FolioRole } from '@/app/api/files/_lib/role-gate';
import { getOwnerAccent } from './gate-owner';
import type { PaidAccessConfig } from '@/lib/gating/types';
import type { GatePaidAccess, ViewerAccess } from '@/components/share/types';

/**
 * SSR gate state for the share pages (`/share/[id]`, `/@username/slug`).
 *
 * Computes the minimal server-side picture:
 * - `accentColor` — the org Owner's accent (null-safe → undefined → default).
 * - `paidAccess` — the resolved effective gate (folio override wins; else the
 *   workspace gate), shaped exactly like `GET /api/files/[id]/public`.
 * - `viewerAccess` — the viewer's resolved standing: org member → `owner`,
 *   an active folio grant (role ≥ viewer) → `collaborator`, otherwise the
 *   preview/none standing derived from the gate. Purchase grants and the
 *   precise preview standing are still reconciled CLIENT-side: ShareClient
 *   re-fetches the public route on mount whenever `paidAccess` is present, so a
 *   stale SSR value self-corrects a moment later (owners never flash a paywall,
 *   buyers unlock via the ?purchase=success poll). `collaborator` is stable
 *   across that re-read: the public route reports the same
 *   value for a grant holder.
 *
 * The standing is resolved ONCE per render — the paid gate and the collaborator
 * branch both read the same answer, so they cannot disagree — and it is what
 * the pages consult for their OWN draft/private gates: the branch
 * cannot live only here, because each page short-circuits on `status ===
 * 'draft'` before this value reaches the client.
 *
 * OSS-safe: short-circuits to "no gate" before touching Supabase, and the
 * stub swap for `@/lib/supabase` keeps this compile-identical in the OSS tree.
 * (In OSS there are no identities and no grants to resolve.)
 */
export async function computeShareGate(folio: {
  /**
   * The folio UUID. A grant is keyed to the folio, so this is what a
   * collaborator standing is resolved against; without it no grant can be
   * resolved and the standing falls back to the pre-collaborator answer.
   */
  id?: string | null;
  paidAccess?: PaidAccessConfig | null;
  projectId?: string | null;
  organization_id?: string | null;
}): Promise<{ paidAccess: GatePaidAccess | null; viewerAccess: ViewerAccess; accentColor?: string }> {
  if (isOSS || !supabaseAdmin) {
    return { paidAccess: null, viewerAccess: 'owner' };
  }

  // ── Viewer standing (one session read, one role resolution) ──────────
  // A signed-out visitor costs one local `getUser()` (no session ⇒ no auth
  // round trip) and never reaches the resolver.
  const viewerId = await resolveViewerId();
  const role: FolioRole | null =
    viewerId && folio.id
      ? await resolveFolioRole(viewerId, {
          id: folio.id,
          organization_id: folio.organization_id ?? null,
        })
      : null;

  // `publish` is the matrix's org-member-only capability — org membership is
  // the only source of effective role `owner` — so this asks the member
  // question through the same resolution every other check uses rather than
  // probing `organization_members` a second time.
  const isMember = !!role && can(role, 'publish');
  // A grant holder who is not a member: exactly the viewer a folio grant exists for.
  const isCollaborator = !!role && can(role, 'view') && !isMember;

  const gate = FEATURES.paidGating
    ? await resolveGateConfig({
        paid_access: folio.paidAccess,
        project_id: folio.projectId,
        organization_id: folio.organization_id,
      })
    : null;
  const accentColor = await getOwnerAccent(folio.organization_id);

  if (!gate) {
    // No effective gate: `owner` is the legacy "nothing to reconcile" sentinel
    // and stays for every viewer it answered before this task — anonymous
    // visitors included. Only a resolved grant holder moves.
    return {
      paidAccess: null,
      viewerAccess: isCollaborator ? 'collaborator' : 'owner',
      accentColor,
    };
  }

  const paidAccess: GatePaidAccess = {
    targetType: gate.targetType,
    priceType: gate.config.priceType,
    amountCents: gate.config.amountCents,
    currency: gate.config.currency,
    rentalDays: gate.config.rentalDays,
    previewMode: gate.config.previewMode,
    previewSeconds: gate.config.previewSeconds,
  };

  // Minimal viewer standing: the owner/member check and the (new) collaborator
  // standing. Everything else is the client's job (see doc comment).
  const viewerAccess: ViewerAccess = isMember
    ? 'owner'
    : isCollaborator
      ? 'collaborator'
      : gate.config.previewMode !== 'none'
        ? 'preview'
        : 'none';

  return { paidAccess, viewerAccess, accentColor };
}

/**
 * The session user id, or null for an anonymous request.
 *
 * Delegates to the shared cookie-backed client (`lib/api/session`) — the same
 * seam `app/api/raw` and the owner-side routes use — and swallows every failure
 * as "anonymous", which is what every previous inline copy of this block did.
 */
async function resolveViewerId(): Promise<string | null> {
  try {
    const clientSupabase = await sessionSupabaseClient();
    const { data } = await clientSupabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}
