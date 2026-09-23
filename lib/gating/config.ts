/**
 * SERVER-ONLY gate resolution. Imports Supabase — do NOT import this from a
 * client component.
 *
 * The client-safe validator lives in ./paid-access.ts. It used to live here,
 * and `components/dashboard/ProjectSettingsDialog.tsx` (client, reachable from
 * the /app shell layout) imported it from here — which dragged the whole
 * Supabase SDK into the app-shell bundle (~57 KB gzip) so a dialog could
 * validate a price locally. `sanitizePaidAccess` is re-exported below purely so
 * existing server-side importers keep working unchanged; new CLIENT code must
 * import from ./paid-access instead.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { PaidAccessConfig, ResolvedGate } from './types';
import { sanitizePaidAccess } from './paid-access';

// Re-exported for server callers that have always imported the validator from
// here (lib/gating/checkout.ts, lib/integrations/ai-tool-loop.ts, the files /
// projects / mcp API routes). Client components must NOT rely on this — use
// ./paid-access, or the Supabase import above comes along for the ride.
export { sanitizePaidAccess };

// Imported for local use AND re-exported, so existing server callers keep
// importing the bounds from here while the client UI can import the constants
// module directly without pulling Supabase toward the browser bundle.
import { MIN_AMOUNT_CENTS, MAX_AMOUNT_CENTS } from './price-bounds';
export { MIN_AMOUNT_CENTS, MAX_AMOUNT_CENTS };

/**
 * Resolve the effective gate for a folio:
 * - folio `paid_access` non-null WINS (an explicit override — either its own
 *   gate or explicitly free);
 * - otherwise the workspace (project) gate is the default;
 * - no enabled config anywhere → null (content is free).
 *
 * A workspace grant covers a folio ONLY when the folio inherits (null own
 * config); an explicitly gated folio requires its own purchase.
 *
 * NOTE: deliberately uncached. This feeds lib/gating/checkout.ts, which sets
 * the amount actually charged, and the cache could not be invalidated on write
 * from here (the PUT that edits a workspace's gate lives in app/api/projects).
 * A TTL would therefore risk charging a stale price, or — if negative results
 * were cached — serving gated content free for the TTL window.
 */
export async function resolveGateConfig(folio: {
  paid_access?: PaidAccessConfig | null;
  project_id?: string | null;
  organization_id?: string | null;
}): Promise<ResolvedGate | null> {
  const own = folio.paid_access;

  if (own != null) {
    return own.enabled ? { config: own, targetType: 'folio' } : null;
  }

  if (!folio.project_id || !supabaseAdmin) return null;

  try {
    const { data, error } = await supabaseAdmin
      .from('projects')
      .select('paid_access')
      .eq('id', folio.project_id)
      .maybeSingle();

    if (error || !data?.paid_access) return null;

    const workspaceConfig = sanitizePaidAccess(data.paid_access);
    if (!workspaceConfig || !workspaceConfig.enabled) return null;

    return { config: workspaceConfig, targetType: 'workspace' };
  } catch {
    return null;
  }
}
