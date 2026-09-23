/**
 * Chart maths — pure, dependency-free, unit-tested.
 *
 * The Analytics page draws its own SVG rather than pulling in a chart library:
 * the shapes here are simple (a dense daily series, a line, an area, a few
 * ticks), a library would add a bundle and a second styling system, and this
 * way the geometry is testable without a DOM.
 *
 * Everything is deterministic and takes `now`/sizes as arguments so the same
 * function renders the same path in a test as on screen.
 */

/* ── compact numbers ─────────────────────────────────────────────────── */

/** Drop a trailing ".0" — 1200 → "1.2K", 12000 → "12K", 1000000 → "1M". */
function trimDecimal(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * Compact a number for a KPI tile: 847 → "847", 1240 → "1.2K", 3_400_000 → "3.4M".
 *
 * Below 10,000 the full number is kept (with thousands separators) — "9,847"
 * is more informative than "9.8K" and fits fine. Above that the digits stop
 * carrying information and the width becomes the problem.
 */
export function compactNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs < 10_000) return sign + Math.round(abs).toLocaleString('en-US');
  if (abs < 1_000_000) return `${sign}${trimDecimal(abs / 1_000)}K`;
  if (abs < 1_000_000_000) return `${sign}${trimDecimal(abs / 1_000_000)}M`;
  return `${sign}${trimDecimal(abs / 1_000_000_000)}B`;
}

/* ── daily series ────────────────────────────────────────────────────── */

export interface SeriesPoint {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string;
  value: number;
}

/** `YYYY-MM-DD` for a timestamp, in LOCAL time (a creator reads their own days). */
export function dayKey(timestamp: number | string | Date): string {
  const d = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Bucket timestamps into a DENSE daily series ending today.
 *
 * Dense matters: charting only the days that have events draws a line between
 * two points a month apart as if the gap were continuous activity. Zero-filling
 * is what makes a flat week visible as flat.
 */
export function buildDailySeries(
  timestamps: Array<string | number>,
  days: number,
  now: number = Date.now(),
): SeriesPoint[] {
  if (days <= 0) return [];

  const counts = new Map<string, number>();
  for (const ts of timestamps) {
    const key = dayKey(ts);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const series: SeriesPoint[] = [];
  const end = new Date(now);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i);
    const key = dayKey(d);
    series.push({ day: key, value: counts.get(key) ?? 0 });
  }
  return series;
}

/**
 * Feedback per day, from comment timestamps.
 *
 * This is the one trend with REAL history already: comments carry `createdAt`
 * going back to the first one ever left (verified in the live data: the oldest
 * is months old). Views have no history at all — their daily counts start when
 * `folio_daily_stats` began collecting — so this series is what lets the charts
 * show something true on day one.
 *
 * Accepts any object with a `comments` array so both the main Analytics page
 * (many folios) and a folio's Metrics tab (one) can call it.
 */
export function feedbackSeries(
  folios: Array<{ comments?: unknown[] | null }>,
  days: number,
  now: number = Date.now(),
): SeriesPoint[] {
  const timestamps: string[] = [];
  for (const folio of folios) {
    for (const comment of folio.comments ?? []) {
      const createdAt = (comment as { createdAt?: string } | null)?.createdAt;
      if (createdAt) timestamps.push(createdAt);
    }
  }
  return buildDailySeries(timestamps, days, now);
}

/**
 * How many days of history to ask for when the caller wants "all of it".
 *
 * Derived from the oldest thing worth charting rather than a magic number, so
 * an account with two months of feedback gets two months of axis instead of a
 * fixed window. Capped at a year — beyond that a daily chart is unreadable and
 * the payload stops being worth it.
 */
export function spanInDays(timestamps: Array<string | number>, now: number = Date.now()): number {
  let earliest = Number.POSITIVE_INFINITY;
  for (const ts of timestamps) {
    const t = new Date(ts).getTime();
    if (!Number.isNaN(t) && t < earliest) earliest = t;
  }
  if (!Number.isFinite(earliest)) return 30;

  // Count CALENDAR days, not elapsed time. `buildDailySeries` buckets by
  // calendar day, so measuring elapsed hours here would disagree with it by a
  // day whenever the oldest item is not at the same time of day as `now` —
  // requesting 62 days of axis for 61 days of history.
  const start = new Date(earliest);
  const end = new Date(now);
  const startMid = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const endMid = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  const days = Math.round((endMid - startMid) / 86_400_000) + 1;
  return Math.max(1, Math.min(365, days));
}

/** Every comment timestamp in a set of folios — the input to `spanInDays`. */
export function commentTimestamps(folios: Array<{ comments?: unknown[] | null }>): string[] {
  const out: string[] = [];
  for (const folio of folios) {
    for (const comment of folio.comments ?? []) {
      const createdAt = (comment as { createdAt?: string } | null)?.createdAt;
      if (createdAt) out.push(createdAt);
    }
  }
  return out;
}

/** True when every point is zero — the chart's "nothing recorded yet" state. */
export function isSeriesEmpty(series: SeriesPoint[]): boolean {
  return series.every((p) => p.value === 0);
}

export function seriesTotal(series: SeriesPoint[]): number {
  return series.reduce((a, p) => a + p.value, 0);
}

/* ── geometry ────────────────────────────────────────────────────────── */

/** Largest value in the series, floored at 1 so an all-zero chart has a scale. */
export function seriesMax(series: SeriesPoint[]): number {
  return Math.max(1, ...series.map((p) => p.value));
}

/**
 * X coordinate for point `i` of `count`, spread across `width`.
 *
 * A single point is centred rather than pinned to the left edge, so a
 * one-day series renders as a dot in the middle instead of a stray tick.
 */
export function pointX(i: number, count: number, width: number): number {
  if (count <= 1) return width / 2;
  return (i / (count - 1)) * width;
}

/** Y coordinate for a value, where `max` maps to 0 (the top). */
export function pointY(value: number, max: number, height: number): number {
  if (max <= 0) return height;
  return height - (value / max) * height;
}

/**
 * A smoothed line through the points, using midpoint quadratic segments.
 *
 * Straight segments between daily points read as jagged noise; the midpoint
 * curve keeps it readable without overshooting the data the way a naive
 * Catmull-Rom can (an overshoot would draw a view count below zero).
 */
export function linePath(series: SeriesPoint[], width: number, height: number): string {
  if (series.length === 0) return '';
  const max = seriesMax(series);
  const pts = series.map((p, i) => ({
    x: pointX(i, series.length, width),
    y: pointY(p.value, max, height),
  }));
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;

  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const midX = (prev.x + cur.x) / 2;
    d += ` Q ${prev.x} ${prev.y} ${midX} ${(prev.y + cur.y) / 2}`;
    d += ` Q ${cur.x} ${cur.y} ${cur.x} ${cur.y}`;
  }
  return d;
}

/** The same line, closed along the baseline, for the filled area beneath it. */
export function areaPath(series: SeriesPoint[], width: number, height: number): string {
  const line = linePath(series, width, height);
  if (!line) return '';
  return `${line} L ${width} ${height} L 0 ${height} Z`;
}

/* ── axis ────────────────────────────────────────────────────────────── */

/** Short date label for the x axis — "Sep 22". */
export function formatDayLabel(day: string): string {
  const parts = day.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return day;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Which series indices get an axis label.
 *
 * Labelling every day on a 30-day axis produces overlapping text; this picks at
 * most `maxLabels` evenly spaced indices and always includes the last point, so
 * the axis reads "start … end" rather than trailing off.
 */
export function tickIndices(count: number, maxLabels = 4): number[] {
  if (count <= 0) return [];
  if (count <= maxLabels) return Array.from({ length: count }, (_, i) => i);
  const step = (count - 1) / (maxLabels - 1);
  const indices: number[] = [];
  for (let i = 0; i < maxLabels; i++) indices.push(Math.round(i * step));
  // Rounding can collide (e.g. count=6 → 0,2,3,5 is fine, but guard anyway).
  return Array.from(new Set(indices));
}
