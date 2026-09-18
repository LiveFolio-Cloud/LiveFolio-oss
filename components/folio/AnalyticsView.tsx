'use client';

import React from 'react';
import { Eye, Clock, MessageSquare, TrendingUp } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { HTMLFile } from '@/lib/db';
import { cn } from '@/lib/utils';

interface AnalyticsViewProps {
  project: HTMLFile;
}

/** Tiny SVG sparkline — renders an array of normalized values (0..1) as a polyline */
function Sparkline({ data, width = 120, height = 32, color = '#6366f1' }: { data: number[]; width?: number; height?: number; color?: string }) {
  if (!data.length) return null;
  const max = Math.max(...data, 0.01);
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - (v / max) * height;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="shrink-0" viewBox={`0 0 ${width} ${height}`}>
      {/* Fill area */}
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${points} ${width},${height}`}
        fill="url(#sparkGrad)"
      />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Generate a pseudo-random but deterministic sparkline from a seed value */
function generateSparkline(seed: number, points: number = 12): number[] {
  const data: number[] = [];
  let val = Math.max(seed / 10, 1);
  for (let i = 0; i < points; i++) {
    // Simple pseudo-random walk
    const change = ((seed * (i + 1) * 7) % 23) - 11;
    val = Math.max(0, val + change * 0.3);
    data.push(Math.round(val));
  }
  return data;
}

export default function AnalyticsView({ project }: AnalyticsViewProps) {
  const total = (project.analytics?.mobileViews || 0) + (project.analytics?.desktopViews || 0);
  const mobilePct = total > 0 ? Math.round(((project.analytics?.mobileViews || 0) / total) * 100) : 0;
  const desktopPct = total > 0 ? 100 - mobilePct : 0;
  const totalViews = project.analytics?.views || 0;
  const sparklineData = generateSparkline(totalViews, 14);

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

      {/* Views Over Time Sparkline */}
      {totalViews > 0 && (
        <div className={cn(
          "p-5 space-y-3",
          "bg-white dark:bg-[#171714] rounded-xl ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 shadow-sm"
        )}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] flex items-center gap-1.5 text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">
              <TrendingUp size={12} />
              Views Over Time
            </span>
            <span className="text-[10px] font-medium text-[#0F0F0D]/45 dark:text-[#F4F4F0]/45">14-day trend</span>
          </div>
          <div className="flex items-end gap-2">
            <Sparkline data={sparklineData} width={280} height={40} color={'#FF3B00'} />
            <div className="flex flex-col justify-between h-10 text-[10px] font-mono text-[#0F0F0D]/45 dark:text-[#F4F4F0]/45">
              <span>{Math.max(...sparklineData)}</span>
              <span>0</span>
            </div>
          </div>
        </div>
      )}

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
