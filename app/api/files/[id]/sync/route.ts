import { NextResponse } from 'next/server';
import { runTransaction, HTMLVersion } from '@/lib/db';
import { extractBase64Images } from '@/lib/extract-base64-images';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Local sync auth key: env var first, then settings.json mcpKey.
function getLocalSecretKey(): string {
  if (process.env.LiveFolio_API_KEY || process.env.LIVEFOLIO_API_KEY) {
    return process.env.LiveFolio_API_KEY || process.env.LIVEFOLIO_API_KEY || '';
  }
  try {
    const settingsPath = path.join(process.cwd(), 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      return settings.mcpKey || '';
    }
  } catch { /* ignore */ }
  return '';
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    // Auth validation - FORCE Authorization header only (no query params for security)
    const authHeader = request.headers.get('authorization');
    const token = authHeader ? authHeader.replace('Bearer ', '').trim() : '';
    const secret = getLocalSecretKey();

    if (!secret || !token || !timingSafeEqualStr(token, secret)) {
      return NextResponse.json({ error: 'Unauthorized sync access key. Please use Bearer token in Authorization header.' }, { status: 401 });
    }

    const body = await request.json();
    const { filename, content, change_message } = body;

    if (!filename || typeof content !== 'string') {
      return NextResponse.json({ error: 'Invalid file synchronizer parameters.' }, { status: 400 });
    }

    let nextVersionId = '';
    const result = await runTransaction(async (db) => {
      const projectIndex = db.findIndex(p => p.id === id);

      if (projectIndex === -1) {
        return { error: `Project '${id}' not found.`, status: 404 };
      }

      const project = db[projectIndex];
      const latestVersion = project.versions[project.versions.length - 1];

      // Skip creating a new version when the content is unchanged — this
      // prevents unbounded quadratic DB growth from repeated syncs.
      if (latestVersion.files[filename] === content) {
        project.updatedAt = new Date().toISOString();
        project.cliLastSeen = new Date().toISOString();
        db[projectIndex] = project;
        nextVersionId = latestVersion.versionId;
        return { success: true, unchanged: true };
      }

      // Merge modified file with existing files of latest version
      let mergedFiles = { ...latestVersion.files, [filename]: content };

      // Extract base64 images to keep versions lean (parity with PUT handler)
      const { files: extractedFiles } = extractBase64Images(mergedFiles);
      mergedFiles = extractedFiles;

      const nextVerNum = project.versions.length + 1;
      nextVersionId = `v${nextVerNum}`;

      const newVersion: HTMLVersion = {
        versionId: nextVersionId,
        commitMessage: change_message || `Watcher Auto-Sync: updated ${filename}`,
        createdAt: new Date().toISOString(),
        author: 'Local Watcher Daemon',
        files: mergedFiles
      };

      project.versions.push(newVersion);
      project.updatedAt = new Date().toISOString();
      project.cliLastSeen = new Date().toISOString();

      db[projectIndex] = project;
      return { success: true };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      success: true,
      versionId: nextVersionId,
      filename,
      message: `Synchronized ${filename} successfully.`
    });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: err may be any thrown value; only logged
  } catch (err: any) {
    console.error("Local sync endpoint exception:", err);
    return NextResponse.json({ error: "Failed to synchronise files." }, { status: 500 });
  }
}
