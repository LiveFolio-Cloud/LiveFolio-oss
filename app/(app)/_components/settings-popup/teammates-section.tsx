'use client';

/**
 * Settings popup — Teammates & Seating section (Cloud). Invite by email
 * with a role, the teammate directory with role updates and revoke.
 * Shares state with the Billing section via useBillingTeammates.
 */
import { Trash2, Users } from 'lucide-react';
import { SectionShell } from './section-shell';
import { useBillingTeammates } from './use-billing-teammates';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Dropdown } from '@/components/ui/dropdown';

export function TeammatesSection() {
  const {
    billingUsage, isAdmin,
    teammates, loadingTeammates,
    inviteEmail, setInviteEmail, inviteRole, setInviteRole, invitingTeammate,
    handleInviteTeammate, showUpgradeCTA,
    isUpdatingRole, isRemovingTeammate, handleUpdateTeammateRole, handleRemoveTeammate,
    handleBillingAction, loadingBilling,
  } = useBillingTeammates();

  if (!isAdmin) return null;

  return (
    <>
<SectionShell icon={Users} title="Teammates & Seating">
            <div className="flex items-center justify-between">
              <span className="rounded-full bg-[var(--app-accent)]/10 px-2.5 py-0.5 text-xs font-semibold text-[var(--app-accent)]">
                Active plan: {billingUsage?.plan || 'Free'}
              </span>
            </div>
            <p className="text-[13px] leading-relaxed text-ink/60">
              Invite coworkers to collaborate on shared folios and manage resource
              allocations.
            </p>

            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-ink">Invite a teammate</span>
                <span className="text-xs text-ink/60">Free &amp; Pro: 1 seat • Team: unlimited</span>
              </div>
              <form onSubmit={handleInviteTeammate} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  type="email"
                  placeholder="co-author@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                  className="h-8 min-w-0 flex-1 border-0 border-b border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 bg-transparent px-0.5 text-[13px] text-ink placeholder:text-ink/50 focus:border-b-2 focus:border-[var(--app-accent)] focus:outline-none transition-colors"
                />
                <Dropdown
                  value={inviteRole}
                  onChange={(v) => setInviteRole(v as 'Admin' | 'Member')}
                  options={['Member', 'Admin']}
                  ariaLabel="Invite role"
                  menuClassName="w-32"
                  className="h-8 rounded-lg border border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 bg-transparent px-2 text-[13px] text-ink"
                />
                <button
                  type="submit"
                  disabled={invitingTeammate}
                  className="h-8 shrink-0 rounded-lg bg-[var(--app-accent)] px-4 text-xs font-semibold text-white transition-colors hover:bg-[var(--app-accent)]/90 disabled:opacity-50"
                >
                  {invitingTeammate ? 'Inviting…' : 'Invite'}
                </button>
              </form>

              {showUpgradeCTA && (
                <div className="space-y-2 rounded-lg bg-[var(--app-accent)]/5 p-3">
                  <p className="text-[13px] font-medium text-ink">
                    Teammate seating is a Team plan feature.
                  </p>
                  <button
                    type="button"
                    onClick={() => handleBillingAction({ intent: 'manage' })}
                    disabled={loadingBilling}
                    className="h-8 rounded-lg bg-[var(--app-accent)] px-3 text-xs font-semibold text-white transition-colors hover:bg-[var(--app-accent)]/90"
                  >
                    Upgrade to Team
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <h4 className="text-sm font-medium text-ink">Teammate directory</h4>
              {loadingTeammates ? (
                <p className="flex items-center gap-2 py-3 text-sm text-ink/60">
                  <LoadingSpinner size="xs" />
                  Loading…
                </p>
              ) : teammates.length === 0 ? (
                <p className="py-2 text-[13px] text-ink/60">
                  No other teammates in this organization.
                </p>
              ) : (
                <div className="divide-y divide-ink/5">
                  {teammates.map((member) => (
                    <div key={member.id} className="flex items-center justify-between py-2.5">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/5 text-xs font-semibold text-ink/70">
                          {member.name ? member.name.slice(0, 2) : 'TM'}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium text-ink">
                            {member.name || 'Teammate'}
                          </p>
                          <p className="truncate text-xs text-ink/60">{member.email}</p>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        {member.role !== 'Owner' ? (
                          <Dropdown
                            value={member.role ?? ''}
                            onChange={(v) => handleUpdateTeammateRole(member.id, v as 'Admin' | 'Member')}
                            disabled={isUpdatingRole === member.id}
                            options={['Member', 'Admin']}
                            ariaLabel={`Role for ${member.name || 'teammate'}`}
                            menuClassName="w-32"
                            className="h-7 rounded-lg border border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 bg-transparent px-1.5 text-xs text-ink"
                          />
                        ) : (
                          <span className="rounded-full bg-[var(--app-accent)]/10 px-2.5 py-0.5 text-xs font-semibold text-[var(--app-accent)]">
                            {member.role}
                          </span>
                        )}

                        {member.role !== 'Owner' && (
                          <button
                            type="button"
                            onClick={() => handleRemoveTeammate(member.id)}
                            disabled={isRemovingTeammate === member.id}
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-ink/50 transition-colors hover:bg-black/5 hover:text-red-600 disabled:opacity-50"
                            aria-label={`Revoke ${member.name || 'teammate'}`}
                          >
                            {isRemovingTeammate === member.id ? (
                              <LoadingSpinner size="sm" />
                            ) : (
                              <Trash2 size={13} />
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </SectionShell>
    </>
  );
}