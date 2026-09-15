import { supabaseAdmin } from '@/lib/supabase';
import { PaidAccessConfig, ResolvedGate } from './types';

const ALLOWED_CURRENCIES = ['usd', 'eur', 'gbp'];

// Imported for local use AND re-exported, so existing server callers keep
// importing the bounds from here while the client UI can import the constants
// module directly without pulling Supabase toward the browser bundle.
import { MIN_AMOUNT_CENTS, MAX_AMOUNT_CENTS } from './price-bounds';
export { MIN_AMOUNT_CENTS, MAX_AMOUNT_CENTS };

const MIN_RENTAL_DAYS = 1;
const MAX_RENTAL_DAYS = 3650;
const MIN_PREVIEW_SECONDS = 5;
const MAX_PREVIEW_SECONDS = 600;

/**
 * Strict validation for paid-access config coming from ANY write surface
 * (MCP, REST files API, ai-create, Slack/Discord). Rejects instead of
 * clamping — invalid config should fail loudly at write time, not silently
 * change the price. `enabled: false` is a VALID config ("explicitly free").
 *
 * This is the ONLY place the folio price bounds are enforced, which is what
 * makes them hold across every surface at once. Callers receive null and must
 * surface that; they must not fall back to a default amount, or an
 * out-of-bounds price would be silently rewritten to a valid one.
 */
export function sanitizePaidAccess(input: unknown): PaidAccessConfig | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;

  if (typeof raw.enabled !== 'boolean') return null;
  if (raw.priceType !== 'one_time' && raw.priceType !== 'rental' && raw.priceType !== 'subscription') return null;
  if (!Number.isInteger(raw.amountCents)) return null;
  const amountCents = raw.amountCents as number;
  if (amountCents < MIN_AMOUNT_CENTS || amountCents > MAX_AMOUNT_CENTS) return null;
  if (typeof raw.currency !== 'string' || !ALLOWED_CURRENCIES.includes(raw.currency)) return null;
  if (raw.previewMode !== 'none' && raw.previewMode !== 'timed' && raw.previewMode !== 'first_page') return null;

  const config: PaidAccessConfig = {
    enabled: raw.enabled,
    priceType: raw.priceType,
    amountCents,
    currency: raw.currency,
    previewMode: raw.previewMode,
    // Seller-controlled post-purchase actions — default deny (view-only).
    allowCopy: raw.allowCopy === true,
    allowDownload: raw.allowDownload === true,
    // Serve-surface hardening — default 'standard' (never wrap unless the
    // seller opted into source-locking).
    protection: raw.protection === 'source_locked' ? 'source_locked' : 'standard',
  };

  if (raw.priceType === 'rental') {
    if (!Number.isInteger(raw.rentalDays)) return null;
    const days = raw.rentalDays as number;
    if (days < MIN_RENTAL_DAYS || days > MAX_RENTAL_DAYS) return null;
    config.rentalDays = days;
  }

  if (raw.priceType === 'subscription') {
    if (raw.interval !== 'month' && raw.interval !== 'year') return null;
    config.interval = raw.interval;
  }

  if (raw.previewMode === 'timed') {
    if (!Number.isInteger(raw.previewSeconds)) return null;
    const seconds = raw.previewSeconds as number;
    if (seconds < MIN_PREVIEW_SECONDS || seconds > MAX_PREVIEW_SECONDS) return null;
    config.previewSeconds = seconds;
  }

  return config;
}

/**
 * Resolve the effective gate for a folio:
 * - folio `paid_access` non-null WINS (an explicit override — either its own
 *   gate or explicitly free);
 * - otherwise the workspace (project) gate is the default;
 * - no enabled config anywhere → null (content is free).
 *
 * A workspace grant covers a folio ONLY when the folio inherits (null own
 * config); an explicitly gated folio requires its own purchase.
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
