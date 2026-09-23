/**
 * Workspace ownership — "mine" vs "shared with me".
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
 * workspace, so ownership here is a *presentation* question, not a permission
 * one. If per-workspace visibility ever becomes a real requirement, it needs a
 * real members table, and this module is where that would land.
 *
 * Pure and React-free so it is unit-testable and usable from the server.
 */

export interface OwnableWorkspace {
  id: string;
  created_by?: string | null;
}

export interface WorkspaceSplit<T extends OwnableWorkspace> {
  mine: T[];
  shared: T[];
}

/**
 * Split workspaces by ownership.
 *
 * Two rules, both deliberate:
 *
 * - **Unknown owner counts as mine.** Rows written before `created_by` was
 *   populated, or by a path that does not set it, would otherwise be filed
 *   under a colleague's name. Losing your own workspace into "shared with me"
 *   is a worse error than the reverse.
 *
 * - **No viewer id means no split.** Until the profile request lands, the
 *   caller cannot know which workspaces are theirs. Returning everything as
 *   `mine` with an empty `shared` keeps the tree exactly as it was for one
 *   request, rather than flashing the list into the wrong groups and back.
 */
export function splitWorkspacesByOwnership<T extends OwnableWorkspace>(
  workspaces: T[],
  viewerId: string | null | undefined,
): WorkspaceSplit<T> {
  if (!viewerId) {
    return { mine: workspaces, shared: [] };
  }
  const mine: T[] = [];
  const shared: T[] = [];
  for (const workspace of workspaces) {
    if (!workspace.created_by || workspace.created_by === viewerId) mine.push(workspace);
    else shared.push(workspace);
  }
  return { mine, shared };
}
