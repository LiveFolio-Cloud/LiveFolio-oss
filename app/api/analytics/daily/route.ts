/**
 * `GET /api/analytics/daily?days=30[&folioId=<id>]` — the trend series.
 *
 * Returns a DENSE daily series for the caller's folios (or one folio), which is
 * what the Analytics chart draws. Dense because a chart that omits empty days
 * draws a line between two points a month apart as if the gap were continuous
 * activity.
 *
 * Cloud reads `folio_daily_stats`, which only starts collecting at the
 * migration's deploy — earlier days are genuinely absent, and the response says
 * so with `collectingSince` rather than padding them with zeros, which would
 * read as "no traffic".
 *
 * OSS mirrors it from the flat file's per-project `analyticsDaily` map.
 */
import { NextResponse } from 'next/server';
import { readDB } from '@/lib/db';
import { isOSS } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase';
import { getAuthContext } from '@/lib/auth';
import { err } from '@/lib/api/respond';
import { buildDailySeries } from '@/lib/analytics-chart';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Window bounds — a year is plenty and keeps the payload small. */
const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

function parseDays(raw: string | null): number {
  const n = parseInt(raw || '', 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DAYS;
  return Math.min(MAX_DAYS, n);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseDays(searchParams.get('days'));
    const folioId = searchParams.get('folioId');

    if (isOSS) {
      const db = await readDB();
      const scoped = folioId ? db.filter((p) => p.id === folioId) : db;
      // OSS stores `analyticsDaily` as { "YYYY-MM-DD": { views, sessionSeconds } }.
      const timestamps: string[] = [];
      for (const project of scoped) {
        const daily = (project as { analyticsDaily?: Record<string, { views?: number }> })
          .analyticsDaily;
        if (!daily) continue;
        for (const [day, entry] of Object.entries(daily)) {
          const views = Number(entry?.views) || 0;
          for (let i = 0; i < views; i++) timestamps.push(`${day}T12:00:00`);
        }
      }
      return NextResponse.json({
        series: buildDailySeries(timestamps, days),
        collectingSince: null,
        available: true,
        scope: folioId ? 'folio' : 'all',
      });
    }

    const { orgId } = await getAuthContext();
    if (!orgId) return err('Unauthorized', { status: 401 });
    if (!supabaseAdmin) {
      return NextResponse.json(
        { error: 'Supabase client is not initialized.' },
        { status: 500 },
      );
    }

    // The folio ids this caller may see. A single query against the org keeps
    // the route honest: `folioId` can only narrow the set, never widen it.
    const { data: folios, error: folioError } = await supabaseAdmin
      .from('folios')
      .select('id')
      .eq('organization_id', orgId);
    if (folioError) throw folioError;

    const allowed = new Set((folios ?? []).map((f: { id: string }) => f.id));
    if (folioId && !allowed.has(folioId)) {
      // Same response as "no data" rather than 403: the caller should not learn
      // whether a folio they cannot see exists.
      return NextResponse.json({
        series: buildDailySeries([], days),
        collectingSince: null,
        available: true,
        scope: 'folio',
      });
    }
    const scopeIds = folioId ? [folioId] : Array.from(allowed);

    if (scopeIds.length === 0) {
      return NextResponse.json({
        series: buildDailySeries([], days),
        collectingSince: null,
        available: true,
        scope: folioId ? 'folio' : 'all',
      });
    }

    const { data, error } = await supabaseAdmin
      .from('folio_daily_stats')
      .select('day, views, session_seconds')
      .in('folio_id', scopeIds)
      .order('day', { ascending: false })
      .limit(MAX_DAYS * Math.max(1, scopeIds.length));

    if (error) {
      // `42P01` = undefined_table: the daily-stats migration has not been
      // applied to this project. That is a DEPLOYMENT gap, not "no traffic",
      // and the two must not look the same on the chart — an empty line reads
      // as "nobody visited", which would be a lie. Report it as unavailable.
      const missingTable =
        (error as { code?: string }).code === '42P01' ||
        /does not exist/i.test(error.message ?? '');
      if (missingTable) {
        console.error(
          '[analytics/daily] folio_daily_stats is missing — the daily-stats schema has not been applied to this project. Reporting the trend as unavailable.',
        );
        return NextResponse.json({
          series: buildDailySeries([], days),
          collectingSince: null,
          available: false,
          scope: folioId ? 'folio' : 'all',
        });
      }
      throw error;
    }

    // Aggregate to one point per day across the scoped folios.
    const byDay = new Map<string, number>();
    let earliest: string | null = null;
    for (const row of (data ?? []) as { day: string; views: number }[]) {
      const key = String(row.day).slice(0, 10);
      byDay.set(key, (byDay.get(key) ?? 0) + (Number(row.views) || 0));
      if (!earliest || key < earliest) earliest = key;
    }

    // Reuse the same dense-series builder as the chart, so a gap is a zero and
    // the x axis always spans the requested window.
    const timestamps: string[] = [];
    byDay.forEach((views, day) => {
      for (let i = 0; i < views; i++) timestamps.push(`${day}T12:00:00`);
    });

    return NextResponse.json({
      series: buildDailySeries(timestamps, days),
      collectingSince: earliest,
      available: true,
      scope: folioId ? 'folio' : 'all',
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: err may be any thrown value; err.message is read
  } catch (error: any) {
    return err(error.message || 'Failed to load daily analytics.', { status: 500 });
  }
}
