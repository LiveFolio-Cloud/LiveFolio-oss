/**
 * MCP tool handlers — folio lifecycle: list / read / create / update / delete /
 * duplicate / archive / unarchive.
 *
 * Handlers only: transport, auth, dispatch and the TOOLS registry stay in
 * `app/api/mcp/route.ts`. Signatures are identical to the versions that lived
 * there — `(args, request?)`, with `list_projects` keeping its historical
 * `(request, args)` order and normalised by the route's dispatch table.
 */
import { readDB, runTransaction, HTMLFile, HTMLVersion } from '@/lib/db';
import { isOSS } from '@/lib/env';
import { supabaseAdmin, transformFolioRecord, transformToFolioRecord, FolioRecord } from '@/lib/supabase';
import { headers } from 'next/headers';
import { assertStorageQuota } from '@/ee/middleware/usageCapping';
import { FOLIO_DEFAULTS, VERSION_MESSAGES } from '@/lib/folio-defaults';
import { processUploadFiles } from '@/lib/process-upload';
import { sanitizePaidAccess } from '@/lib/gating/config';
import type { PaidAccessConfig } from '@/lib/gating/types';
import { sanitizeListing, listingWriteGuard, preserveAttestation } from '@/lib/listing/config';
import { ensureOwnerHandle } from '@/lib/handles-server';
import type { ListingMetadata } from '@/lib/listing/types';
import { deleteFolioAssets } from '@/lib/asset-store';
import { hasActiveGrant } from '@/lib/gating/grants';
import { archiveFolio, unarchiveFolio } from '@/lib/archive';
import { projectMemoryCache } from '@/lib/project-cache';
import { extractUUIDFromSlug } from '@/lib/utils';
import crypto from 'crypto';
import { slugifyFolioTitle } from '@/lib/folio-slug';
import { nextVersionId as nextFolioVersionId, applyVersionRetention } from '@/lib/version-retention';
import { globalWithTunnel, requireSupabaseAdmin, resolveOrgIdFromHeaders, resolveActingUserId, requireConfirmed, buildFolioLinks, getRequestOrigin, sanitizeAuthor } from '@/lib/mcp/shared';
import { requireWorkspaceOwner, resolveFolioForCaller, unwritableArguments } from '@/lib/mcp/tools/collaborators';

export async function handleListProjects(request?: Request, args?: { include_archived?: boolean }) {
  const includeArchived = args?.include_archived === true;
  let db: HTMLFile[] = [];

  if (!isOSS) {
    const orgId = await resolveOrgIdFromHeaders();
    requireSupabaseAdmin();

    // Read from the metadata view, not the base table: `versions[].files` there
    // is a {filename: byteLength} projection, so this no longer streams the full
    // HTML of every retained version into memory just to report counts. The view
    // exposes every column this summary reads (id, title, description, status,
    // archived_at, comments, updated_at, versions).
    const query = supabaseAdmin
      .from('folios_metadata')
      .select('*')
      .eq('organization_id', orgId)
      .order('updated_at', { ascending: false });
    // Archived folios are hidden unless explicitly asked for.
    const { data, error } = await (includeArchived ? query : query.is('archived_at', null));

    if (error) throw error;
    db = (data as FolioRecord[]).map(transformFolioRecord);
  } else {
    db = await readDB();
  }

  if (!includeArchived) db = db.filter((p) => !p.archivedAt);

  const origin = getRequestOrigin(request);
  const activeUrl = globalWithTunnel.activeUrl;

  const summary = db.map(p => {
    const latestVersion = p.versions[p.versions.length - 1];
    const fileCount = latestVersion ? Object.keys(latestVersion.files).length : 0;
    const openComments = (p.comments || []).filter(c => !c.resolved).length;

    return {
      project_id: p.id,
      title: p.title,
      description: p.description,
      status: p.status || 'draft',
      archived: !!p.archivedAt,
      file_count: fileCount,
      version_count: p.versions.length,
      open_comments: openComments,
      updated_at: p.updatedAt,
      share_url: activeUrl 
        ? `${activeUrl}/share/${p.id}` 
        : `${origin}/share/${p.id}`,
      public_share_url: activeUrl
        ? `${activeUrl}/share/${p.id}`
        : undefined,
      ...buildFolioLinks(p.id, origin)
    };
  });

  return { projects: summary, total: summary.length };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
export async function handleGetProject(args: any, request?: Request) {
  const { project_id } = args || {};
  if (!project_id) throw new Error("Argument 'project_id' is required.");

  let project: HTMLFile;

  if (!isOSS) {
    const orgId = await resolveOrgIdFromHeaders();

    // Resolves the caller's standing on this folio rather than assuming the
    // workspace owns it: a folio that was shared with them by a grant reads
    // too, while a caller with no standing gets the same answer as a missing
    // id — the resolver owns that decision, and the not-found text is unchanged.
    project = (await resolveFolioForCaller(project_id, orgId, 'view')).folio;
  } else {
    const db = await readDB();
    const found = db.find(p => p.id === project_id);
    if (!found) throw new Error(`Project with ID '${project_id}' not found.`);
    project = found;
  }

  const latestVersion = project.versions[project.versions.length - 1];
  const openComments = (project.comments || []).filter(c => !c.resolved);
  const origin = getRequestOrigin(request);
  const activeUrl = globalWithTunnel.activeUrl;

  return {
    project_id: project.id,
    title: project.title,
    description: project.description,
    project_mode: project.projectMode || 'document',
    // Sharing/visibility state — agents use these to confirm e.g. "is it
    // private now?" without anonymous REST probes.
    status: project.status || 'published',
    isPrivate: project.isPrivate ?? false,
    hasAccessKey: !!project.accessKey,
    // Archive state, so "did the archive stick?" is answerable from here.
    // Without it an agent could only see `status: 'draft'`, which is ALSO what
    // a plain unpublish looks like — and this is the field a caller reaches
    // for to confirm an archive actually happened.
    archived: !!project.archivedAt,
    archived_at: project.archivedAt ?? null,
    // View analytics (cloud only — the OSS flat DB has no beacon pipeline).
    analytics: isOSS ? undefined : (project.analytics || { views: 0, totalTimeSeconds: 0, avgTimeSeconds: 0, mobileViews: 0, desktopViews: 0 }),
    design_preferences: project.designPreferences || {},
    current_files: latestVersion?.files || {},
    version_history: project.versions.map(v => ({
      versionId: v.versionId,
      commitMessage: v.commitMessage,
      author: sanitizeAuthor(v.author),
      createdAt: v.createdAt,
      fileNames: Object.keys(v.files)
    })),
    open_comments: openComments.map(c => ({
      ...c,
      author: sanitizeAuthor(c.author)
    })),
    // Include safe chat history for context
    chats: (project.chats || []).map(m => ({
      sender: m.sender,
      text: m.text,
      createdAt: m.createdAt,
      isProposal: m.isProposal,
      interactiveCard: m.interactiveCard ? {
        type: m.interactiveCard.type,
        title: m.interactiveCard.title
      } : undefined
    })),
    share_url: activeUrl 
      ? `${activeUrl}/share/${project.id}` 
      : `${origin}/share/${project.id}`,
    public_share_url: activeUrl
      ? `${activeUrl}/share/${project.id}`
      : undefined,
    ...buildFolioLinks(project.id, origin)
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
export async function handleCreateProject(args: any, request?: Request) {
  const { title, initial_html, description, project_mode, design_preferences, reference_files, isPrivate, accessKey, allowComments, presentationModeOnly, project_id, paid_access, thumbnail_url, listing } = args || {};
  if (!title) throw new Error("Argument 'title' is required.");
  if (!initial_html) throw new Error("Argument 'initial_html' is required.");

  // Paid access (optional) — strict validation; invalid config fails loudly
  // instead of silently changing the price. Stored in OSS too, never enforced there.
  let paidAccess: PaidAccessConfig | null = null;
  if (paid_access !== undefined) {
    const cfg = sanitizePaidAccess(paid_access);
    if (!cfg) throw new Error('Invalid paid_access config: expected { enabled, priceType, amountCents, currency, previewMode } with rentalDays (rental), interval (subscription), or previewSeconds (timed) as required by each mode.');
    paidAccess = cfg;
  }

  // Marketplace listing metadata (optional) — strict validation like paid_access.
  let listingMeta: ListingMetadata | null = null;
  if (listing !== undefined) {
    listingMeta = sanitizeListing(listing);
    if (!listingMeta) {
      throw new Error('Invalid listing metadata: expected { listed: boolean, category?, tags?, creation?, license?: { kind, allowModify, allowResale, requireAttribution, maxProjects? }, rightsAttestedAt? } with values from the documented enums.');
    }
  }

  // Creating straight into an archived workspace would hide the folio the
  // instant it exists. Make the caller unarchive first.
  if (project_id && !isOSS) {
    requireSupabaseAdmin();
    const orgId = await resolveOrgIdFromHeaders();
    const { data: workspace } = await supabaseAdmin
      .from('projects')
      .select('archived_at')
      .eq('id', project_id)
      .eq('organization_id', orgId)
      .maybeSingle();
    if (workspace?.archived_at) {
      throw new Error('That workspace is archived. Unarchive it (manage_workspace action:"unarchive") before creating folios in it.');
    }
  }

  // Security: UUID ids are not enumerable (OSS previously used a
  // title+timestamp slug that was guessable and collided).
  const cleanId = crypto.randomUUID();

  const initialFiles = {
    "index.html": initial_html
  };

  const newProject: HTMLFile = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Postgres generates the UUID in cloud mode; HTMLFile.id is typed string so undefined is cast
    id: isOSS ? cleanId : undefined as any, // Let Postgres generate UUID
    title: title.trim(),
    description: description || FOLIO_DEFAULTS.description,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    comments: [],
    status: args?.status || FOLIO_DEFAULTS.status,
    projectMode: project_mode || FOLIO_DEFAULTS.projectMode,
    designPreferences: design_preferences,
    referenceFiles: reference_files || [],
    isPrivate: isPrivate ?? FOLIO_DEFAULTS.isPrivate,
    accessKey: accessKey || undefined,
    allowComments: allowComments ?? FOLIO_DEFAULTS.allowComments,
    presentationModeOnly: presentationModeOnly ?? FOLIO_DEFAULTS.presentationModeOnly,
    paidAccess,
    thumbnailUrl: thumbnail_url || null,
    listing: listingMeta ?? undefined,
    projectId: project_id || null,
    slug: slugifyFolioTitle(title),
    versions: [
      {
        versionId: VERSION_MESSAGES.initial,
        commitMessage: VERSION_MESSAGES.commitMCP,
        createdAt: new Date().toISOString(),
        author: "AI Coding Assistant (MCP)",
        files: initialFiles
      }
    ]
  };

  const origin = getRequestOrigin(request);
  const activeUrl = globalWithTunnel.activeUrl;
  const shareBase = activeUrl || origin;

  if (!isOSS) {
    const orgId = await resolveOrgIdFromHeaders();
    requireSupabaseAdmin();

    // Listing guard — creation-time listings must carry the per-folio rights
    // affirmation, and the org owner must have accepted the Seller Terms.
    if (listingMeta?.listed) {
      const guardCode = await listingWriteGuard({
        orgId,
        listed: true,
        rightsAttestedAt: listingMeta.rightsAttestedAt,
        existingAttested: false,
      });
      if (guardCode === 'LISTING_NEEDS_SELLER_AGREEMENT') {
        throw new Error('LISTING_NEEDS_SELLER_AGREEMENT: The workspace owner must accept the LiveFolio Seller Terms before listing folios for sale/discovery. Ask the owner to open the folio\'s Share menu → Marketplace listing and accept the terms.');
      }
      if (guardCode === 'LISTING_SELLER_SUSPENDED') {
        throw new Error('LISTING_SELLER_SUSPENDED: This seller account is suspended. Listings cannot be created.');
      }
      if (guardCode === 'LISTING_NEEDS_RIGHTS_ATTESTATION') {
        throw new Error('LISTING_NEEDS_RIGHTS_ATTESTATION: Set rightsAttestedAt (ISO timestamp) on the listing to affirm "I own this content or have the necessary rights/licenses to sell and distribute it."');
      }
    }

    // Storage quota enforcement — block creation when over limit.
    // Mirrors app/api/files/route.ts POST. In OSS, assertStorageQuota
    // always returns { allowed: true }, so this branch is cloud-only anyway.
    const headerList = await headers();
    const userId = headerList.get('x-user-id') || orgId;
    let estimatedBytes = Buffer.byteLength(JSON.stringify(initialFiles), 'utf8');
    for (const ref of reference_files || []) {
      estimatedBytes += ref.size || (ref.content ? Buffer.byteLength(ref.content, 'utf8') : 0);
    }
    const { allowed, code } = await assertStorageQuota(userId, estimatedBytes, orgId);
    if (!allowed) {
      throw new Error(`${code || 'STORAGE_EXCEEDED'}: You have exceeded your storage limit. Upgrade your plan to continue creating folios.`);
    }

    const dbRecord = transformToFolioRecord(newProject, orgId);
    delete dbRecord.id;

    const { data, error } = await supabaseAdmin
      .from('folios')
      .insert(dbRecord)
      .select()
      .single();

    if (error) throw error;
    const created = transformFolioRecord(data as FolioRecord);

    // Agents often publish before the human ever opens Settings — make sure
    // the org Owner has a handle so created folios get @username/slug links.
    // Best-effort: failures never fail the create.
    await ensureOwnerHandle(orgId).catch(() => {});

    return {
      success: true,
      project_id: created.id,
      share_url: `${shareBase}/share/${created.id}`,
      ...buildFolioLinks(created.id, origin)
    };
  } else {
    await runTransaction(async (db) => {
      db.push(newProject);
    });

    return {
      success: true,
      project_id: cleanId,
      share_url: `${shareBase}/share/${cleanId}`,
      ...buildFolioLinks(cleanId, origin)
    };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
export async function handleUpdateProject(args: any, request?: Request) {
  const { project_id, updated_files, change_message, title, description, isPrivate, accessKey, allowComments, presentationModeOnly, status, paid_access, thumbnail_url, listing } = args || {};
  if (!project_id) throw new Error("Argument 'project_id' is required.");

  // Marketplace listing metadata (optional) — strict validation like paid_access.
  let listingMeta: ListingMetadata | null = null;
  if (listing !== undefined) {
    listingMeta = sanitizeListing(listing);
    if (!listingMeta) {
      throw new Error('Invalid listing metadata: expected { listed: boolean, category?, tags?, creation?, license?: { kind, allowModify, allowResale, requireAttribution, maxProjects? }, rightsAttestedAt? } with values from the documented enums.');
    }
  }

  // Metadata-only updates (status / isPrivate / sharing settings) are valid
  // without file changes — treat absent or empty updated_files as "no files".
  const hasFileChanges = !!updated_files && typeof updated_files === 'object' && Object.keys(updated_files).length > 0;

  // Paid access (optional) — strict validation; invalid config fails loudly
  // instead of silently changing the price. Stored in OSS too, never enforced there.
  let paidAccess: PaidAccessConfig | null = null;
  if (paid_access !== undefined) {
    const cfg = sanitizePaidAccess(paid_access);
    if (!cfg) throw new Error('Invalid paid_access config: expected { enabled, priceType, amountCents, currency, previewMode } with rentalDays (rental), interval (subscription), or previewSeconds (timed) as required by each mode.');
    paidAccess = cfg;
  }

  let versionId = '';
  // Fields the caller supplied that their role on this folio does not carry.
  // Named back in the result: the write still happens, and a bare 200 would
  // otherwise read as "every field you sent was applied".
  let strippedFields: string[] = [];
  if (!isOSS) {
    const orgId = await resolveOrgIdFromHeaders();
    const email = 'agent@livefolio.cloud';

    // The caller's standing on this folio, not an assumption that their
    // workspace owns it: a live editor grant pushes versions here, a viewer
    // grant does not, and an unrelated caller gets the missing-folio answer.
    const { folio: project, role } = await resolveFolioForCaller(
      project_id,
      orgId,
      'push_versions'
    );
    const lastVersion = project.versions[project.versions.length - 1];

    // The whole row is rewritten below, so an owner-only field cannot be
    // protected by a check on the route — it has to be refused per column. Only
    // what the CALLER sent is stripped; a column they did not send travels from
    // the stored row unchanged, so a stripped field is written back byte for
    // byte rather than cleared.
    strippedFields = unwritableArguments(role, args);
    const mayWrite = (argument: string) => !strippedFields.includes(argument);

    // The folio's OWN workspace, not the caller's. A collaborator's version
    // push files its assets under the workspace that owns the folio — where the
    // raw route looks for them — and is retained under that workspace's plan. A
    // stored row always carries its org; the fallback only covers a null.
    const folioOrgId = project.organization_id || orgId;

    let storedBytes = 0;
    if (hasFileChanges) {
      // Merge or replace files — offload base64 images to asset store
      let mergedFiles = { ...lastVersion.files, ...updated_files };
      const processed = await processUploadFiles(mergedFiles, project_id, folioOrgId);
      mergedFiles = processed.files;
      storedBytes = processed.storedBytes;

      versionId = nextFolioVersionId(project.versions);

      const newVersion: HTMLVersion = {
        versionId,
        commitMessage: change_message || `Revised via MCP Client (${versionId})`,
        createdAt: new Date().toISOString(),
        author: email || "AI Coding Assistant (MCP)",
        files: mergedFiles
      };

      project.versions.push(newVersion);
      // Free plan: retain only the last 25 versions / 30 days
      project.versions = await applyVersionRetention(project.versions, folioOrgId);
    } else {
      // Metadata-only update — no new version checkpoint.
      versionId = lastVersion?.versionId || '';
    }
    project.updatedAt = new Date().toISOString();

    // Apply optional metadata updates, each behind the field's own capability
    // so a role that cannot write it leaves the stored value alone.
    if (mayWrite('title') && title !== undefined) project.title = title;
    if (mayWrite('description') && description !== undefined) project.description = description;
    if (mayWrite('isPrivate') && isPrivate !== undefined) project.isPrivate = isPrivate;
    if (mayWrite('accessKey') && accessKey !== undefined) project.accessKey = accessKey;
    if (mayWrite('allowComments') && allowComments !== undefined) project.allowComments = allowComments;
    if (mayWrite('presentationModeOnly') && presentationModeOnly !== undefined) project.presentationModeOnly = presentationModeOnly;
    if (mayWrite('status') && status !== undefined) project.status = status;
    if (mayWrite('paid_access') && paid_access !== undefined) project.paidAccess = paidAccess;
    if (mayWrite('thumbnail_url') && thumbnail_url !== undefined) project.thumbnailUrl = thumbnail_url;

    // Listing guard — flipping a folio INTO a listing requires account
    // standing + rights affirmation (existing affirmations carry forward).
    if (mayWrite('listing') && listingMeta?.listed) {
      const guardCode = await listingWriteGuard({
        orgId,
        listed: true,
        rightsAttestedAt: listingMeta.rightsAttestedAt,
        existingAttested: !!project.listing?.rightsAttestedAt,
      });
      if (guardCode === 'LISTING_NEEDS_SELLER_AGREEMENT') {
        throw new Error('LISTING_NEEDS_SELLER_AGREEMENT: The workspace owner must accept the LiveFolio Seller Terms before listing folios for sale/discovery. Ask the owner to open the folio\'s Share menu → Marketplace listing and accept the terms.');
      }
      if (guardCode === 'LISTING_SELLER_SUSPENDED') {
        throw new Error('LISTING_SELLER_SUSPENDED: This seller account is suspended. Listings cannot be created.');
      }
      if (guardCode === 'LISTING_NEEDS_RIGHTS_ATTESTATION') {
        throw new Error('LISTING_NEEDS_RIGHTS_ATTESTATION: Set rightsAttestedAt (ISO timestamp) on the listing to affirm "I own this content or have the necessary rights/licenses to sell and distribute it."');
      }
    }
    if (mayWrite('listing') && listing !== undefined) {
      // Never wipe the rights affirmation on later listing edits/unlists.
      project.listing = preserveAttestation(listingMeta, project.listing);
    }

    // Preserve the folio's existing organization — don't overwrite on update.
    // `transformFolioRecord` copies `organization_id` straight through, so the
    // resolved project carries the same value the raw row did.
    const dbRecord = transformToFolioRecord(project, folioOrgId);
    const estimatedSize = JSON.stringify(dbRecord).length;
    const MAX_MCP_FOLIO_SIZE = 32_000_000;
    if (estimatedSize > MAX_MCP_FOLIO_SIZE) {
      throw new Error(`FOLIO_TOO_LARGE: This folio would be ${(estimatedSize / 1_000_000).toFixed(1)} MB across ${project.versions.length} versions (max 32 MB). Assets stored: ${(storedBytes / 1_000_000).toFixed(1)} MB.`);
    }
    const { error: updateError } = await supabaseAdmin
      .from('folios')
      .update(dbRecord)
      .eq('id', project_id)
      .eq('organization_id', folioOrgId);

    if (updateError) throw updateError;
    // Agent edits must be visible immediately — the raw/share/editor paths
    // all read through this 10-minute in-memory project cache. Without this
    // invalidation, viewers kept serving the pre-update version.
    projectMemoryCache.invalidate(project_id);
  } else {
    await runTransaction(async (db) => {
      const pIndex = db.findIndex(p => p.id === project_id);
      if (pIndex === -1) throw new Error(`Project with ID '${project_id}' not found.`);

      const project = db[pIndex];
      const lastVersion = project.versions[project.versions.length - 1];

      if (hasFileChanges) {
        // Merge or replace files, offload base64 images to asset store
        let mergedFiles = { ...lastVersion.files, ...updated_files };
        const { files: processed } = await processUploadFiles(mergedFiles, project_id, 'oss');
        mergedFiles = processed;
        // max-based, not count-based: the count form re-issues an id that is
        // already in use once retention pruning leaves a gap in the sequence.
        versionId = nextFolioVersionId(project.versions);

        const newVersion: HTMLVersion = {
          versionId,
          commitMessage: change_message || `Revised via MCP Client (${versionId})`,
          createdAt: new Date().toISOString(),
          author: "AI Coding Assistant (MCP)",
          files: mergedFiles
        };

        project.versions.push(newVersion);
      } else {
        // Metadata-only update — no new version checkpoint.
        versionId = lastVersion?.versionId || '';
      }
      project.updatedAt = new Date().toISOString();

      // Apply optional metadata updates
      if (title !== undefined) project.title = title;
      if (description !== undefined) project.description = description;
      if (isPrivate !== undefined) project.isPrivate = isPrivate;
      if (accessKey !== undefined) project.accessKey = accessKey;
      if (allowComments !== undefined) project.allowComments = allowComments;
      if (presentationModeOnly !== undefined) project.presentationModeOnly = presentationModeOnly;
      if (status !== undefined) project.status = status;
      if (paid_access !== undefined) project.paidAccess = paidAccess;
      if (thumbnail_url !== undefined) project.thumbnailUrl = thumbnail_url;
      if (listing !== undefined) project.listing = preserveAttestation(listingMeta, project.listing);

      db[pIndex] = project;
    });
  }

  const origin = getRequestOrigin(request);
  const activeUrl = globalWithTunnel.activeUrl;
  const shareBase = activeUrl || origin;

  return {
    success: true,
    project_id,
    versionId,
    // Present only when something was refused, so the caller is never left
    // believing an owner-only change (a publish, a price, a privacy flip) took
    // effect when the write deliberately skipped it.
    ...(strippedFields.length > 0
      ? {
          stripped_fields: strippedFields,
          note: `Not applied — these need the owner role on this folio: ${strippedFields.join(', ')}. Everything else was written.`,
        }
      : {}),
    share_url: `${shareBase}/share/${project_id}`,
    ...buildFolioLinks(project_id, origin)
  };
}

// ── Phase 1: delete / duplicate / feedback ──────────────────────────────

/** Permanently delete a folio (dual-mode). confirmed must be exactly true. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
export async function handleDeleteProject(args: any) {
  const { project_id, confirmed } = args || {};
  if (!project_id) throw new Error("Argument 'project_id' is required.");
  requireConfirmed(confirmed);

  if (!isOSS) {
    const orgId = await resolveOrgIdFromHeaders();
    requireSupabaseAdmin();

    // Deleting is refused twice over, and both refusals are needed. The folio
    // must resolve for this caller at all (which answers a stranger with the
    // missing-folio string, not a permission one), and on top of that only the
    // workspace's Owner may destroy one — a teammate who is neither the Owner
    // nor the folio's owner is refused here exactly as the REST folio API
    // refuses them.
    await resolveFolioForCaller(project_id, orgId, 'delete');
    await requireWorkspaceOwner(orgId);

    // Org-scoped fetch first — never delete a folio the caller can't see.
    const { data: row, error: fetchError } = await supabaseAdmin
      .from('folios')
      .select('id, title')
      .eq('id', project_id)
      .eq('organization_id', orgId)
      .maybeSingle();
    if (fetchError || !row) throw new Error(`Project with ID '${project_id}' not found.`);

    try {
      await deleteFolioAssets(project_id, orgId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- asset deletion may throw non-Error values; .message is read defensively
    } catch (assetErr: any) {
      console.error('[MCP] delete_project asset cleanup failed:', assetErr?.message || assetErr);
    }

    const { error: deleteErr } = await supabaseAdmin
      .from('folios')
      .delete()
      .eq('id', project_id)
      .eq('organization_id', orgId);

    if (deleteErr) throw deleteErr;
    projectMemoryCache.invalidate(project_id);
    return { success: true, project_id, deleted_title: row.title };
  }

  await runTransaction(async (db) => {
    const idx = db.findIndex((p) => p.id === project_id);
    if (idx === -1) throw new Error(`Project with ID '${project_id}' not found.`);
    const [removed] = db.splice(idx, 1);
    return { success: true, project_id, deleted_title: removed.title };
  });
  return { success: true, project_id };
}

/**
 * Bounded-concurrency map — the same fixed-worker-pool idiom as
 * `mapWithConcurrency` in lib/process-upload.ts (a shared cursor claimed by
 * `limit` workers), minus its fail-fast halt: a worker takes the next index and
 * the callback owns its own error handling, so callers keep count-and-continue
 * semantics. Never unbounded — `Promise.all` over the raw items would open one
 * request per item.
 */
export async function forEachWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

/** Copy a folio into the caller's account (cloud-only, grant/allowCopy aware). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
export async function handleDuplicateProject(args: any) {
  if (isOSS) throw new Error('Duplicate is a cloud feature and is not available in OSS mode.');
  const { project_id } = args || {};
  if (!project_id) throw new Error("Argument 'project_id' is required.");

  const orgId = await resolveOrgIdFromHeaders();
  const userId = await resolveActingUserId(orgId);
  requireSupabaseAdmin();

  const queryId = extractUUIDFromSlug(project_id);
  const { data: row, error } = await supabaseAdmin
    .from('folios')
    .select('*')
    .eq('id', queryId)
    .maybeSingle();
  if (error || !row) throw new Error(`Folio '${project_id}' not found.`);

  const folio = transformFolioRecord(row as FolioRecord);
  const sellerOrgId = folio.organization_id as string;

  // Owner/member bypass — the creator's own team duplicates freely.
  const { data: membership } = await supabaseAdmin
    .from('organization_members')
    .select('id')
    .eq('organization_id', sellerOrgId)
    .eq('user_id', userId)
    .limit(1);
  const isMember = !!(membership && membership.length > 0);

  if (!isMember) {
    const { resolveGateConfig } = await import('@/lib/gating/config');
    const gate = await resolveGateConfig({
      paid_access: folio.paidAccess as PaidAccessConfig | null,
      project_id: folio.projectId,
      organization_id: sellerOrgId,
    });
    const granted =
      (await hasActiveGrant(userId, 'folio', folio.id)) ||
      (!folio.paidAccess && folio.projectId
        ? await hasActiveGrant(userId, 'workspace', folio.projectId)
        : false);
    if (!granted || !gate?.config.enabled || gate.config.allowCopy !== true) {
      throw new Error(
        "Duplication is not enabled for this folio. Paid folios require an active purchase AND the seller's allowCopy setting."
      );
    }
  }

  // The copy: fresh id, fresh identity — the buyer owns it from here.
  const newId = crypto.randomUUID();
  const copied: HTMLFile = {
    ...JSON.parse(JSON.stringify(folio)),
    id: newId,
    organization_id: orgId,
    title: folio.title ? `${folio.title} (copy)` : 'Untitled (copy)',
    projectId: null,
    folderId: null,
    slug: null,
    status: 'draft',
    isPrivate: false,
    accessKey: undefined,
    publicTunnelEnabled: undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Copy content-addressed assets into the buyer's storage path so the raw
  // route (which resolves assets by {orgId}/{folioId}/) keeps serving.
  const hashes = new Set<string>();
  for (const v of copied.versions) {
    for (const value of Object.values(v.files)) {
      if (typeof value === 'string' && value.startsWith('asset://')) {
        const hash = value.replace('asset://sha256-', '');
        if (/^[0-9a-f]{64}(?:\.[a-z0-9]{1,8})?$/i.test(hash)) hashes.add(hash);
      }
    }
  }
  // One round trip per asset, but bounded to 6 in flight — this used to be a
  // serial loop, so an asset-heavy folio paid the full latency of every copy
  // back to back. Exactly the same set of copies is performed, and a per-asset
  // failure is still only counted (never thrown), as before.
  const ASSET_COPY_CONCURRENCY = 6;
  const assetStore = supabaseAdmin.storage;
  let copyErrors = 0;
  await forEachWithConcurrency(Array.from(hashes), ASSET_COPY_CONCURRENCY, async (hash) => {
    const { error: cpErr } = await assetStore
      .from('folio-assets')
      .copy(`${sellerOrgId}/${folio.id}/${hash}`, `${orgId}/${newId}/${hash}`);
    if (cpErr) copyErrors++;
  });
  if (copyErrors > 0) {
    console.error(`[MCP duplicate] ${copyErrors}/${hashes.size} assets failed to copy for folio ${newId}`);
  }

  const { error: insertErr } = await supabaseAdmin
    .from('folios')
    .insert(transformToFolioRecord(copied, orgId));

  if (insertErr) {
    console.error('Duplicate insert failed:', insertErr.message);
    throw new Error('Could not create the copy.');
  }

  return { success: true, project_id: newId, copied_from: folio.id };
}

/**
 * Archive a folio. Dual-mode. The invariant (unpublish + unlist + stamp) lives
 * in lib/archive.ts so this and the REST route can never drift.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
export async function handleArchiveFolio(args: any) {
  const { project_id } = args || {};
  if (!project_id) throw new Error("Argument 'project_id' is required.");

  let orgId: string | undefined;
  if (!isOSS) {
    orgId = await resolveOrgIdFromHeaders();
    // Same two refusals as deleting: the folio has to resolve for this caller,
    // and archiving stays with the workspace's Owner.
    await resolveFolioForCaller(project_id, orgId, 'archive');
    await requireWorkspaceOwner(orgId);
  }

  const state = await archiveFolio(project_id, orgId);
  if (!state) throw new Error(`Project with ID '${project_id}' not found.`);

  return {
    success: true,
    project_id: state.id,
    status: state.status,
    archived: true,
    archived_at: state.archivedAt,
    note: 'Archived — unpublished, unlisted, and hidden from every public surface. Nothing was deleted and it still counts toward storage. Restore with unarchive_folio.',
  };
}

/** Restore an archived folio. Dual-mode. Comes back as a DRAFT, never published. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
export async function handleUnarchiveFolio(args: any) {
  const { project_id } = args || {};
  if (!project_id) throw new Error("Argument 'project_id' is required.");

  let orgId: string | undefined;
  if (!isOSS) {
    orgId = await resolveOrgIdFromHeaders();
    // Unarchive is the archive capability in reverse, so it carries the same
    // pair of refusals — and it has to, or the archive tightening would be
    // undone by the one call that brings a folio back.
    await resolveFolioForCaller(project_id, orgId, 'archive');
    await requireWorkspaceOwner(orgId);
  }

  const state = await unarchiveFolio(project_id, orgId);
  if (!state) throw new Error(`Project with ID '${project_id}' not found.`);

  return {
    success: true,
    project_id: state.id,
    status: state.status,
    archived: false,
    archived_at: null,
    note: 'Restored as a draft. It is still unpublished and unlisted — call manage_sharing with status:"published" when the owner wants it live again.',
  };
}
