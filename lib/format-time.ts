/**
 * format-time — the relative "x ago" timestamps shown on comments.
 *
 * There are (or were) three copies of this ladder, and they do NOT agree on
 * wording. That wording is deliberate per surface — a prose sentence in a
 * discussion card reads differently from a compact badge in a narrow panel —
 * so the differences are options here rather than a single winner:
 *
 *   | surface         | < 1 min   | unit suffix | past a week          |
 *   |-----------------|-----------|-------------|----------------------|
 *   | discussion card | "just now"| " ago"      | "Sep 19"             |
 *   | comments panel  | "now"     | ""          | "Sep 19"             |
 *   | status page     | "just now"| " ago"      | keeps counting days  |
 *
 * The status page (`app/status/page.tsx`) has NOT adopted this yet — pass
 * `afterWeek: 'days'` to reproduce its ladder if/when it does.
 *
 * The ladder itself: minutes < 1 → `nowLabel`; < 60 → `Nm`; hours < 24 → `Nh`;
 * days < 7 → `Nd`; then `afterWeek`.
 */

import { formatMonthDay } from '@/lib/format-date';

export interface RelativeTimeOptions {
  /** Label for a timestamp under a minute old. Wording differs per surface. */
  nowLabel: string;
  /**
   * Appended verbatim to every numeric unit — `' ago'` for prose ("5m ago"),
   * `''` for the compact badge ("5m"). Required, so each call site states
   * which one it wants instead of inheriting a default.
   */
  suffix: string;
  /**
   * What to render once the timestamp is a week old:
   * `'date'` (default) → `"Sep 19"`; `'days'` → keep counting (`"12d"`).
   */
  afterWeek?: 'date' | 'days';
}

/**
 * Relative time for an ISO timestamp, e.g. `"5m ago"`.
 *
 * Returns `''` for an unparseable timestamp rather than rendering "NaN".
 */
export function formatRelativeTime(
  isoString: string,
  { nowLabel, suffix, afterWeek = 'date' }: RelativeTimeOptions
): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return nowLabel;
    if (diffMins < 60) return `${diffMins}m${suffix}`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h${suffix}`;
    const diffDays = Math.floor(diffHrs / 24);
    if (diffDays < 7) return `${diffDays}d${suffix}`;
    return afterWeek === 'days' ? `${diffDays}d${suffix}` : formatMonthDay(date);
  } catch {
    return '';
  }
}
