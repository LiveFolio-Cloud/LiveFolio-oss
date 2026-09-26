import { NextResponse } from 'next/server';
import { readDB, runTransaction, HTMLFile } from '@/lib/db';
import { isOSS, isCloud } from '@/lib/env';
import { supabaseAdmin, transformFolioRecord, transformToFolioRecord, FolioRecord } from '@/lib/supabase';
import { getAuthContext } from '@/lib/auth';
import { assertStorageQuota } from '@/ee/middleware/usageCapping';
import { processUploadFiles } from '@/lib/process-upload';
import { sanitizePaidAccess } from '@/lib/gating/config';
import type { PaidAccessConfig } from '@/lib/gating/types';
import { sanitizeListing, listingWriteGuard, listingWriteGuardResponse } from '@/lib/listing/config';
import type { ListingMetadata } from '@/lib/listing/types';
import { slugifyFolioTitle } from '@/lib/folio-slug';
import { err } from '@/lib/api/respond';
import { listGrantedFolios, type GrantRole } from './_lib/role-gate';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const { orgId, userId } = await getAuthContext();
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('project_id');

    if (isOSS) {
      const db = await readDB();
      // Pre-compute storage bytes per project so the client doesn't
      // need to iterate all file contents just for the storage bar.
      let enriched = db.map((project) => {
        let storageBytes = 0;
        for (const version of project.versions) {
          for (const content of Object.values(version.files)) {
            if (typeof content === 'string') storageBytes += Buffer.byteLength(content, 'utf8');
          }
        }
        for (const ref of project.referenceFiles || []) {
          storageBytes += ref.size || (ref.content ? Buffer.byteLength(ref.content, 'utf8') : 0);
        }
        return { ...project, _storageBytes: storageBytes };
      });
      // Client-side filter by project_id
      if (projectId === 'unfiled') {
        enriched = enriched.filter((p) => !p.projectId);
      } else if (projectId) {
        enriched = enriched.filter((p) => p.projectId === projectId);
      }
      return NextResponse.json(enriched, {
        headers: { 'Cache-Control': 'public, max-age=5, stale-while-revalidate=60' },
      });
    }

    // Cloud Mode — the caller's own org, UNIONED with folios granted to them
    // personally (ARCHITECTURE.html §5 seam 1).
    if (!supabaseAdmin) {
      return NextResponse.json({
        error: 'Supabase client is not initialized.',
        message: 'Please make sure that NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in your local .env file when running in cloud/SaaS mode.'
      }, { status: 500 });
    }

    // Identity, not org membership, is what this route needs: a collaborator
    // may hold a grant while belonging to no organization at all, and an org
    // member always has both. (The previous guard was `!orgId`, which refused
    // the very caller the grant exists for.)
    if (!userId) return err('Unauthorized', { status: 401 });

    // The caller's live grants, read once (`active`, unexpired — a pending or
    // revoked row is deliberately not access). Cheap: one indexed partial-index
    // read keyed on user_id, and the join to the folios themselves is the
    // `.in()` query below rather than a fetch-everything-and-filter in JS.
    const grants = await listGrantedFolios(userId);
    const grantedRoleById = new Map<string, GrantRole>(
      grants.map((entry) => [entry.folio_id, entry.role])
    );

    // Org folios. The query is scoped to the org the caller ACTUALLY belongs
    // to — `orgId` is re-derived from the memberships table by
    // `getAuthContext`, never trusted raw from the header.
    let orgRows: FolioRecord[] = [];
    if (orgId) {
      const { data: initialData, error } = await supabaseAdmin
        .from('folios_metadata')
        .select('*')
        .eq('organization_id', orgId)
        .order('updated_at', { ascending: false });
      orgRows = (initialData as FolioRecord[]) || [];

      if (error) throw error;

      // Self-healing: if metadata view is empty, check for orphaned folios
      // that belong to this org directly in the folios table (not the view).
      // IMPORTANT: Only reassign folios with a genuinely invalid org_id
      // (NULL or non-existent org), NOT folios that simply belong to another
      // valid organization. The previous logic was reassigning other orgs'
      // folios on every empty-workspace load.
      if (orgRows.length === 0) {
        const { data: rawFolios, error: rawErr } = await supabaseAdmin
          .from('folios')
          .select('id, organization_id')
          .eq('organization_id', orgId)
          .order('updated_at', { ascending: false })
          .limit(50);

        if (!rawErr && rawFolios && rawFolios.length > 0) {
          // Folios exist for this org but the metadata view didn't pick them up.
          // Just use the raw query results — no reassignment needed.
          const { data: refreshed, error: refreshErr } = await supabaseAdmin
            .from('folios')
            .select('*')
            .eq('organization_id', orgId)
            .order('updated_at', { ascending: false });
          if (!refreshErr && refreshed) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped Supabase folio rows (select *)
            orgRows = refreshed.map((f: any) => ({
              ...f,
              updated_at: f.updated_at || f.updatedAt,
              created_at: f.created_at || f.createdAt,
            }));
          }
          console.log(`[Self-Heal List] Found ${rawFolios.length} folios for org ${orgId} not in metadata view`);
        }
      }
    }

    // Granted folios the org read did not already cover. The metadata view is
    // asked for exactly the granted ids: it carries no grant columns of its own
    // (ARCHITECTURE.html §5), so the union is built here from the id set.
    let grantedRows: FolioRecord[] = [];
    if (grantedRoleById.size > 0) {
      const { data: grantedData, error: grantedErr } = await supabaseAdmin
        .from('folios_metadata')
        .select('*')
        .in('id', Array.from(grantedRoleById.keys()));

      if (grantedErr) throw grantedErr;
      grantedRows = (grantedData as FolioRecord[]) || [];
    }

    // De-duplicate on `id`, and let the ORG row win — invariant 1: a member
    // who also holds a grant must not be demoted to the grant's role, and must
    // appear exactly once. Everything else about an org row is unchanged.
    const orgIds = new Set(orgRows.map((row) => row.id));
    const rows = [
      ...orgRows.map((row) => ({ row, accessRole: 'owner' as const })),
      ...grantedRows
        .filter((row) => !orgIds.has(row.id))
        .map((row) => ({
          row,
          // Present by construction: the id set came from `grantedRoleById`.
          accessRole: grantedRoleById.get(row.id) as GrantRole,
        })),
    ];

    const payload = rows.map(({ row, accessRole }) => ({
      ...transformFolioRecord(row),
      // The caller's effective role for THIS row: `owner` (org membership) or
      // the grant's role. The sidebar files a row under "Shared with me" when this
      // is one of the three grant roles, and leaves anything else — including a
      // payload without the field, e.g. from an older client or OSS — in the
      // org list.
      accessRole,
      // Invariant 5: the retired email array is an owner-side record. It rides
      // in the view's row, so a granted reader would otherwise be handed the
      // addresses of everyone else on the folio. Owners keep today's payload.
      ...(accessRole === 'owner' ? {} : { collaborators: [] as string[] }),
    }));

    // The org query is ordered by `updated_at` desc; the union has to re-apply
    // that order or granted rows would all sink to the bottom of the sidebar.
    // ISO-8601 strings compare lexicographically, which is the same total order.
    payload.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));

    return NextResponse.json(payload);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: err may be any thrown value; err.message is read
  } catch (error: any) {
    return err(error.message || 'Failed to list projects.', { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { orgId, email, userId } = await getAuthContext();
    const body = await request.json();
    const {
      title,
      description,
      isPrivate,
      defaultFiles,
      initial_html,
      accessKey,
      allowComments = true,
      presentationModeOnly = false,
      paidAccess,
      thumbnailUrl,
      listing,
    } = body;

    // Validate title before any work — missing/empty → 400
    if (!title || !title.trim()) {
      return err('Title is required', { status: 400 });
    }

    // Paid access: validate at write time via the single shared sanitizer.
    // Invalid configs fail loudly (400) instead of silently changing the
    // price. OSS stores the value too but never enforces it.
    let sanitizedPaidAccess: PaidAccessConfig | null = null;
    if (paidAccess !== undefined && paidAccess !== null) {
      sanitizedPaidAccess = sanitizePaidAccess(paidAccess);
      if (!sanitizedPaidAccess) {
        return err('INVALID_PAID_ACCESS', { status: 400 });
      }
    }

    // Marketplace listing metadata (optional) — strict validation like paidAccess.
    let sanitizedListing: ListingMetadata | null = null;
    if (listing !== undefined && listing !== null) {
      sanitizedListing = sanitizeListing(listing);
      if (!sanitizedListing) {
        return err('INVALID_LISTING', { status: 400 });
      }
      if (isCloud && sanitizedListing.listed) {
        // Creation-time listings must carry the per-folio rights affirmation;
        // account standing is checked against the org owner below/at insert.
        const guardCode = await listingWriteGuard({
          orgId,
          listed: true,
          rightsAttestedAt: sanitizedListing.rightsAttestedAt,
          existingAttested: false,
        });
        const guardResponse = listingWriteGuardResponse(guardCode);
        if (guardResponse) return guardResponse;
      }
    }

    // Generate a real UUID in both modes. OSS previously used a 7-char
    // Math.random id — guessable/enumerable, which exposed private folios
    // whose access depended on id secrecy. UUIDs are not enumerable.
    const cleanId = crypto.randomUUID();

    // Support MCP-style initial_html
    const rawFiles: Record<string, string> = defaultFiles || (initial_html ? { 'index.html': initial_html } : {});

    // Storage quota enforcement — block creation when over limit
    if (!isOSS && userId && orgId) {
      // Estimate new folio size from the initial files + reference files
      let estimatedBytes = 0;
      for (const content of Object.values(rawFiles)) {
        if (typeof content === 'string') estimatedBytes += Buffer.byteLength(content, 'utf8');
      }
      for (const ref of body.referenceFiles || []) {
        estimatedBytes += ref.size || (ref.content ? Buffer.byteLength(ref.content, 'utf8') : 0);
      }
      const { allowed } = await assertStorageQuota(userId, estimatedBytes, orgId);
      if (!allowed) {
        return NextResponse.json(
          { error: 'STORAGE_EXCEEDED', message: 'You have exceeded your storage limit. Upgrade your plan to continue creating folios.' },
          { status: 402 }
        );
      }
    }

    // Auto-generate URL-safe slug from title
    const generateSlug = (t: string) => {
      return slugifyFolioTitle(t);
    };
    const baseSlug = generateSlug(title);

    const newProject: HTMLFile = {
      id: cleanId,
      title: title.trim(),
      slug: baseSlug,
      description: description?.trim() || 'Custom HTML Multipages',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isPrivate: isOSS ? false : !!isPrivate,
      accessKey: accessKey || undefined,
      allowComments: !!allowComments,
      presentationModeOnly: !!presentationModeOnly,
      // Retired write path (ARCHITECTURE.html §5 seam N-C). A creation payload
      // may still carry `collaborators` — the old share UI sends it — and it is
      // ignored on purpose: access comes from the granted-access records, which
      // only the invite API writes (`canWriteField` refuses the column to every
      // role, owner included). The dead JSONB column is left empty, never
      // populated with emails that grant nothing.
      collaborators: [],
      comments: [],
      status: body.status || 'draft',
      projectMode: body.projectMode || 'deck',
      designPreferences: body.designPreferences,
      referenceFiles: body.referenceFiles || [],
      paidAccess: paidAccess !== undefined && paidAccess !== null ? sanitizedPaidAccess : undefined,
      thumbnailUrl: typeof thumbnailUrl === 'string' ? thumbnailUrl : undefined,
      listing: sanitizedListing ?? undefined,
      versions: [
        {
          versionId: "v1",
          commitMessage: "Genesis Initial Draft Commit",
          createdAt: new Date().toISOString(),
          author: email || "Workspace Founder",
          files: rawFiles
        }
      ]
    };

    if (isOSS) {
      await runTransaction(async (db) => {
        db.push(newProject);
      });
      return NextResponse.json({ success: true, project: newProject });
    }

    // Cloud Mode
    if (!supabaseAdmin) {
      return NextResponse.json({ 
        error: 'Supabase client is not initialized.',
        message: 'Please make sure that NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in your local .env file when running in cloud/SaaS mode.'
      }, { status: 500 });
    }

    if (!orgId) return err('Unauthorized', { status: 401 });

    const dbRecord = transformToFolioRecord(newProject, orgId);
    // Use the UUID we already generated (needed for asset store paths)

    // Attribute folio to the creating user for per-user storage accounting
    if (userId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- created_by column is not part of Partial<FolioRecord> but is set server-side for usage attribution
      (dbRecord as any).created_by = userId;
    }

    const { data, error } = await supabaseAdmin
      .from('folios')
      .insert(dbRecord)
      .select()
      .single();

    if (error) throw error;

    // Offload base64 images to the asset store now that the folio row exists
    // (folio_assets FK constraint is satisfied).
    if (Object.keys(rawFiles).length > 0) {
      const { files: processed, storedBytes, assetCount } = await processUploadFiles(rawFiles, cleanId, orgId || 'oss');
      if (assetCount > 0) {
        console.log(`[POST /api/files] Stored ${assetCount} assets (${(storedBytes / 1024).toFixed(1)} KB) for new folio`);
        // Update v1 files with asset:// pointers
        const { error: updateErr } = await supabaseAdmin
          .from('folios')
          .update({ versions: [{ versionId: 'v1', commitMessage: 'Genesis Initial Draft Commit', createdAt: newProject.createdAt, author: newProject.versions[0].author, files: processed }] })
          .eq('id', cleanId);
        if (updateErr) console.error('[POST /api/files] Pointer update failed:', updateErr);
      }
      // Re-read to get updated version
      const { data: updated } = await supabaseAdmin.from('folios').select('*').eq('id', cleanId).single();
      if (updated) return NextResponse.json({ success: true, project: transformFolioRecord(updated) });
    }

    return NextResponse.json({ success: true, project: transformFolioRecord(data) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: err may be any thrown value; err.message is read
  } catch (error: any) {
    return err(error.message || 'Failed to create project.', { status: 500 });
  }
}
