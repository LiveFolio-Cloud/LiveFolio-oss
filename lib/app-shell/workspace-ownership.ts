/**
 * Sidebar ownership — "mine" vs "shared with me", for both workspaces and
 * folios.
 *
 * `GET /api/projects` returns EVERY workspace in the caller's organization; it
 * filters on `organization_id` only. So a team member's sidebar has always been
 * a mix of their own workspaces and their colleagues'. Splitting them is what
 * makes a shared org read as a team rather than as "your folders, plus some you
 * didn't make".
 *
 * Why a `created_by` comparison and not a membership table: there is no
 * per-workspace membership in the schema — membership is org-level
 * (`organization_members`). Everyone in the org can already open every
 * workspace, so workspace ownership here is a *presentation* question, not a
 * permission one.
 *
 * Folio grants ARE the permission-bearing case this module's old docblock said
 * "would land here": `GET /api/files` now unions the org's folios with folios
 * granted to the caller, tagging granted rows with `accessRole`
 * (`viewer` | `commenter` | `editor`). `splitFoliosByGrant` files them under
 * the caller's own tree or a "Shared folios" group, so a grantee finds the
 * folio they were invited to without it vanishing into a workspace they cannot
 * see (a granted folio's `projectId` is the OWNER's workspace).
 *
 * Pure and React-free so it is unit-testable and usable from the server.
 */

export interface OwnableWorkspace {
  id: string;
  created_by?: string | null;
}

/** The role tag the list union stamps on granted rows of `GET /api/files`. */
export interface GrantedFolio {
  id: string;
  accessRole?: string | null;
}

export interface WorkspaceSplit<T> {
  mine: T[];
  shared: T[];
}

/**
 * One split core over a predicate — both splits below share it so the two
 * rules stay written once:
 *
 * - **Unknown counts as mine.** A row the predicate cannot classify (a
 *   workspace without `created_by`, a folio without a role tag, an OSS
 *   payload) stays in the caller's own list. Filing your own item under a
 *   stranger is a worse error than the reverse.
 *
 * - **No viewer id means no split.** Until the profile request lands, the
 *   caller cannot know what is theirs. Returning everything as `mine` with an
 *   empty `shared` keeps the tree exactly as it was for one request, rather
 *   than flashing items into the wrong groups and back.
 */
function splitBy<T>(items: T[], viewerId: string | null | undefined, isShared: (item: T) => boolean): WorkspaceSplit<T> {
  if (!viewerId) {
    return { mine: items, shared: [] };
  }
  const mine: T[] = [];
  const shared: T[] = [];
  for (const item of items) {
    if (isShared(item)) shared.push(item);
    else mine.push(item);
  }
  return { mine, shared };
}

/**
 * Split workspaces by ownership (`created_by` vs the viewer).
 *
 * Behaviour is unchanged from the original implementation — same rules, same
 * ordering, same empty-list and solo-account answers. The existing call site
 * at `WorkspaceSidebar.tsx` and its tests are the contract.
 */
export function splitWorkspacesByOwnership<T extends OwnableWorkspace>(
  workspaces: T[],
  viewerId: string | null | undefined,
): WorkspaceSplit<T> {
  return splitBy(workspaces, viewerId, (workspace) =>
    !!workspace.created_by && workspace.created_by !== viewerId
  );
}

/**
 * Split folios by the caller's standing on them.
 *
 * `GET /api/files` tags every granted row with `accessRole` — the
 * grant role the caller holds (`viewer` | `commenter` | `editor`). Org folios
 * carry `'owner'`, and OSS or older payloads carry nothing at all.
 *
 * The rules above map verbatim:
 *
 * - A folio whose `accessRole` is a grant role goes to `shared`; anything else
 *   — `'owner'`, a missing tag, an unexpected value — counts as mine.
 * - No viewer id (OSS, or the profile request still in flight) means no split.
 */
export function splitFoliosByGrant<T extends GrantedFolio>(
  folios: T[],
  viewerId: string | null | undefined,
): WorkspaceSplit<T> {
  return splitBy(folios, viewerId, (folio) =>
    folio.accessRole === 'viewer' || folio.accessRole === 'commenter' || folio.accessRole === 'editor'
  );
}
