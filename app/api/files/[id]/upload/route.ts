import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth';
import { isOSS } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase';
import { runTransaction } from '@/lib/db';
import { assertStorageQuota } from '@/ee/middleware/usageCapping';

export const dynamic = 'force-dynamic';

const MIME_MAP: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon',
  svg: 'image/svg+xml', bmp: 'image/bmp',
};

const MAX_FILE_BYTES = 25 * 1024 * 1024;          // single file cap
const MAX_BATCH_TOTAL_BYTES = 40 * 1024 * 1024;   // total batch cap (raw body)

function bytesToDataUrl(buf: Buffer, ext: string): string {
  const mime = MIME_MAP[ext] || 'application/octet-stream';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function isUnsafeFolioId(id: string): boolean {
  return !id || id.includes('/') || id.includes('\\') || id.startsWith('.');
}

/** Single file upload via raw binary body + x-file-path header. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (isUnsafeFolioId(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const filePath = request.headers.get('x-file-path');
    if (!filePath) return NextResponse.json({ error: 'Missing x-file-path header' }, { status: 400 });

    const buf = Buffer.from(await request.arrayBuffer());
    if (buf.length > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'FILE_TOO_LARGE' }, { status: 413 });
    }

    const ext = filePath.split('.').pop()?.toLowerCase() || 'png';
    const dataUrl = bytesToDataUrl(buf, ext);
    console.log(`[upload] ${id}/${filePath} ${(buf.length / 1024).toFixed(1)} KB`);

    return persistFile(id, filePath, dataUrl);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: err may be any thrown value; only err?.message is read
  } catch (err: any) {
    console.error(`POST /api/files/[id]/upload error:`, err?.message || err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Batch upload: JSON body { files: { "path": "data:image/...;base64,...", ... } }.
 * All images land in ONE update — no cumulative row bloat, no 19x timeouts.
 * Body is base64 strings (not raw binary), typically 8 MB for 19 images — under
 * the 10 MB Next.js body buffer limit.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (isUnsafeFolioId(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = await request.json();
    const files: Record<string, string> = body.files || {};
    const entries = Object.entries(files);
    if (entries.length === 0) return NextResponse.json({ error: 'No files' }, { status: 400 });

    // Total size cap — prevents memory exhaustion / DB bloat.
    let totalBytes = 0;
    for (const [, dataUrl] of entries) {
      if (typeof dataUrl !== 'string') return NextResponse.json({ error: 'Invalid file payload' }, { status: 400 });
      totalBytes += Buffer.byteLength(dataUrl, 'utf8');
    }
    if (totalBytes > MAX_BATCH_TOTAL_BYTES) {
      return NextResponse.json({ error: 'BATCH_TOO_LARGE' }, { status: 413 });
    }
    console.log(`[upload-batch] ${id}: ${entries.length} files`);

    if (isOSS) {
      await runTransaction(async (db) => {
        const idx = db.findIndex((p) => p.id === id);
        if (idx === -1) throw new Error('Project not found');
        const v = db[idx].versions[db[idx].versions.length - 1];
        for (const [path, dataUrl] of entries) v.files[path] = dataUrl;
        db[idx].updatedAt = new Date().toISOString();
      });
      return NextResponse.json({ success: true, count: entries.length });
    }

    const { orgId, userId } = await getAuthContext();
    if (!supabaseAdmin) throw new Error('Supabase not initialized');
    const folioOrgId = orgId || '';

    // Enforce storage quota
    if (userId && orgId) {
      const { allowed } = await assertStorageQuota(userId, totalBytes, orgId);
      if (!allowed) {
        return NextResponse.json(
          { error: 'STORAGE_EXCEEDED', message: 'You have exceeded your storage limit. Upgrade your plan to continue.' },
          { status: 402 }
        );
      }
    }

    const { error: updateError } = await supabaseAdmin.rpc('set_folio_files_batch', {
      p_folio_id: id, p_org_id: folioOrgId, p_files: files,
    });
    if (updateError) throw updateError;

    console.log(`[upload-batch] ${id}: ${entries.length} files saved`);
    return NextResponse.json({ success: true, count: entries.length });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: err may be any thrown value; only err?.message is read
  } catch (err: any) {
    console.error(`PATCH /api/files/[id]/upload error:`, err?.message || err);
    if (err?.message === 'Project not found') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function persistFile(id: string, filePath: string, dataUrl: string) {
  if (isOSS) {
    await runTransaction(async (db) => {
      const idx = db.findIndex((p) => p.id === id);
      if (idx === -1) throw new Error('Project not found');
      db[idx].versions[db[idx].versions.length - 1].files[filePath] = dataUrl;
      db[idx].updatedAt = new Date().toISOString();
    });
    return NextResponse.json({ success: true, path: filePath });
  }

  const { orgId, userId } = await getAuthContext();
  if (!supabaseAdmin) throw new Error('Supabase not initialized');
  const folioOrgId = orgId || '';

  // Enforce storage quota
  if (userId && orgId) {
    const { allowed } = await assertStorageQuota(userId, Buffer.byteLength(dataUrl, 'utf8'), orgId);
    if (!allowed) {
      return NextResponse.json(
        { error: 'STORAGE_EXCEEDED', message: 'You have exceeded your storage limit. Upgrade your plan to continue.' },
        { status: 402 }
      );
    }
  }

  const { error: updateError } = await supabaseAdmin.rpc('set_folio_file', {
    p_folio_id: id, p_org_id: folioOrgId, p_file_path: filePath, p_data_url: dataUrl,
  });
  if (updateError) throw updateError;
  return NextResponse.json({ success: true, path: filePath });
}
