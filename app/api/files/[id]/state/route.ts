/**
 * Folio state API — `GET` / `PUT /api/files/[id]/state`.
 *
 * The store behind the localStorage shim (ARCHITECTURE.html §2, part 4). A
 * folio runs in a sandboxed, opaque-origin iframe where native `localStorage`
 * throws on every access, so `public/livefolio-state-bridge.js` shadows
 * `localStorage` with an in-memory map and relays writes to the parent page,
 * which calls this route (it holds the session). This route is the ONLY write
 * path for the data a folio collects — the raw route's gates do not protect
 * it, so every gate is re-checked here, server-side (invariant 6).
 *
 * ── The gate stack (ARCHITECTURE.html §5, the checklist this file answers) ──
 *
 *   archived / takedown   → 404 (never confirm existence to a passer-by)
 *   draft                 → 404 unless the caller has standing ≥ view
 *   private               → access key, or a collaborator's `bypass_access_key`
 *   paid                  → org member / buyer grant / collaborator
 *   state_write = 'off'        → 403   (PUT only)
 *   state_write = 'signed_in'  → 401 without a session user (PUT only)
 *   state_write = 'anonymous'  → allowed once the gates above pass (PUT only)
 *   rate limit            → 120 writes / 15 min per IP per folio (PUT)
 *   size                  → 413 beyond 256 KB (PUT)
 *
 * ORDER MATTERS: the visibility gates run BEFORE the `state_write` gate, so a
 * caller who cannot see the folio gets the same 404 a missing folio gets and
 * never learns that data editing exists (403 confirms the folio is real —
 * it is reserved for a caller who can already see it, the same contract
 * `app/api/files/_lib/role-gate.ts` states).
 *
 * ── Store access ───────────────────────────────────────────────────────────
 *
 * Cloud reads/writes `folio_state` through `lib/folio-state.ts` ONLY — no
 * direct table query (db-layer owns the table and the `set_folio_state` RPC,
 * which is also where the 256 KB cap is authoritative). The OSS arm mirrors
 * the comments route's flat-file structure (`readDB` / `runTransaction`) and
 * lives on the `HTMLFile.state` / `HTMLFile.stateRev` fields, gated by
 * `HTMLFile.stateWrite` — all three absent on every record written before the
 * feature existed, and absent means 'off' / empty.
 *
 * ── What the request body may NOT do ───────────────────────────────────────
 *
 * `updatedBy` / `updatedLabel` are decided here from the verified session, never
 * from the payload: a client-supplied label would be a free-text impersonation
 * field on a shared folio. `baseRev` / `label` are accepted (the ShareClient
 * sends them per the frozen protocol) and deliberately ignored — v1 is
 * last-write-wins, and the rev gate that protects unacknowledged writes lives
 * in the shim (spike §C3), whose SYNC is driven by the rev THIS route returns.
 */
import { NextResponse } from 'next/server';
import { readDB, runTransaction } from '@/lib/db';
import { isOSS, FEATURES } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase';
import { extractUUIDFromSlug } from '@/lib/utils';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { safeEqual } from '@/lib/crypto';
import { isLocalHost } from '@/lib/network';
import { err } from '@/lib/api/respond';
import { sessionSupabaseClient } from '@/lib/api/session';
import { resolveGateConfig } from '@/lib/gating/config';
import { hasActiveGrant } from '@/lib/gating/grants';
import { resolveByHyphenSuffix } from '@/lib/api/folio-id';
import { can, resolveFolioRole } from '../../_lib/role-gate';
import { roleTargetOf } from '../../_lib/role-gate';
import type { FolioRole } from '../../_lib/role-gate';
import type { PaidAccessConfig } from '@/lib/gating/types';
import type { HTMLFile } from '@/lib/db';
import {
  STATE_SEED_MAX_BYTES,
  getFolioState,
  isStateWriteMode,
  setFolioState,
  stateByteLength,
  validateStateMap,
  type StateWriteMode,
} from '@/lib/folio-state';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Seed freshness is the correctness guarantee for this feature (spike Q2/Q7):
 * a cached state response can hand a viewer another viewer's seed, or hide the
 * write they just made. Every response from this route — success or refusal —
 * carries `no-store`. Never narrow this to the success path.
 */
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/** Every refusal from this route, with the no-store header already applied. */
function stateErr(message: string, status: number): NextResponse {
  return err(message, { status, headers: NO_STORE });
}

/**
 * Map a `FolioStateError` CODE to a status. Deliberately reads `.code` rather
 * than using `instanceof` — the module's own contract note is explicit that
 * the code survives duplicate module instances and the ES5 downlevel. Returns
 * null when the thrown value is not a state error, so the caller falls through
 * to its generic 500.
 */
function stateErrorResponse(caught: unknown): NextResponse | null {
  const code = (caught as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') return null;
  switch (code) {
    case 'STATE_TOO_LARGE':
      // The RPC (or, in OSS, the pre-check below) measured the payload over
      // 256 KB. 413 is the contract the shim's read-only path expects.
      return stateErr('State exceeds the 256 KB limit.', 413);
    case 'STATE_INVALID':
      return stateErr('Invalid state payload.', 400);
    case 'STATE_UNAVAILABLE':
      // Cloud mode with no service-role client configured. (OSS never reaches
      // here: it branches to the flat-file arm before touching the lib, which
      // is the only deployment where the flat file exists.)
      return stateErr('State storage is not configured.', 500);
    case 'STATE_WRITE_FAILED':
      return stateErr('Failed to save folio state.', 500);
    default:
      return null;
  }
}

// ── The folio row (cloud) ──────────────────────────────────────────────────

/**
 * The ONLY columns either verb reads off `folios`. Read directly (like the
 * comments route selects its own columns) rather than through
 * `transformFolioRecord`: the transform maps the whole 1-10 MB row — versions
 * included — and this route only ever needs the gate facts and `state_write`.
 */
interface StateFolioRow {
  id: string;
  organization_id: string | null;
  status: string | null;
  is_private: boolean | null;
  access_key: string | null;
  archived_at: string | null;
  moderation_status: string | null;
  paid_access?: PaidAccessConfig | null;
  project_id: string | null;
  state_write: string | null;
}

const STATE_FOLIO_COLUMNS =
  'id, organization_id, status, is_private, access_key, archived_at, moderation_status, paid_access, project_id, state_write';

/**
 * Load the row by id, tolerating a human-readable slug whose tail is the UUID
 * (`extractUUIDFromSlug`) and falling back to the whole id — the same two-step
 * lookup `/public` and `/comments` perform.
 */
async function loadFolioRow(targetId: string): Promise<StateFolioRow | null> {
  if (!supabaseAdmin) return null;
  const queryId = extractUUIDFromSlug(targetId);

  let { data, error } = await supabaseAdmin
    .from('folios')
    .select(STATE_FOLIO_COLUMNS)
    .eq('id', queryId)
    .maybeSingle();

  if (!data && !error && queryId !== targetId) {
    const res = await supabaseAdmin
      .from('folios')
      .select(STATE_FOLIO_COLUMNS)
      .eq('id', targetId)
      .maybeSingle();
    if (!res.error && res.data) data = res.data;
    error = res.error;
  }

  if (error || !data) return null;
  return data as unknown as StateFolioRow;
}

// ── Identity + gates ───────────────────────────────────────────────────────

/** The verified session behind one request. Everything here is server-derived. */
interface Viewer {
  id: string;
  email: string | null;
  /** Display name for `updated_label`: profile full name, else email. */
  name: string | null;
}

/**
 * Resolve the session from the request cookies — the same read-only SSR client
 * `/public` uses. Anonymous requests settle locally (no session → no auth
 * round trip), and ANY failure (no env, no cookies, a stale token) is
 * anonymous: a route that fails open on an identity read is an access hole.
 */
async function resolveViewer(): Promise<Viewer | null> {
  try {
    const clientSupabase = await sessionSupabaseClient();
    const { data } = await clientSupabase.auth.getUser();
    const user = data.user;
    if (!user) return null;
    const meta = (user.user_metadata || {}) as Record<string, unknown>;
    const fullName = typeof meta.full_name === 'string' ? meta.full_name.trim() : '';
    return {
      id: user.id,
      email: user.email ?? null,
      name: fullName || user.email || null,
    };
  } catch {
    return null; // anonymous
  }
}

type ReadGate =
  | { ok: true; viewer: Viewer | null; role: FolioRole }
  | { ok: false; response: NextResponse };

/**
 * The read gate stack, mirroring `/public` (and the raw route) gate for gate:
 * archived / takedown → 404 · draft → 404 without standing ≥ view · private →
 * key or collaborator standing · paid → member / buyer grant / collaborator.
 *
 * The access key arrives differently per verb — query for GET, body for PUT,
 * exactly as the comments route does — so it is passed in already extracted.
 */
async function authorizeRead(row: StateFolioRow, accessKeyParam: string): Promise<ReadGate> {
  // Content takedown and archive behave identically on every public surface:
  // the caller sees "not found", never a leak of the folio's existence.
  if (row.archived_at) return { ok: false, response: stateErr('Project not found', 404) };
  if (row.moderation_status === 'hidden') {
    return { ok: false, response: stateErr('Project not found', 404) };
  }

  const viewer = await resolveViewer();
  // One resolution for the whole request, so one verb cannot judge the caller
  // differently from the next. `resolveFolioRole(null, ...)` is 'anonymous',
  // which satisfies no capability — never the benefit of the doubt.
  const role = await resolveFolioRole(viewer?.id ?? null, roleTargetOf(row));

  const serverKey = (row.access_key || '').trim();
  // A validated private-key holder IS the access the owner chose to share:
  // they bypass the paywall (same precedence as /public) — but they are not
  // handed a standing, so nothing below this route treats them as a member.
  const keyAccess =
    !!row.is_private && serverKey !== '' && accessKeyParam !== '' &&
    safeEqual(accessKeyParam, serverKey);

  // A draft must not confirm its own existence to a passer-by. `view` is the
  // capability that covers "any publish state"; an org member (owner), a
  // collaborator (≥ viewer) and a key holder all hold it.
  if (row.status === 'draft' && !can(role, 'view') && !keyAccess) {
    return { ok: false, response: stateErr('Project not found', 404) };
  }

  // Private: the key, or a standing whose grant is the owner's act of sharing
  // (`bypass_access_key`). Asking a collaborator for a secret the owner never
  // sent them is what this bypass exists to prevent.
  if (row.is_private && !keyAccess && !can(role, 'bypass_access_key')) {
    return { ok: false, response: stateErr('Access Denied: Invalid access key.', 403) };
  }

  // Paid gate. Members and collaborators come free with the standing
  // (`bypass_paywall`); a buyer needs a live grant for the folio — or, when the
  // folio INHERITS the workspace gate (no own config), for the workspace.
  if (FEATURES.paidGating && !keyAccess) {
    const gate = await resolveGateConfig({
      paid_access: row.paid_access ?? null,
      project_id: row.project_id,
      organization_id: row.organization_id,
    });

    if (gate) {
      let allowed = can(role, 'bypass_paywall');
      if (!allowed && viewer) {
        allowed =
          (await hasActiveGrant(viewer.id, 'folio', row.id)) ||
          (row.paid_access == null && row.project_id
            ? await hasActiveGrant(viewer.id, 'workspace', row.project_id)
            : false);
      }
      if (!allowed) {
        return {
          ok: false,
          response: stateErr('Access Denied: This folio requires a purchase.', 403),
        };
      }
    }
  }

  return { ok: true, viewer, role };
}

/**
 * The `state_write` gate (PUT only). Absent means 'off' — the column has a
 * NOT NULL default, but rows read by paths that predate it (and the whole OSS
 * record shape) are simply undefined, and undefined must never be a yes.
 *
 * 'off' answers 403, not 404: every caller reaching this point has passed the
 * visibility gates, so the folio's existence is already known to them.
 */
function checkWriteMode(row: { state_write?: string | null }, viewer: Viewer | null): NextResponse | null {
  const mode: StateWriteMode = isStateWriteMode(row.state_write) ? row.state_write : 'off';
  if (mode === 'off') {
    return stateErr('Data editing is disabled for this folio.', 403);
  }
  if (mode === 'signed_in' && !viewer) {
    return stateErr("Sign in required to edit this folio's data.", 401);
  }
  return null;
}

// ── OSS arm (flat file) ────────────────────────────────────────────────────

/**
 * Resolve a folio from the flat-file DB, hyphen-suffix tolerant (the OSS share
 * URL may carry a readable slug). Returns the canonical id with the record so
 * the write transaction addresses the right row.
 */
async function findFlatFileFolio(targetId: string): Promise<{ id: string; project: HTMLFile } | null> {
  const db = await readDB();
  const direct = db.find((p) => p.id === targetId);
  if (direct) return { id: direct.id, project: direct };
  const resolved = resolveByHyphenSuffix(targetId, (candidate) => db.find((p) => p.id === candidate));
  return resolved ? { id: resolved.id, project: resolved.value } : null;
}

/**
 * The OSS half of the gate stack. There is no standing in a self-hosted
 * install (`resolveFolioRole` answers 'owner' for every caller there), so the
 * gates are the record's own: archived → 404, draft → 404 for anyone but the
 * local editor preview (mirroring the raw route's OSS draft gate, which is
 * what keeps `localhost` preview working), private → key or 403.
 */
function ossReadGate(
  project: HTMLFile,
  host: string | null,
  accessKeyParam: string
): NextResponse | null {
  if (project.archivedAt) return stateErr('Project not found', 404);

  if (project.status === 'draft' && !isLocalHost(host)) {
    // Unpublished: the same 404 a missing folio gets, so it cannot confirm
    // its own existence to a remote passer-by.
    return stateErr('Project not found', 404);
  }

  if (project.isPrivate) {
    const serverKey = (project.accessKey || '').trim();
    if (!serverKey || !accessKeyParam || !safeEqual(accessKeyParam, serverKey)) {
      return stateErr('Access Denied: Invalid access key.', 403);
    }
  }

  return null;
}

/** The read shape, from a flat-file record (absent fields ⇒ empty / rev 0). */
function flatFileState(project: HTMLFile): { state: Record<string, string>; rev: number } {
  const state = validateStateMap(project.state) ?? {};
  const rev =
    typeof project.stateRev === 'number' && Number.isFinite(project.stateRev) && project.stateRev > 0
      ? Math.trunc(project.stateRev)
      : 0;
  return { state, rev };
}

// ── GET ────────────────────────────────────────────────────────────────────

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    let targetId = id;
    const { searchParams } = new URL(request.url);
    const accessKeyParam = (searchParams.get('access_key') || '').trim();

    if (isOSS) {
      const found = await findFlatFileFolio(targetId);
      if (!found) return stateErr('Project not found', 404);
      targetId = found.id;

      const refused = ossReadGate(found.project, request.headers.get('host'), accessKeyParam);
      if (refused) return refused;

      const { state, rev } = flatFileState(found.project);
      // `updatedAt` is a Cloud-only fact: the flat-file record mirrors
      // `state`/`stateRev` only, and inventing a timestamp from the folio's
      // own `updatedAt` (which moves for reasons that have nothing to do with
      // state) would be worse than null.
      return NextResponse.json({ state, rev, updatedAt: null }, { headers: NO_STORE });
    }

    const row = await loadFolioRow(targetId);
    if (!row) return stateErr('Project not found', 404);

    const gate = await authorizeRead(row, accessKeyParam);
    if (!gate.ok) return gate.response;

    const record = await getFolioState(row.id);
    return NextResponse.json(
      record
        ? { state: record.state, rev: record.rev, updatedAt: record.updatedAt }
        : { state: {}, rev: 0, updatedAt: null },
      { headers: NO_STORE }
    );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: caught may be any thrown value; only logged
  } catch (caught: any) {
    console.error('GET /api/files/[id]/state error:', caught);
    const mapped = stateErrorResponse(caught);
    if (mapped) return mapped;
    return stateErr('Internal server error', 500);
  }
}

// ── PUT ────────────────────────────────────────────────────────────────────

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    let targetId = id;

    // A malformed body is a client error, not a 500: read it explicitly so the
    // catch-all below never has to guess. `state` is validated as a
    // {key: string} map — the same guard the store applies, so the route and
    // the lib cannot disagree about what a valid payload is.
    let body: { state?: unknown; accessKey?: unknown } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return stateErr('Invalid JSON body.', 400);
    }

    const state = validateStateMap(body?.state);
    if (!state) {
      return stateErr('state must be an object whose values are all strings.', 400);
    }

    const accessKeyParam = (typeof body?.accessKey === 'string' ? body.accessKey : '').trim();

    // ── OSS: flat file ─────────────────────────────────────────────────────
    if (isOSS) {
      const found = await findFlatFileFolio(targetId);
      if (!found) return stateErr('Project not found', 404);
      targetId = found.id;

      const refused = ossReadGate(found.project, request.headers.get('host'), accessKeyParam);
      if (refused) return refused;

      const modeRefusal = checkWriteMode(
        { state_write: found.project.stateWrite ?? null },
        null // no sessions in OSS: 'signed_in' is unsatisfiable, and answers 401
      );
      if (modeRefusal) return modeRefusal;

      const limited = enforceRateLimit(request, found.id);
      if (limited) return limited;

      const tooLarge = enforceSizeCap(state);
      if (tooLarge) return tooLarge;

      const { rev } = flatFileState(found.project);
      const nextRev = await runTransaction(async (db) => {
        const index = db.findIndex((p) => p.id === found.id);
        if (index === -1) throw new Error('Project not found');
        const project = db[index];
        const current =
          typeof project.stateRev === 'number' && Number.isFinite(project.stateRev) && project.stateRev > 0
            ? Math.trunc(project.stateRev)
            : 0;
        project.state = { ...state };
        project.stateRev = current + 1;
        // `updatedAt` on the folio is deliberately NOT touched: the Cloud arm
        // writes `folio_state` only and never the folios row, and the two arms
        // must not drift.
        db[index] = project;
        return current + 1;
      });

      return NextResponse.json(
        { state, rev: Number.isFinite(nextRev) ? nextRev : rev + 1, updatedAt: null },
        { headers: NO_STORE }
      );
    }

    // ── Cloud: gate, then `lib/folio-state.ts` ─────────────────────────────
    const row = await loadFolioRow(targetId);
    if (!row) return stateErr('Project not found', 404);

    const gate = await authorizeRead(row, accessKeyParam);
    if (!gate.ok) return gate.response;

    const modeRefusal = checkWriteMode(row, gate.viewer);
    if (modeRefusal) return modeRefusal;

    const limited = enforceRateLimit(request, row.id);
    if (limited) return limited;

    const tooLarge = enforceSizeCap(state);
    if (tooLarge) return tooLarge;

    const { rev, updatedAt } = await setFolioState({
      folioId: row.id,
      state,
      // Attribution is server-derived: the session's own id, or null. The
      // session's display name, or 'Guest' — never the payload's.
      updatedBy: gate.viewer?.id ?? null,
      updatedLabel: gate.viewer?.name || 'Guest',
    });

    // The SAME shape GET returns, with the RPC's authoritative rev — the
    // ShareClient relays this rev in its SYNC, and a stale one destroys an
    // unacknowledged write in the shim (spike §C3).
    return NextResponse.json({ state, rev, updatedAt }, { headers: NO_STORE });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: caught may be any thrown value; only logged
  } catch (caught: any) {
    console.error('PUT /api/files/[id]/state error:', caught);
    const mapped = stateErrorResponse(caught);
    if (mapped) return mapped;
    return stateErr('Internal server error', 500);
  }
}

/**
 * 120 writes / 15 min per IP per folio — the comments route's limiter call,
 * with this route's budget. The key carries the folio so one busy folio
 * cannot exhaust a viewer's budget for every other folio, and the IP so one
 * viewer cannot exhaust a folio's budget for everyone (the shared fallback
 * bucket when the deployment cannot tell clients apart is the only
 * exception, and that is the limiter's own documented behaviour).
 */
function enforceRateLimit(request: Request, folioId: string): NextResponse | null {
  const clientIp = getClientIp(request);
  const limit = checkRateLimit(`state-put:ip:${clientIp}:${folioId}`, 120, 15 * 60_000, 60 * 60_000);
  if (!limit.allowed) {
    return stateErr('Too many edits. Please try again later.', 429);
  }
  return null;
}

/**
 * The fast half of the 256 KB rule. Cloud's authoritative measure is the RPC's
 * `octet_length(p_state::text)` (LF001 → STATE_TOO_LARGE → 413); OSS has no RPC,
 * so this IS its cap. `stateByteLength` is the UTF-8 length of the JSON text —
 * always ≤ Postgres's jsonb::text (which inserts a space after `:` and `,`),
 * so this can under-reject relative to the RPC but never over-reject a payload
 * the store would have accepted. The RPC therefore stays the authority.
 */
function enforceSizeCap(state: Record<string, string>): NextResponse | null {
  if (stateByteLength(state) > STATE_SEED_MAX_BYTES) {
    return stateErr('State exceeds the 256 KB limit.', 413);
  }
  return null;
}
