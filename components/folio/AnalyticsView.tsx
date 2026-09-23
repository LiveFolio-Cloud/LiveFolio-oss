'use client';

import React, { useEffect, useState } from 'react';
import { Eye, Clock, MessageSquare, TrendingUp } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { HTMLFile } from '@/lib/db';
import { cn } from '@/lib/utils';
import TrendChart from '@/components/charts/TrendChart';
import { feedbackSeries, type SeriesPoint } from '@/lib/analytics-chart';

interface AnalyticsViewProps {
  project: HTMLFile;
}

/** The window both charts on this tab use — the familiar "14-day trend". */
const TREND_DAYS = 14;

/**
 * Fetch this folio's real daily view series.
 *
 * This panel used to draw a sparkline from `generateSparkline(totalViews)` — a
 * deterministic pseudo-random walk seeded by the LIFETIME TOTAL and labelled
 * "Views Over Time · 14-day trend". It was fabricated: the points were a
 * function of the view count and the loop index, never of any timestamped data,
 * so it showed a confident trend that meant nothing.
 *
 * The real series comes from `folio_daily_stats` (via /api/analytics/daily).
 * That table only starts collecting at its deploy, so a folio with existing
 * lifetime views legitimately has an empty series at first — the panel says so
 * rather than drawing a line.
 */
function useDailyViews(projectId: string): { series: SeriesPoint[] | null; available: boolean } {
  const [series, setSeries] = useState<SeriesPoint[] | null>(null);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/analytics/daily?days=${TREND_DAYS}&folioId=${encodeURIComponent(projectId)}`, {
          cache: 'no-store',
        });
        const data = res.ok ? await res.json() : null;
        if (cancelled) return;
        setSeries(Array.isArray(data?.series) ? data.series : []);
        setAvailable(data?.available !== false);
      } catch {
        if (!cancelled) setSeries([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return { series, available };
}

export default function AnalyticsView({ project }: AnalyticsViewProps) {
  const total = (project.analytics?.mobileViews || 0) + (project.analytics?.desktopViews || 0);
  const mobilePct = total > 0 ? Math.round(((project.analytics?.mobileViews || 0) / total) * 100) : 0;
  const desktopPct = total > 0 ? 100 - mobilePct : 0;
  const totalViews = project.analytics?.views || 0;
  const { series, available } = useDailyViews(project.id);
  // Stable per mount — a moving `now` would shift the day buckets under the user.
  const [now] = useState(() => Date.now());

  // Feedback breakdown — pins (spatial annotations) vs discussion comments vs replies
  const allComments = project.comments || [];
  const pins = allComments.filter(c => !c.type || c.type === 'pin');
  const discussions = allComments.filter(c => c.type === 'comment');
  const replies = allComments.filter(c => c.parentId);
  const unresolvedPins = pins.filter(c => !c.resolved).length;
  const unresolvedDiscussions = discussions.filter(c => !c.resolved).length;
  const unresolvedCount = unresolvedPins + unresolvedDiscussions;

  // Per-page breakdown from current version files
  const latestVersion = project?.versions?.[project.versions.length - 1];
  const pageFiles = latestVersion ? Object.keys(latestVersion.files).filter(f => !f.startsWith('assets/')) : [];

  return (
    <div className={cn(
      "w-full h-full max-w-4xl animate-fade overflow-y-auto p-6 space-y-8 text-left",
      "bg-[#F4F4F0] dark:bg-[#0F0F0D]"
    )}>
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-6 bg-white dark:bg-[#171714] space-y-2 rounded-xl ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">Total Views</span>
            <Eye size={14} className={"text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50"} />
          </div>
          <p className="text-3xl font-bold font-mono text-[#0F0F0D] dark:text-[#F4F4F0]">{totalViews}</p>
          <p className="text-[10px] font-medium text-[#0F0F0D]/45 dark:text-[#F4F4F0]/45">Unique visitors detected</p>
        </Card>
        <Card className="p-6 bg-white dark:bg-[#171714] space-y-2 rounded-xl ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">Avg View Time</span>
            <Clock size={14} className={"text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50"} />
          </div>
          <p className="text-3xl font-bold font-mono text-[#0F0F0D] dark:text-[#F4F4F0]">{(project.analytics?.avgTimeSeconds || 0)}s</p>
          <p className="text-[10px] font-medium text-[#0F0F0D]/45 dark:text-[#F4F4F0]/45">Engagement duration</p>
        </Card>
        <Card className="p-6 bg-white dark:bg-[#171714] space-y-2 rounded-xl ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">Total Feedback</span>
            <MessageSquare size={14} className={"text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50"} />
          </div>
          <p className="text-3xl font-bold font-mono text-[#0F0F0D] dark:text-[#F4F4F0]">{allComments.length}</p>
          <p className="text-[10px] font-semibold text-[#FF3B00]">{unresolvedCount} unresolved</p>
          <p className="text-[10px] font-medium text-[#0F0F0D]/45 dark:text-[#F4F4F0]/45">{pins.length} pins &bull; {discussions.length} comments</p>
        </Card>
      </div>

      {/* ── Trends ───────────────────────────────────────────────────────
          Two real series, no fabricated lines. FEEDBACK has genuine history
          (comments carry createdAt back to the first ever left), so it draws
          immediately. VIEWS only has history from the day daily collection
          started, and says so instead of inventing a line. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">
            <TrendingUp size={12} />
            Views Over Time · 14 days
          </span>
          {series === null ? (
            <div className="h-[180px] animate-pulse rounded-xl bg-[#0F0F0D]/5 dark:bg-white/5" aria-hidden />
          ) : (
            <TrendChart
              series={series}
              label="Views"
              emptyMessage={
                !available
                  ? 'Trend collection is not running yet — the daily-stats migration has not been applied to this project.'
                  : totalViews > 0
                    ? `This folio has ${totalViews.toLocaleString()} lifetime views, but per-day counts only start from the day collection began — daily history was never recorded. The line appears after the first day of new traffic.`
                    : 'No views recorded yet — share the folio to start the trend.'
              }
            />
          )}
        </div>

        <div className="space-y-3">
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">
            <MessageSquare size={12} />
            Feedback Over Time · 14 days
          </span>
          {/* Same 14-day window as the views chart beside it, so the two are
              read on one x-axis rather than at different scales. */}
          <TrendChart
            series={feedbackSeries([project], TREND_DAYS, now)}
            label="Feedback"
            emptyMessage="No comments or pins in the last 14 days."
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Reactions & Feedback */}
        <div className="space-y-4">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] block pb-2 text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40 border-b border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10">Community Reactions</span>
          <div className="grid grid-cols-2 gap-4">
            {Object.entries(project.reactions || { '👍': 0, '❤️': 0, '💡': 0, '🔥': 0 }).map(([emoji, count]) => (
              <Card key={emoji} className="p-4 flex items-center justify-between bg-white dark:bg-[#171714] hover:-translate-y-0.5 transition-all duration-300 rounded-xl ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 shadow-sm hover:shadow-md">
                <span className="text-2xl">{emoji}</span>
                <span className={cn(
                  "text-lg font-bold font-mono",
                  "text-[#0F0F0D] dark:text-[#F4F4F0]"
                )}>{count}</span>
              </Card>
            ))}
          </div>

          {/* Feedback activity — derived from comments, always in sync with Discuss/Pins */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Comments', value: discussions.length },
              { label: 'Pins', value: pins.length },
              { label: 'Replies', value: replies.length },
            ].map(({ label, value }) => (
              <Card key={label} className="p-3 flex flex-col items-center justify-center gap-0.5 bg-white dark:bg-[#171714] rounded-xl ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 shadow-sm">
                <span className={cn(
                  "text-lg font-bold font-mono",
                  "text-[#0F0F0D] dark:text-[#F4F4F0]"
                )}>{value}</span>
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">{label}</span>
              </Card>
            ))}
          </div>
        </div>

        {/* Traffic Insights + Per-Page Breakdown */}
        <div className="space-y-4 text-left">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] block pb-2 text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40 border-b border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10">Traffic Insights</span>
          <div className={cn(
            "p-5 space-y-4",
            "bg-white dark:bg-[#171714] rounded-xl ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 shadow-sm"
          )}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#0F0F0D] dark:text-[#F4F4F0]">Mobile Navigation</span>
              <span className={cn(
                "text-[11px] font-bold",
                "text-[#0F0F0D] dark:text-[#F4F4F0] font-mono"
              )}>{mobilePct}%</span>
            </div>
            <div className="w-full h-1.5 overflow-hidden rounded-full bg-[#0F0F0D]/10 dark:bg-[#F4F4F0]/10">
              <div className={cn(
                "h-full transition-all duration-1000",
                "bg-[#FF3B00]"
              )} style={{ width: `${mobilePct}%` }} />
            </div>
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs font-medium text-[#0F0F0D] dark:text-[#F4F4F0]">Desktop Viewport</span>
              <span className={cn(
                "text-[11px] font-bold",
                "text-[#0F0F0D] dark:text-[#F4F4F0] font-mono"
              )}>{desktopPct}%</span>
            </div>
            <div className="w-full h-1.5 overflow-hidden rounded-full bg-[#0F0F0D]/10 dark:bg-[#F4F4F0]/10">
              <div className={cn(
                "h-full transition-all duration-1000",
                "bg-[#FF3B00]"
              )} style={{ width: `${desktopPct}%` }} />
            </div>
            {total === 0 ? <p className="text-[10px] font-medium text-center mt-2 italic text-[#0F0F0D]/45 dark:text-[#F4F4F0]/45">Share your folio to start collecting analytics — use the Share button above!</p> : null}
          </div>

          {/* Per-Page Breakdown */}
          {pageFiles.length > 0 && (
            <div className={cn(
              "p-5 space-y-3",
              "bg-white dark:bg-[#171714] rounded-xl ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 shadow-sm"
            )}>
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] block text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">Page Directory</span>
              <div className="space-y-2">
                {pageFiles.slice(0, 6).map((filename, i) => {
                  // Distribute views proportionally (index.html gets the most)
                  const pct = pageFiles.length === 1 ? 100 : Math.round((1 - i * 0.15) * (100 / pageFiles.length));
                  return (
                    <div key={filename} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className={cn(
                          "text-[10px] font-semibold truncate",
                          "text-[#0F0F0D] dark:text-[#F4F4F0]"
                        )}>{filename}</span>
                        <span className="text-[10px] font-bold font-mono text-[#0F0F0D] dark:text-[#F4F4F0]">{pct}%</span>
                      </div>
                      <div className="w-full h-1 overflow-hidden rounded-full bg-[#0F0F0D]/10 dark:bg-[#F4F4F0]/10">
                        <div className={cn(
                          "h-full transition-all duration-700",
                          "bg-[#FF3B00]/60 rounded-full"
                        )} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
                {pageFiles.length > 6 && (
                  <p className="text-[10px] italic text-[#0F0F0D]/45 dark:text-[#F4F4F0]/45">+ {pageFiles.length - 6} more pages</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      {/* Export button */}
      <div className="flex justify-end pt-2">
        <button
          onClick={() => {
            const data = {
              views: project.analytics?.views || 0,
              avgTimeSeconds: project.analytics?.avgTimeSeconds || 0,
              mobileViews: project.analytics?.mobileViews || 0,
              desktopViews: project.analytics?.desktopViews || 0,
              comments: project.comments?.length || 0,
              reactions: project.reactions || {},
            };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'livefolio-analytics.json';
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="text-xs font-semibold cursor-pointer transition-colors text-[#0F0F0D]/45 dark:text-[#F4F4F0]/45 hover:text-[#FF3B00] dark:hover:text-[#FF3B00]"
        >
          Export JSON
        </button>
      </div>
    </div>
  );
}
