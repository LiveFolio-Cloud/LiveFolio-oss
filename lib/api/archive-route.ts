import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth';
import { isOSS } from '@/lib/env';
import { extractUUIDFromSlug } from '@/lib/utils';
import { supabaseAdmin } from '@/lib/supabase';
import {
  archiveFolio,
  unarchiveFolio,
  archiveWorkspace,
  unarchiveWorkspace,
  type ArchiveState,
} from '@/lib/archive';
import { err } from '@/lib/api/respond';

/**
 * Shared handler for the four archive/unarchive route pairs.
 *
 * `archive` and `unarchive` are the same endpoint with a flag flipped: the
 * request shape, the OSS/Cloud auth guard, the 404, the error envelope and the
 * log line are all identical, and only the copy and the `lib/archive` call
 * differ. Written twice per family (four files), those guards drift — and a
 * drifted archive guard is content that was supposed to be hidden staying
 * public, which is exactly the failure `lib/archive.ts` exists to prevent.
 *
 * Every string, status code and key order here is load-bearing: the route files
 * are public endpoints, so this module reproduces their previous bodies exactly
 * rather than tidying the copy. See the two convenience factories below for the
 * per-family differences (OSS behaviour, id normalisation, response shape).
 *
 * Segment config (`dynamic`, `revalidate`) is NOT here — Next.js reads it from
 * the route file itself, so each route still declares its own.
 */

/** Which half of the pair a route file is. */
export type ArchiveDirection = 'archive' | 'unarchive';

/** A Next.js route handler taking `{ id }` from the dynamic segment. */
type ArchiveRouteHandler = (
  request: Request,
  context: { params: Promise<{ id: string }> }
) => Promise<Response>;

interface ArchiveRouteSpec {
  /** Route files are public endpoints — the 404 copy differs per resource. */
  notFound: string;
  /** 401 copy when an authenticated caller has no org. */
  unauthorized: string;
  /** `console.error` prefix on a thrown toggle. */
  logPrefix: string;
  /** Fallback for a thrown toggle that carries no `message`. */
  failure: string;
  /**
   * In OSS mode: `'flat-file'` runs the toggle against the flat-file DB
   * (folios), `'reject'` answers 501 (workspaces do not exist in OSS).
   */
  oss: 'flat-file' | 'reject';
  /**
   * Unwrap a trailing UUID from a `slug-uuid` share id before lookup. Cloud
   * folio ids arrive as slugs; workspace ids are bare UUIDs.
   */
  slugAwareId: boolean;
  /**
   * Cloud pre-flight: workspaces are Supabase-only, so a missing admin client
   * is a 500 rather than a silent no-op.
   */
  requireAdminClient: boolean;
  /**
   * The `lib/archive` primitive for this direction. `orgId` is undefined only
   * in OSS flat-file mode, where `archiveFolio` ignores the scope anyway.
   */
  toggle: (id: string, orgId: string | undefined) => Promise<ArchiveState | null>;
  /** Body keys after `success` — order is preserved into the JSON response. */
  success: (state: ArchiveState) => Record<string, unknown>;
}

/**
 * The workspace toggles are Supabase-only, so they take a definite org where
 * the folio ones tolerate an absent one. `oss: 'reject'` plus the 401 above
 * already guarantee it — this is the typed bridge, and it throws (→ the route's
 * own 500) rather than silently scoping a sweep to the wrong org if that ever
 * stops being true.
 */
function requireOrg(orgId: string | undefined): string {
  if (!orgId) throw new Error('Archive route reached its toggle with no org.');
  return orgId;
}

/** The Supabase-admin guard body — verbatim, including the key order. */
function adminClientMissing(): NextResponse {
  return NextResponse.json({
    error: 'Supabase client is not initialized.',
    message: 'Please make sure that NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in your local .env file when running in cloud/SaaS mode.'
  }, { status: 500 });
}

function createArchiveRoute(spec: ArchiveRouteSpec): ArchiveRouteHandler {
  return async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
    try {
      const { id } = await context.params;

      let orgId: string | undefined;
      if (isOSS) {
        if (spec.oss === 'reject') {
          return err('Not implemented in OSS mode.', { status: 501 });
        }
      } else {
        const auth = await getAuthContext();
        if (!auth.orgId) {
          return err(spec.unauthorized, { status: 401 });
        }
        orgId = auth.orgId;
      }

      if (spec.requireAdminClient && !supabaseAdmin) {
        return adminClientMissing();
      }

      const state = await spec.toggle(
        spec.slugAwareId && !isOSS ? extractUUIDFromSlug(id) : id,
        orgId
      );
      if (!state) {
        return err(spec.notFound, { status: 404 });
      }

      return NextResponse.json({ success: true, ...spec.success(state) });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- thrown error shape is dynamic (caught.message read below)
    } catch (caught: any) {
      console.error(spec.logPrefix, caught?.message || caught);
      return NextResponse.json({ error: caught?.message || spec.failure }, { status: 500 });
    }
  };
}

/**
 * Copy for `app/api/files/[id]/{archive,unarchive}`. Kept as literals rather
 * than built from `direction` so the strings are greppable and cannot drift.
 */
const FOLIO_COPY = {
  archive: {
    unauthorized: 'Sign in to archive a folio.',
    logPrefix: 'Archive failed:',
    failure: 'Failed to archive folio.',
    note: 'Archived — unpublished and unlisted. Restore it as a draft with unarchive.',
  },
  unarchive: {
    unauthorized: 'Sign in to unarchive a folio.',
    logPrefix: 'Unarchive failed:',
    failure: 'Failed to unarchive folio.',
    note: 'Restored as a draft. Publish it again when you are ready.',
  },
} as const;

const WORKSPACE_COPY = {
  archive: {
    logPrefix: 'Workspace archive failed:',
    failure: 'Failed to archive workspace.',
    note: 'Workspace archived — its folios are unpublished and hidden, and still count toward storage. Restore returns them as drafts.',
  },
  unarchive: {
    logPrefix: 'Workspace unarchive failed:',
    failure: 'Failed to unarchive workspace.',
    note: 'Workspace and its folios restored as drafts. Publish them again when you are ready.',
  },
} as const;

/**
 * `POST /api/files/[id]/{archive,unarchive}` — hide or restore one folio.
 *
 * OSS has no auth and no Supabase, so the guard falls through to the
 * flat-file `lib/archive` implementation.
 */
export function createFolioArchiveRoute(direction: ArchiveDirection): ArchiveRouteHandler {
  const archived = direction === 'archive';
  const copy = FOLIO_COPY[direction];
  return createArchiveRoute({
    notFound: 'Folio not found.',
    unauthorized: copy.unauthorized,
    logPrefix: copy.logPrefix,
    failure: copy.failure,
    oss: 'flat-file',
    slugAwareId: true,
    requireAdminClient: false,
    toggle: archived ? archiveFolio : unarchiveFolio,
    // `status` is always 'draft' after either direction — nothing republishes
    // on its own — so it is read from the state, while `archivedAt` is pinned
    // to the direction: unarchive clears it, whatever the row still holds.
    success: (state) => ({
      project: {
        id: state.id,
        status: state.status,
        archived,
        archivedAt: archived ? state.archivedAt : null,
      },
      note: copy.note,
    }),
  });
}

/**
 * `POST /api/projects/[id]/{archive,unarchive}` — sweep a whole workspace.
 *
 * Cloud-only (OSS has no workspaces), and Supabase-only, so both halves of the
 * guard are real: 501 in OSS, 500 when the admin client is absent.
 */
export function createWorkspaceArchiveRoute(direction: ArchiveDirection): ArchiveRouteHandler {
  const archived = direction === 'archive';
  const copy = WORKSPACE_COPY[direction];
  return createArchiveRoute({
    notFound: 'Workspace not found.',
    unauthorized: 'Unauthorized',
    logPrefix: copy.logPrefix,
    failure: copy.failure,
    oss: 'reject',
    slugAwareId: false,
    requireAdminClient: true,
    toggle: (id, orgId) => (archived ? archiveWorkspace : unarchiveWorkspace)(id, requireOrg(orgId)),
    // The affected-folio count is surfaced under a direction-specific key, so
    // the caller can tell a sweep from a restore without inspecting `archived`.
    success: (state) => ({
      project: {
        id: state.id,
        archived,
        archivedAt: archived ? state.archivedAt : null,
      },
      [archived ? 'archived_folios' : 'restored_folios']: state.affectedFolios,
      note: copy.note,
    }),
  });
}
