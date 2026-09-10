import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { headers } from 'next/headers';
import { runTransaction, type HTMLFile } from '@/lib/db';
import { isOSS } from '@/lib/env';
import { isLocalHost } from '@/lib/network';
import { supabaseAdmin, transformFolioRecord, transformToFolioRecord, type FolioRecord } from '@/lib/supabase';
import { assertStorageQuota } from '@/ee/middleware/usageCapping';
import { FOLIO_DEFAULTS, VERSION_MESSAGES } from '@/lib/folio-defaults';
import { slugifyFolioTitle } from '@/lib/folio-slug';
import { ensureOwnerHandle } from '@/lib/handles-server';

/**
 * Inbound webhook — the "push a folio from any tool" surface (Automation
 * connector). Any machine with the workspace key can POST a folio here:
 *
 *   POST /api/webhooks/inbound
 *   Authorization: Bearer <workspace API key>        (Cloud) or
 *   Authorization: Bearer <master key>               (OSS)
 *   { "title": "...", "initial_html": "<html>…</html>" }
 *
 * Response mirrors MCP create_project: { success, project_id, share_url,
 * studio_url } so existing agent/automation parsing patterns carry over.
 *
 * Auth model:
 * - Cloud: middleware validates the Bearer key (or `?key=`) against
 *   organizations.api_key and injects x-organization-id (see middleware.ts;
 *   /api/webhooks is an allowed public prefix but identity headers are only
 *   ever re-added after server-side verification). We require that header —
 *   unlike MCP there is intentionally NO in-route key fallback: the
 *   middleware always runs in cloud, and route-level lookups would just
 *   duplicate its 60s cache.
 * - OSS: resolve the master key (env → settings.json mcpKey) exactly like
 *   MCP validateAuth; no key configured = localhost only. Remote/tunnel
 *   pushes reach this path only because middleware.ts's OSS air-gap
 *   allowlist includes it — the key check happens here.
 *
 * Version provenance: genesis commit is tagged via VERSION_MESSAGES.
 */
export const dynamic = 'force-dynamic';

/** Field-validated subset of what create_project accepts (no paid/listing). */
const PROJECT_MODES = ['deck', 'document', 'spreadsheet', 'dashboard', 'infography'] as const;

const globalWithTunnel = global as typeof globalThis & {
  activeUrl?: string | null;
};

/** Resolve the OSS master key — env vars first, then settings.json (MCP parity). */
function resolveOssMasterKey(): string {
  let key = process.env.LIVEFOLIO_API_KEY || '';
  if (!key) key = process.env.LiveFolio_API_KEY || '';
  if (!key) {
    try {
      const settingsPath = path.join(process.cwd(), 'settings.json');
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        key = settings.mcpKey || '';
      }
    } catch {
      // unreadable settings.json — treated as "no key configured"
    }
  }
  return key;
}

async function authorizeInbound(request: Request): Promise<boolean> {
  if (!isOSS) {
    // Cloud: middleware-injected identity. Client-supplied identity headers
    // are stripped by middleware, so presence == verified caller.
    return !!request.headers.get('x-organization-id');
  }

  // OSS: master-key auth, mirroring MCP validateAuth's OSS branch.
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const url = new URL(request.url);
  const queryKey = url.searchParams.get('key') || '';

  const effectiveKey = resolveOssMasterKey();
  if (!effectiveKey) {
    // No key configured anywhere → local requests only (dev convenience).
    const host = request.headers.get('host') || '';
    return isLocalHost(host);
  }
  if (token && token === effectiveKey) return true;
  if (queryKey === effectiveKey) return true;
  return false;
}

/** Derive the public origin for share links — NEXT_PUBLIC_APP_URL first (MCP parity). */
function getRequestOrigin(request: Request): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');
  }
  const host = request.headers.get('host');
  if (!host || host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
    return 'https://livefolio.cloud';
  }
  const protocol = request.headers.get('x-forwarded-proto') || 'https';
  return `${protocol}://${host}`;
}

function invalid(message: string) {
  return NextResponse.json({ success: false, error: message }, { status: 400 });
}

export async function POST(request: Request) {
  if (!(await authorizeInbound(request))) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized: missing or invalid API key.' },
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // ── Parse + validate the payload ──────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return invalid('Invalid JSON body.');
  }
  if (!body || typeof body !== 'object') return invalid('Invalid JSON body.');

  const { title, initial_html, description, project_mode, design_preferences, reference_files, isPrivate, accessKey, allowComments, presentationModeOnly, status, thumbnail_url, project_id } = body;

  if (typeof title !== 'string' || !title.trim()) {
    return invalid("Field 'title' (string) is required.");
  }
  if (typeof initial_html !== 'string' || !initial_html.trim()) {
    return invalid("Field 'initial_html' (string, the full index.html source) is required.");
  }
  if (description !== undefined && typeof description !== 'string') {
    return invalid("Field 'description' must be a string.");
  }
  if (project_mode !== undefined && !PROJECT_MODES.includes(project_mode as (typeof PROJECT_MODES)[number])) {
    return invalid(`Field 'project_mode' must be one of: ${PROJECT_MODES.join(', ')}.`);
  }
  if (design_preferences !== undefined && (typeof design_preferences !== 'object' || design_preferences === null || Array.isArray(design_preferences))) {
    return invalid("Field 'design_preferences' must be an object { theme, typography, palette, ... }.");
  }
  if (reference_files !== undefined && !Array.isArray(reference_files)) {
    return invalid("Field 'reference_files' must be an array of { filename, content, size? }.");
  }
  for (const [key, v] of Object.entries({ isPrivate, allowComments, presentationModeOnly })) {
    if (v !== undefined && typeof v !== 'boolean') return invalid(`Field '${key}' must be a boolean.`);
  }
  if (accessKey !== undefined && typeof accessKey !== 'string') return invalid("Field 'accessKey' must be a string.");
  if (status !== undefined && status !== 'draft' && status !== 'published') {
    return invalid("Field 'status' must be 'draft' or 'published'.");
  }
  if (thumbnail_url !== undefined && typeof thumbnail_url !== 'string') return invalid("Field 'thumbnail_url' must be a string.");
  if (project_id !== undefined && typeof project_id !== 'string') return invalid("Field 'project_id' must be a string.");

  const cleanId = crypto.randomUUID();
  const initialFiles: Record<string, string> = { 'index.html': initial_html };
  const refs = reference_files?.map((ref) => {
    const r = ref as { filename?: unknown; content?: unknown; size?: unknown };
    if (typeof r?.filename !== 'string' || !r.filename.trim() || typeof r?.content !== 'string') {
      throw new Error("Each reference file needs a 'filename' and string 'content'.");
    }
    return { filename: r.filename, content: r.content, size: typeof r.size === 'number' ? r.size : Buffer.byteLength(r.content, 'utf8') };
  });

  // Security: UUID ids are not enumerable (same rationale as MCP/API creates).
  const newProject: HTMLFile = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Postgres generates the UUID in cloud mode; HTMLFile.id is typed string so undefined is cast
    id: isOSS ? cleanId : (undefined as any),
    title: title.trim(),
    description: (description as string | undefined) || FOLIO_DEFAULTS.description,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    comments: [],
    status: (status as HTMLFile['status']) || FOLIO_DEFAULTS.status,
    projectMode: (project_mode as HTMLFile['projectMode']) || FOLIO_DEFAULTS.projectMode,
    designPreferences: (design_preferences as HTMLFile['designPreferences']) || undefined,
    referenceFiles: refs || [],
    isPrivate: (isPrivate as boolean | undefined) ?? FOLIO_DEFAULTS.isPrivate,
    accessKey: (accessKey as string | undefined) || undefined,
    allowComments: (allowComments as boolean | undefined) ?? FOLIO_DEFAULTS.allowComments,
    presentationModeOnly: (presentationModeOnly as boolean | undefined) ?? FOLIO_DEFAULTS.presentationModeOnly,
    thumbnailUrl: (thumbnail_url as string | undefined) || null,
    projectId: (project_id as string | undefined) || null,
    slug: slugifyFolioTitle(title),
    versions: [
      {
        versionId: VERSION_MESSAGES.initial,
        commitMessage: VERSION_MESSAGES.commitWebhook,
        createdAt: new Date().toISOString(),
        author: 'Webhook',
        files: initialFiles,
      },
    ],
  };

  const origin = getRequestOrigin(request);
  const activeUrl = globalWithTunnel.activeUrl;
  const shareBase = activeUrl || origin;

  try {
    if (!isOSS) {
      const orgId = request.headers.get('x-organization-id');
      if (!orgId || !supabaseAdmin) throw new Error('Workspace identity unavailable.');

      // Storage quota enforcement — same gate as every other creation path
      // (MCP create_project, POST /api/files). In OSS this is a no-op stub.
      const headerList = await headers();
      const userId = headerList.get('x-user-id') || orgId;
      let estimatedBytes = Buffer.byteLength(JSON.stringify(initialFiles), 'utf8');
      for (const ref of refs || []) {
        estimatedBytes += ref.size || Buffer.byteLength(ref.content, 'utf8');
      }
      const { allowed, code } = await assertStorageQuota(userId, estimatedBytes, orgId);
      if (!allowed) {
        return NextResponse.json(
          { success: false, error: `${code || 'STORAGE_EXCEEDED'}: Storage limit reached — upgrade the plan to keep pushing folios.` },
          { status: 402, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const dbRecord = transformToFolioRecord(newProject, orgId);
      delete dbRecord.id; // let Postgres generate the UUID

      const { data, error } = await supabaseAdmin.from('folios').insert(dbRecord).select().single();
      if (error) throw error;
      const created = transformFolioRecord(data as FolioRecord);

      // Pushes often run before a human ever opens Settings — make sure the
      // org Owner has a handle so folios get @username/slug links. Best-effort.
      await ensureOwnerHandle(orgId).catch(() => {});

      return NextResponse.json({
        success: true,
        project_id: created.id,
        share_url: `${shareBase}/share/${created.id}`,
        studio_url: `${origin}/studio/${created.id}`,
      });
    }

    await runTransaction(async (db) => {
      db.push(newProject);
    });

    return NextResponse.json({
      success: true,
      project_id: cleanId,
      share_url: `${shareBase}/share/${cleanId}`,
      studio_url: `${origin}/studio/${cleanId}`,
    });
  } catch (err) {
    console.error('[Webhook inbound] create failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error while creating the folio.' },
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
