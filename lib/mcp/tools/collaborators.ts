/**
 * Self-hosted stand-in for the hosted collaborator tools.
 *
 * The hosted module is the agent surface for folio grants — list, add, re-role
 * and remove a collaborator. There is nobody to invite on a single-operator
 * install and no grant table to read, so none of it applies here.
 *
 * Declared names are exactly what the shipped tree imports: the four handlers,
 * the advertisement and instruction arrays (`app/api/mcp/route.ts`), and the
 * grant-aware resolver the other MCP tools route through (`tools/folios.ts`).
 * Every call site of the latter two sits inside a `!isOSS` branch, so the
 * throwing stubs below are unreachable — and they throw the same error the
 * hosted handlers raised from their own guards.
 */

import type { HTMLFile } from '@/lib/db';

/** Local aliases: the hosted vocabulary is not published. */
type FolioRole = 'anonymous' | 'none' | 'viewer' | 'commenter' | 'editor' | 'owner';
type FolioCapability = string;

const CLOUD_FEATURE = 'Folio collaborators are a cloud feature and are not available in OSS mode.';

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- mirrors the hosted signature; arguments are unvalidated JSON-RPC params
export async function handleListFolioCollaborators(args: any): Promise<never> {
  throw new Error(CLOUD_FEATURE);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- mirrors the hosted signature; arguments are unvalidated JSON-RPC params
export async function handleAddFolioCollaborator(args: any): Promise<never> {
  throw new Error(CLOUD_FEATURE);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- mirrors the hosted signature; arguments are unvalidated JSON-RPC params
export async function handleRemoveFolioCollaborator(args: any): Promise<never> {
  throw new Error(CLOUD_FEATURE);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- mirrors the hosted signature; arguments are unvalidated JSON-RPC params
export async function handleUpdateCollaboratorRole(args: any): Promise<never> {
  throw new Error(CLOUD_FEATURE);
}

/** No workspace roles exist on a single-operator install. */
export async function requireWorkspaceOwner(_orgId: string): Promise<never> {
  throw new Error(CLOUD_FEATURE);
}

/** A folio plus the caller's resolved standing on it. */
export interface CallerFolioAccess {
  folio: HTMLFile;
  role: FolioRole;
}

/** Cloud-only: resolves through workspace membership or a folio grant. */
export async function resolveFolioForCaller(
  _projectId: string,
  _orgId: string,
  _minimum: FolioCapability
): Promise<CallerFolioAccess> {
  throw new Error(CLOUD_FEATURE);
}

/** Nothing is ever stripped: the operator owns every field of every folio. */
export function unwritableArguments(_role: FolioRole, _args: unknown): string[] {
  return [];
}

export interface CollaboratorToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Nothing to advertise. */
export const COLLABORATOR_TOOLS: CollaboratorToolDescriptor[] = [];

/** Nothing to dispatch: the table is empty, so no tool name reaches the route. */
export const COLLABORATOR_TOOL_HANDLERS: ReadonlyArray<
  readonly [string, (args: unknown) => Promise<unknown>]
> = [];

/** No capability lines to add to the `initialize` map. */
export const COLLABORATOR_INSTRUCTION_LINES: string[] = [];
