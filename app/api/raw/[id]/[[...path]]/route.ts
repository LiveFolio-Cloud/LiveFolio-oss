import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import crypto from 'crypto';
import { readDB, HTMLFile } from '@/lib/db';
import { isLocalHost } from '@/lib/network';
import { isOSS, isCloud, FEATURES } from '@/lib/env';
import { supabaseAdmin, transformFolioRecord } from '@/lib/supabase';
import { projectMemoryCache } from '@/lib/project-cache';
import { resolveGateConfig } from '@/lib/gating/config';
import { hasActiveGrant } from '@/lib/gating/grants';
import { paywall403Html, injectFirstPageClip } from '@/lib/gating/paywall-html';
import { signPreviewCookieValue, verifyPreviewCookieValue } from '@/lib/gating/preview';
import { getOwnerAccent } from '@/app/api/_lib/gate-owner';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { signPageToken, verifyPageToken } from '@/lib/folio-tokens';
import { embedTraceMarker } from '@/lib/folio-keys';
import type { PaidAccessConfig } from '@/lib/gating/types';

function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// ── Watermark helpers (Free-plan folios, public share only) ──────

const WATERMARK_HTML = `<!-- LiveFolio Watermark v3 -->
<div style="position:fixed;bottom:12px;left:16px;z-index:99999;pointer-events:none;opacity:0.35;font-family:system-ui,-apple-system,sans-serif;font-size:11px;font-weight:500;color:#6b7280;letter-spacing:0.02em;user-select:none;display:flex;align-items:center;gap:6px;transition:opacity 0.3s;" aria-hidden="true">
  <svg width="12" height="12" viewBox="0 0 32 32" style="opacity:0.8;flex-shrink:0"><rect width="32" height="32" fill="currentColor"/><rect x="8" y="8" width="16" height="16" fill="#FF3B00"/></svg>
  Made with LiveFolio
</div>`;

function injectWatermark(html: string): string {
  if (html.includes('</body>')) {
    return html.replace('</body>', `${WATERMARK_HTML}\n</body>`);
  }
  return html + WATERMARK_HTML;
}

// ── Share pin bridge (opt-in via ?lf_pins=1) ─────────────────────────
// The share viewer renders the folio in a sandboxed iframe and needs a
// script INSIDE the document to capture pins with real DOM context
// (selector/elementHtml/section) and to anchor markers to elements. The tag
// references a STATIC file (public/livefolio-pin-bridge.js) rather than
// inline code: a static file updates independently of any folio version —
// bridge fixes ship without a folio bump, and it stays cacheable on its
// own URL. Studio previews never pass lf_pins=1.
const PIN_BRIDGE_TAG = '<script src="/livefolio-pin-bridge.js"></script>';

function injectPinBridge(html: string): string {
  if (html.includes('</body>')) {
    return html.replace('</body>', `${PIN_BRIDGE_TAG}\n</body>`);
  }
  return html + PIN_BRIDGE_TAG;
}

// ── Source-lock delivery (P2) ────────────────────────────────────────
// `source_locked` paid folios serve HTML through a JS bootstrap shell that
// holds a short-TTL token and fetches the real page in a second request.
// View-source / Ctrl+S of the public share then yields only this shell.
// Members (studio) and agents never hit it — the wrap path is restricted
// to public-share requests and exempts org members via session check.

function buildSourceLockShell(token: string): string {
  // Token is base64url of JSON+HMAC — safe to inline after < escaping.
  const safeToken = token.replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="robots" content="noindex" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>LiveFolio</title>
<style>html,body{height:100%;margin:0;background:#F4F4F0}body{display:flex;align-items:center;justify-content:center;font:13px system-ui,sans-serif;color:#8A8A85}</style>
</head>
<body>
<p>Loading folio…</p>
<script>
(function () {
  var q = new URLSearchParams(location.search);
  q.set('__p', '${safeToken}');
  fetch(location.pathname + '?' + q.toString(), { credentials: 'same-origin' })
    .then(function (r) { if (!r.ok) { throw new Error('load failed'); } return r.text(); })
    .then(function (html) { document.open(); document.write(html); document.close(); })
    .catch(function () { document.body.textContent = 'This folio could not be loaded. Please refresh.'; });
})();
<\/script>
</body>
</html>`;
}

/** Copy friction injected into token-served payload HTML (never in studio). */
const SOURCE_LOCK_FRICTION = `<style>
html, body { -webkit-user-select: none; user-select: none; }
input, textarea, [contenteditable] { -webkit-user-select: text; user-select: text; }
</style>
<script>
(function () {
  function block(e) { e.preventDefault(); e.stopPropagation(); return false; }
  document.addEventListener('contextmenu', block, true);
  document.addEventListener('keydown', function (e) {
    var k = (e.key || '').toLowerCase();
    if (e.key === 'F12') { e.preventDefault(); return; }
    if (e.ctrlKey || e.metaKey) {
      if (k === 's' || k === 'u' || k === 'p') { e.preventDefault(); return; }
      if (e.shiftKey && (k === 'i' || k === 'j' || k === 'c')) { e.preventDefault(); }
    }
  }, true);
  document.addEventListener('copy', function (e) {
    var el = document.activeElement;
    var inField = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    var sel = window.getSelection();
    if (!inField && (!sel || sel.isCollapsed)) { e.preventDefault(); }
  });
})();
<\/script>`;

function injectSourceLockFriction(html: string): string {
  if (html.includes('</body>')) {
    return html.replace('</body>', `${SOURCE_LOCK_FRICTION}\n</body>`);
  }
  return html + SOURCE_LOCK_FRICTION;
}

/** Guest share (public viewer) vs Studio/member request.
 *
 * Security: this used to read the client-sent `Referer` header
 * (`Referer: …/studio/…` → treated as Studio). Referer is spoofable — any
 * anonymous caller could strip the Free-plan watermark or, on source-locked
 * folios, skip the wrapping shell and receive the real HTML. The decision is
 * now session-based: Cloud resolves org membership from the session cookie +
 * DB (unforgeable); OSS has no members, so the local Studio host stands in
 * (unchanged local-first behavior). */
async function isGuestShare(request: Request, project: HTMLFile): Promise<boolean> {
  const host = request.headers.get('host') || '';
  if (isOSS) return !isLocalHost(host);
  return !(await isOrgMemberOf(project));
}

let _watermarkPlanCache: { orgId: string; plan: string; expiresAt: number } | null = null;

async function isFreePlan(project: HTMLFile): Promise<boolean> {
  if (isOSS) return true;

  const orgId = project.organization_id;
  if (!orgId) return true;

  try {
    if (_watermarkPlanCache && _watermarkPlanCache.orgId === orgId && _watermarkPlanCache.expiresAt > Date.now()) {
      return _watermarkPlanCache.plan === 'Free';
    }
    const { data, error } = await supabaseAdmin
      .from('organizations')
      .select('plan')
      .eq('id', orgId)
      .single();
    if (error || !data) return true;
    _watermarkPlanCache = { orgId, plan: data.plan, expiresAt: Date.now() + 5 * 60_000 };
    return data.plan === 'Free';
  } catch {
    return true;
  }
}

// ── Historical-version gate (content protection) ─────────────────────
// The raw route serves ?v=<versionId> pins so the studio and share pages
// can rehydrate an exact snapshot (comment/pin anchors). Blindly
// enumerable, those same URLs hand scrapers the folio's FULL edit
// history — content the author later removed or replaced keeps serving.
// Non-latest versions now require a credentialed viewer (org member,
// active grant, or the folio's valid access key). Anonymous callers and
// non-member sessions get the latest published version only — which is
// all the public link grants them anyway (guests pin to latest: the
// share viewer never requests historical versions).

/** Cloud session user — null for anonymous (mirrors the paid-gate lookup). */
async function resolveSessionUser(): Promise<{ id: string } | null> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    if (!supabaseUrl || !supabaseAnonKey) return null;
    const cookieStore = await cookies();
    // No Supabase auth cookie present → anonymous. Short-circuit so the hot
    // public-share path (watermark/guest checks) never pays an auth RTT.
    if (!cookieStore.getAll().some((c) => c.name.startsWith('sb-') || c.name.startsWith('supabase-'))) {
      return null;
    }
    const { createServerClient } = await import('@/lib/supabase');
    const clientSupabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} },
    });
    const { data } = await clientSupabase.auth.getUser();
    return data.user;
  } catch {
    return null;
  }
}

// Membership decisions on the public share path must not hammer the DB per
// request; org memberships change rarely, so a 5-minute in-memory cache is
// safe (worst case: a new member waits one window before Studio gets the
// no-watermark/no-wrap treatment).
const _membershipCache = new Map<string, { member: boolean; expiresAt: number }>();

/** May this caller fetch a NON-latest version? (OSS: single-owner — yes.) */
async function canViewHistorical(request: Request, project: HTMLFile): Promise<boolean> {
  if (isOSS) return true;
  try {
    const { searchParams } = new URL(request.url);
    // A valid private access key = the owner chose this holder — history included.
    const accessKeyParam = searchParams.get('access_key') || '';
    if (
      project.isPrivate &&
      project.accessKey &&
      accessKeyParam &&
      timingSafeEqualStr(accessKeyParam.trim(), project.accessKey.trim())
    ) {
      return true;
    }
    if (!supabaseAdmin) return false;
    const user = await resolveSessionUser();
    if (!user) return false;
    // Org member (owner/team) sees the full history.
    const { data: membership } = await supabaseAdmin
      .from('organization_members')
      .select('id')
      .eq('organization_id', project.organization_id)
      .eq('user_id', user.id)
      .limit(1);
    if (membership && membership.length > 0) return true;
    // Active buyer grant — folio grant, or workspace grant when the folio
    // inherits the workspace gate (same precedence as the paid gate).
    if (await hasActiveGrant(user.id, 'folio', project.id)) return true;
    const folioHasOwnGate = project.paidAccess != null;
    if (!folioHasOwnGate && project.projectId &&
        await hasActiveGrant(user.id, 'workspace', project.projectId)) {
      return true;
    }
  } catch { /* any failure → deny */ }
  return false;
}

/** Is the requesting session an org member? (Source-lock member exemption.) */
async function isOrgMemberOf(project: HTMLFile): Promise<boolean> {
  if (isOSS || !project.organization_id || !supabaseAdmin) return false;
  const user = await resolveSessionUser();
  if (!user) return false;
  const cacheKey = `${user.id}:${project.organization_id}`;
  const hit = _membershipCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.member;
  try {
    const { data: membership } = await supabaseAdmin
      .from('organization_members')
      .select('id')
      .eq('organization_id', project.organization_id)
      .eq('user_id', user.id)
      .limit(1);
    const member = !!(membership && membership.length > 0);
    _membershipCache.set(cacheKey, { member, expiresAt: Date.now() + 5 * 60_000 });
    return member;
  } catch {
    return false;
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; path?: string[] }> }
) {
  try {
    // ── Anonymous traffic throttle (content protection) ──────────────
    // Bulk scripted harvests (version enumeration, card-preview scraping
    // loops) hit this far harder than any interactive session; lock them
    // out instead of feeding them. Ceiling is generous for humans: a full
    // Explore scroll-through bursts well under this. In-memory + per-IP,
    // same store the auth routes use.
    const ip = getClientIp(request);
    const rl = checkRateLimit(`raw:ip:${ip}`, 1500, 60_000, 600_000);
    if (!rl.allowed) {
      return new Response('Too many requests.', {
        status: 429,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store, max-age=0, must-revalidate',
          'X-RateLimit-Limit': String(rl.limit),
          'X-RateLimit-Remaining': '0',
          'Retry-After': String(Math.max(1, Math.ceil(((rl.lockedUntil ?? rl.resetAt) - Date.now()) / 1000))),
        },
      });
    }

    const { id, path: pathArray } = await context.params;
    const { searchParams } = new URL(request.url);
    const versionId = searchParams.get('v');

    let project: HTMLFile | null = null;

    if (isOSS) {
      const db = await readDB();
      const match = db.find((p) => p.id === id);
      project = match || null;

      // Security: enforce isPrivate/accessKey in OSS too (previously this
      // gate existed only in cloud mode — private OSS folios were exposed).
      if (project && project.isPrivate) {
        const accessKeyParam = searchParams.get('access_key') || '';
        const serverKey = (project.accessKey || '').trim();
        if (!serverKey || !accessKeyParam || !timingSafeEqualStr(accessKeyParam, serverKey)) {
          return new Response('Access Denied: Invalid access key.', { status: 403 });
        }
      }
    } else {
      // Cloud Mode - High-Fidelity direct UUID lookups (with long-duration in-memory caching)
      const cachedProject = projectMemoryCache.get(id);
      if (cachedProject) {
        project = cachedProject;
      } else {
        if (!supabaseAdmin) {
          return new Response('Supabase is not configured.', { status: 500 });
        }

        // Fetch specific folio directly by UUID
        const { data: folio, error: fetchErr } = await supabaseAdmin
          .from('folios')
          .select('*')
          .eq('id', id)
          .single();

        if (fetchErr || !folio) {
          return new Response('Folio Project Not Found', { status: 404 });
        }

        project = transformFolioRecord(folio);
        
        projectMemoryCache.set(id, project);
      }

      // Security Access Control Check
      if (project.isPrivate) {
        // First check: valid access key in query param bypasses auth
        const accessKeyParam = searchParams.get('access_key') || '';
        if (accessKeyParam && (project.accessKey || '').trim()) {
          if (!timingSafeEqualStr(accessKeyParam, (project.accessKey || '').trim())) {
            return new Response('Access Denied: Invalid access key.', { status: 403 });
          }
          // Valid access key — skip Supabase auth check, allow through
        } else {
          const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
          const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

          const cookieStore = await cookies();
          const { createServerClient } = await import('@/lib/supabase');
          const clientSupabase = createServerClient(
            supabaseUrl,
            supabaseAnonKey,
            {
              cookies: {
                getAll() { return cookieStore.getAll(); },
                setAll() {} // No-op in GET route
              }
            }
          );

          const { data: { user } } = await clientSupabase.auth.getUser();

          if (!user) {
            return new Response('Unauthorized: Private folio preview requires an active session.', { status: 401 });
          }

          // Check organization membership
          const { data: membership, error: memberErr } = await supabaseAdmin
            .from('organization_members')
            .select('id')
            .eq('organization_id', project.organization_id)
            .eq('user_id', user.id)
            .limit(1);

          if (memberErr || !membership || membership.length === 0) {
            return new Response('Access Denied: You do not have permission to preview this private folio.', { status: 403 });
          }
        }
      }
    }

    if (!project) {
      return new Response('Project Not Found', { status: 404 });
    }

    // Draft/takedown gate — block raw file access for unpublished or
    // moderated-down folios unless the viewer is an org member (studio
    // preview). `moderation_status = 'hidden'` is a platform takedown:
    // identical to draft for the public, but members keep edit access.
    const takenDown = project.moderationStatus === 'hidden';
    if (project.status === 'draft' || takenDown) {
      const host = request.headers.get('host');
      if (isOSS) {
        // OSS: allow localhost (studio preview), block external. Takedowns
        // cannot exist in OSS (no platform moderation) — draft wording only.
        if (!isLocalHost(host)) {
          return new Response('This folio has not been published yet.', { status: 404 });
        }
      } else {
        // Cloud: allow authenticated org members (studio preview), block others
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
        const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
        const cookieStore = await cookies();
        const { createServerClient } = await import('@/lib/supabase');
        const clientSupabase = createServerClient(supabaseUrl, supabaseAnonKey, {
          cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} }
        });
        const { data: { user } } = await clientSupabase.auth.getUser();
        if (!user) {
          return new Response(
            takenDown ? 'This folio is no longer available.' : 'This folio has not been published yet.',
            { status: 404 }
          );
        }
        const { data: membership } = await supabaseAdmin
          .from('organization_members')
          .select('id')
          .eq('organization_id', project.organization_id)
          .eq('user_id', user.id)
          .limit(1);
        if (!membership || membership.length === 0) {
          return new Response(
            takenDown ? 'This folio is no longer available.' : 'This folio has not been published yet.',
            { status: 404 }
          );
        }
      }
    }

    // Tunnel gating only applies in OSS mode. Cloud folios are publicly hosted.
    const host = request.headers.get('host');
    if (isOSS && !isLocalHost(host) && !project.publicTunnelEnabled) {
      return new Response(
        `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Access Restricted</title>
    <style>
        body { background: #09090b; color: #a1a1aa; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
        .box { max-width: 400px; padding: 32px; border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; background: rgba(255,255,255,0.01); backdrop-filter: blur(8px); }
        h1 { color: #f4f4f5; font-size: 18px; margin-top: 0; }
        p { font-size: 12px; line-height: 1.5; }
    </style>
</head>
<body>
    <div class="box">
        <h1>Private Folio</h1>
        <p>This folio's public link is currently disabled. Toggle "Enable Public Link" inside the LiveFolio Studio to make it accessible online.</p>
    </div>
</body>
</html>`,
        { 
          status: 403, 
          headers: { 'Content-Type': 'text/html; charset=utf-8' } 
        }
      );
    }

    // Determine target version — default latest. ?v= pins an exact version;
    // only credentialed viewers (member/grant/access key) may pin a
    // NON-latest one. Anonymously requesting an old version silently
    // serves the latest: no 403 oracle ("this version exists but is
    // locked") and blind ?v= enumeration yields nothing beyond the public
    // link. Version ids are uuid-ish; a garbage id simply falls through
    // to latest, as before.
    let version = project.versions[project.versions.length - 1];
    if (versionId) {
      const match = project.versions.find((v) => v.versionId === versionId);
      const latestId = version?.versionId;
      if (match && match.versionId === latestId) {
        version = match; // the public version — no identity needed
      } else if (match && (await canViewHistorical(request, project))) {
        version = match;
      }
    }

    const filename = (pathArray && pathArray.length > 0) ? pathArray.join('/') : 'index.html';
    let code = version.files[filename];

    if (code === undefined) {
      // Fallback: Case-insensitive lookup
      const lowerFilename = filename.toLowerCase();
      const caseInsensitiveKey = Object.keys(version.files).find(
        (k) => k.toLowerCase() === lowerFilename
      );
      if (caseInsensitiveKey) {
        code = version.files[caseInsensitiveKey];
      }
    }

    // ── Paid gate (cloud only) ────────────────────────────────────────
    // Inserted AFTER filename/code resolution (preview modes need
    // `filename`) but BEFORE any serving branch, so every response below
    // can be finalized with the gate's cache/cookie policy.
    //
    // Enforcement model (2026-09-03): the real wall is the server-side
    // grant check (`hasActiveGrant`). Preview modes only shape what a
    // non-paying visitor sees:
    //   'timed'      — ONE N-second read window per browser per 24h. When
    //                  the signed window expires, a consumed-marker cookie
    //                  (24h) hard-paywalls revisits — no re-trigger.
    //   'first_page' — first viewport only: the served index is clipped to
    //                  height:100vh with overflow hidden (no scroll) plus an
    //                  unlock banner; other HTML pages paywall outright.
    // All cookie schemes are clearing-proof only against casual visitors —
    // accepted as marketing-grade; logged-in buyers unlock by grant, which
    // no cookie can fake.
    let forceNoStore = false;
    let previewCookieToSet: { name: string; value: string; maxAge: number } | null = null;
    let clipFirstPage = false;
    let gateCfg: PaidAccessConfig | null = null;
    let gateAccent: string | undefined;
    // Buyer-trace state (P3): set when the resolved viewer holds an active
    // grant — served HTML pages then carry an invisible per-buyer marker.
    let gateViewerGranted = false;
    let gateViewerId: string | null = null;
    // Private folios only ever serve access-key holders or org members —
    // bearer/studio content must never be cached by shared caches or CDNs
    // (previously a keyed ?v= request fell through to `public, immutable`
    // and outlived the folio's privacy by up to a year).
    if (project.isPrivate) forceNoStore = true;

    const keyAccessCloud = !isOSS && project.isPrivate && project.accessKey
      && searchParams.get('access_key')
      && timingSafeEqualStr((project.accessKey || '').trim(), (searchParams.get('access_key') || '').trim());
    // Private-key holders are the access the owner chose — no paywall for them.
    if (isCloud && FEATURES.paidGating && !keyAccessCloud) {
      const gate = await resolveGateConfig({
        paid_access: project.paidAccess,
        project_id: project.projectId,
        organization_id: project.organization_id,
      });

      if (gate?.config.enabled) {
        gateCfg = gate.config;

        // Viewer identity — null-safe (anonymous visitors simply paywall).
        let user: { id: string } | null = null;
        try {
          const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
          const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
          const cookieStore = await cookies();
          const { createServerClient } = await import('@/lib/supabase');
          const clientSupabase = createServerClient(supabaseUrl, supabaseAnonKey, {
            cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} }
          });
          const { data } = await clientSupabase.auth.getUser();
          user = data.user;
        } catch { /* anonymous */ }

        // Owner/member bypass — org members always see their own folios.
        let isMember = false;
        if (user && project.organization_id) {
          const { data: membership } = await supabaseAdmin
            .from('organization_members')
            .select('id')
            .eq('organization_id', project.organization_id)
            .eq('user_id', user.id)
            .limit(1);
          isMember = !!(membership && membership.length > 0);
        }

        // Grants: a folio grant always unlocks; a workspace grant only
        // unlocks INHERITED folios (a folio with its own config is its own).
        const folioHasOwnGate = project.paidAccess != null;
        let granted = false;
        if (user && !isMember) {
          granted = await hasActiveGrant(user.id, 'folio', id)
            || (!folioHasOwnGate && project.projectId
              ? await hasActiveGrant(user.id, 'workspace', project.projectId)
              : false);
        }

        const canView = isMember || granted;
        gateViewerGranted = granted && !!user;
        gateViewerId = granted ? (user?.id ?? null) : null;
        if (!canView) {
          gateAccent = await getOwnerAccent(project.organization_id);
          // Never let a CDN cache gated content shown to a previewer.
          forceNoStore = true;
          const cfg = gate.config;

          if (cfg.previewMode === 'none') {
            return new Response(paywall403Html(cfg, gateAccent), {
              status: 403,
              headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store, max-age=0, must-revalidate',
              },
            });
          }

          if (cfg.previewMode === 'timed') {
            // ONE read window per browser per 24h: the first gated request
            // arms a signed clock cookie; while valid the content serves.
            // When an armed (now expired) cookie is seen again, a 24h
            // consumed marker is set and the visitor hits the hard paywall —
            // leaving and re-entering cannot re-trigger another preview.
            const cookieName = `lf_preview_${id}`;
            const consumedName = `lf_preview_consumed_${id}`;
            const cookieHeader = request.headers.get('cookie') || '';
            const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]*)`));

            const hardPaywall = (): Response => new Response(paywall403Html(cfg, gateAccent), {
              status: 403,
              headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store, max-age=0, must-revalidate',
              },
            });

            // Consumed within the last 24h → hard paywall, never re-arm
            // (the browser may already have dropped the expired preview
            // cookie, so absence of a preview cookie must not re-trigger).
            if (new RegExp(`(?:^|;\\s*)${consumedName}=([^;]*)`).test(cookieHeader)) {
              return hardPaywall();
            }

            if (match) {
              // A preview cookie EXISTS → this browser already previewed.
              let cookieVal: string | null = null;
              try { cookieVal = decodeURIComponent(match[1]); } catch { cookieVal = null; }
              const graceActive = !!cookieVal && verifyPreviewCookieValue(cookieVal, id);
              if (!graceActive) {
                // Window expired → consume the preview for 24h, then paywall.
                const res = hardPaywall();
                res.headers.append(
                  'Set-Cookie',
                  `${consumedName}=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`
                );
                return res;
              }
              // graceActive: fall through — content keeps serving.
            } else {
              const previewSeconds = cfg.previewSeconds ?? 30;
              previewCookieToSet = {
                name: cookieName,
                value: signPreviewCookieValue(id, previewSeconds),
                maxAge: previewSeconds,
              };
            }
          }

          if (cfg.previewMode === 'first_page') {
            // Non-index HTML pages are paid content → paywall outright.
            // Shared static assets (css/js/json/images/asset://) stay served
            // so the index.html preview renders — accepted asset leakage.
            if (filename.toLowerCase() !== 'index.html' && filename.toLowerCase().endsWith('.html')) {
              return new Response(paywall403Html(cfg, gateAccent), {
                status: 403,
                headers: {
                  'Content-Type': 'text/html; charset=utf-8',
                  'Cache-Control': 'no-store, max-age=0, must-revalidate',
                },
              });
            }
            // Single-file long doc: clip applied AFTER code resolution, on
            // HTML responses only (after the watermark injection below).
            clipFirstPage = true;
          }
        }
      }
    }

    // Applied to every response in the gated flow: no-store for gated
    // content, plus the timed-preview cookie on the first gated response.
    const applyGateHeaders = (init: HeadersInit = {}): Headers => {
      const headers = new Headers(init);
      if (forceNoStore) {
        headers.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
      }
      if (previewCookieToSet) {
        headers.set(
          'Set-Cookie',
          `${previewCookieToSet.name}=${previewCookieToSet.value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${previewCookieToSet.maxAge}`
        );
      }
      return headers;
    };

    // Cache policy per response kind. `forceNoStore` (private / gated /
    // token-served content) always wins. Versioned HTML used to be
    // `immutable` for a year — but a privacy flip (private, paid gate,
    // takedown) does not bump the version, so caches kept serving content
    // long after it stopped being public. Versioned HTML is now bounded +
    // revalidating. Binary assets stay content-addressed-immutable (public
    // folios only — forceNoStore already excludes private/gated ones).
    const cacheControl = (htmlResponse: boolean): string => {
      if (forceNoStore) return 'no-store, max-age=0, must-revalidate';
      if (htmlResponse) {
        return versionId
          ? 'public, max-age=300, must-revalidate'
          : 'public, max-age=5, stale-while-revalidate=60';
      }
      return versionId
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=5, stale-while-revalidate=60';
    };

    // ── Source-lock flow (P2) ──────────────────────────────────────────
    // Runs for every HTML-serving branch below (the requested file, or the
    // index.html fallback). Three outcomes:
    //   wrap    — public share of a source_locked folio: mint a token and
    //             serve the bootstrap shell (real HTML never leaves raw).
    //   payload — a valid token arrived: serve the REAL page below (with
    //             friction injected), never cached.
    //   deny    — a bogus/expired token: 403.
    //   null    — not source_locked, studio/member request, or secret
    //             unconfigured (fail open): serve normally.
    const sourceLockFlow = async (
      servedFile: string
    ): Promise<{ kind: 'wrap'; html: string } | { kind: 'payload' } | { kind: 'deny' } | null> => {
      if (!isCloud || gateCfg?.protection !== 'source_locked') return null;
      const payloadToken = searchParams.get('__p');
      if (payloadToken) {
        const valid =
          payloadToken.length < 512 &&
          verifyPageToken(payloadToken, { f: project.id, v: version.versionId ?? '', n: servedFile });
        if (!valid) return { kind: 'deny' };
        // Token-bound content must never be cached (tokens expire in ~60s).
        forceNoStore = true;
        return { kind: 'payload' };
      }
      // Studio previews are never wrapped; neither are org members (they
      // reach the studio, which always fetches full source). Session-based —
      // the old Referer check let an anonymous caller spoof a /studio/
      // referer and receive the real HTML unwrapped.
      if (!(await isGuestShare(request, project))) return null;
      const token = signPageToken({ f: project.id, v: version.versionId ?? '', n: servedFile });
      if (!token) return null; // secret unconfigured → fail open (logged in lib)
      forceNoStore = true;
      return { kind: 'wrap', html: buildSourceLockShell(token) };
    };

    const wrapHtmlHeaders = (html: string): Response =>
      new Response(html, {
        headers: applyGateHeaders({
          'Content-Type': 'text/html; charset=utf-8',
          'X-Frame-Options': 'SAMEORIGIN',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "frame-ancestors 'self'",
          'Cache-Control': 'no-store, max-age=0, must-revalidate',
        }),
      });

    if (code === undefined) {
      // If the specific page is not found, fallback to index.html or list of pages
      if (version.files['index.html']) {
        const lock = await sourceLockFlow('index.html');
        if (lock?.kind === 'wrap') return wrapHtmlHeaders(lock.html);
        if (lock?.kind === 'deny') {
          return new Response('Access denied', { status: 403, headers: applyGateHeaders() });
        }
        let html = version.files['index.html'];
        if ((await isFreePlan(project)) && (await isGuestShare(request, project))) {
          html = injectWatermark(html);
        }
        if (lock?.kind === 'payload') {
          html = injectSourceLockFriction(html);
        }
        // First-page preview: clip the fallback index.html too (any HTML
        // response inside the gated flow must respect the preview mode).
        if (clipFirstPage && gateCfg) {
          html = injectFirstPageClip(html, gateCfg, gateAccent);
        }
        // Buyer trace (P3) — granted live viewers get the invisible marker.
        if (gateViewerGranted && gateViewerId) {
          html = embedTraceMarker(html, { f: project.id, u: gateViewerId, k: 'live', t: Date.now() });
        }
        // Share pin bridge — last injection so nothing above can strip it.
        if (searchParams.get('lf_pins') === '1') {
          html = injectPinBridge(html);
        }
        return new Response(html, {
          headers: applyGateHeaders({
            'Content-Type': 'text/html; charset=utf-8',
            'X-Frame-Options': 'SAMEORIGIN',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "frame-ancestors 'self'",
            'Cache-Control': 'no-store, max-age=0, must-revalidate',
          })
        });
      }
      // Deliberately terse — a file-inventory listing would hand anonymous
      // callers the full page list of the active version (probing aid).
      return new Response('Page not found.', { status: 404 });
    }

    // Determine correct Content-Type based on file extension
    let contentType = 'text/html; charset=utf-8';
    const lowerFilename = filename.toLowerCase();
    if (lowerFilename.endsWith('.css')) {
      contentType = 'text/css; charset=utf-8';
    } else if (lowerFilename.endsWith('.js') || lowerFilename.endsWith('.mjs')) {
      contentType = 'application/javascript; charset=utf-8';
    } else if (lowerFilename.endsWith('.json')) {
      contentType = 'application/json; charset=utf-8';
    } else if (lowerFilename.endsWith('.svg')) {
      contentType = 'image/svg+xml; charset=utf-8';
    } else if (lowerFilename.endsWith('.png')) {
      contentType = 'image/png';
    } else if (lowerFilename.endsWith('.jpg') || lowerFilename.endsWith('.jpeg')) {
      contentType = 'image/jpeg';
    } else if (lowerFilename.endsWith('.gif')) {
      contentType = 'image/gif';
    } else if (lowerFilename.endsWith('.webp')) {
      contentType = 'image/webp';
    } else if (lowerFilename.endsWith('.ico')) {
      contentType = 'image/x-icon';
    }

    // ── asset:// pointer resolution (Phase 1) ────────────────────────
    // Images stored in Supabase Storage (Cloud) or disk (OSS) instead of
    // embedded as base64 in JSONB. The files map holds "asset://sha256-{hex}"
    // pointers. Resolve here before falling through to legacy branches.
    if (code.startsWith('asset://')) {
      // Strict canonical prefix — any other asset:// variant is rejected
      // outright (defense-in-depth alongside the hash regex below).
      const ASSET_PREFIX = 'asset://sha256-';
      if (!code.startsWith(ASSET_PREFIX)) {
        return new Response('Asset not found', { status: 404 });
      }
      const hash = code.slice(ASSET_PREFIX.length); // hex.ext
      // Security: only accept strict content-addressed pointers. Anything
      // containing path separators or '..' is rejected — this prevents
      // path traversal via crafted asset:// pointers (arbitrary file read).
      if (!/^[0-9a-f]{64}(?:\.[a-z0-9]{1,8})?$/i.test(hash)) {
        return new Response('Asset not found', { status: 404 });
      }
      // Security: the folio id is used as a directory component — reject
      // any id that could escape the asset root.
      if (!id || id.includes('/') || id.includes('\\') || id.startsWith('.')) {
        return new Response('Asset not found', { status: 404 });
      }
      if (isOSS) {
        const fs = await import('fs/promises');
        const path = await import('path');
        const assetDir = path.resolve(path.join(process.cwd(), 'data', 'folio-assets', id));
        const assetPath = path.resolve(path.join(assetDir, hash));
        // Defense-in-depth: containment check even if the regex ever loosens.
        if (assetPath !== assetDir && !assetPath.startsWith(assetDir + path.sep)) {
          return new Response('Asset not found', { status: 404 });
        }
        try {
          // hash includes extension (e.g., "abc123def.png")
          const buf = await fs.readFile(assetPath);
          return new Response(buf, {
            headers: {
              'Content-Type': contentType,
              'X-Frame-Options': 'SAMEORIGIN',
              'X-Content-Type-Options': 'nosniff',
              'Content-Security-Policy': "frame-ancestors 'self'",
              'Cache-Control': 'public, max-age=31536000, immutable',
            }
          });
        } catch {
          return new Response('Asset not found', { status: 404 });
        }
      }
      // Cloud: redirect to signed Supabase Storage URL.
      // The pointer is "asset://sha256-{hex}.{ext}" — the hash+ext is the
      // filename in Storage at {orgId}/{folioId}/{filename}.
      const { supabaseAdmin } = await import('@/lib/supabase');
      if (supabaseAdmin && project) {
        const orgDir = project.organization_id || id;
        const storagePath = `${orgDir}/${id}/${hash}`;
        const { data } = await supabaseAdmin.storage
          .from('folio-assets')
          .createSignedUrl(storagePath, 3600);
        if (data?.signedUrl) {
          return NextResponse.redirect(data.signedUrl, { status: 302, headers: applyGateHeaders() });
        }
      }
      return new Response('Asset not found', { status: 404 });
    }

    // If file is a Base64-encoded Data URL asset, decode and serve as binary
    if (code.startsWith('data:')) {
      const match = code.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        const mimeType = match[1];
        const base64Data = match[2];
        const buffer = Buffer.from(base64Data, 'base64');
        return new Response(buffer, {
          headers: applyGateHeaders({
            'Content-Type': mimeType,
            'X-Frame-Options': 'SAMEORIGIN',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "frame-ancestors 'self'",
            'Cache-Control': 'no-store, max-age=0, must-revalidate',
          })
        });
      }
    }

    // Recover corrupted latin1 binary strings (legacy extractBase64Images bug).
    // Before the fix, extractBase64Images stored decoded image bytes as
    // decoded.toString('binary') — a latin1-encoded string. Serving that as
    // UTF-8 text corrupts any byte ≥ 0x80. Detect these by checking if the
    // file has an image extension and the stored value is NOT a data URL.
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp'];
    const isImagePath = imageExtensions.some((e) => lowerFilename.endsWith(e));
    if (isImagePath && code && !code.startsWith('data:') && !code.startsWith('asset://')) {
      // Reconstruct original bytes via latin1 decoding
      const buffer = Buffer.from(code, 'latin1');
      return new Response(buffer, {
        headers: applyGateHeaders({
          'Content-Type': contentType,
          'X-Frame-Options': 'SAMEORIGIN',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "frame-ancestors 'self'",
          'Cache-Control': cacheControl(false),
        })
      });
    }

    // Source-lock gate for the main HTML branch — see sourceLockFlow above
    // (same rules as the index-fallback branch).
    const isHtml = contentType.startsWith('text/html');
    const lock = isHtml ? await sourceLockFlow(filename) : null;
    if (lock?.kind === 'wrap') return wrapHtmlHeaders(lock.html);
    if (lock?.kind === 'deny') {
      return new Response('Access denied', { status: 403, headers: applyGateHeaders() });
    }

    // Inject subtle watermark for Free-plan folios on HTML responses. Guest
    // decision is session-based (never Referer — spoofable, see isGuestShare).
    const shouldWatermark = isHtml && (await isFreePlan(project)) && (await isGuestShare(request, project));
    if (shouldWatermark) {
      code = injectWatermark(code);
    }
    // Token-served payloads carry the copy-friction layer (never in studio).
    if (lock?.kind === 'payload') {
      code = injectSourceLockFriction(code);
    }

    // First-page preview clip — HTML responses only, after the watermark
    // (same server-side injection precedent). Assets keep flowing untouched
    // so the clipped index.html still renders.
    if (clipFirstPage && gateCfg && contentType.startsWith('text/html')) {
      code = injectFirstPageClip(code, gateCfg, gateAccent);
    }
    // Buyer trace (P3) — granted live viewers get the invisible marker.
    if (isHtml && gateViewerGranted && gateViewerId) {
      code = embedTraceMarker(code, { f: project.id, u: gateViewerId, k: 'live', t: Date.now() });
    }
    // Share pin bridge — last injection so nothing above can strip it.
    if (isHtml && searchParams.get('lf_pins') === '1') {
      code = injectPinBridge(code);
    }

    // Serve file with correct content-type — cache policy in cacheControl()
    // (HTML vs asset · versioned vs not · forceNoStore wins).
    const cacheHeader = cacheControl(isHtml);

    return new Response(code, {
      headers: applyGateHeaders({
        'Content-Type': contentType,
        'X-Frame-Options': 'SAMEORIGIN',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "frame-ancestors 'self'",
        'Cache-Control': cacheHeader,
      })
    });

  } catch (err: unknown) {
    console.error('[/api/raw] Server exception:', err);
    return new Response('Internal Server Error', { status: 500 });
  }
}
