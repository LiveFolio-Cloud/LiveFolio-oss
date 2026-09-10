import { cookies } from 'next/headers';
import { isOSS, FEATURES } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase';
import { resolveGateConfig } from '@/lib/gating/config';
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
 * - `viewerAccess` — owner/member check only. Grants and precise preview
 *   standing are reconciled CLIENT-side: ShareClient re-fetches the public
 *   route on mount whenever `paidAccess` is present, so a stale SSR value
 *   self-corrects a moment later (owners never flash a paywall, buyers unlock
 *   via the ?purchase=success poll).
 *
 * OSS-safe: short-circuits to "no gate" before touching Supabase, and the
 * stub swap for `@/lib/supabase` keeps this compile-identical in the OSS tree.
 */
export async function computeShareGate(folio: {
  paidAccess?: PaidAccessConfig | null;
  projectId?: string | null;
  organization_id?: string | null;
}): Promise<{ paidAccess: GatePaidAccess | null; viewerAccess: ViewerAccess; accentColor?: string }> {
  if (isOSS || !FEATURES.paidGating || !supabaseAdmin) {
    return { paidAccess: null, viewerAccess: 'owner' };
  }

  const gate = await resolveGateConfig({
    paid_access: folio.paidAccess,
    project_id: folio.projectId,
    organization_id: folio.organization_id,
  });
  const accentColor = await getOwnerAccent(folio.organization_id);

  if (!gate) {
    return { paidAccess: null, viewerAccess: 'owner', accentColor };
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

  // Minimal viewer standing: the owner/member check. Everything else is the
  // client's job (see doc comment).
  let viewerAccess: ViewerAccess = gate.config.previewMode !== 'none' ? 'preview' : 'none';
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    const cookieStore = await cookies();
    const { createServerClient } = await import('@/lib/supabase');
    const clientSupabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} }
    });
    const { data: authData } = await clientSupabase.auth.getUser();
    const user = authData.user;
    if (user && folio.organization_id) {
      const { data: membership } = await supabaseAdmin
        .from('organization_members')
        .select('id')
        .eq('organization_id', folio.organization_id)
        .eq('user_id', user.id)
        .limit(1);
      if (membership && membership.length > 0) viewerAccess = 'owner';
    }
  } catch { /* anonymous or auth unavailable — preview/none stands */ }

  return { paidAccess, viewerAccess, accentColor };
}
