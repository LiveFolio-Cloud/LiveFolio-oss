'use client';

/**
 * Settings popup — Billing & Quota section (Cloud). Plan, monthly prompt
 * usage, team-seat slider, and the Stripe checkout/portal action. Shares
 * state with the Teammates section via useBillingTeammates.
 */
import { AlertCircle, CreditCard, Users } from 'lucide-react';
import { SectionShell } from './section-shell';
import { useBillingTeammates } from './use-billing-teammates';

export function BillingSection() {
  const {
    billingUsage, loadingBilling, billingError, teamSeats, setTeamSeats, plan, setPlan,
    handleBillingAction, usagePct, nearLimit, storagePct, storageNearLimit, isAdmin,
  } = useBillingTeammates();

  if (!isAdmin) return null;

  return (
    <>
<SectionShell icon={CreditCard} title="Billing & Quota">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink">Workspace plan</span>
              <span className="rounded-full bg-[var(--app-accent)]/10 px-2.5 py-0.5 text-xs font-semibold text-[var(--app-accent)]">
                {billingUsage?.plan || 'Free'}
              </span>
            </div>

            {billingUsage && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-ink/60">AI assistant messages</span>
                  <span className="font-medium text-ink tabular-nums">
                    {billingUsage.monthly_message_count} / {billingUsage.monthly_message_limit}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/5">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      nearLimit ? 'bg-amber-400' : 'bg-[var(--app-accent)]'
                    }`}
                    style={{ width: `${usagePct}%` }}
                  />
                </div>
                {nearLimit ? (
                  <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                    Almost at your monthly limit — it resets on your billing anniversary.
                  </p>
                ) : (
                  <p className="text-xs text-ink/60">
                    Usage resets on the monthly billing cycle anniversary.
                  </p>
                )}

                {billingUsage.storage_limit_bytes ? (
                  <>
                    <div className="flex items-center justify-between pt-1 text-[13px]">
                      <span className="text-ink/60">Storage</span>
                      <span className="font-medium text-ink tabular-nums">
                        {(billingUsage.storage_used_bytes || 0) / 1_048_576 < 1024
                          ? `${((billingUsage.storage_used_bytes || 0) / 1_048_576).toFixed(0)} MB`
                          : `${((billingUsage.storage_used_bytes || 0) / 1_073_741_824).toFixed(1)} GB`}{' '}
                        / {billingUsage.storage_limit_bytes / 1_073_741_824 >= 1
                          ? `${(billingUsage.storage_limit_bytes / 1_073_741_824).toFixed(0)} GB`
                          : `${(billingUsage.storage_limit_bytes / 1_048_576).toFixed(0)} MB`}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/5">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          storageNearLimit ? 'bg-amber-400' : 'bg-[var(--app-accent)]'
                        }`}
                        style={{ width: `${storagePct}%` }}
                      />
                    </div>
                    {storageNearLimit && (
                      <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                        Storage almost full — upgrade for more space.
                      </p>
                    )}
                  </>
                ) : null}
              </div>
            )}

            {(!billingUsage || billingUsage.plan === 'Free') && (
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 gap-1.5">
                  {([
                    { key: 'Pro', label: 'Pro', price: '$8', unit: '/mo' },
                    { key: 'Team', label: 'Team', price: '$15', unit: '/seat' },
                  ] as const).map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setPlan(p.key)}
                      className={`rounded-lg border px-2 py-1.5 text-center transition-colors ${
                        plan === p.key
                          ? 'border-[var(--app-accent)] bg-[var(--app-accent)]/10 ring-1 ring-[var(--app-accent)]'
                          : 'border-black/10 hover:border-black/20'
                      }`}
                    >
                      <span className="block text-xs font-semibold text-ink">{p.label}</span>
                      <span className="block text-[11px] text-ink/60">
                        {p.price}{p.unit === '/seat' ? '/seat' : '/mo'}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="text-[11px] leading-relaxed text-ink/45">
                  Need SSO, audit or dedicated infrastructure?{' '}
                  <a href="mailto:hello@livefolio.cloud" className="font-semibold text-[var(--app-accent)]">Enterprise — contact us</a>
                </p>
                {plan === 'Team' ? (
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 text-sm font-medium text-ink">
                      <Users size={13} className="text-[var(--app-accent)]" />
                      Seats
                    </label>
                    <span className="text-[13px] font-medium text-ink tabular-nums">
                      {teamSeats} {teamSeats === 1 ? 'seat' : 'seats'}
                    </span>
                  </div>
                ) : null}
                {plan === 'Team' ? (
                  <input
                    type="range"
                    min="1"
                    max="50"
                    value={teamSeats}
                    onChange={(e) => setTeamSeats(parseInt(e.target.value))}
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-black/5 accent-[var(--app-accent)]"
                  />
                ) : null}
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-ink/60">
                    {plan === 'Pro' ? '$8 / month' : '$15 / seat'}
                  </span>
                  <span className="font-medium text-[var(--app-accent)]">
                    {plan === 'Pro' ? 'Total: $8 / mo' : `Total: $${teamSeats * 15} / mo`}
                  </span>
                </div>
              </div>
            )}

            <div className="pt-1">
              <button
                type="button"
                onClick={handleBillingAction}
                disabled={loadingBilling}
                className="h-8 rounded-lg bg-[var(--app-accent)] px-4 text-xs font-semibold text-white transition-colors hover:bg-[var(--app-accent)]/90 disabled:opacity-50"
              >
                {loadingBilling ? 'Processing…' : billingUsage?.plan === 'Free' ? `Upgrade to ${plan}` : 'Manage Subscription'}
              </button>
            </div>

            {billingError && (
              <p className="flex items-start gap-1.5 text-xs font-medium text-red-600">
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
                {billingError}
              </p>
            )}
          </SectionShell>
    </>
  );
}
