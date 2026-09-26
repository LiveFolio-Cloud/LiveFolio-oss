import { NextResponse } from 'next/server';
import { readDB, runTransaction, HTMLFile } from '@/lib/db';
import { isOSS, isCloud } from '@/lib/env';
import { supabaseAdmin, transformFolioRecord, transformToFolioRecord, FolioRecord } from '@/lib/supabase';
import { getAuthContext } from '@/lib/auth';
import { getOwnerIdentity } from '@/app/api/_lib/gate-owner';
import { projectMemoryCache } from '@/lib/project-cache';
import { processUploadFiles } from '@/lib/process-upload';
import { deleteFolioAssets } from '@/lib/asset-store';
import { assertStorageQuota } from '@/ee/middleware/usageCapping';
import { sanitizePaidAccess } from '@/lib/gating/config';
import type { PaidAccessConfig } from '@/lib/gating/types';
import { sanitizeListing, listingWriteGuard, preserveAttestation, defaultListing } from '@/lib/listing/config';
import type { ListingMetadata } from '@/lib/listing/types';
import { nextVersionId, applyVersionRetention } from '@/lib/version-retention';
import { folioIsArchived } from '@/lib/archive';
import { err } from '@/lib/api/respond';
import { can, resolveFolioRole, type FolioRole } from '../_lib/role-gate';
import {
  folioNotFound,
  gateFolio,
  partitionWritableFields,
  roleTargetOf,
} from '../_lib/role-gate';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Security: the folio id is used in filesystem paths (OSS asset store).
// Reject ids that could escape the asset root.
function isUnsafeFolioId(id: string): boolean {
  return !id || id.includes('/') || id.includes('\\') || id.startsWith('.');
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    // `orgId` is deliberately NOT read: a collaborator's own workspace has
    // nothing to do with the folio they were granted, and every query below is
    // scoped by the folio's own org instead.
    const { userId } = await getAuthContext();

    if (isOSS) {
      const db = await readDB();
      const project = db.find((p) => p.id === id);
      if (!project) return err('Project not found.', { status: 404 });
      return NextResponse.json(project);
    }

    // Cloud Mode — the caller is identified by their USER id, and the folio by
    // the id alone: a collaborator's grant lives outside their own workspace, so
    // scoping the read to their org's folios is what hid the folio from them.
    // What replaces that scope is the role check below — a folio the caller
    // cannot see is a 404, exactly as it was when the org filter refused it.
    if (!userId) return err('Unauthorized', { status: 401 });

    // Owner handle rides along so editor menus can build the canonical
    // @username/slug link INSTANTLY (identity is cached in-process — this
    // is not a per-open cost). The org asked about is the FOLIO's, not the
    // caller's: a collaborator's own workspace has nothing to do with it.
    const withOwner = async (project: HTMLFile) => {
      const identity = await getOwnerIdentity(project.organization_id);
      return NextResponse.json({ ...project, ownerUsername: identity.username ?? null });
    };

    // The in-process cache is keyed by folio id alone and is read BEFORE any
    // query, so the role check has to run on the cached row too (seam N-A):
    // a cache hit must never be an authorization decision of its own.
    const cachedProject = projectMemoryCache.get(id);
    if (cachedProject) {
      const cachedRole = await resolveFolioRole(userId, roleTargetOf(cachedProject));
      if (!can(cachedRole, 'view')) return folioNotFound();
      return withOwner(cachedProject);
    }

    const { data, error } = await supabaseAdmin
      .from('folios')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error || !data) {
      // Security: no global-lookup "self-healing" reassignment here.
      // A folio that is not found under the caller's org is simply not
      // visible to them — returning 404 prevents cross-tenant theft.
      return err('Project not found.', { status: 404 });
    }
    const project = transformFolioRecord(data as FolioRecord);

    // `view`: any grant role, or org membership. `none` — and any folio with no
    // organization to be a member of — gets the same 404 a missing id gets.
    const role = await resolveFolioRole(userId, roleTargetOf(project));
    if (!can(role, 'view')) return folioNotFound();

    projectMemoryCache.set(id, project);

    return withOwner(project);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: error may be any thrown value; only logged
  } catch (error: any) {
    console.error('GET /api/files/[id] error:', error);
    return err('Internal server error.', { status: 500 });
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { orgId, email, userId } = await getAuthContext();

    // Security: reject crafted ids before any filesystem/asset work.
    if (isUnsafeFolioId(id)) {
      return err('Project not found.', { status: 404 });
    }

    // body is pre-buffered at full size by server.ts (which injects
    // proxyClientMaxBodySize: 50mb into the standalone config at startup).
    const rawBody = await request.text();
    const bodySize = Buffer.byteLength(rawBody, 'utf8');
    const MAX_BODY_SIZE = 20 * 1024 * 1024;
    if (bodySize > MAX_BODY_SIZE) {
      return NextResponse.json(
        { error: 'FOLIO_TOO_LARGE', message: `Request body is ${(bodySize / 1_000_000).toFixed(1)} MB. Maximum is 20 MB.` },
        { status: 413 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- request body is arbitrary client JSON (plain or gzip-wrapped)
    let body: any;
    try {
      body = JSON.parse(rawBody);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: parseErr may be any thrown value; parseErr.message is read
    } catch (parseErr: any) {
      console.error(`[PUT /api/files/${id}] JSON parse failed at ${(bodySize / 1_000_000).toFixed(2)} MB: ${parseErr.message}`);
      return NextResponse.json(
        { error: 'INVALID_JSON', message: `Failed to parse request body (${(bodySize / 1_000_000).toFixed(1)} MB).` },
        { status: 400 }
      );
    }

    // Decompress gzip-compressed payload from clients that support
    // CompressionStream (large folio saves with embedded images).
    // Reduces 10+ MB of base64 JSON to ~2-3 MB, avoiding Next.js's
    // 10 MB body buffer truncation entirely.
    if (body._gz && typeof body._d === 'string') {
      try {
        const { gunzip } = await import('zlib');
        const compressed = Buffer.from(body._d, 'base64');
        // Cap decompressed output — a small gzip bomb must not exhaust memory.
        // The cap is enforced on this path too (a payload over it rejects with
        // the same "Cannot create a Buffer larger than N bytes" error the sync
        // variant raised), so the 400 below is unchanged.
        // Async, not gunzipSync: inflating up to 64 MB used to block the event
        // loop for every other request on this instance.
        const decompressed = await new Promise<Buffer>((resolve, reject) => {
          gunzip(compressed, { maxOutputLength: 64 * 1024 * 1024 }, (gzError, out) =>
            gzError ? reject(gzError) : resolve(out)
          );
        });
        body = JSON.parse(decompressed.toString('utf8'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: gzErr may be any thrown value; gzErr.message is read
      } catch (gzErr: any) {
        console.error(`[PUT /api/files/${id}] gzip decompress failed: ${gzErr.message}`);
        return NextResponse.json(
          { error: 'INVALID_BODY', message: 'Failed to decompress request body.' },
          { status: 400 }
        );
      }
    }
    const {
      files,
      commitMessage,
      updated_files,
      change_message,
      author,
      title,
      description,
      isPrivate,
      accessKey,
      allowComments,
      presentationModeOnly,
      aiPersona,
      projectMode,
      designPreferences,
      restoreVersionId,
      reactions,
      publicTunnelEnabled,
      referenceFiles,
      status,
      projectId,
      folderId,
      paidAccess,
      thumbnailUrl,
      listing
    } = body;
    // `collaborators` is deliberately NOT read any more: access comes from
    // granted-access records written by the invite API, and the JSONB email
    // array this route used to write and email is retired (seam N-C). A payload
    // still carrying it is reported as stripped rather than silently applied.

    // ── Authorization, before any write machinery ─────────────────────────
    // Resolved on the folio ROW, so it works for a collaborator whose own org
    // does not contain the folio. It runs before the archived-publish 409, the
    // paid/listing sanitizers and the quota check, so a caller with no standing
    // is refused with the same 404 a missing folio gets and cannot use the
    // error it receives — or the work it causes — to probe for folios.
    let callerRole: FolioRole | null = null;
    let folioOrgId: string | null = null;
    if (!isOSS) {
      if (!userId) return err('Unauthorized', { status: 401 });
      const gate = await gateFolio(userId, id, 'push_versions', {
        forbidden: 'Only an editor or the owner can update this folio.',
      });
      if (!gate.ok) return gate.response;
      callerRole = gate.access.role;
      folioOrgId = gate.access.folio.organization_id;
    }

    // Per FIELD, never per route: `transformToFolioRecord` writes the whole row,
    // so publish state, privacy, the access key, the paywall config and the
    // listing all ride in the same payload as `title` and `versions`. Whatever
    // this role may not write is stripped below and named in the response —
    // a 200 that quietly dropped half the payload is exactly the kind of lie an
    // optimistic client cannot recover from.
    const { blocked, stripped } = callerRole
      ? partitionWritableFields(callerRole, body)
      : { blocked: new Set<string>(), stripped: [] as string[] };
    const mayWrite = (bodyKey: string) => !blocked.has(bodyKey);
    const strippedReport = stripped.length > 0 ? { strippedFields: stripped } : {};

    // An archived folio cannot be republished in place — it has to come back
    // out of the archive first, landing as a draft the owner publishes
    // deliberately. Server-side backstop for the UI hiding publish while
    // archived, and for agents calling this route directly.
    if (status === 'published' && (await folioIsArchived(id))) {
      return NextResponse.json(
        {
          error: 'ARCHIVED',
          message: 'This folio is archived. Unarchive it first — it returns as a draft you can publish.',
        },
        { status: 409 }
      );
    }

    // Resolve effective files and message
    const targetFiles = updated_files || files;
    const targetMessage = change_message || commitMessage;

    // Paid access: validate at write time via the single shared sanitizer.
    // Invalid configs fail loudly (400). Explicit `null` clears the gate
    // (back to "inherit workspace"); omitted leaves it untouched.
    let sanitizedPaidAccess: PaidAccessConfig | null | undefined;
    if (paidAccess !== undefined && paidAccess !== null && mayWrite('paidAccess')) {
      sanitizedPaidAccess = sanitizePaidAccess(paidAccess);
      if (!sanitizedPaidAccess) {
        return err('INVALID_PAID_ACCESS', { status: 400 });
      }
    } else if (paidAccess === null && mayWrite('paidAccess')) {
      sanitizedPaidAccess = null; // explicit clear
    } else {
      sanitizedPaidAccess = undefined; // not provided
    }

    // Marketplace listing metadata: validate at write time via the single
    // shared sanitizer (same posture as paidAccess — fail loudly, 400).
    // A field this role may not write is never validated, never written and never
    // reported as applied — it is stripped, and the removal is named in the
    // response. Failing the whole write (or its validation) over a field that
    // was going to be discarded anyway would break an editor's legitimate save.
    let sanitizedListing: ListingMetadata | null | undefined;
    if (listing !== undefined && listing !== null && mayWrite('listing')) {
      sanitizedListing = sanitizeListing(listing);
      if (!sanitizedListing) {
        return err('INVALID_LISTING', { status: 400 });
      }
    } else if (listing === null && mayWrite('listing')) {
      sanitizedListing = null; // explicit clear (unlists)
    } else {
      sanitizedListing = undefined; // not provided
    }

    // Listing guard — turning a folio INTO a listing requires the org owner's
    // Seller-Terms acceptance + the per-listing rights affirmation. Server
    // errors are machine-readable so clients can route to the attestation UI.
    if (isCloud && mayWrite('listing') && sanitizedListing?.listed) {
      // An existing per-folio affirmation is enough for re-listing — only
      // first-time listings require the affirmation to ride in the payload.
      let existingAttested = sanitizedListing.rightsAttestedAt != null;
      if (!existingAttested) {
        const { data: attestedRow } = await supabaseAdmin
          .from('folios')
          .select('rights_attested_at')
          .eq('id', id)
          .maybeSingle();
        existingAttested = !!attestedRow?.rights_attested_at;
      }
      const guardCode = await listingWriteGuard({
        orgId,
        listed: true,
        rightsAttestedAt: sanitizedListing.rightsAttestedAt,
        existingAttested,
      });
      if (guardCode === 'LISTING_NEEDS_SELLER_AGREEMENT' || guardCode === 'LISTING_SELLER_SUSPENDED') {
        return err(guardCode, { status: 403 });
      }
      if (guardCode === 'LISTING_NEEDS_RIGHTS_ATTESTATION') {
        return err(guardCode, { status: 400 });
      }
    }

    if (isOSS) {
      // Process assets INSIDE the transaction, after the project-exists
      // check — assets are never written for nonexistent folios, and the
      // folio id is validated above.
      const result = await runTransaction(async (db) => {
        const projectIndex = db.findIndex((p) => p.id === id);
        if (projectIndex === -1) throw new Error('Project not found');

        const project = db[projectIndex];

        // 1. Versioning — process assets after the existence check
        if (targetFiles && targetMessage) {
          const { files: processed, storedBytes, assetCount } = await processUploadFiles(targetFiles, id, 'oss');
          if (assetCount > 0) {
            console.log(`[PUT /api/files] OSS: ${assetCount} assets stored (${(storedBytes / 1024).toFixed(1)} KB), ${id}`);
          }
          project.versions.push({
            versionId: nextVersionId(project.versions),
            commitMessage: targetMessage,
            createdAt: new Date().toISOString(),
            author: author || email || 'Anonymous Developer',
            files: processed
          });
        }

        // 2. State Restoration
        if (restoreVersionId) {
          const version = project.versions.find(v => v.versionId === restoreVersionId);
          if (version) {
            project.versions.push({
              versionId: nextVersionId(project.versions),
              commitMessage: `Restored to ${restoreVersionId}`,
              createdAt: new Date().toISOString(),
              author: email || 'System',
              files: version.files
            });
          }
        }

        // 3. Metadata Updates
        if (title !== undefined) project.title = title;
        if (description !== undefined) project.description = description;
        if (isPrivate !== undefined) project.isPrivate = isPrivate;
        if (accessKey !== undefined) project.accessKey = accessKey;
        if (allowComments !== undefined) project.allowComments = allowComments;
        if (presentationModeOnly !== undefined) project.presentationModeOnly = presentationModeOnly;
        // The retired collaborator write + share-notification path used to sit
        // here. Self-hosted installs have no accounts to grant to, and the
        // notification email pointed at a link that granted nothing: the invite
        // API is the only writer of access now (seam N-C), and it does not
        // exist in this tree.
        if (aiPersona !== undefined) project.aiPersona = aiPersona;
        if (projectMode !== undefined) project.projectMode = projectMode;
        if (designPreferences !== undefined) project.designPreferences = designPreferences;
        if (reactions !== undefined) project.reactions = reactions;
        if (publicTunnelEnabled !== undefined) project.publicTunnelEnabled = publicTunnelEnabled;
        if (referenceFiles !== undefined) project.referenceFiles = referenceFiles;
        if (status !== undefined) project.status = status;
        if (projectId !== undefined) project.projectId = projectId || null;
        if (folderId !== undefined) project.folderId = folderId || null;
        if (paidAccess !== undefined) project.paidAccess = sanitizedPaidAccess;
        if (thumbnailUrl !== undefined) project.thumbnailUrl = thumbnailUrl;
        if (listing !== undefined) project.listing = sanitizedListing;

        project.updatedAt = new Date().toISOString();
        return project;
      });

      return NextResponse.json({ success: true, project: result });
    }

    // Cloud Mode — authorized above. `orgId` here is the CALLER's workspace and
    // is used only for their own storage accounting; every write below is
    // scoped to `folioOrgId`, the org the folio actually belongs to, so a
    // collaborator pushing a version can never move the folio into their
    // workspace (and `transformToFolioRecord` cannot be handed the wrong org).
    const writeOrgId = folioOrgId || orgId || '';

    // Enforce storage quota on version pushes too (not just creation).
    if (userId && orgId && (targetFiles || referenceFiles)) {
      let estimatedBytes = 0;
      if (targetFiles) {
        for (const content of Object.values(targetFiles)) {
          if (typeof content === 'string') estimatedBytes += Buffer.byteLength(content, 'utf8');
        }
      }
      for (const ref of referenceFiles || []) {
        estimatedBytes += ref.size || (ref.content ? Buffer.byteLength(ref.content, 'utf8') : 0);
      }
      const { allowed } = await assertStorageQuota(userId, estimatedBytes, orgId);
      if (!allowed) {
        return NextResponse.json(
          { error: 'STORAGE_EXCEEDED', message: 'You have exceeded your storage limit. Upgrade your plan to continue updating folios.' },
          { status: 402 }
        );
      }
    }

    // Fast path: lightweight metadata-only update (no version push, no restore)
    // Skips the 1-10 MB SELECT * and full-row rewrite for toggles like allowComments.
    const isLightweightUpdate = !targetFiles && !targetMessage && restoreVersionId === undefined
      && referenceFiles === undefined;
    if (isLightweightUpdate) {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (title !== undefined && mayWrite('title')) patch.title = title;
      if (description !== undefined && mayWrite('description')) patch.description = description;
      if (isPrivate !== undefined && mayWrite('isPrivate')) patch.is_private = isPrivate;
      if (accessKey !== undefined && mayWrite('accessKey')) patch.access_key = accessKey;
      if (allowComments !== undefined && mayWrite('allowComments')) patch.allow_comments = allowComments;
      if (presentationModeOnly !== undefined && mayWrite('presentationModeOnly')) patch.presentation_mode_only = presentationModeOnly;
      if (aiPersona !== undefined && mayWrite('aiPersona')) patch.ai_persona = aiPersona;
      if (projectMode !== undefined && mayWrite('projectMode')) patch.project_mode = projectMode;
      if (designPreferences !== undefined && mayWrite('designPreferences')) patch.design_preferences = designPreferences;
      if (reactions !== undefined && mayWrite('reactions')) patch.reactions = reactions;
      if (publicTunnelEnabled !== undefined && mayWrite('publicTunnelEnabled')) patch.public_tunnel_enabled = publicTunnelEnabled;
      if (status !== undefined && mayWrite('status')) patch.status = status;
      if (projectId !== undefined && mayWrite('projectId')) patch.project_id = projectId || null;
      if (folderId !== undefined && mayWrite('folderId')) patch.folder_id = folderId || null;
      if (paidAccess !== undefined && mayWrite('paidAccess')) patch.paid_access = sanitizedPaidAccess;
      if (thumbnailUrl !== undefined && mayWrite('thumbnailUrl')) patch.thumbnail_url = thumbnailUrl;
      if (listing !== undefined && mayWrite('listing')) {
        patch.listed = sanitizedListing!.listed;
        patch.category = sanitizedListing!.category;
        patch.tags = sanitizedListing!.tags;
        patch.creation = sanitizedListing!.creation;
        patch.license = sanitizedListing!.license;
        // rights_attested_at is written only when provided — never cleared by
        // an unrelated listing update (the affirmation is the evidence record).
        if (sanitizedListing!.rightsAttestedAt != null) {
          patch.rights_attested_at = sanitizedListing!.rightsAttestedAt;
        }
      }

      if (Object.keys(patch).length <= 1) {
        // Only updated_at — nothing to change. `strippedFields` still rides
        // along when a refusal is the reason there was nothing to change.
        return NextResponse.json({ success: true, project: { id }, ...strippedReport });
      }

      const { error: patchError } = await supabaseAdmin
        .from('folios')
        .update(patch)
        .eq('id', id)
        .eq('organization_id', writeOrgId);

      if (patchError) {
        console.error('[PUT /api/files] Lightweight update failed:', patchError.message);
        throw patchError;
      }

      projectMemoryCache.invalidate(id);
      // Response echoes the patch with the API's camelCase field names — the
      // DB row uses snake_case, and clients merge this project back into
      // their optimistic state (a snake_case echo would clobber isPrivate &
      // co. and flip toggles back off). A field that was refused is NOT echoed
      // as written: the response must not confirm a change that did not happen.
      const responseProject: Record<string, unknown> = { id };
      if (title !== undefined && mayWrite('title')) responseProject.title = title;
      if (description !== undefined && mayWrite('description')) responseProject.description = description;
      if (isPrivate !== undefined && mayWrite('isPrivate')) responseProject.isPrivate = isPrivate;
      if (accessKey !== undefined && mayWrite('accessKey')) responseProject.accessKey = accessKey;
      if (allowComments !== undefined && mayWrite('allowComments')) responseProject.allowComments = allowComments;
      if (presentationModeOnly !== undefined && mayWrite('presentationModeOnly')) responseProject.presentationModeOnly = presentationModeOnly;
      if (aiPersona !== undefined && mayWrite('aiPersona')) responseProject.aiPersona = aiPersona;
      if (projectMode !== undefined && mayWrite('projectMode')) responseProject.projectMode = projectMode;
      if (designPreferences !== undefined && mayWrite('designPreferences')) responseProject.designPreferences = designPreferences;
      if (reactions !== undefined && mayWrite('reactions')) responseProject.reactions = reactions;
      if (publicTunnelEnabled !== undefined && mayWrite('publicTunnelEnabled')) responseProject.publicTunnelEnabled = publicTunnelEnabled;
      if (status !== undefined && mayWrite('status')) responseProject.status = status;
      if (projectId !== undefined && mayWrite('projectId')) responseProject.projectId = projectId;
      if (folderId !== undefined && mayWrite('folderId')) responseProject.folderId = folderId;
      // CRITICAL: echo the gating fields with the API's camelCase names —
      // clients merge this echo into optimistic state, and omitting them
      // would drop the gate config from the UI's view after a patch.
      if (paidAccess !== undefined && mayWrite('paidAccess')) responseProject.paidAccess = sanitizedPaidAccess;
      if (thumbnailUrl !== undefined && mayWrite('thumbnailUrl')) responseProject.thumbnailUrl = thumbnailUrl;
      if (listing !== undefined && mayWrite('listing')) responseProject.listing = sanitizedListing;
      return NextResponse.json({ success: true, project: responseProject, ...strippedReport });
    }

    // 1. Fetch current project (full row — needed for version pushes).
    // Scoped by id alone: the caller's standing was resolved above, and the org
    // filter would refuse the collaborator this route now admits.
    const { data: current, error: fetchError } = await supabaseAdmin
      .from('folios')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    // Security: no global-lookup "self-healing" reassignment here. The row is
    // fetched by id because the caller's standing was already resolved — an
    // unreadable id is not a folio this request may touch.
    if (fetchError || !current) {
      throw new Error('Project not found');
    }

    const project = transformFolioRecord(current as FolioRecord);

    // 2. Apply modifications
    if (restoreVersionId) {
      const version = project.versions.find(v => v.versionId === restoreVersionId);
      if (version) {
        project.versions.push({
          versionId: nextVersionId(project.versions),
          commitMessage: `Restored to ${restoreVersionId}`,
          createdAt: new Date().toISOString(),
          author: email || 'System',
          files: version.files
        });
      }
    }

    // Every assignment below is guarded per FIELD (`mayWrite`): for an owner
    // nothing is blocked, so the round-trip is byte-identical; for an editor the
    // owner-only columns keep the values the SELECT above just read, which is
    // what makes "the same PUT carrying is_private leaves the column untouched"
    // true rather than merely likely.
    if (title !== undefined && mayWrite('title')) project.title = title;
    if (description !== undefined && mayWrite('description')) project.description = description;
    if (isPrivate !== undefined && mayWrite('isPrivate')) project.isPrivate = isPrivate;
    if (accessKey !== undefined && mayWrite('accessKey')) project.accessKey = accessKey;
    if (allowComments !== undefined && mayWrite('allowComments')) project.allowComments = allowComments;
    if (presentationModeOnly !== undefined && mayWrite('presentationModeOnly')) project.presentationModeOnly = presentationModeOnly;
    // The retired collaborator write + share-notification path used to sit
    // here (seam N-C): it diffed the payload's emails against the stored column
    // and emailed a /share/<id> link that granted nothing. Access is now a
    // granted-access record written by the invite API, and no payload key
    // can write that table.
    if (aiPersona !== undefined && mayWrite('aiPersona')) project.aiPersona = aiPersona;
    if (projectMode !== undefined && mayWrite('projectMode')) project.projectMode = projectMode;
    if (designPreferences !== undefined && mayWrite('designPreferences')) project.designPreferences = designPreferences;
    if (reactions !== undefined && mayWrite('reactions')) project.reactions = reactions;
    if (publicTunnelEnabled !== undefined && mayWrite('publicTunnelEnabled')) project.publicTunnelEnabled = publicTunnelEnabled;
    if (referenceFiles !== undefined && mayWrite('referenceFiles')) project.referenceFiles = referenceFiles;
    if (status !== undefined && mayWrite('status')) project.status = status;
    if (projectId !== undefined && mayWrite('projectId')) project.projectId = projectId || null;
    if (folderId !== undefined && mayWrite('folderId')) project.folderId = folderId || null;
    if (paidAccess !== undefined && mayWrite('paidAccess')) project.paidAccess = sanitizedPaidAccess;
    if (thumbnailUrl !== undefined && mayWrite('thumbnailUrl')) project.thumbnailUrl = thumbnailUrl;
    if (listing !== undefined && mayWrite('listing')) {
      // An explicit clear resets the listing metadata but NEVER the rights
      // affirmation (the evidence record survives unlisting).
      project.listing = listing === null
        ? preserveAttestation(defaultListing(), project.listing)
        : preserveAttestation(sanitizedListing, project.listing);
    }

    if (targetFiles && targetMessage) {
      // Offload base64 images to the asset store, keeping the JSONB column lean.
      // After processing, image values become "asset://" pointers (~60 bytes each
      // vs 500+ KB of base64). The actual binary lives in Supabase Storage.
      const { files: processed, storedBytes, assetCount } = await processUploadFiles(targetFiles, id, writeOrgId);
      if (assetCount > 0) {
        console.log(`[PUT /api/files] Stored ${assetCount} assets (${(storedBytes / 1024).toFixed(1)} KB) for folio ${id}`);
      }

      project.versions.push({
        versionId: nextVersionId(project.versions),
        commitMessage: targetMessage,
        createdAt: new Date().toISOString(),
        author: email || 'Authorized Guest',
        files: processed
      });
    }

    project.updatedAt = new Date().toISOString();

    // Free plan: retain only the last 25 versions / 30 days (pricing card).
    // The plan that applies is the FOLIO's org's, not the writer's.
    project.versions = await applyVersionRetention(project.versions, writeOrgId);

    // 3. Persist back to Supabase
    // `writeOrgId` — never the caller's org id: an editor collaborator's push
    // must not carry their own workspace onto the row (ownership reassignment),
    // and the update below is filtered by the same value for the same reason.
    const dbRecord = transformToFolioRecord(project, writeOrgId);
    // This log used to carry `JSON.stringify(dbRecord).length` — a full
    // serialization of the folio (many MB once assets are inlined) paid purely
    // to print a number, immediately followed by supabase-js serializing the
    // same object again to send it. Nothing branches on that value (log only),
    // and no cheaper expression reproduces the exact length, so the log now
    // carries the request-payload size already computed above (`bodySize` is
    // post-gzip for compressed saves, hence "request body" not "folio").
    console.log(`[PUT /api/files] Folio ${id}: ${project.versions.length} versions, ${(bodySize / 1024).toFixed(1)} KB request body`);

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('folios')
      .update(dbRecord)
      .eq('id', id)
      .eq('organization_id', writeOrgId)
      .select()
      .single();

    if (updateError) throw updateError;
    projectMemoryCache.invalidate(id);
    return NextResponse.json({ success: true, project: transformFolioRecord(updated as FolioRecord), ...strippedReport });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: error may be any thrown value; error?.message is read
  } catch (error: any) {
    console.error('PUT /api/files/[id] error:', error?.message || error);
    if (error?.message === 'Project not found') {
      return err('Project not found.', { status: 404 });
    }
    return err('Internal server error.', { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { userId } = await getAuthContext();

    if (isOSS) {
      // Clean up local asset files
      const { deleteFolioAssets: delOSS } = await import('@/lib/asset-store.oss');
      await delOSS(id, 'oss').catch(() => {});
      await runTransaction(async (db) => {
        const index = db.findIndex((p) => p.id === id);
        if (index === -1) throw new Error('Project not found');
        db.splice(index, 1);
      });
      return NextResponse.json({ success: true });
    }

    // Cloud Mode — THE CREATOR OR THE WORKSPACE OWNER, and nobody else
    // (seam 4, tightened 2026-09-26).
    // This is a deliberate privilege TIGHTENING, twice over. The route used to
    // contain no role check at all, and its org-scoped delete meant any
    // `Member` of the workspace — not just its owner — could delete any folio
    // in it (ARCHITECTURE.html §1). The first pass then asked
    // `can(role, 'delete')`, which did not help: `owner` means "an org member"
    // here, so an Admin and a Member still held it. `gateFolio` now asks
    // `canDeleteFolio` for this capability — the folio's creator, or the
    // workspace's Owner — so an org Member who did not create the folio is
    // refused, an editor collaborator is refused, and a caller with no standing
    // is refused with a 404 that does not confirm the folio exists.
    if (!userId) return err('Unauthorized', { status: 401 });

    const gate = await gateFolio(userId, id, 'delete', {
      forbidden: 'Only the folio creator or the workspace owner can delete this folio.',
    });
    if (!gate.ok) return gate.response;

    // The org comes from the resolved folio, not from the caller's headers: the
    // asset sweep and the delete are scoped to the org that owns the row.
    const orgScope = gate.access.folio.organization_id ?? '';

    // Delete Storage assets before the DB row (which cascades to folio_assets)
    await deleteFolioAssets(id, orgScope).catch((e) => console.error('[DELETE] Asset cleanup failed:', e.message));

    const { error } = await supabaseAdmin
      .from('folios')
      .delete()
      .eq('id', id)
      .eq('organization_id', orgScope);

    if (error) throw error;
    projectMemoryCache.invalidate(id);
    return NextResponse.json({ success: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: error may be any thrown value; only logged
  } catch (error: any) {
    console.error('DELETE /api/files/[id] error:', error);
    return err('Internal server error.', { status: 500 });
  }
}
