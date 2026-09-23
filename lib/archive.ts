/**
 * Folio & workspace archiving — the single place the archive invariant lives.
 *
 * ARCHIVE = `archived_at = now()` + `status = 'draft'` + `listed = false`,
 * applied together. Every public surface in the product already gates on
 * `status === 'draft'` (the share page, the raw content route, profile and
 * workspace listings, Explore), so an archived folio is hidden everywhere
 * public without adding a single new filter to those readers. `archived_at`
 * is what the owner-side UI groups by.
 *
 * UNARCHIVE clears `archived_at` and nothing else. Status stays 'draft' and
 * the listing stays false — nothing ever silently republishes. The owner
 * re-publishes deliberately from the share menu.
 *
 * Archiving a workspace applies the same invariant to every child folio, and
 * gates the public workspace page on the workspace's own `archived_at`
 * (workspaces have no status column).
 *
 * Archived folios are NOT deleted and still count toward storage quota.
 *
 * This lives in lib/ rather than in each route because the invariant is
 * shared by the REST archive routes and the MCP archive tools — inlining it
 * would let those drift, and a drifted archive means content that was
 * supposed to be hidden stays public.
 */
import { readDB, runTransaction } from './db';
import { isOSS } from './env';
import { supabaseAdmin } from './supabase';
import { projectMemoryCache } from './project-cache';

/** Result of an archive/unarchive call. `null` = not found, or not in your org. */
export interface ArchiveState {
  id: string;
  archived: boolean;
  archivedAt: string | null;
  /** Always 'draft' after archive or unarchive — nothing auto-republishes. */
  status: 'draft';
  /** Workspace calls only: how many child folios were swept in. */
  affectedFolios?: number;
}

/** The columns the child sweep writes, so folio and workspace agree. */
const ARCHIVED_COLUMNS = (now: string) => ({
  archived_at: now,
  status: 'draft',
  listed: false,
  updated_at: now,
});

/**
 * PostgREST caps an unpaged select at 1000 rows. Below that we can invalidate
 * precisely; at or above it we cannot enumerate every child, so we drop the
 * whole cache rather than leave stale entries for the ones we never saw.
 */
const CACHE_ENUMERATION_CAP = 1000;

function invalidateChildren(childIds: string[]): void {
  if (childIds.length >= CACHE_ENUMERATION_CAP) {
    projectMemoryCache.clear();
    return;
  }
  for (const id of childIds) projectMemoryCache.invalidate(id);
}

/**
 * Archive one folio. Dual-mode.
 *
 * Idempotent by design: agents retry, and a second archive must not re-stamp
 * the timestamp or fail.
 */
export async function archiveFolio(id: string, orgId?: string): Promise<ArchiveState | null> {
  const now = new Date().toISOString();

  if (isOSS) {
    // Flat-file: the lock inside runTransaction is the concurrency control,
    // and a throw inside the callback skips the write entirely.
    return runTransaction((db) => {
      const folio = db.find((p) => p.id === id);
      if (!folio) return null;
      if (folio.archivedAt) {
        // Already archived — leave the original timestamp alone.
        return { id, archived: true, archivedAt: folio.archivedAt, status: 'draft' as const };
      }
      folio.archivedAt = now;
      folio.status = 'draft';
      // A null listing already means "not listed", so only rewrite a real one.
      if (folio.listing) folio.listing = { ...folio.listing, listed: false };
      folio.updatedAt = now;
      return { id, archived: true, archivedAt: now, status: 'draft' as const };
    });
  }

  if (!supabaseAdmin) throw new Error('Supabase client is not initialized in Cloud mode.');
  if (!orgId) throw new Error('Unauthorized: No organization context');

  const { data: row, error: readErr } = await supabaseAdmin
    .from('folios')
    .select('id, archived_at')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!row) return null;

  if (row.archived_at) {
    return { id, archived: true, archivedAt: row.archived_at as string, status: 'draft' };
  }

  // Direct column write rather than runTransaction: the transaction path
  // round-trips through transformToFolioRecord, which deliberately omits
  // archived_at, so it would silently drop this field.
  const { error: writeErr } = await supabaseAdmin
    .from('folios')
    .update(ARCHIVED_COLUMNS(now))
    .eq('id', id)
    .eq('organization_id', orgId);
  if (writeErr) throw writeErr;

  projectMemoryCache.invalidate(id);
  return { id, archived: true, archivedAt: now, status: 'draft' };
}

/**
 * Unarchive one folio. Dual-mode. Clears the flag only — status stays 'draft'
 * so the folio returns as a draft the owner chooses to publish again.
 */
export async function unarchiveFolio(id: string, orgId?: string): Promise<ArchiveState | null> {
  const now = new Date().toISOString();

  if (isOSS) {
    return runTransaction((db) => {
      const folio = db.find((p) => p.id === id);
      if (!folio) return null;
      folio.archivedAt = null;
      folio.updatedAt = now;
      // status/listing deliberately untouched.
      return { id, archived: false, archivedAt: null, status: 'draft' as const };
    });
  }

  if (!supabaseAdmin) throw new Error('Supabase client is not initialized in Cloud mode.');
  if (!orgId) throw new Error('Unauthorized: No organization context');

  const { data: row, error: readErr } = await supabaseAdmin
    .from('folios')
    .select('id')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!row) return null;

  const { error: writeErr } = await supabaseAdmin
    .from('folios')
    .update({ archived_at: null, updated_at: now })
    .eq('id', id)
    .eq('organization_id', orgId);
  if (writeErr) throw writeErr;

  projectMemoryCache.invalidate(id);
  return { id, archived: false, archivedAt: null, status: 'draft' };
}

/**
 * Archive a workspace and sweep every folio inside it. Cloud-only — the OSS
 * tree has no workspaces, and its routes 501 before reaching here.
 *
 * Children are swept with two filtered statements rather than by reading rows
 * and writing them back, so this is safe at any workspace size: the first
 * stamps `archived_at` only where it is unset (an earlier individual archive
 * keeps its own timestamp), the second forces status/listing for everyone so
 * nothing stays published inside an archived workspace.
 */
export async function archiveWorkspace(id: string, orgId: string): Promise<ArchiveState | null> {
  if (isOSS) throw new Error('Workspaces are a Cloud feature.');
  if (!supabaseAdmin) throw new Error('Supabase client is not initialized in Cloud mode.');

  const now = new Date().toISOString();

  const { data: ws, error: wsErr } = await supabaseAdmin
    .from('projects')
    .select('id, archived_at')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (wsErr) throw wsErr;
  if (!ws) return null;

  // Read child ids first — this is what the cache needs, and it must happen
  // before the sweep so we know what to invalidate.
  const { data: children, error: childErr } = await supabaseAdmin
    .from('folios')
    .select('id')
    .eq('project_id', id)
    .eq('organization_id', orgId);
  if (childErr) throw childErr;
  const childIds: string[] = (children ?? []).map((c: { id: string }) => c.id);

  const alreadyArchived = !!ws.archived_at;
  if (!alreadyArchived) {
    const { error } = await supabaseAdmin
      .from('projects')
      .update({ archived_at: now, updated_at: now })
      .eq('id', id)
      .eq('organization_id', orgId);
    if (error) throw error;
  }

  // 1. Stamp newly-archived children.
  const { error: stampErr } = await supabaseAdmin
    .from('folios')
    .update({ archived_at: now, updated_at: now })
    .eq('project_id', id)
    .eq('organization_id', orgId)
    .is('archived_at', null);
  if (stampErr) throw stampErr;

  // 2. Force the public-facing invariant on ALL children, including ones that
  //    were already individually archived.
  const { error: forceErr } = await supabaseAdmin
    .from('folios')
    .update({ status: 'draft', listed: false, updated_at: now })
    .eq('project_id', id)
    .eq('organization_id', orgId);
  if (forceErr) throw forceErr;

  invalidateChildren(childIds);

  return {
    id,
    archived: true,
    archivedAt: alreadyArchived ? (ws.archived_at as string) : now,
    status: 'draft',
    affectedFolios: childIds.length,
  };
}

/**
 * Unarchive a workspace and clear the flag on every child.
 *
 * NOTE: this clears `archived_at` on ALL children, including folios the owner
 * had archived individually before the workspace was archived. Those reappear
 * as drafts alongside the rest. That is deliberate — the alternative needs
 * provenance columns to tell the two apart, and the outcome is benign: an
 * unarchived folio is still a draft, still unlisted, still invisible publicly
 * until the owner publishes it.
 */
export async function unarchiveWorkspace(id: string, orgId: string): Promise<ArchiveState | null> {
  if (isOSS) throw new Error('Workspaces are a Cloud feature.');
  if (!supabaseAdmin) throw new Error('Supabase client is not initialized in Cloud mode.');

  const now = new Date().toISOString();

  const { data: ws, error: wsErr } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (wsErr) throw wsErr;
  if (!ws) return null;

  const { data: children, error: childErr } = await supabaseAdmin
    .from('folios')
    .select('id')
    .eq('project_id', id)
    .eq('organization_id', orgId);
  if (childErr) throw childErr;
  const childIds: string[] = (children ?? []).map((c: { id: string }) => c.id);

  const { error: wsUpdateErr } = await supabaseAdmin
    .from('projects')
    .update({ archived_at: null, updated_at: now })
    .eq('id', id)
    .eq('organization_id', orgId);
  if (wsUpdateErr) throw wsUpdateErr;

  const { error: childUpdateErr } = await supabaseAdmin
    .from('folios')
    .update({ archived_at: null, updated_at: now })
    .eq('project_id', id)
    .eq('organization_id', orgId);
  if (childUpdateErr) throw childUpdateErr;

  invalidateChildren(childIds);

  return {
    id,
    archived: false,
    archivedAt: null,
    status: 'draft',
    affectedFolios: childIds.length,
  };
}

/**
 * True when a folio is archived, from either shape. Readers that hold a
 * transformed HTMLFile use this rather than poking at the field directly, so
 * the "is it hidden" question has one answer.
 */
export function isArchived(folio: { archivedAt?: string | null; archived_at?: string | null } | null | undefined): boolean {
  if (!folio) return false;
  return !!(folio.archivedAt ?? folio.archived_at);
}

/**
 * Read-only archive probe for write paths that must refuse to republish an
 * archived folio. Never throws for a missing folio — callers are guarding an
 * update whose own lookup will 404 separately.
 */
export async function folioIsArchived(id: string, orgId?: string): Promise<boolean> {
  if (isOSS) {
    const db = await readDB();
    return isArchived(db.find((p) => p.id === id));
  }
  if (!supabaseAdmin) return false;
  const base = supabaseAdmin.from('folios').select('archived_at').eq('id', id);
  const { data } = await (orgId ? base.eq('organization_id', orgId) : base).maybeSingle();
  return !!data?.archived_at;
}
