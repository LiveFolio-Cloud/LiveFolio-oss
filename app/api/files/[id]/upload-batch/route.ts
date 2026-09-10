import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth';
import { isOSS } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase';
import { readDB, writeDB } from '@/lib/db';
import { processUploadFiles } from '@/lib/process-upload';

export const dynamic = 'force-dynamic';

/**
 * Accept multipart/form-data with multiple image files. Each part is a raw
 * binary image. The part's filename is used as the folio file path.
 *
 * Bypasses ALL body size limits: multipart/form-data is streamed, not buffered
 * by Next.js's proxyClientMaxBodySize. Raw binary avoids the 33% base64 tax.
 *
 * All images land in one DB transaction — no cumulative row bloat, no timeouts.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const formData = await request.formData();
    const imageEntries: [string, string][] = []; // [path, dataUrl]

    const entries = formData.entries();
    let entry = entries.next();
    while (!entry.done) {
      const value = entry.value[1];
      entry = entries.next();
      if (!(value instanceof File)) continue;
      const path = value.name;
      const buf = Buffer.from(await value.arrayBuffer());
      const ext = path.split('.').pop()?.toLowerCase() || 'png';
      const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon', svg: 'image/svg+xml', bmp: 'image/bmp' };
      const mime = mimeMap[ext] || 'application/octet-stream';
      imageEntries.push([path, `data:${mime};base64,${buf.toString('base64')}`]);
    }

    if (imageEntries.length === 0) {
      return NextResponse.json({ error: 'No image files in form data' }, { status: 400 });
    }

    console.log(`[upload-batch] ${id}: ${imageEntries.length} files`);

    // Convert data URLs to asset:// pointers via the unified pipeline
    const filesObj: Record<string, string> = {};
    for (const [path, dataUrl] of imageEntries) filesObj[path] = dataUrl;

    // Get orgId early so the asset store can use it for storage paths
    let orgId = 'oss';
    if (!isOSS) {
      const auth = await getAuthContext();
      orgId = auth.orgId || '';
    }

    const { files: processed, storedBytes, assetCount } = await processUploadFiles(filesObj, id, orgId);
    if (assetCount > 0) {
      console.log(`[upload-batch] ${id}: ${assetCount} assets stored (${(storedBytes / 1024).toFixed(1)} KB)`);
    }

    if (isOSS) {
      const db = await readDB();
      const idx = db.findIndex((p) => p.id === id);
      if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      const v = db[idx].versions[db[idx].versions.length - 1];
      for (const [path, ptr] of Object.entries(processed)) v.files[path] = ptr;
      db[idx].updatedAt = new Date().toISOString();
      await writeDB(db);
      return NextResponse.json({ success: true, count: imageEntries.length });
    }

    if (!supabaseAdmin) throw new Error('Supabase not initialized');

    const { error: updateError } = await supabaseAdmin.rpc('set_folio_files_batch', {
      p_folio_id: id, p_org_id: orgId || '', p_files: processed,
    });
    if (updateError) throw updateError;

    console.log(`[upload-batch] ${id}: ${imageEntries.length} files saved`);
    return NextResponse.json({ success: true, count: imageEntries.length });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: err may be any thrown value; err.message is read
  } catch (err: any) {
    console.error(`POST /api/files/[id]/upload-batch error:`, err.message || err);
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}
