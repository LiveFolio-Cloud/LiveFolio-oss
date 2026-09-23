import { NextResponse } from 'next/server';
import { runTransaction, HTMLVersion } from '@/lib/db';
import { getAuthContext } from '@/lib/auth';
import { nextVersionId as nextFolioVersionId, applyVersionRetention } from '@/lib/version-retention';
import { extractBase64Images } from '@/lib/extract-base64-images';
import { safeEqual } from '@/lib/crypto';
import fs from 'fs';
import path from 'path';
import { err } from '@/lib/api/respond';

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

    if (!secret || !token || !safeEqual(token, secret)) {
      return err('Unauthorized sync access key. Please use Bearer token in Authorization header.', { status: 401 });
    }

    // Org context for Free-plan version retention. Same source the
    // transaction itself uses to scope the read and the upsert below.
    const { orgId } = await getAuthContext();

    const body = await request.json();
    const { filename, content, change_message } = body;

    if (!filename || typeof content !== 'string') {
      return err('Invalid file synchronizer parameters.', { status: 400 });
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

      nextVersionId = nextFolioVersionId(project.versions);

      const newVersion: HTMLVersion = {
        versionId: nextVersionId,
        commitMessage: change_message || `Watcher Auto-Sync: updated ${filename}`,
        createdAt: new Date().toISOString(),
        author: 'Local Watcher Daemon',
        files: mergedFiles
      };

      project.versions.push(newVersion);

      // Free plan: retain only the last 25 versions / 30 days (pricing card)
      project.versions = await applyVersionRetention(project.versions, orgId);

      project.updatedAt = new Date().toISOString();
      project.cliLastSeen = new Date().toISOString();

      db[projectIndex] = project;
      return { success: true };
    });

    if ('error' in result) {
      // NOTE: not converted to err() — `result.error` is typed
      // `string | undefined` (runTransaction's union is not narrowed by
      // `'error' in result`). err() requires `string`; coercing would either
      // change the emitted JSON or require a non-null assertion.
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      success: true,
      versionId: nextVersionId,
      filename,
      message: `Synchronized ${filename} successfully.`
    });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: caught may be any thrown value; only logged
  } catch (caught: any) {
    console.error("Local sync endpoint exception:", caught);
    return err("Failed to synchronise files.", { status: 500 });
  }
}
