'use client';

/**
 * Settings popup — Analytics section (both modes).
 *
 * Two scopes:
 * - "All folios" (default): combined KPIs across every folio + a ranked
 *   "Top folios" list (sorted by views, with rank and share %).
 * - A specific folio: that folio's KPIs, views/time breakdown, and the
 *   governance block — status (publish/unpublish), privacy, comments and
 *   reaction feedback. The status section exists ONLY in folio scope.
 *
 * Same /api/files endpoints as the analytics page; the select is the scope
 * filter. Defaults to all folios combined.
 */
import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { BarChart3, Eye, Clock, MessageSquare, ThumbsUp, History, Users, UserPlus, Wallet, ShoppingBag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isOSS } from '@/lib/env';
import { SectionShell } from './section-shell';
import { Toggle } from './toggle';
import { Dropdown } from '@/components/ui/dropdown';

interface FolioComment {
  id: string;
  text: string;
  author?: string;
  filename?: string;
  resolved?: boolean;
}

interface Folio {
  id: string;
  title: string;
  description?: string;
  status?: string;
  isPrivate?: boolean;
  allowComments?: boolean;
  accessKey?: string;
  versions?: unknown[];
  comments?: FolioComment[];
  reactions?: Record<string, number>;
  analytics?: {
    views: number;
    totalTimeSeconds: number;
    avgTimeSeconds: number;
    mobileViews?: number;
    desktopViews?: number;
  };
}

/** Empty scope = the combined all-folios view. */
const ALL_SCOPE = '';

/** $12.50 style — trims trailing zeros on whole amounts. */
function formatMoney(cents: number): string {
  const whole = cents / 100;
  const hasFraction = Math.round(cents) % 100 !== 0;
  return `$${whole.toLocaleString('en-US', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

function KpiCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-lg bg-black/[0.03] dark:bg-white/[0.04] px-3 py-2.5">
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-[11px] font-medium text-ink/60">{label}</span>
        <Icon size={12} strokeWidth={2.5} className="shrink-0 text-ink/35" />
      </div>
      <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-ink">{value}</p>
    </div>
  );
}

export function ReportsSection() {
  const [folios, setFolios] = useState<Folio[]>([]);
  const [selectedId, setSelectedId] = useState<string>(ALL_SCOPE);
  const [isLoading, setIsLoading] = useState(true);
  const [savingField, setSavingField] = useState(false);
  // Audience & revenue KPIs (community/earnings are creator-wide, so they
  // only render in the "All folios" scope).
  const [followers, setFollowers] = useState<number | null>(null);
  const [following, setFollowing] = useState<number | null>(null);
  const [netCents, setNetCents] = useState<number | null>(null);
  const [salesCount, setSalesCount] = useState<number | null>(null);

  const load = async () => {
    try {
      const res = await fetch('/api/files');
      if (res.ok) {
        const data = (await res.json()) as Folio[];
        setFolios(data);
      }
    } catch (err) {
      console.error('Failed to load folios:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Audience + earnings totals (best-effort; zeros/– when unavailable).
  const loadCommunityAndRevenue = async () => {
    try {
      const profileRes = await fetch('/api/profile');
      const profile = profileRes.ok ? (await profileRes.json())?.profile : null;
      if (profile?.username) {
        const [fRes, gRes] = await Promise.all([
          fetch(`/api/profile/${profile.username}/followers`),
          fetch(`/api/profile/${profile.username}/following`),
        ]);
        const f = fRes.ok ? await fRes.json() : null;
        const g = gRes.ok ? await gRes.json() : null;
        setFollowers(Number(f?.total) || 0);
        setFollowing(Number(g?.total) || 0);
      } else {
        setFollowers(0);
        setFollowing(0);
      }
    } catch {
      setFollowers(null);
      setFollowing(null);
    }
    try {
      const res = await fetch('/api/billing/connect/sales');
      const data = res.ok ? await res.json() : null;
      if (data && typeof data.totalNetCents === 'number') {
        setNetCents(data.totalNetCents);
        setSalesCount(Array.isArray(data.sales) ? data.sales.filter((x: { status: string }) => x.status !== 'refunded').length : 0);
      }
    } catch {
      setNetCents(null);
      setSalesCount(null);
    }
  };

  useEffect(() => {
    load();
    // Followers/earnings KPIs are cloud-only (Supabase profiles + Stripe
    // Connect); skipping the call in OSS avoids 404 fetches for zeros.
    if (!isOSS) loadCommunityAndRevenue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scopeFolio = folios.find((f) => f.id === selectedId) || null;

  const put = async (field: string, value: boolean | string) => {
    if (!scopeFolio || savingField) return;
    setSavingField(true);
    try {
      const res = await fetch(`/api/files/${scopeFolio.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (res.ok) await load();
    } catch (err) {
      console.error('Failed to update folio:', err);
    } finally {
      setSavingField(false);
    }
  };

  // Combined totals + ranked list (shared by both scopes).
  const totals = {
    views: folios.reduce((a, f) => a + (f.analytics?.views ?? 0), 0),
    comments: folios.reduce((a, f) => a + (f.comments?.length ?? 0), 0),
    reactions: folios.reduce(
      (a, f) => a + Object.values(f.reactions ?? {}).reduce((x, y) => x + y, 0),
      0
    ),
    checkpoints: folios.reduce((a, f) => a + (f.versions?.length ?? 0), 0),
  };

  const ranked = folios
    .map((f) => ({ folio: f, views: f.analytics?.views ?? 0 }))
    .filter((x) => x.views > 0)
    .sort((a, b) => b.views - a.views)
    .slice(0, 5);
  const maxViews = ranked[0]?.views ?? 1;

  return (
    <>
      <SectionShell icon={BarChart3} title="Analytics">
        {isLoading ? (
          <p className="text-[13px] text-ink/60">Loading…</p>
        ) : folios.length === 0 ? (
          <p className="text-[13px] text-ink/60">No folios yet.</p>
        ) : (
          <div className="space-y-4">
            {/* Scope filter — "All folios" is the landing view */}
            <Dropdown
              value={selectedId}
              onChange={setSelectedId}
              options={[
                { value: ALL_SCOPE, label: `All folios (${folios.length})` },
                ...folios.map((f) => ({ value: f.id, label: f.title || 'Untitled' })),
              ]}
              ariaLabel="Filter by folio"
              menuClassName="w-64 max-h-72 overflow-y-auto"
              className="h-8 w-full rounded-lg border border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 bg-transparent px-2 text-[13px] text-ink"
            />

            {scopeFolio === null ? (
              /* ── Combined view: every folio, one screen ── */
              <>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <KpiCard icon={Eye} label="Views" value={totals.views} />
                  <KpiCard icon={MessageSquare} label="Comments" value={totals.comments} />
                  <KpiCard icon={ThumbsUp} label="Reactions" value={totals.reactions} />
                  <KpiCard icon={History} label="Checkpoints" value={totals.checkpoints} />
                </div>

                {/* Audience & revenue — creator-wide KPIs (cloud-only: follow
                    network + Stripe Connect; never render in OSS where the
                    endpoints are excluded from the sync) */}
                {!isOSS && (
                  <>
                    <p className="pt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-ink/40">
                      Audience &amp; revenue
                    </p>
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                      <KpiCard icon={Users} label="Followers" value={followers ?? '–'} />
                      <KpiCard icon={UserPlus} label="Following" value={following ?? '–'} />
                      <KpiCard
                        icon={Wallet}
                        label="Net earnings"
                        value={netCents == null ? '–' : formatMoney(netCents)}
                      />
                      <KpiCard icon={ShoppingBag} label="Sales" value={salesCount ?? '–'} />
                    </div>
                  </>
                )}

                <div className="rounded-lg bg-black/[0.03] dark:bg-white/[0.04] p-3">
                  <div className="mb-2.5 flex items-baseline justify-between gap-2">
                    <p className="text-xs font-semibold text-ink/70">Top folios</p>
                    <span className="text-[11px] text-ink/40">by views</span>
                  </div>
                  {ranked.length === 0 ? (
                    <p className="text-xs text-ink/50">
                      No views recorded yet — share a folio to get started.
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      {ranked.map(({ folio, views }, i) => {
                        const share = totals.views > 0 ? Math.round((views / totals.views) * 100) : 0;
                        return (
                          <div key={folio.id} className="flex items-center gap-2.5">
                            <span
                              className={cn(
                                'w-4 shrink-0 text-right text-xs tabular-nums',
                                i === 0 ? 'font-bold text-[var(--app-accent)]' : 'text-ink/40'
                              )}
                            >
                              {i + 1}
                            </span>
                            <span className="w-28 shrink-0 truncate text-xs text-ink/70">
                              {folio.title}
                            </span>
                            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                              <div
                                className="h-full rounded-full bg-[var(--app-accent)]"
                                style={{ width: `${Math.max(2, (views / maxViews) * 100)}%` }}
                              />
                            </div>
                            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-ink/70">
                              {views}
                            </span>
                            <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-ink/40">
                              {share}%
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {folios.length > 5 && (
                    <p className="mt-2.5 text-xs text-ink/50">
                      Top 5 of {folios.length} folios — pick one above for full stats.
                    </p>
                  )}
                </div>
              </>
            ) : (
              /* ── Folio scope: its stats + status & governance ── */
              <>
                <div className="grid grid-cols-2 gap-2">
                  <KpiCard icon={Eye} label="Views" value={scopeFolio.analytics?.views ?? 0} />
                  <KpiCard
                    icon={MessageSquare}
                    label="Comments"
                    value={scopeFolio.comments?.length ?? 0}
                  />
                  <KpiCard
                    icon={ThumbsUp}
                    label="Reactions"
                    value={Object.values(scopeFolio.reactions ?? {}).reduce((a, b) => a + b, 0)}
                  />
                  <KpiCard
                    icon={History}
                    label="Checkpoints"
                    value={scopeFolio.versions?.length ?? 0}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-black/[0.03] dark:bg-white/[0.04] px-3 py-2.5">
                    <div className="flex items-center gap-1.5 text-xs text-ink/60">
                      <Eye size={12} />
                      Views
                    </div>
                    <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink">
                      {scopeFolio.analytics?.views ?? 0}
                    </p>
                    <p className="text-xs text-ink/60">
                      {scopeFolio.analytics?.desktopViews ?? 0} desktop ·{' '}
                      {scopeFolio.analytics?.mobileViews ?? 0} mobile
                    </p>
                  </div>
                  <div className="rounded-lg bg-black/[0.03] dark:bg-white/[0.04] px-3 py-2.5">
                    <div className="flex items-center gap-1.5 text-xs text-ink/60">
                      <Clock size={12} />
                      Avg time
                    </div>
                    <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink">
                      {scopeFolio.analytics?.avgTimeSeconds
                        ? `${Math.round(scopeFolio.analytics.avgTimeSeconds / 60)}m`
                        : '—'}
                    </p>
                    <p className="text-xs text-ink/60">
                      {scopeFolio.analytics?.totalTimeSeconds
                        ? `${Math.round(scopeFolio.analytics.totalTimeSeconds / 60)}m total`
                        : 'No sessions yet'}
                    </p>
                  </div>
                </div>

                {/* Status of the folio — folio scope only */}
                <div className="space-y-3 border-t border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 pt-3">
                  <p className="text-xs font-semibold text-ink/70">Status of this folio</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-ink">Status</span>
                    <div className="flex items-center gap-2">
                      {scopeFolio.status === 'published' ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink/70">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          Published
                        </span>
                      ) : scopeFolio.isPrivate ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink/70">
                          <span className="h-1.5 w-1.5 rounded-full bg-[var(--app-accent)]" />
                          Private
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink/70">
                          <span className="h-1.5 w-1.5 rounded-full bg-ink/30" />
                          Draft
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          put(
                            'status',
                            scopeFolio.status === 'published' ? 'draft' : 'published'
                          )
                        }
                        disabled={savingField}
                        className="h-7 rounded-lg bg-[var(--app-accent)] px-3 text-xs font-semibold text-white transition-colors hover:bg-[var(--app-accent)]/90 disabled:opacity-50"
                      >
                        {scopeFolio.status === 'published' ? 'Unpublish' : 'Publish'}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-ink">Private folio</span>
                    <Toggle
                      checked={Boolean(scopeFolio.isPrivate)}
                      onChange={() => put('isPrivate', !scopeFolio.isPrivate)}
                      disabled={savingField}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-ink">Allow comments</span>
                    <Toggle
                      checked={Boolean(scopeFolio.allowComments)}
                      onChange={() => put('allowComments', !scopeFolio.allowComments)}
                      disabled={savingField}
                    />
                  </div>
                </div>

                <div className="space-y-2 border-t border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-ink">Open comments</span>
                    <span className="text-[13px] font-medium tabular-nums text-ink">
                      {(scopeFolio.comments || []).filter((c) => !c.resolved).length}
                    </span>
                  </div>
                  {(scopeFolio.comments || [])
                    .filter((c) => !c.resolved)
                    .slice(0, 5)
                    .map((c) => (
                      <div key={c.id} className="rounded-lg bg-black/[0.03] dark:bg-white/[0.04] px-2.5 py-1.5">
                        <p className="text-[13px] leading-snug text-ink">{c.text}</p>
                        <p className="mt-0.5 text-xs text-ink/60">
                          {c.author || 'Guest'} · {c.filename || 'page'}
                        </p>
                      </div>
                    ))}
                  {(scopeFolio.comments || []).filter((c) => !c.resolved).length === 0 && (
                    <p className="text-[13px] text-ink/60">No open comments.</p>
                  )}
                </div>

                <div className="space-y-2 border-t border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 pt-3">
                  <span className="text-[13px] text-ink">Reaction feedback</span>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { emoji: '👍', key: 'thumbs', count: scopeFolio.reactions?.['👍'] || 0 },
                      { emoji: '❤️', key: 'heart', count: scopeFolio.reactions?.['❤️'] || 0 },
                      { emoji: '💡', key: 'idea', count: scopeFolio.reactions?.['💡'] || 0 },
                      { emoji: '🔥', key: 'fire', count: scopeFolio.reactions?.['🔥'] || 0 },
                    ].map((r) => (
                      <div key={r.key} className="rounded-lg bg-black/[0.03] dark:bg-white/[0.04] px-2 py-1.5 text-center">
                        <span className="text-sm">{r.emoji}</span>
                        <p className="text-[13px] font-semibold tabular-nums text-ink">{r.count}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </SectionShell>
    </>
  );
}
