import { NextResponse } from 'next/server';
import { readDB, runTransaction } from '@/lib/db';
import { isOSS } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase';
import { extractUUIDFromSlug } from '@/lib/utils';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { err, ok } from '@/lib/api/respond';
import { resolveByHyphenSuffix } from '@/lib/api/folio-id';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Cap a single reported session length (24 h) and the number of initial
// (view-count) beacons per IP — analytics must not be trivially inflatable.
const MAX_SESSION_SECONDS = 24 * 60 * 60;

/**
 * Update Analytics for a project
 * Body: { sessionSeconds: number, isInitial?: boolean, device?: string }
 * Increments views by 1 (on initial beacon) and adds sessionSeconds to totalTimeSeconds.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    // Rate limit view beacons per IP (public endpoint).
    const clientIp = getClientIp(request);
    const rateLimit = checkRateLimit(`analytics:ip:${clientIp}`, 300, 15 * 60_000, 60 * 60_000);
    if (!rateLimit.allowed) {
      return err('Too many requests. Please try again later.', { status: 429 });
    }

    // Safely parse JSON to avoid 'Unexpected end of JSON input' errors from beacons
    const text = await request.text();
    if (!text) {
      return NextResponse.json({ success: true, note: 'Empty body ignored' });
    }

    const body = JSON.parse(text);
    const { isInitial = false } = body;
    let { sessionSeconds = 0, device } = body;
    // Clamp session time and device type to sane values.
    sessionSeconds = Math.max(0, Math.min(MAX_SESSION_SECONDS, Number(sessionSeconds) || 0));
    device = device === 'mobile' ? 'mobile' : 'desktop';

    let targetId = id;

    if (isOSS) {
      const db = await readDB();
      let project = db.find((p) => p.id === targetId);
      if (!project) {
        // Progressive hyphenated-ID resolution: try increasingly longer suffixes
        const resolved = resolveByHyphenSuffix(targetId, (candidate) => db.find((p) => p.id === candidate));
        if (resolved) { project = resolved.value; targetId = resolved.id; }
      }
      if (!project) {
        return err('Project not found', { status: 404 });
      }
      // Archived folios take no view beacons.
      if (project.archivedAt) {
        return err('Project not found', { status: 404 });
      }

      await runTransaction(async (db) => {
        const pIndex = db.findIndex((p) => p.id === targetId);
        if (pIndex === -1) throw new Error('Project not found');
        const p = db[pIndex];
        const views = (p.analytics?.views || 0) + (isInitial ? 1 : 0);
        const totalTimeSeconds = (p.analytics?.totalTimeSeconds || 0) + sessionSeconds;
        const avgTimeSeconds = views > 0 ? Math.round(totalTimeSeconds / views) : 0;
        let mobileViews = p.analytics?.mobileViews || 0;
        let desktopViews = p.analytics?.desktopViews || 0;
        if (isInitial) {
          if (device === 'mobile') mobileViews++;
          else desktopViews++;
        }
        p.analytics = { views, totalTimeSeconds, avgTimeSeconds, mobileViews, desktopViews };

        // Daily bucket — the OSS mirror of `folio_daily_stats` in Cloud. Same
        // rule: only an initial beacon (or recorded time) opens a day, so a
        // day with no view never appears as a zero point on the chart.
        if (isInitial || sessionSeconds > 0) {
          // Local calendar day, matching how the chart buckets.
          const now = new Date();
          const dayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
          const daily = p.analyticsDaily ?? {};
          const entry = daily[dayKey] ?? { views: 0, sessionSeconds: 0 };
          daily[dayKey] = {
            views: entry.views + (isInitial ? 1 : 0),
            sessionSeconds: entry.sessionSeconds + sessionSeconds,
          };
          p.analyticsDaily = daily;
        }

        p.updatedAt = new Date().toISOString();
        db[pIndex] = p;
      });
      return ok();
    }

    // Cloud Mode — extract UUID from human-readable slug before querying.
    // Always resolve accurate DB-facing UUID to match the folios table PK type.
    const queryId = extractUUIDFromSlug(targetId);

    // Use queryId as the canonical lookup key; fallback to raw id only if needed.
    let resolvedId = queryId;

    // Helper: try lookup by queryId first, then by raw targetId as fallback
    const lookupFolio = async (idToTry: string) => {
      const { data, error } = await supabaseAdmin
        .from('folios')
        .select('id, analytics, archived_at')
        .eq('id', idToTry)
        .maybeSingle();

      if (!error && data) {
        return { data, error: null, finalId: data.id || idToTry };
      }

      // Fallback: try the raw targetId if different
      if (idToTry !== targetId) {
        const fb = await supabaseAdmin
          .from('folios')
          .select('id, analytics, archived_at')
          .eq('id', targetId)
          .maybeSingle();
        if (!fb.error && fb.data) {
          return { data: fb.data, error: null, finalId: fb.data.id || targetId };
        }
      }

      return null;
    };

    const lookup = await lookupFolio(queryId);
    if (!lookup) {
      return err('Project not found', { status: 404 });
    }
    if (lookup.data.archived_at) {
      return err('Project not found', { status: 404 });
    }

    resolvedId = lookup.finalId;

    // Atomic increment via server-only RPC — no read-modify-write race, and
    // session time is clamped server-side. View beacons are still rate-limited
    // at the top of this handler.
    const { error: updateError } = await supabaseAdmin.rpc('increment_folio_analytics', {
      p_folio_id: resolvedId,
      p_session_seconds: Math.round(sessionSeconds),
      p_is_initial: !!isInitial,
      p_device: device,
    });

    if (updateError) {
      console.error('Analytics update error:', updateError);
      return err('Update failed', { status: 500 });
    }

    return ok();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: err may be any thrown value; err?.code is read
  } catch (error: any) {
    console.error('Analytics update error:', error);
    // Don't return 500 for timeout errors — the beacon can retry
    const status = error?.code === '57014' ? 503 : 500;
    return err('Update failed', { status });
  }
}
