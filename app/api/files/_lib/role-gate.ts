import type { NextResponse } from 'next/server';
import { err } from '@/lib/api/respond';

/**
 * The folio gate on a self-hosted install.
 *
 * Every shipped route that asks "who is this caller, and may they do this?"
 * imports this module. On a hosted install the answer comes from the grant
 * engine (workspace membership, per-folio grants, seats, invites); here there
 * is one operator and no accounts, so the answer is always the same: they own
 * every folio on the disk.
 *
 * The hosted engine is not published. This file is the whole of the access
 * vocabulary in the self-hosted tree — the routes keep their gate structure,
 * the status-code contract and the refusal copy, and every question resolves
 * to "yes" without a query.
 *
 * Only the names the shipped tree imports are declared; the type-check fails
 * if that ever stops being enough.
 */

// ─── Vocabulary ──────────────────────────────────────────────────────────────

/** A caller's standing on a folio. Only `owner` is ever produced here. */
export type FolioRole = 'anonymous' | 'none' | 'viewer' | 'commenter' | 'editor' | 'owner';

/**
 * The access decisions the shipped routes ask about — the complete set, found
 * by grepping every `can` / `gateFolio` call in the published tree. The hosted
 * build distinguishes more; a question nobody asks is not declared.
 */
export type FolioCapability =
  | 'view'
  | 'bypass_access_key'
  | 'bypass_paywall'
  | 'comment'
  | 'react'
  | 'push_versions'
  | 'publish'
  | 'delete';

/** A shared-access role. No such row exists here; kept for the routes that name one. */
export type GrantRole = 'viewer' | 'commenter' | 'editor';

/** The minimum a folio must expose to be resolved. */
export interface FolioRoleTarget {
  id: string;
  organization_id: string | null;
}

// ─── Answers ─────────────────────────────────────────────────────────────────

/** One operator, no accounts: every caller owns every folio here. */
export async function resolveFolioRole(
  _userId?: string | null,
  _folio?: FolioRoleTarget | null
): Promise<FolioRole> {
  return 'owner';
}

/** The owner holds every capability. Any other standing is denied. */
export function can(role: FolioRole, _capability?: FolioCapability): boolean {
  return role === 'owner';
}

/** The owner may write any field a route asks about; the field list is the route's. */
export function canWriteField(role: FolioRole, _field?: string): boolean {
  return role === 'owner';
}

/** Nothing is shared with anyone here. */
export async function listGrantedFolios(
  _userId?: string
): Promise<{ folio_id: string; role: GrantRole }[]> {
  return [];
}

// ─── The gate contract ───────────────────────────────────────────────────────

/** The `[id]` routes' 404 body — unchanged copy. */
export const FOLIO_NOT_FOUND = 'Project not found.';

export interface GateCopy {
  /** 404 body. Defaults to this module's generic copy. */
  notFound?: string;
  /** 403 body. Defaults to this module's generic copy. */
  forbidden?: string;
}

/** A folio plus the caller's resolved standing on it. */
export interface FolioAccess {
  role: FolioRole;
  folio: FolioRoleTarget;
}

/** `ok` carries the access the caller was granted; `!ok` the finished refusal. */
export type FolioGate = { ok: true; access: FolioAccess } | { ok: false; response: NextResponse };

/** The 404 every refusal of an invisible folio uses. */
export function folioNotFound(copy?: GateCopy): NextResponse {
  return err(copy?.notFound || FOLIO_NOT_FOUND, { status: 404 });
}

/** The identity the resolver takes, read off a row the caller already holds. */
export function roleTargetOf(row: {
  id: string;
  organization_id?: string | null;
}): FolioRoleTarget {
  return { id: row.id, organization_id: row.organization_id ?? null };
}

/**
 * Resolve the caller's access to a folio and check one capability.
 *
 * A self-hosted install has no organization to scope the folio to and no
 * grants to consult, so this grants access without reading anything — the
 * routes' own lookup is what decides whether the folio exists.
 */
export async function gateFolio(
  _userId: string | null | undefined,
  id: string,
  _capability: FolioCapability,
  _copy?: GateCopy
): Promise<FolioGate> {
  return { ok: true, access: { role: 'owner', folio: { id, organization_id: null } } };
}

/** The body keys a role may not write, and the ones it asked to write. */
export interface FieldPartition {
  blocked: Set<string>;
  stripped: string[];
}

/**
 * Nothing is ever stripped: the operator owns every field of every folio.
 *
 * The hosted version ranks fields per role because one payload carries the
 * document, its publish state, its price and its listing together. There is no
 * rank below the top here, so the partition is empty and the route's own field
 * handling is unchanged.
 */
export function partitionWritableFields(
  _role: FolioRole,
  _body: Record<string, unknown>
): FieldPartition {
  return { blocked: new Set<string>(), stripped: [] };
}

/** Always proceeds: the operator may archive and restore their own folios. */
export async function gateFolioArchive(_context: {
  params: Promise<{ id: string }>;
}): Promise<NextResponse | null> {
  return null;
}
