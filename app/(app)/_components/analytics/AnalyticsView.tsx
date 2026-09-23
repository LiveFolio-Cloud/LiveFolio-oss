'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  Clock,
  Eye,
  History,
  Loader2,
  MessageSquare,
  Monitor,
  ShoppingBag,
  Smartphone,
  ThumbsUp,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { isCloud, isOSS } from '@/lib/env';
import { Dropdown } from '@/components/ui/dropdown';
import {
  commentTimestamps,
  compactNumber,
  feedbackSeries,
  spanInDays,
  type SeriesPoint,
} from '@/lib/analytics-chart';
// Shared with the folio Metrics tab — one chart implementation, one data source.
import TrendChart from '@/components/charts/TrendChart';

/**
 * Every field is optional on purpose: this is read from a JSONB column whose
 * default is `{}`, so a folio created before a metric existed genuinely has no
 * such key. Typing them as required would be a lie the compiler enforces.
 */
interface FolioAnalytics {
  views?: number;
  totalTimeSeconds?: number;
  avgTimeSeconds?: number;
  mobileViews?: number;
  desktopViews?: number;
}

export interface AnalyticsFolio {
  id: string;
  title: string;
  status?: string;
  analytics?: FolioAnalytics;
  comments?: unknown[];
  reactions?: Record<string, number>;
  versions?: unknown[];
}

/** Sentinel for the "All folios" scope — an empty id cannot collide with a UUID. */
const ALL_SCOPE = '';

/** Formats a duration in seconds as "4m" / "48s" / "1h 3m". */
export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

/** Cents → "$1,234.56" ("$1,234" when there are no cents to show). */
export function formatMoney(cents: number): string {
  const whole = cents / 100;
  const hasFraction = Math.round(whole * 100) % 100 !== 0;
  return `$${whole.toLocaleString('en-US', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

export interface FolioTotals {
  views: number;
  comments: number;
  reactions: number;
  checkpoints: number;
}

/** Combined totals across every folio — the "All folios" KPI row. */
export function sumTotals(folios: AnalyticsFolio[]): FolioTotals {
  return {
    views: folios.reduce((a, f) => a + (f.analytics?.views ?? 0), 0),
    comments: folios.reduce((a, f) => a + (Array.isArray(f.comments) ? f.comments.length : 0), 0),
    reactions: folios.reduce(
      (a, f) => a + Object.values(f.reactions ?? {}).reduce((x, y) => x + (Number(y) || 0), 0),
      0,
    ),
    checkpoints: folios.reduce((a, f) => a + (f.versions?.length ?? 0), 0),
  };
}

export interface RankedFolio {
  id: string;
  title: string;
  views: number;
  /** Share of the creator's total views, 0–1. */
  share: number;
  avgTimeSeconds: number;
}

/**
 * Rank EVERY folio that has views, highest first.
 *
 * Deliberately uncapped: the previous home for this (the settings modal) showed
 * only the top five and told you to pick one from the scope menu for the rest.
 * A ranking that hides rows is a summary; this page is the place you come to
 * see all of them.
 */
export function rankFolios(
  folios: AnalyticsFolio[],
  totals: FolioTotals,
): { ranked: RankedFolio[]; withoutViews: number } {
  const withViews = folios.filter((f) => (f.analytics?.views ?? 0) > 0);
  const ranked = withViews
    .map((f) => ({
      id: f.id,
      title: f.title || 'Untitled',
      views: f.analytics?.views ?? 0,
      share: totals.views > 0 ? (f.analytics?.views ?? 0) / totals.views : 0,
      avgTimeSeconds: f.analytics?.avgTimeSeconds ?? 0,
    }))
    .sort((a, b) => b.views - a.views);
  return { ranked, withoutViews: folios.length - withViews.length };
}

/** Per-folio KPI row, shared by both scopes. Compact so the tiles stay even. */
function KpiGrid({ totals }: { totals: FolioTotals }) {
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <Kpi icon={Eye} label="Views" value={compactNumber(totals.views)} />
      <Kpi icon={MessageSquare} label="Comments" value={compactNumber(totals.comments)} />
      <Kpi icon={ThumbsUp} label="Reactions" value={compactNumber(totals.reactions)} />
      <Kpi icon={History} label="Checkpoints" value={compactNumber(totals.checkpoints)} />
    </div>
  );
}


/**
 * Creator analytics, as its own destination.
 *
 * Two scopes, exactly as the settings section had them — the whole point of
 * this surface is being able to ask "how is everything doing" AND "how is THIS
 * one doing":
 *
 * - **All folios**: combined KPIs, audience & revenue, and every folio ranked.
 * - **A single folio**: that folio's KPIs, its device split, and its time
 *   on page.
 *
 * What did NOT come along is the publish/private/allow-comments block that used
 * to sit in folio scope — that is governance, it was split out to Settings →
 * Publishing, and mixing "how is it doing" with "what should it do" is what
 * made the original hard to read.
 *
 * Two trends are drawn, and the difference between them matters:
 *
 * - **Feedback** has genuine history — comments carry `createdAt` back to the
 *   first one ever left, so "All time" shows the whole real arc.
 * - **Views** have none: `folios.analytics` is a JSONB blob of lifetime totals
 *   with no time dimension, and daily counting only began when
 *   `folio_daily_stats` was deployed. A folio with years of views and one day
 *   of daily rows is normal, and the chart says so rather than inventing a line.
 */
export default function AnalyticsView() {
  const [folios, setFolios] = useState<AnalyticsFolio[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>(ALL_SCOPE);
  const [followers, setFollowers] = useState<number | null>(null);
  const [following, setFollowing] = useState<number | null>(null);
  const [netCents, setNetCents] = useState<number | null>(null);
  const [salesCount, setSalesCount] = useState<number | null>(null);
  const [viewsSeries, setViewsSeries] = useState<SeriesPoint[] | null>(null);
  const [collectingSince, setCollectingSince] = useState<string | null>(null);
  /** False when the daily-stats store is missing — a deploy gap, not no traffic. */
  const [viewsAvailable, setViewsAvailable] = useState(true);
  // One stable "now" per mount: recomputing it every render would shift the
  // day buckets (and any local-midnight boundary) under the user.
  const [now] = useState(() => Date.now());
  /**
   * Chart window. 14 days is the default — it is the window this surface has
   * always been labelled with, and a fortnight is enough to see a shape without
   * a spike from six weeks ago flattening everything recent.
   * 'all' resolves to the real span of the account's history.
   */
  const [range, setRange] = useState<'14' | '30' | '90' | 'all'>('14');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/files', { cache: 'no-store' });
        const data = res.ok ? ((await res.json()) as AnalyticsFolio[]) : [];
        if (!cancelled) setFolios(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setFolios([]);
      }
    })();

    // Audience + revenue — creator-wide, cloud-only (the follow network and a
    // seller payout account do not exist in OSS). Best-effort: a failure leaves
    // the KPI showing "—" rather than breaking the page.
    if (isCloud) {
      (async () => {
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
            if (!cancelled) {
              setFollowers(Number(f?.total) || 0);
              setFollowing(Number(g?.total) || 0);
            }
          } else if (!cancelled) {
            setFollowers(0);
            setFollowing(0);
          }
        } catch {
          if (!cancelled) {
            setFollowers(null);
            setFollowing(null);
          }
        }
        try {
          const res = await fetch('/api/billing/connect/sales');
          const data = res.ok ? await res.json() : null;
          if (data && typeof data.totalNetCents === 'number' && !cancelled) {
            setNetCents(data.totalNetCents);
            setSalesCount(
              Array.isArray(data.sales)
                ? data.sales.filter((x: { status: string }) => x.status !== 'refunded').length
                : 0,
            );
          }
        } catch {
          if (!cancelled) setNetCents(null);
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, []);

  // Memoised so the `?? []` fallback does not produce a fresh array each render
  // — that would invalidate every memo below on every keystroke elsewhere.
  const list = useMemo(() => folios ?? [], [folios]);
  const totals = useMemo(() => sumTotals(list), [list]);
  const { ranked, withoutViews } = useMemo(() => rankFolios(list, totals), [list, totals]);
  const scopeFolio = list.find((f) => f.id === selectedId) || null;

  // Feedback per day, scoped the same way as everything else on the page.
  const scopedFolios = useMemo(
    () => (scopeFolio ? [scopeFolio] : list),
    [scopeFolio, list],
  );
  // "All time" resolves to the oldest piece of real history this account has,
  // rather than a fixed window — so it genuinely shows everything recorded.
  const chartDays = useMemo(
    () => (range === 'all' ? spanInDays(commentTimestamps(scopedFolios), now) : Number(range)),
    [range, scopedFolios, now],
  );
  const feedback = useMemo(
    () => feedbackSeries(scopedFolios, chartDays, now),
    [scopedFolios, chartDays, now],
  );

  // The views trend — refetched per scope AND per window: "last 30 days" is a
  // different series for one folio than for all of them.
  useEffect(() => {
    let cancelled = false;
    setViewsSeries(null);
    const params = new URLSearchParams({ days: String(chartDays) });
    if (selectedId) params.set('folioId', selectedId);
    (async () => {
      try {
        const res = await fetch(`/api/analytics/daily?${params.toString()}`, { cache: 'no-store' });
        const data = res.ok ? await res.json() : null;
        if (cancelled) return;
        setViewsSeries(Array.isArray(data?.series) ? data.series : []);
        setCollectingSince(typeof data?.collectingSince === 'string' ? data.collectingSince : null);
        setViewsAvailable(data?.available !== false);
      } catch {
        if (!cancelled) {
          setViewsSeries([]);
          setViewsAvailable(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, chartDays]);

  // Bars scale against the LEADING folio rather than the total: with twenty
  // folios a share-of-total bar renders every row at a few percent and
  // communicates nothing. The percentage beside it still carries the real share.
  const maxViews = ranked[0]?.views ?? 0;

  const deviceTotal = list.reduce(
    (a, f) => a + (f.analytics?.desktopViews ?? 0) + (f.analytics?.mobileViews ?? 0),
    0,
  );

  if (folios === null) {
    return (
      <main className="flex h-full min-h-0 flex-1 items-center justify-center">
        <Loader2 size={16} className="animate-spin text-ink/20" />
      </main>
    );
  }

  const scopeTotals: FolioTotals = scopeFolio
    ? {
        views: scopeFolio.analytics?.views ?? 0,
        comments: Array.isArray(scopeFolio.comments) ? scopeFolio.comments.length : 0,
        reactions: Object.values(scopeFolio.reactions ?? {}).reduce(
          (a, b) => a + (Number(b) || 0),
          0,
        ),
        checkpoints: scopeFolio.versions?.length ?? 0,
      }
    : totals;

  /**
   * The views chart's empty state has three different causes, and they must not
   * look alike: a deployment gap, a freshly-started series, and genuinely no
   * traffic. An empty line reads as "nobody visited" — a lie for the first two.
   */
  const viewsEmptyMessage = !viewsAvailable
    ? 'Trend collection is not running yet — the daily-stats migration has not been applied to this project.'
    : collectingSince
      ? `Collecting daily views since ${collectingSince} — the line appears once there is a day to draw.`
      : // No daily rows. Distinguish "you have traffic that predates daily
        // collection" from "you genuinely have none" — a lifetime view count
        // above zero means the former, and "no views" would be false.
        scopeTotals.views > 0
        ? `${compactNumber(scopeTotals.views)} lifetime views, but per-day counts start from the day collection began — daily history was never recorded. The line appears after the first day of new traffic.`
        : 'No views recorded yet — share a folio to start the trend.';

  const scopeDesktop = scopeFolio?.analytics?.desktopViews ?? 0;
  const scopeMobile = scopeFolio?.analytics?.mobileViews ?? 0;
  const scopeDeviceTotal = scopeDesktop + scopeMobile;
  const scopeDesktopPct = scopeDeviceTotal > 0 ? Math.round((scopeDesktop / scopeDeviceTotal) * 100) : 0;

  return (
    <main className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2.5 px-6 pb-3 pt-5">
        <TrendingUp size={15} className="text-[var(--app-accent)]" />
        <h1 className="text-lg font-bold tracking-tight text-ink">Analytics</h1>
        {/* Scope control, sized to its label rather than stretched across the
            header. It reads as part of the title — "Analytics, of all folios" —
            instead of as a form field parked on the right. The menu keeps its
            own width, so a long folio title truncates here but stays readable
            in the list. */}
        <Dropdown
          value={selectedId}
          onChange={setSelectedId}
          options={[
            { value: ALL_SCOPE, label: `All folios (${list.length})` },
            ...list.map((f) => ({ value: f.id, label: f.title || 'Untitled' })),
          ]}
          ariaLabel="Filter by folio"
          menuClassName="w-72 max-h-72 overflow-y-auto"
          className="h-7 max-w-[16rem] rounded-full bg-black/[0.04] px-2.5 text-[12px] font-medium text-ink/65 transition-colors hover:bg-black/[0.07] hover:text-ink dark:bg-white/[0.06] dark:hover:bg-white/10"
        />
        {/* Window control. "All time" is real here for feedback (comments carry
            timestamps going back to the first ever left) and honest for views
            (which only have history from the day collection started). */}
        <div className="ml-auto flex shrink-0 items-center gap-0.5 rounded-full bg-black/[0.04] p-0.5 dark:bg-white/[0.06]">
          {(
            [
              ['14', '14d'],
              ['30', '30d'],
              ['90', '90d'],
              ['all', 'All time'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setRange(value)}
              aria-pressed={range === value}
              className={
                'cursor-pointer rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ' +
                (range === value
                  ? 'bg-bone text-ink shadow-sm'
                  : 'text-ink/55 hover:text-ink')
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-16">
        <div className="mx-auto w-full max-w-4xl space-y-6">
          {list.length === 0 ? (
            <Empty>No folios yet — publish one to start collecting views.</Empty>
          ) : scopeFolio === null ? (
            /* ── All folios ─────────────────────────────────────────── */
            <>
              <KpiGrid totals={totals} />

              {/* The charts lead: a KPI row is a snapshot, and the question
                  "is this growing" is the one analytics exists to answer. */}
              {viewsSeries === null ? (
                <ChartSkeleton />
              ) : (
                <TrendChart
                  series={viewsSeries}
                  label="Views"
                  emptyMessage={viewsEmptyMessage}
                />
              )}
              <TrendChart
                series={feedback}
                label="Feedback"
                emptyMessage="No comments or pins in the last 30 days."
              />

              {!isOSS && (
                <>
                  <h2 className="pt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-ink/40">
                    Audience &amp; revenue
                  </h2>
                  <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                    <Kpi icon={Users} label="Followers" value={followers ?? '—'} />
                    <Kpi icon={UserPlus} label="Following" value={following ?? '—'} />
                    <Kpi
                      icon={Wallet}
                      label="Net earnings"
                      value={netCents === null ? '—' : formatMoney(netCents)}
                    />
                    <Kpi icon={ShoppingBag} label="Sales" value={salesCount ?? '—'} />
                  </div>
                </>
              )}

              <section>
                <h2 className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-ink/40">
                  All folios by views
                </h2>
                {ranked.length === 0 ? (
                  <Empty>No views recorded yet — share a folio to get started.</Empty>
                ) : (
                  <div className="overflow-hidden rounded-xl ring-1 ring-[#0F0F0D]/5 dark:ring-white/10">
                    {ranked.map((f, i) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setSelectedId(f.id)}
                        title={`See ${f.title}'s stats`}
                        className="group flex w-full cursor-pointer items-center gap-3 border-b border-[#0F0F0D]/[0.04] px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-[#0F0F0D]/[0.03] dark:border-white/[0.06] dark:hover:bg-white/5"
                      >
                        <span
                          className={
                            'w-4 shrink-0 text-right text-[11px] tabular-nums ' +
                            (i === 0 ? 'font-bold text-[var(--app-accent)]' : 'text-ink/35')
                          }
                        >
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-[13px] font-medium text-ink">
                              {f.title}
                            </span>
                            <ArrowUpRight
                              size={11}
                              className="shrink-0 text-ink/0 transition-colors group-hover:text-[var(--app-accent)]"
                            />
                          </span>
                          <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-black/[0.05] dark:bg-white/[0.08]">
                            <span
                              className="block h-full rounded-full bg-[var(--app-accent)]/70"
                              style={{
                                width: `${maxViews > 0 ? Math.max(2, (f.views / maxViews) * 100) : 0}%`,
                              }}
                            />
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-[13px] font-semibold tabular-nums text-ink">
                            {f.views.toLocaleString()}
                          </span>
                          <span className="block text-[11px] tabular-nums text-ink/40">
                            {Math.round(f.share * 100)}% · {formatDuration(f.avgTimeSeconds)}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {withoutViews > 0 && (
                  <p className="mt-2 text-[11px] text-ink/40">
                    {withoutViews === 1
                      ? '1 folio has no views yet'
                      : `${withoutViews} folios have no views yet`}{' '}
                    — pick one above to see its stats.
                  </p>
                )}
              </section>

              {deviceTotal > 0 && (
                <section>
                  <h2 className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-ink/40">
                    Where they read
                  </h2>
                  <DeviceSplit folios={list} />
                </section>
              )}
            </>
          ) : (
            /* ── A single folio ─────────────────────────────────────── */
            <>
              <div className="flex items-center gap-2">
                <h2 className="truncate text-[13px] font-semibold text-ink">{scopeFolio.title}</h2>
                {scopeFolio.status === 'draft' && (
                  <span className="shrink-0 rounded bg-black/5 px-1.5 text-[9px] font-bold uppercase tracking-wide text-ink/45 dark:bg-white/10">
                    draft
                  </span>
                )}
                <Link
                  href={`/app/${scopeFolio.id}`}
                  className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-ink/50 transition-colors hover:text-[var(--app-accent)]"
                >
                  Open folio <ArrowUpRight size={10} />
                </Link>
              </div>

              <KpiGrid totals={scopeTotals} />

              {viewsSeries === null ? (
                <ChartSkeleton />
              ) : (
                <TrendChart
                  series={viewsSeries}
                  label="Views"
                  emptyMessage={viewsEmptyMessage}
                />
              )}
              <TrendChart
                series={feedback}
                label="Feedback"
                emptyMessage="No comments or pins in the last 30 days."
              />

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl px-3 py-2.5 ring-1 ring-[#0F0F0D]/5 dark:ring-white/10">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink/55">
                    <Eye size={12} className="text-ink/30" />
                    Views
                  </div>
                  <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-ink">
                    {scopeTotals.views.toLocaleString()}
                  </p>
                  <p className="text-[11px] text-ink/40">
                    {scopeDesktop} desktop · {scopeMobile} mobile
                  </p>
                </div>
                <div className="rounded-xl px-3 py-2.5 ring-1 ring-[#0F0F0D]/5 dark:ring-white/10">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink/55">
                    <Clock size={12} className="text-ink/30" />
                    Avg time
                  </div>
                  <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-ink">
                    {formatDuration(scopeFolio.analytics?.avgTimeSeconds ?? 0)}
                  </p>
                  <p className="text-[11px] text-ink/40">
                    {scopeFolio.analytics?.totalTimeSeconds
                      ? `${formatDuration(scopeFolio.analytics.totalTimeSeconds)} total`
                      : 'No sessions yet'}
                  </p>
                </div>
              </div>

              {scopeDeviceTotal > 0 && (
                <section>
                  <h2 className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-ink/40">
                    Where they read
                  </h2>
                  <div className="rounded-xl p-3 ring-1 ring-[#0F0F0D]/5 dark:ring-white/10">
                    <div className="flex h-2 w-full overflow-hidden rounded-full bg-black/[0.05] dark:bg-white/[0.08]">
                      <span
                        className="h-full bg-[var(--app-accent)]/70"
                        style={{ width: `${scopeDesktopPct}%` }}
                      />
                    </div>
                    <div className="mt-2.5 flex items-center justify-between text-[12px]">
                      <span className="flex items-center gap-1.5 text-ink/70">
                        <Monitor size={12} className="text-[var(--app-accent)]/70" />
                        Desktop
                        <span className="font-semibold tabular-nums text-ink">{scopeDesktop}</span>
                      </span>
                      <span className="flex items-center gap-1.5 text-ink/70">
                        <Smartphone size={12} className="text-ink/40" />
                        Mobile
                        <span className="font-semibold tabular-nums text-ink">{scopeMobile}</span>
                      </span>
                    </div>
                  </div>
                </section>
              )}
            </>
          )}

          {/* Honest scope note — the reader should know what is NOT here. */}
          <p className="flex items-start gap-1.5 pt-1 text-[11px] leading-relaxed text-ink/35">
            <TrendingUp size={11} className="mt-0.5 shrink-0" />
            Lifetime totals only. Views are not bucketed by day yet, so there is no trend
            line — these numbers gain a time dimension once daily stats start collecting.
          </p>
        </div>
      </div>
    </main>
  );
}

/** Desktop/mobile composition across every folio. */
function DeviceSplit({ folios }: { folios: AnalyticsFolio[] }) {
  const desktop = folios.reduce((a, f) => a + (f.analytics?.desktopViews ?? 0), 0);
  const mobile = folios.reduce((a, f) => a + (f.analytics?.mobileViews ?? 0), 0);
  const total = desktop + mobile;
  const desktopPct = total > 0 ? Math.round((desktop / total) * 100) : 0;

  return (
    <div className="rounded-xl p-3 ring-1 ring-[#0F0F0D]/5 dark:ring-white/10">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-black/[0.05] dark:bg-white/[0.08]">
        <span className="h-full bg-[var(--app-accent)]/70" style={{ width: `${desktopPct}%` }} />
      </div>
      <div className="mt-2.5 flex items-center justify-between text-[12px]">
        <span className="flex items-center gap-1.5 text-ink/70">
          <Monitor size={12} className="text-[var(--app-accent)]/70" />
          Desktop
          <span className="font-semibold tabular-nums text-ink">{desktop.toLocaleString()}</span>
        </span>
        <span className="flex items-center gap-1.5 text-ink/70">
          <Smartphone size={12} className="text-ink/40" />
          Mobile
          <span className="font-semibold tabular-nums text-ink">{mobile.toLocaleString()}</span>
        </span>
      </div>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Eye;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-xl px-3 py-2.5 ring-1 ring-[#0F0F0D]/5 dark:ring-white/10">
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-[11px] font-medium text-ink/55">{label}</span>
        <Icon size={12} strokeWidth={2.5} className="shrink-0 text-ink/30" />
      </div>
      <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-ink">{value}</p>
    </div>
  );
}

/** Placeholder sized like a chart, so the page does not jump when it lands. */
function ChartSkeleton() {
  return (
    <div className="rounded-xl p-3 ring-1 ring-[#0F0F0D]/5 dark:ring-white/10" aria-hidden>
      <div className="mb-2 flex items-baseline justify-between">
        <div className="h-3 w-24 animate-pulse rounded bg-ink/[0.06]" />
        <div className="h-3 w-12 animate-pulse rounded bg-ink/[0.05]" />
      </div>
      <div className="h-[140px] w-full animate-pulse rounded-lg bg-ink/[0.04]" />
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-[#0F0F0D]/10 py-10 text-center dark:border-[#F4F4F0]/10">
      <p className="text-[13px] text-ink/45">{children}</p>
    </div>
  );
}
