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
    const { orgId } = await getAuthContext();

    if (isOSS) {
      const db = await readDB();
      const project = db.find((p) => p.id === id);
      if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
      return NextResponse.json(project);
    }

    // Cloud Mode
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Owner handle rides along so studio menus can build the canonical
    // @username/slug link INSTANTLY (identity is cached in-process — this
    // is not a per-open cost).
    const withOwner = async (project: HTMLFile) => {
      const identity = await getOwnerIdentity(orgId);
      return NextResponse.json({ ...project, ownerUsername: identity.username ?? null });
    };

    const cachedProject = projectMemoryCache.get(id);
    if (cachedProject && cachedProject.organization_id === orgId) {
      return withOwner(cachedProject);
    }

    const { data, error } = await supabaseAdmin
      .from('folios')
      .select('*')
      .eq('id', id)
      .eq('organization_id', orgId)
      .single();

    if (error || !data) {
      // Security: no global-lookup "self-healing" reassignment here.
      // A folio that is not found under the caller's org is simply not
      // visible to them — returning 404 prevents cross-tenant theft.
      return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    }
    const project = transformFolioRecord(data as FolioRecord);
    projectMemoryCache.set(id, project);

    return withOwner(project);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: err may be any thrown value; only logged
  } catch (err: any) {
    console.error('GET /api/files/[id] error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
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
      return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
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
        const { gunzipSync } = await import('zlib');
        const compressed = Buffer.from(body._d, 'base64');
        // Cap decompressed output — a small gzip bomb must not exhaust memory.
        const decompressed = gunzipSync(compressed, { maxOutputLength: 64 * 1024 * 1024 }).toString('utf8');
        body = JSON.parse(decompressed);
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
      collaborators, 
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

    // Resolve effective files and message
    const targetFiles = updated_files || files;
    const targetMessage = change_message || commitMessage;

    // Paid access: validate at write time via the single shared sanitizer.
    // Invalid configs fail loudly (400). Explicit `null` clears the gate
    // (back to "inherit workspace"); omitted leaves it untouched.
    let sanitizedPaidAccess: PaidAccessConfig | null | undefined;
    if (paidAccess !== undefined && paidAccess !== null) {
      sanitizedPaidAccess = sanitizePaidAccess(paidAccess);
      if (!sanitizedPaidAccess) {
        return NextResponse.json({ error: 'INVALID_PAID_ACCESS' }, { status: 400 });
      }
    } else if (paidAccess === null) {
      sanitizedPaidAccess = null; // explicit clear
    } else {
      sanitizedPaidAccess = undefined; // not provided
    }

    // Marketplace listing metadata: validate at write time via the single
    // shared sanitizer (same posture as paidAccess — fail loudly, 400).
    let sanitizedListing: ListingMetadata | null | undefined;
    if (listing !== undefined && listing !== null) {
      sanitizedListing = sanitizeListing(listing);
      if (!sanitizedListing) {
        return NextResponse.json({ error: 'INVALID_LISTING' }, { status: 400 });
      }
    } else if (listing === null) {
      sanitizedListing = null; // explicit clear (unlists)
    } else {
      sanitizedListing = undefined; // not provided
    }

    // Listing guard — turning a folio INTO a listing requires the org owner's
    // Seller-Terms acceptance + the per-listing rights affirmation. Server
    // errors are machine-readable so clients can route to the attestation UI.
    if (isCloud && sanitizedListing?.listed) {
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
        return NextResponse.json({ error: guardCode }, { status: 403 });
      }
      if (guardCode === 'LISTING_NEEDS_RIGHTS_ATTESTATION') {
        return NextResponse.json({ error: guardCode }, { status: 400 });
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
        if (collaborators !== undefined) {
          const prevOSS: string[] = project.collaborators || [];
          const newOSS = (collaborators as string[]).filter((c: string) => !prevOSS.includes(c));
          project.collaborators = collaborators;
          // OSS mode: share notifications only fire locally (console sandbox)
          if (newOSS.length > 0) {
            import('@/lib/email').then(({ sendShareNotification }) => {
              const shareUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/share/${id}`;
              for (const newEmail of newOSS) {
                sendShareNotification({
                  to: newEmail, folioTitle: project.title || 'Untitled Folio',
                  sharedByName: email || 'A teammate', folioUrl: shareUrl,
                }).catch(err => console.error('[Share Notification OSS] Failed:', err));
              }
            });
          }
        }
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

    // Cloud Mode
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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
      && collaborators === undefined && referenceFiles === undefined;
    if (isLightweightUpdate) {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (title !== undefined) patch.title = title;
      if (description !== undefined) patch.description = description;
      if (isPrivate !== undefined) patch.is_private = isPrivate;
      if (accessKey !== undefined) patch.access_key = accessKey;
      if (allowComments !== undefined) patch.allow_comments = allowComments;
      if (presentationModeOnly !== undefined) patch.presentation_mode_only = presentationModeOnly;
      if (aiPersona !== undefined) patch.ai_persona = aiPersona;
      if (projectMode !== undefined) patch.project_mode = projectMode;
      if (designPreferences !== undefined) patch.design_preferences = designPreferences;
      if (reactions !== undefined) patch.reactions = reactions;
      if (publicTunnelEnabled !== undefined) patch.public_tunnel_enabled = publicTunnelEnabled;
      if (status !== undefined) patch.status = status;
      if (projectId !== undefined) patch.project_id = projectId || null;
      if (folderId !== undefined) patch.folder_id = folderId || null;
      if (paidAccess !== undefined) patch.paid_access = sanitizedPaidAccess;
      if (thumbnailUrl !== undefined) patch.thumbnail_url = thumbnailUrl;
      if (listing !== undefined) {
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
        // Only updated_at — nothing to change
        return NextResponse.json({ success: true, project: { id } });
      }

      const { error: patchError } = await supabaseAdmin
        .from('folios')
        .update(patch)
        .eq('id', id)
        .eq('organization_id', orgId);

      if (patchError) {
        console.error('[PUT /api/files] Lightweight update failed:', patchError.message);
        throw patchError;
      }

      projectMemoryCache.invalidate(id);
      // Response echoes the patch with the API's camelCase field names — the
      // DB row uses snake_case, and clients merge this project back into
      // their optimistic state (a snake_case echo would clobber isPrivate &
      // co. and flip toggles back off).
      const responseProject: Record<string, unknown> = { id };
      if (title !== undefined) responseProject.title = title;
      if (description !== undefined) responseProject.description = description;
      if (isPrivate !== undefined) responseProject.isPrivate = isPrivate;
      if (accessKey !== undefined) responseProject.accessKey = accessKey;
      if (allowComments !== undefined) responseProject.allowComments = allowComments;
      if (presentationModeOnly !== undefined) responseProject.presentationModeOnly = presentationModeOnly;
      if (aiPersona !== undefined) responseProject.aiPersona = aiPersona;
      if (projectMode !== undefined) responseProject.projectMode = projectMode;
      if (designPreferences !== undefined) responseProject.designPreferences = designPreferences;
      if (reactions !== undefined) responseProject.reactions = reactions;
      if (publicTunnelEnabled !== undefined) responseProject.publicTunnelEnabled = publicTunnelEnabled;
      if (status !== undefined) responseProject.status = status;
      if (projectId !== undefined) responseProject.projectId = projectId;
      if (folderId !== undefined) responseProject.folderId = folderId;
      // CRITICAL: echo the gating fields with the API's camelCase names —
      // clients merge this echo into optimistic state, and omitting them
      // would drop the gate config from the UI's view after a patch.
      if (paidAccess !== undefined) responseProject.paidAccess = sanitizedPaidAccess;
      if (thumbnailUrl !== undefined) responseProject.thumbnailUrl = thumbnailUrl;
      if (listing !== undefined) responseProject.listing = sanitizedListing;
      return NextResponse.json({ success: true, project: responseProject });
    }

    // 1. Fetch current project (full row — needed for version pushes)
    const { data: current, error: fetchError } = await supabaseAdmin
      .from('folios')
      .select('*')
      .eq('id', id)
      .eq('organization_id', orgId)
      .single();

    // Security: no global-lookup "self-healing" reassignment here. A folio
    // that is not found under the caller's org is not theirs to modify.
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

    if (title !== undefined) project.title = title;
    if (description !== undefined) project.description = description;
    if (isPrivate !== undefined) project.isPrivate = isPrivate;
    if (accessKey !== undefined) project.accessKey = accessKey;
    if (allowComments !== undefined) project.allowComments = allowComments;
    if (presentationModeOnly !== undefined) project.presentationModeOnly = presentationModeOnly;
    if (collaborators !== undefined) {
      const prevCollaborators: string[] = project.collaborators || [];
      const newCollaborators = (collaborators as string[]).filter(
        (c: string) => !prevCollaborators.includes(c)
      );
      project.collaborators = collaborators;
      if (newCollaborators.length > 0) {
        const { sendShareNotification } = await import('@/lib/email');
        const shareUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://livefolio.cloud'}/share/${id}`;
        for (const newEmail of newCollaborators) {
          sendShareNotification({
            to: newEmail, folioTitle: project.title || 'Untitled Folio',
            sharedByName: email || 'A teammate', folioUrl: shareUrl,
          }).catch(err => console.error('[Share Notification] Failed:', err));
        }
      }
    }
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
    if (listing !== undefined) {
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
      const { files: processed, storedBytes, assetCount } = await processUploadFiles(targetFiles, id, orgId);
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

    // Free plan: retain only the last 25 versions / 30 days (pricing card)
    project.versions = await applyVersionRetention(project.versions, orgId);

    // 3. Persist back to Supabase
    const dbRecord = transformToFolioRecord(project, orgId);
    const folioSize = JSON.stringify(dbRecord).length;
    console.log(`[PUT /api/files] Folio ${id}: ${project.versions.length} versions, ${(folioSize / 1024).toFixed(1)} KB total`);

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('folios')
      .update(dbRecord)
      .eq('id', id)
      .eq('organization_id', orgId)
      .select()
      .single();

    if (updateError) throw updateError;
    projectMemoryCache.invalidate(id);
    return NextResponse.json({ success: true, project: transformFolioRecord(updated as FolioRecord) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: err may be any thrown value; err?.message is read
  } catch (err: any) {
    console.error('PUT /api/files/[id] error:', err?.message || err);
    if (err?.message === 'Project not found') {
      return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { orgId } = await getAuthContext();

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

    // Cloud Mode
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Delete Storage assets before the DB row (which cascades to folio_assets)
    await deleteFolioAssets(id, orgId).catch((e) => console.error('[DELETE] Asset cleanup failed:', e.message));

    const { error } = await supabaseAdmin
      .from('folios')
      .delete()
      .eq('id', id)
      .eq('organization_id', orgId);

    if (error) throw error;
    projectMemoryCache.invalidate(id);
    return NextResponse.json({ success: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: err may be any thrown value; only logged
  } catch (err: any) {
    console.error('DELETE /api/files/[id] error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
