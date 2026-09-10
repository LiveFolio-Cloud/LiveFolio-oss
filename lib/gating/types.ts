/**
 * Paid-access configuration for a folio or workspace (project).
 *
 * Stored as a JSONB column (`folios.paid_access` / `projects.paid_access`).
 * `NULL` on a folio means "inherit the workspace gate"; a non-null object is
 * an explicit override — including `{ enabled: false }`, which means
 * "explicitly free inside a gated workspace".
 *
 * Zero imports: this module is shared by `lib/db.ts` and `lib/gating/*`
 * without creating a dependency cycle.
 */
export interface PaidAccessConfig {
  /** Master switch. false = explicitly free (an override, not "no config"). */
  enabled: boolean;
  /** Purchase model. 'subscription' is accepted by validation but not yet purchasable (Phase 2). */
  priceType: 'one_time' | 'rental' | 'subscription';
  /** Price in minor units (cents). Minimum 100 ($1.00). */
  amountCents: number;
  /** ISO 4217 lowercase. Allowlist: usd, eur, gbp. */
  currency: string;
  /** Rental only: access duration in days (1–3650). */
  rentalDays?: number;
  /** Subscription only (Phase 2): billing interval. */
  interval?: 'month' | 'year';
  /** Free preview shown to non-paying visitors: 'none' (hard paywall),
   *  'timed' (one N-second read window per browser per 24h), 'first_page'
   *  (first viewport only — body clipped to 100vh, scroll locked, banner). */
  previewMode: 'none' | 'timed' | 'first_page';
  /** Timed preview only: visible seconds (5–600). */
  previewSeconds?: number;
  /** Seller-controlled post-purchase actions (default false = view-only).
   *  When true, buyers with an active grant can duplicate the folio into
   *  their own account / download it as a ZIP. Enforced server-side. */
  allowCopy?: boolean;
  allowDownload?: boolean;
  /**
   * Serve-surface hardening for gated content. 'source_locked' delivers
   * HTML pages through a JS bootstrap + copy friction so view-source /
   * save-as yields a shell. Casual-copier defense — NOT encryption: a
   * determined thief can still extract rendered content. Studio previews,
   * org members and agents always receive full source regardless.
   * Default: 'standard' (no wrapping).
   */
  protection?: 'standard' | 'source_locked';
}

/** What a resolved gate applies to — a single folio or a whole workspace. */
export type GateTargetType = 'folio' | 'workspace';

/** A gate resolved through the folio-over-workspace precedence rules. */
export interface ResolvedGate {
  config: PaidAccessConfig;
  targetType: GateTargetType;
}
