/**
 * Paid-access validation — shared by the server write surfaces and the seller UI.
 *
 * Lives apart from lib/gating/config.ts for the same reason as ./price-bounds.ts:
 * that module imports Supabase (via `resolveGateConfig`), and the gate-config UI
 * is a CLIENT component. `components/dashboard/ProjectSettingsDialog.tsx` is
 * reachable from `app/(app)/layout.tsx` (a client layout) → WorkspaceSidebar →
 * ProjectSettingsDialog, so importing the validator from ./config.ts dragged
 * `@supabase/ssr` + `@supabase/supabase-js` into the app-shell bundle for every
 * /app and /app/[folioId] visitor — ~57 KB gzip to validate a price locally.
 *
 * This module is deliberately Supabase-free. It imports ONLY ./types (type-only)
 * and ./price-bounds, so it is safe on the client. `lib/gating/config.ts`
 * re-exports `sanitizePaidAccess` so existing server-side importers are
 * unaffected.
 *
 * Neither file may grow a Supabase import — that would silently re-introduce the
 * bundle leak, and nothing in the type system would catch it.
 */

import { MIN_AMOUNT_CENTS, MAX_AMOUNT_CENTS } from './price-bounds';
import type { PaidAccessConfig } from './types';

/** ISO 4217 lowercase. Anything else is rejected at write time. */
const ALLOWED_CURRENCIES = ['usd', 'eur', 'gbp'];

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
