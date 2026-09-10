import { NextResponse } from 'next/server';
import { readDB, runTransaction, HTMLFile } from '@/lib/db';
import { isOSS, isCloud } from '@/lib/env';
import { supabaseAdmin, transformFolioRecord, transformToFolioRecord, FolioRecord } from '@/lib/supabase';
import { getAuthContext } from '@/lib/auth';
import { assertStorageQuota } from '@/ee/middleware/usageCapping';
import { processUploadFiles } from '@/lib/process-upload';
import { sanitizePaidAccess } from '@/lib/gating/config';
import type { PaidAccessConfig } from '@/lib/gating/types';
import { sanitizeListing, listingWriteGuard } from '@/lib/listing/config';
import type { ListingMetadata } from '@/lib/listing/types';
import { slugifyFolioTitle } from '@/lib/folio-slug';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const { orgId } = await getAuthContext();
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

    // Cloud Mode - Scoped to Org
    if (!supabaseAdmin) {
      return NextResponse.json({ 
        error: 'Supabase client is not initialized.',
        message: 'Please make sure that NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in your local .env file when running in cloud/SaaS mode.'
      }, { status: 500 });
    }

    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: initialData, error } = await supabaseAdmin
      .from('folios_metadata')
      .select('*')
      .eq('organization_id', orgId)
      .order('updated_at', { ascending: false });
    let data = initialData;

    if (error) throw error;

    // Self-healing: if metadata view is empty, check for orphaned folios
    // that belong to this org directly in the folios table (not the view).
    // IMPORTANT: Only reassign folios with a genuinely invalid org_id
    // (NULL or non-existent org), NOT folios that simply belong to another
    // valid organization. The previous logic was reassigning other orgs'
    // folios on every empty-workspace load.
    if (!data || data.length === 0) {
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
          data = refreshed.map((f: any) => ({
            ...f,
            updated_at: f.updated_at || f.updatedAt,
            created_at: f.created_at || f.createdAt,
          }));
        }
        console.log(`[Self-Heal List] Found ${rawFolios.length} folios for org ${orgId} not in metadata view`);
      }
    }

    return NextResponse.json((data as FolioRecord[]).map(transformFolioRecord));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: err may be any thrown value; err.message is read
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to list projects.' }, { status: 500 });
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
      collaborators,
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
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    // Paid access: validate at write time via the single shared sanitizer.
    // Invalid configs fail loudly (400) instead of silently changing the
    // price. OSS stores the value too but never enforces it.
    let sanitizedPaidAccess: PaidAccessConfig | null = null;
    if (paidAccess !== undefined && paidAccess !== null) {
      sanitizedPaidAccess = sanitizePaidAccess(paidAccess);
      if (!sanitizedPaidAccess) {
        return NextResponse.json({ error: 'INVALID_PAID_ACCESS' }, { status: 400 });
      }
    }

    // Marketplace listing metadata (optional) — strict validation like paidAccess.
    let sanitizedListing: ListingMetadata | null = null;
    if (listing !== undefined && listing !== null) {
      sanitizedListing = sanitizeListing(listing);
      if (!sanitizedListing) {
        return NextResponse.json({ error: 'INVALID_LISTING' }, { status: 400 });
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
        if (guardCode === 'LISTING_NEEDS_SELLER_AGREEMENT' || guardCode === 'LISTING_SELLER_SUSPENDED') {
          return NextResponse.json({ error: guardCode }, { status: 403 });
        }
        if (guardCode === 'LISTING_NEEDS_RIGHTS_ATTESTATION') {
          return NextResponse.json({ error: guardCode }, { status: 400 });
        }
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
      collaborators: isOSS ? [] : (collaborators || []),
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

    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to create project.' }, { status: 500 });
  }
}
