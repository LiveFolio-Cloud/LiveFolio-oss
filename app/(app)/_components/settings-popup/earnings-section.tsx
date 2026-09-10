'use client';

/**
 * Settings popup — Earnings section (Cloud). Stripe Connect lifecycle for
 * creators: connect → hosted onboarding → status pill → dashboard link,
 * plus the sales summary (gross / 10% fee / net + recent sales). Follows the
 * flat SectionShell language of the other settings sections.
 */
import { AlertCircle, ExternalLink, Loader2, Wallet } from 'lucide-react';
import { SectionShell } from './section-shell';
import { useStripeConnect } from './use-stripe-connect';
import { cn } from '@/lib/utils';

const CURRENCY_SYMBOL: Record<string, string> = { usd: '$', eur: '€', gbp: '£' };

function money(cents: number, currency = 'usd'): string {
  const sym = CURRENCY_SYMBOL[currency] ?? '$';
  return `${sym}${(cents / 100).toFixed(2)}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: 'bg-emerald-500/10 text-emerald-600',
    pending: 'bg-amber-500/10 text-amber-600',
    restricted: 'bg-rose-500/10 text-rose-600',
    none: 'bg-black/5 text-ink/50 dark:bg-white/10',
  };
  const labels: Record<string, string> = {
    active: 'Connected',
    pending: 'Onboarding',
    restricted: 'Restricted',
    none: 'Not connected',
  };
  return (
    <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', styles[status] ?? styles.none)}>
      {labels[status] ?? status}
    </span>
  );
}

export function EarningsSection() {
  const { status, sales, loading, error, start, refresh, openDashboard, disconnect } = useStripeConnect();

  const handleDisconnect = async () => {
    if (
      !confirm(
        'Disconnect Stripe? Your paid folios will stop selling until you reconnect. Prices stay as configured.'
      )
    ) {
      return;
    }
    await disconnect();
  };

  return (
    <SectionShell icon={Wallet} title="Earnings">
      {!status ? (
        <div className="flex items-center gap-2 text-sm text-ink/60">
          <Loader2 size={13} className="animate-spin" />
          Checking Stripe…
        </div>
      ) : (
        <>
          {/* Status row */}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="block text-sm font-medium text-ink">Stripe account</span>
              {status.accountId && (
                <span className="block truncate text-xs text-ink/45 font-mono">{status.accountId}</span>
              )}
            </div>
            <StatusPill status={status.status} />
          </div>

          {/* Actions by state */}
          {status.status === 'none' && (
            <div className="space-y-2">
              <p className="text-xs leading-relaxed text-ink/60">
                Connect Stripe to get paid for folio sales. LiveFolio takes a 10% platform fee;
                the rest lands in your Stripe account.
              </p>
              <button
                type="button"
                onClick={start}
                disabled={loading}
                className="h-8 rounded-lg bg-[var(--app-accent)] px-4 text-xs font-semibold text-white transition-colors hover:bg-[var(--app-accent)]/90 disabled:opacity-50"
              >
                {loading ? 'Opening Stripe…' : 'Connect Stripe'}
              </button>
            </div>
          )}

          {status.status === 'pending' && (
            <div className="space-y-2">
              <p className="text-xs leading-relaxed text-ink/60">
                Your account is created — finish the short Stripe onboarding to start selling.
              </p>
              <button
                type="button"
                onClick={refresh}
                disabled={loading}
                className="h-8 rounded-lg bg-[var(--app-accent)] px-4 text-xs font-semibold text-white transition-colors hover:bg-[var(--app-accent)]/90 disabled:opacity-50"
              >
                {loading ? 'Opening Stripe…' : 'Complete onboarding'}
              </button>
            </div>
          )}

          {status.status === 'restricted' && (
            <div className="space-y-2">
              <p className="text-xs leading-relaxed text-rose-600">
                Your Stripe account needs attention before it can receive payouts.
              </p>
              <button
                type="button"
                onClick={refresh}
                disabled={loading}
                className="h-8 rounded-lg bg-[var(--app-accent)] px-4 text-xs font-semibold text-white transition-colors hover:bg-[var(--app-accent)]/90 disabled:opacity-50"
              >
                {loading ? 'Opening Stripe…' : 'Resume onboarding'}
              </button>
            </div>
          )}

          {status.status === 'active' && (
            <div className="space-y-2.5">
              <button
                type="button"
                onClick={openDashboard}
                disabled={loading}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-ink/5 px-3 text-xs font-semibold text-ink/80 transition-colors hover:bg-ink/10 disabled:opacity-50"
              >
                <ExternalLink size={12} />
                {loading ? 'Opening…' : 'Open Stripe dashboard'}
              </button>

              {/* Sales summary */}
              {sales ? (
                <div className="space-y-2.5">
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Gross', value: money(sales.totalGrossCents) },
                      { label: 'Fees', value: `-${money(sales.totalFeesCents)}` },
                      { label: 'Net', value: money(sales.totalNetCents) },
                    ].map(({ label, value }) => (
                      <div
                        key={label}
                        className="rounded-lg bg-black/[0.03] px-2.5 py-2 dark:bg-white/5"
                      >
                        <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-ink/40">
                          {label}
                        </span>
                        <span className="block text-sm font-semibold text-ink tabular-nums">{value}</span>
                      </div>
                    ))}
                  </div>

                  {sales.sales.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-ink/40">
                        Recent sales
                      </span>
                      {sales.sales.slice(0, 5).map((s) => (
                        <div key={s.id} className="flex items-center justify-between gap-2 text-[13px]">
                          <span className="min-w-0 truncate text-ink/70">
                            {s.title ?? 'Deleted target'}
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            <span className="text-xs text-ink/40">{fmtDate(s.grantedAt)}</span>
                            <span className="font-medium text-ink tabular-nums">
                              {money(s.amountCents, s.currency)}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-ink/45">No sales yet — share a paid folio to get started.</p>
              )}
            </div>
          )}

          {status.status !== 'none' && (
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={loading}
              className="text-xs font-medium text-ink/40 transition-colors hover:text-red-600 disabled:opacity-50"
            >
              Disconnect Stripe
            </button>
          )}

          {error && (
            <p className="flex items-start gap-1.5 text-xs font-medium text-red-600">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
        </>
      )}
    </SectionShell>
  );
}
