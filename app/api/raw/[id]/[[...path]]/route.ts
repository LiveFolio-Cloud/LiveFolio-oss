import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
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
import { checkRateLimit, getClientIp, buildRateLimitHeaders } from '@/lib/rate-limit';
import { signPageToken, verifyPageToken } from '@/lib/folio-tokens';
import { embedTraceMarker } from '@/lib/folio-keys';
import { safeEqual } from '@/lib/crypto';
import { sessionSupabaseClient } from '@/lib/api/session';
import { isOrgMember } from '@/lib/api/membership';
import { can, resolveFolioRole } from '@/app/api/files/_lib/role-gate';
import type { FolioCapability, FolioRole } from '@/app/api/files/_lib/role-gate';
import type { PaidAccessConfig } from '@/lib/gating/types';

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
// own URL. Editor previews never pass lf_pins=1.
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
// Members (the editor) and agents never hit it — the wrap path is restricted
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

/** Copy friction injected into token-served payload HTML (never in the editor). */
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

/** Guest share (public viewer) vs editor/member request.
 *
 * Security: this used to read the client-sent `Referer` header
 * (`Referer: …/studio/…` → treated as the editor). Referer is spoofable — any
 * anonymous caller could strip the Free-plan watermark or, on source-locked
 * folios, skip the wrapping shell and receive the real HTML. The decision is
 * now session-based: Cloud resolves org membership from the session cookie +
 * DB (unforgeable); OSS has no members, so the local host stands in
 * (unchanged local-first behavior).
 *
 * `readSession` is the caller's per-request session memo (see GET): this check
 * and the gate checks must agree on who is calling, and an HTML response
 * already pays for one identity read here, so it must not pay for two. */
async function isGuestShare(
  request: Request,
  project: HTMLFile,
  readSession: () => Promise<{ id: string } | null>
): Promise<boolean> {
  const host = request.headers.get('host') || '';
  if (isOSS) return !isLocalHost(host);
  return !(await isOrgMemberOf(project, readSession));
}

// Keyed by org id — this used to be a single slot, so two orgs interleaving
// requests overwrote each other's entry and the cache missed on nearly every
// request under any multi-tenant traffic, paying the `organizations.plan`
// query it exists to avoid. Same 5-minute TTL, bounded like the signed-URL
// cache below (a map keyed by tenant id must not grow without limit).
const _watermarkPlanTtlMs = 5 * 60_000;
const _WATERMARK_PLAN_CACHE_MAX = 500;
const _watermarkPlanCache = new Map<string, { plan: string; expiresAt: number }>();

function readWatermarkPlanCache(orgId: string): string | null {
  const hit = _watermarkPlanCache.get(orgId);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    _watermarkPlanCache.delete(orgId); // evict expired on read so the map tracks live entries only
    return null;
  }
  // Re-insert at the tail (Map preserves insertion order) so a hot org is the
  // last evicted under pressure.
  _watermarkPlanCache.delete(orgId);
  _watermarkPlanCache.set(orgId, hit);
  return hit.plan;
}

function writeWatermarkPlanCache(orgId: string, plan: string): void {
  if (_watermarkPlanCache.size >= _WATERMARK_PLAN_CACHE_MAX) {
    // Reclaim expired entries first; only if that frees nothing do we evict
    // least-recently-used. Either path keeps the map at or below the bound.
    // forEach (not `for...of`) — this tsconfig target can't downlevel-iterate a
    // Map, and deleting the current entry inside forEach is well-defined.
    _watermarkPlanCache.forEach((v, k) => {
      if (v.expiresAt <= Date.now()) _watermarkPlanCache.delete(k);
    });
    while (_watermarkPlanCache.size >= _WATERMARK_PLAN_CACHE_MAX) {
      const oldest = _watermarkPlanCache.keys().next().value;
      if (oldest === undefined) break;
      _watermarkPlanCache.delete(oldest);
    }
  }
  _watermarkPlanCache.set(orgId, { plan, expiresAt: Date.now() + _watermarkPlanTtlMs });
}

async function isFreePlan(project: HTMLFile): Promise<boolean> {
  // OSS short-circuit stays FIRST: single-owner, always Free, and the map is
  // never touched (keeping OSS allocation-free on this hot path).
  if (isOSS) return true;

  const orgId = project.organization_id;
  if (!orgId) return true;

  try {
    // A miss falls through to the query below — identical to the old cold
    // path, including both `return true` (treat as Free) fallbacks.
    const cachedPlan = readWatermarkPlanCache(orgId);
    if (cachedPlan !== null) return cachedPlan === 'Free';
    const { data, error } = await supabaseAdmin
      .from('organizations')
      .select('plan')
      .eq('id', orgId)
      .single();
    if (error || !data) return true;
    writeWatermarkPlanCache(orgId, data.plan);
    return data.plan === 'Free';
  } catch {
    return true;
  }
}

// ── Historical-version gate (content protection) ─────────────────────
// The raw route serves ?v=<versionId> pins so the editor and share pages
// can rehydrate an exact snapshot (comment/pin anchors). Blindly
// enumerable, those same URLs hand scrapers the folio's FULL edit
// history — content the author later removed or replaced keeps serving.
// Non-latest versions require a credentialed viewer: an org member, a folio
// collaborator (a grant is the owner's own act of sharing, so the
// history it covers is the same history the member sees), a buyer grant, or
// the folio's valid access key. Anonymous callers and strangers get the
// latest published version only — which is all the public link grants them
// anyway (guests pin to latest: the share viewer never requests historical
// versions).

/** Cloud session user — null for anonymous (mirrors the paid-gate lookup).
 *
 * The cookie client itself is the SHARED one (`lib/api/session`) — this file
 * used to carry four copies of "read the two public env vars, build an SSR
 * client on the request cookies, ask for the user", and they all read the
 * session through this one wrapper now. The only local part is the cookie
 * probe: with no Supabase auth cookie the request is anonymous by definition,
 * and the probe keeps the hot public-share path from building a client it
 * cannot use. */
async function resolveSessionUser(): Promise<{ id: string } | null> {
  try {
    const cookieStore = await cookies();
    // No Supabase auth cookie present → anonymous.
    if (!cookieStore.getAll().some((c) => c.name.startsWith('sb-') || c.name.startsWith('supabase-'))) {
      return null;
    }
    const clientSupabase = await sessionSupabaseClient();
    const { data } = await clientSupabase.auth.getUser();
    return data.user;
  } catch {
    return null;
  }
}

/**
 * The viewer's resolved standing on this folio: who they are, and what
 * `lib/collaborators` says they are on this folio.
 *
 * `role` is null when the question does not apply — OSS, or no identity at all
 * — which is why every check below goes through `standingHas()` rather than
 * reading `role` directly: null can never satisfy a capability.
 */
interface ViewerStanding {
  /** Session user id, or null for an anonymous request. */
  userId: string | null;
  /** The resolved folio role, or null when it was not resolved. */
  role: FolioRole | null;
}

/** Does this standing reach this capability on this folio?
 *
 * `can()` is total: a null role (OSS or anonymous) and an unrecognised
 * capability both answer false, so a caller that has not established standing
 * gets a refusal rather than the benefit of the doubt. */
function standingHas(standing: ViewerStanding, capability: FolioCapability): boolean {
  return standing.role !== null && can(standing.role, capability);
}

/** Resolve the session, then the role, for one viewer on one folio. */
async function resolveStandingFor(
  project: HTMLFile,
  readSession: () => Promise<{ id: string } | null>
): Promise<ViewerStanding> {
  const user = await readSession();
  if (!user) return { userId: null, role: null };
  // Self-hosted installs have no grants AND `resolveFolioRole` answers 'owner'
  // for every caller there — consulting it would silently turn the OSS
  // private-key gate and the OSS draft gate into no-ops for every visitor.
  // It is never asked in OSS.
  if (isOSS) return { userId: user.id, role: null };
  const role = await resolveFolioRole(user.id, {
    id: project.id,
    organization_id: project.organization_id ?? null,
  });
  return { userId: user.id, role };
}

// Membership decisions on the public share path must not hammer the DB per
// request; org memberships change rarely, so a 5-minute in-memory cache is
// safe (worst case: a new member waits one window before the editor gets the
// no-watermark/no-wrap treatment). Keyed by (user id, org id) — a pair count
// that grows with the user base, so it is bounded and evicted exactly like the
// watermark-plan and signed-URL caches below: entries expired logically but
// never deleted used to stay resident for the life of the process.
const _MEMBERSHIP_TTL_MS = 5 * 60_000;
const _MEMBERSHIP_CACHE_MAX = 500;
const _membershipCache = new Map<string, { member: boolean; expiresAt: number }>();

/** Cached membership, or null on miss (a cached `false` is a real answer). */
function readMembershipCache(cacheKey: string): boolean | null {
  const hit = _membershipCache.get(cacheKey);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    _membershipCache.delete(cacheKey); // evict expired on read so the map tracks live entries only
    return null;
  }
  // Re-insert at the tail (Map preserves insertion order) so a hot session is
  // the last evicted under pressure.
  _membershipCache.delete(cacheKey);
  _membershipCache.set(cacheKey, hit);
  return hit.member;
}

function writeMembershipCache(cacheKey: string, member: boolean): void {
  if (_membershipCache.size >= _MEMBERSHIP_CACHE_MAX) {
    // Reclaim expired entries first; only if that frees nothing do we evict
    // least-recently-used. Either path keeps the map at or below the bound.
    // forEach (not `for...of`) — this tsconfig target can't downlevel-iterate a
    // Map, and deleting the current entry inside forEach is well-defined.
    _membershipCache.forEach((v, k) => {
      if (v.expiresAt <= Date.now()) _membershipCache.delete(k);
    });
    while (_membershipCache.size >= _MEMBERSHIP_CACHE_MAX) {
      const oldest = _membershipCache.keys().next().value;
      if (oldest === undefined) break;
      _membershipCache.delete(oldest);
    }
  }
  _membershipCache.set(cacheKey, { member, expiresAt: Date.now() + _MEMBERSHIP_TTL_MS });
}

/** May this caller fetch a NON-latest version? (OSS: single-owner — yes.)
 *
 * The caller's standing is passed in rather than resolved here: the four gates
 * on this route share ONE resolution per request (see the memo in GET), so a
 * request cannot be a collaborator for one gate and a stranger for the next. */
async function canViewHistorical(
  request: Request,
  project: HTMLFile,
  standing: ViewerStanding
): Promise<boolean> {
  if (isOSS) return true;
  try {
    const { searchParams } = new URL(request.url);
    // A valid private access key = the owner chose this holder — history included.
    const accessKeyParam = searchParams.get('access_key') || '';
    if (
      project.isPrivate &&
      project.accessKey &&
      accessKeyParam &&
      safeEqual(accessKeyParam.trim(), project.accessKey.trim())
    ) {
      return true;
    }
    if (!standing.userId) return false;
    // Org member (owner/team) and folio collaborator (role ≥ viewer) both see
    // the full history — one resolution, the module's single decision point.
    if (standingHas(standing, 'view')) return true;
    // Active buyer grant — folio grant, or workspace grant when the folio
    // inherits the workspace gate (same precedence as the paid gate).
    if (await hasActiveGrant(standing.userId, 'folio', project.id)) return true;
    const folioHasOwnGate = project.paidAccess != null;
    if (!folioHasOwnGate && project.projectId &&
        await hasActiveGrant(standing.userId, 'workspace', project.projectId)) {
      return true;
    }
  } catch { /* any failure → deny */ }
  return false;
}

/** Is the requesting session an org member? (Source-lock member exemption.)
 *
 * The probe is the shared one (`lib/api/membership`); the 5-minute cache in
 * front of it stays, because this runs on the public HTML path and a member's
 * answer is what keeps the watermark and the source-lock wrap off their own
 * folios. */
async function isOrgMemberOf(
  project: HTMLFile,
  readSession: () => Promise<{ id: string } | null>
): Promise<boolean> {
  if (isOSS || !project.organization_id || !supabaseAdmin) return false;
  const user = await readSession();
  if (!user) return false;
  const cacheKey = `${user.id}:${project.organization_id}`;
  const cachedMember = readMembershipCache(cacheKey);
  if (cachedMember !== null) return cachedMember;
  try {
    const member = await isOrgMember(user.id, project.organization_id);
    writeMembershipCache(cacheKey, member);
    return member;
  } catch {
    return false;
  }
}

// ── Signed asset URL cache (Cloud) ───────────────────────────────────
// Every asset:// request used to mint a fresh Storage signed URL and 302 to
// it, so a 20-image folio cost 20 Storage API round trips per page render.
// The signature is valid for an hour (SIGNED_URL_TTL_S) — reuse it. The key is
// the storage path, which encodes exactly the (orgId, folioId, hash) triple the
// signature is bound to, so unrelated assets can never collide on an entry.
// TTL sits 10 minutes under the signature lifetime so we never hand out a URL
// that expires mid-flight (clock skew between this process and Storage).
const SIGNED_URL_TTL_S = 3600;
const _signedUrlTtlMs = 50 * 60_000;
const _SIGNED_URL_CACHE_MAX = 500;
const _signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

function readSignedUrlCache(key: string): string | null {
  const hit = _signedUrlCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    _signedUrlCache.delete(key); // evict expired on read so the map tracks live entries only
    return null;
  }
  // Re-insert at the tail (Map preserves insertion order) so a hot folio's
  // assets are the last evicted under pressure.
  _signedUrlCache.delete(key);
  _signedUrlCache.set(key, hit);
  return hit.url;
}

function writeSignedUrlCache(key: string, url: string): void {
  if (_signedUrlCache.size >= _SIGNED_URL_CACHE_MAX) {
    // Reclaim expired entries first; only if that frees nothing do we evict
    // least-recently-used. Either path keeps the map at or below the bound.
    // forEach (not `for...of`) — this tsconfig target can't downlevel-iterate a
    // Map, and deleting the current entry inside forEach is well-defined.
    _signedUrlCache.forEach((v, k) => {
      if (v.expiresAt <= Date.now()) _signedUrlCache.delete(k);
    });
    while (_signedUrlCache.size >= _SIGNED_URL_CACHE_MAX) {
      const oldest = _signedUrlCache.keys().next().value;
      if (oldest === undefined) break;
      _signedUrlCache.delete(oldest);
    }
  }
  _signedUrlCache.set(key, { url, expiresAt: Date.now() + _signedUrlTtlMs });
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
          // Shared helper (same one 6 other routes use). It emits the three
          // X-RateLimit-* headers plus Retry-After — the latter with the exact
          // formula this route used to hand-roll (lockout end, else window
          // reset), so no header is dropped and X-RateLimit-Reset is gained.
          ...buildRateLimitHeaders(rl),
        },
      });
    }

    const { id, path: pathArray } = await context.params;
    const { searchParams } = new URL(request.url);
    const versionId = searchParams.get('v');

    let project: HTMLFile | null = null;

    // ── One viewer resolution per request ─────────────────────────────
    // Five checks below ask who is calling: the private-key gate, the
    // draft/takedown gate, the historical-version pin, the paid gate — and the
    // guest/member check that decides the watermark and the source-lock wrap.
    // They used to ask separately, each with its own session read and its own
    // membership query; they now share ONE session read, which is also what
    // stops them disagreeing with each other.
    //
    // Two levels, deliberately: the session read is shared by everything (the
    // guest check needs only that), while the ROLE is resolved lazily, because
    // it costs a membership probe and a grant read that a request which never
    // reaches a gate should not pay for — the common anonymous, published, free
    // case reads no session at all (the cookie probe) and resolves no role.
    let sessionPromise: Promise<{ id: string } | null> | null = null;
    const readSession = (): Promise<{ id: string } | null> => {
      if (!sessionPromise) sessionPromise = resolveSessionUser();
      return sessionPromise;
    };
    let standingPromise: Promise<ViewerStanding> | null = null;
    const viewerStanding = (folio: HTMLFile): Promise<ViewerStanding> => {
      if (!standingPromise) standingPromise = resolveStandingFor(folio, readSession);
      return standingPromise;
    };

    if (isOSS) {
      const db = await readDB();
      const match = db.find((p) => p.id === id);
      project = match || null;

      // Security: enforce isPrivate/accessKey in OSS too (previously this
      // gate existed only in cloud mode — private OSS folios were exposed).
      if (project && project.isPrivate) {
        const accessKeyParam = searchParams.get('access_key') || '';
        const serverKey = (project.accessKey || '').trim();
        if (!serverKey || !accessKeyParam || !safeEqual(accessKeyParam, serverKey)) {
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
          if (!safeEqual(accessKeyParam, (project.accessKey || '').trim())) {
            return new Response('Access Denied: Invalid access key.', { status: 403 });
          }
          // Valid access key — skip Supabase auth check, allow through
        } else {
          // A collaborator (role ≥ viewer) bypasses the key: the grant
          // IS the owner handing over the key, and asking them for a secret the
          // owner never sent them would leave every invited viewer locked out.
          // Org members keep their standing through the same check (resolveFolioRole
          // answers 'owner' for them), so the 401-vs-403 shape below is the only
          // part still owed to identity: signed out is 401, signed in without
          // standing on this folio is 403.
          const standing = await viewerStanding(project);
          if (!standingHas(standing, 'bypass_access_key')) {
            if (!standing.userId) {
              return new Response('Unauthorized: Private folio preview requires an active session.', { status: 401 });
            }
            return new Response('Access Denied: You do not have permission to preview this private folio.', { status: 403 });
          }
        }
      }
    }

    if (!project) {
      return new Response('Project Not Found', { status: 404 });
    }

    // Draft/takedown gate — block raw file access for unpublished or
    // moderated-down folios unless the viewer is an org member (editor
    // preview). `moderation_status = 'hidden'` is a platform takedown:
    // identical to draft for the public, but members keep edit access.
    //
    // The collaborator standing joins the Cloud arm: `view` is the
    // capability that covers "any publish state", which is exactly this gate.
    // Two deliberate exclusions keep the grant's reach where §2 puts it:
    //   · a takedown is a PLATFORM action, not a publish state, so it asks the
    //     org-member-only capability (`publish`) and a grant never bypasses it;
    //   · an ARCHIVED folio is a draft by construction (archive forces
    //     status='draft'), and a grant never un-archives — `archivedAt` keeps
    //     the archived case member-only, exactly as before this task.
    const takenDown = project.moderationStatus === 'hidden';
    if (project.status === 'draft' || takenDown) {
      const host = request.headers.get('host');
      if (isOSS) {
        // OSS: allow localhost (editor preview), block external. Takedowns
        // cannot exist in OSS (no platform moderation) — draft wording only.
        if (!isLocalHost(host)) {
          return new Response('This folio has not been published yet.', { status: 404 });
        }
      } else {
        // Cloud: allow anyone with standing on this folio, block everyone else.
        // Same 404 either way — a refusal must not confirm the folio exists.
        const standing = await viewerStanding(project);
        const archived = Boolean(project.archivedAt);
        const allowed = takenDown || archived
          ? standingHas(standing, 'publish')
          : standingHas(standing, 'view');
        if (!allowed) {
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
        <p>This folio's public link is currently disabled. Toggle "Enable Public Link" inside the folio editor to make it accessible online.</p>
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
    // only credentialed viewers (member/collaborator/buyer/access key) may pin
    // a NON-latest one. Anonymously requesting an old version silently
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
      } else if (match && (await canViewHistorical(request, project, await viewerStanding(project)))) {
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
    // bearer/editor content must never be cached by shared caches or CDNs
    // (previously a keyed ?v= request fell through to `public, immutable`
    // and outlived the folio's privacy by up to a year).
    if (project.isPrivate) forceNoStore = true;

    const keyAccessCloud = !isOSS && project.isPrivate && project.accessKey
      && searchParams.get('access_key')
      && safeEqual((project.accessKey || '').trim(), (searchParams.get('access_key') || '').trim());
    // Private-key holders are the access the owner chose — no paywall for them.
    if (isCloud && FEATURES.paidGating && !keyAccessCloud) {
      const gate = await resolveGateConfig({
        paid_access: project.paidAccess,
        project_id: project.projectId,
        organization_id: project.organization_id,
      });

      if (gate?.config.enabled) {
        gateCfg = gate.config;

        // Viewer identity + standing — the SAME memoized resolution the
        // private-key, draft and historical gates above use, so one request
        // cannot be judged differently by two of them. Null-safe: an anonymous
        // visitor simply paywalls.
        const standing = await viewerStanding(project);
        const user = standing.userId ? { id: standing.userId } : null;

        // Owner/member bypass — org members always see their own folios.
        // `publish` is the matrix's org-member-only capability, so this asks
        // the member question through the resolver rather than probing
        // organization_members a second time on the same request.
        const isMember = standingHas(standing, 'publish');

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

        // A collaborator (role ≥ viewer) passes the paywall without a
        // purchase: the grant is the owner's own act of sharing, exactly like
        // the access key. It deliberately does NOT set the buyer-trace state
        // below: that marker identifies a PAYING viewer, and a collaborator has
        // paid nothing.
        const collaboratorBypass = standingHas(standing, 'bypass_paywall');
        const canView = isMember || granted || collaboratorBypass;
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
    //   null    — not source_locked, editor/member request, or secret
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
      // Editor previews are never wrapped; neither are org members (they
      // reach the editor, which always fetches full source). Session-based —
      // the old Referer check let an anonymous caller spoof a /studio/
      // referer and receive the real HTML unwrapped.
      if (!(await isGuestShare(request, project, readSession))) return null;
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
        if ((await isFreePlan(project)) && (await isGuestShare(request, project, readSession))) {
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
        // Data-dir contract — MUST match the WRITE side (lib/asset-store.oss.ts:13)
        // and lib/db.ts:236. Standalone installs set LIVEFOLIO_DATA_DIR so user
        // assets live outside .next/standalone/ (upgrades wipe that dir); the CLI
        // spawns the server with it set and cwd = the app dir, so resolving from
        // cwd here sent every asset:// read to a directory nothing ever writes to
        // — every embedded image 404'd. `|| process.cwd()` (not ??) is deliberate:
        // it mirrors the shared expression, so an empty-string value falls back to
        // cwd on both sides. Unset/empty → byte-identical to the previous path.
        const dataDir = process.env.LIVEFOLIO_DATA_DIR || process.cwd();
        const assetDir = path.resolve(path.join(dataDir, 'data', 'folio-assets', id));
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
        const cachedUrl = readSignedUrlCache(storagePath);
        if (cachedUrl) {
          return NextResponse.redirect(cachedUrl, { status: 302, headers: applyGateHeaders() });
        }
        const { data } = await supabaseAdmin.storage
          .from('folio-assets')
          .createSignedUrl(storagePath, SIGNED_URL_TTL_S);
        if (data?.signedUrl) {
          writeSignedUrlCache(storagePath, data.signedUrl);
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
    const shouldWatermark = isHtml && (await isFreePlan(project)) && (await isGuestShare(request, project, readSession));
    if (shouldWatermark) {
      code = injectWatermark(code);
    }
    // Token-served payloads carry the copy-friction layer (never in the editor).
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
