'use client';

import React, { useId, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  areaPath,
  compactNumber,
  formatDayLabel,
  isSeriesEmpty,
  linePath,
  seriesMax,
  seriesTotal,
  tickIndices,
  type SeriesPoint,
} from '@/lib/analytics-chart';

/**
 * A daily trend line, drawn as inline SVG.
 *
 * Deliberately dependency-free: the shape is a line, an area and a few ticks,
 * and a charting library would cost a bundle plus a second styling system for
 * something this small. It also keeps the geometry testable — `lib/analytics-chart.ts`
 * computes every path with no DOM.
 *
 * The viewBox is fixed (600×140) and scaled by CSS, so the chart is crisp at any
 * width without re-measuring; the trade-off is that stroke widths scale with it,
 * which is why they are set with `vectorEffect="non-scaling-stroke"`.
 */
export default function TrendChart({
  series,
  label,
  emptyMessage = 'Nothing recorded yet.',
  className,
}: {
  series: SeriesPoint[];
  /** What the line counts — "views", "comments". Used in the tooltip and a11y text. */
  label: string;
  emptyMessage?: string;
  className?: string;
}) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const W = 600;
  const H = 140;

  const { line, area, max, total, empty, ticks } = useMemo(() => {
    const m = seriesMax(series);
    return {
      line: linePath(series, W, H),
      area: areaPath(series, W, H),
      max: m,
      total: seriesTotal(series),
      empty: isSeriesEmpty(series),
      ticks: tickIndices(series.length, 4),
    };
  }, [series]);

  const hovered = hover !== null ? series[hover] : null;
  const hoverX = hover !== null ? (hover / Math.max(1, series.length - 1)) * W : 0;
  const hoverY = hovered ? H - (hovered.value / max) * H : 0;

  if (empty) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[#0F0F0D]/10 py-10 dark:border-[#F4F4F0]/10',
          className,
        )}
      >
        <p className="text-[13px] text-ink/45">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={cn('rounded-xl p-3 ring-1 ring-[#0F0F0D]/5 dark:ring-white/10', className)}>
      {/* Header: what is being counted, and the total it adds up to. */}
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium text-ink/55 capitalize">{label} per day</span>
        <span className="text-[13px] font-semibold tabular-nums text-ink">
          {compactNumber(total)}
          <span className="ml-1 text-[11px] font-normal text-ink/40">total</span>
        </span>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-[140px] w-full"
          role="img"
          aria-label={`${label} per day, last ${series.length} days, ${total} total`}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--app-accent)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--app-accent)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Baseline — without it a flat zero line floats in space. */}
          <line
            x1="0"
            y1={H}
            x2={W}
            y2={H}
            stroke="currentColor"
            className="text-ink/10"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />

          <path d={area} fill={`url(#${gradientId})`} />
          <path
            d={line}
            fill="none"
            stroke="var(--app-accent)"
            strokeWidth="1.75"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />

          {/* Hover read-out */}
          {hovered && (
            <>
              <line
                x1={hoverX}
                y1="0"
                x2={hoverX}
                y2={H}
                stroke="currentColor"
                className="text-ink/20"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              <circle cx={hoverX} cy={hoverY} r="3" fill="var(--app-accent)" />
            </>
          )}

          {/* Hit targets — one per day, full height, so hovering anywhere in a
              column reads that day rather than requiring the thin line itself. */}
          {series.map((p, i) => (
            <rect
              key={p.day}
              x={(i / series.length) * W}
              y="0"
              width={W / series.length}
              height={H}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}
        </svg>

        {hovered && (
          <div
            className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 rounded-lg bg-ink px-2 py-1 text-[11px] font-medium text-bone shadow-lg"
            style={{ left: `${(hoverX / W) * 100}%` }}
          >
            {formatDayLabel(hovered.day)} · {hovered.value}
          </div>
        )}
      </div>

      {/* X axis — first/last plus evenly spaced middles, never overlapping. */}
      <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-ink/35">
        {ticks.map((i) => (
          <span key={series[i].day}>{formatDayLabel(series[i].day)}</span>
        ))}
      </div>
    </div>
  );
}
