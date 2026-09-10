import { NextResponse } from 'next/server';
import { readDB, runTransaction, HTMLFile, HTMLVersion, HTMLComment } from '@/lib/db';
import fs from 'fs';
import path from 'path';
import { startTunnel, type Tunnel } from 'untun';
import { isOSS } from '@/lib/env';
import { isLocalHost } from '@/lib/network';
import { supabaseAdmin, transformFolioRecord, transformToFolioRecord, FolioRecord } from '@/lib/supabase';
import { headers } from 'next/headers';
import { assertStorageQuota, getOrganizationQuota } from '@/ee/middleware/usageCapping';
import { FOLIO_DEFAULTS, VERSION_MESSAGES } from '@/lib/folio-defaults';
import { processUploadFiles } from '@/lib/process-upload';
import { sanitizePaidAccess } from '@/lib/gating/config';
import type { PaidAccessConfig } from '@/lib/gating/types';
import { sanitizeListing, listingWriteGuard, preserveAttestation, assertCanList } from '@/lib/listing/config';
import { ensureOwnerHandle, claimHandle, suggestHandles, isHandleAvailable } from '@/lib/handles-server';
import type { ListingMetadata } from '@/lib/listing/types';
import { deleteFolioAssets } from '@/lib/asset-store';
import { hasActiveGrant, claimPendingGrants } from '@/lib/gating/grants';
import { createGateCheckoutSession } from '@/lib/gating/checkout';
import { createSellerOnboardingLink } from '@/lib/gating/seller';
import { sendOrgInviteEmail } from '@/lib/email';
import { projectMemoryCache } from '@/lib/project-cache';
import { extractUUIDFromSlug } from '@/lib/utils';
import { getProfileFollowCounts } from '@/app/api/_lib/profile-follow-counts';
import { resolveProfileId } from '@/app/api/_lib/resolve-profile';
import { platformFeeCents } from '@/lib/gating/fees';
import crypto from 'crypto';
import { slugifyFolioTitle } from '@/lib/folio-slug';
import { nextVersionId as nextFolioVersionId, applyVersionRetention } from '@/lib/version-retention';

const SETTINGS_FILE = path.join(process.cwd(), 'settings.json');

const globalWithTunnel = global as typeof globalThis & {
  activeTunnel?: Tunnel;
  activeUrl?: string | null;
  mcpSseConnections?: Map<string, ReadableStreamDefaultController>;
};

if (!globalWithTunnel.mcpSseConnections) {
  globalWithTunnel.mcpSseConnections = new Map();
}

// ── CORS ─────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Session-Id',
  // Let browser-based MCP clients read the auth challenge on 401s.
  'Access-Control-Expose-Headers': 'WWW-Authenticate',
  'Access-Control-Max-Age': '86400',
};

/**
 * MCP auth-spec challenge: points agents at the resource metadata so they can
 * self-discover the registration path instead of guessing credentials.
 */
function wwwAuthenticate(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://livefolio.cloud').replace(/\/+$/, '');
  return `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`;
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get('host') || url.host || 'localhost:3001';
  const protocol = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';

  console.log(`[MCP DEBUG] GET SSE Connection requested from host: ${host}, path: ${url.pathname}`);

  if (!(await validateAuth(request))) {
    console.log(`[MCP DEBUG] GET SSE Connection rejected: Unauthorized`);
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized. Missing or invalid LiveFolio_API_KEY." },
        id: null
      },
      { status: 401, headers: { ...CORS_HEADERS, 'WWW-Authenticate': wwwAuthenticate() } }
    );
  }

  const key = url.searchParams.get('key') || '';
  const sessionId = crypto.randomUUID();

  console.log(`[MCP DEBUG] GET SSE Connection approved. SessionId generated: ${sessionId}`);

  const encoder = new TextEncoder();
  let heartbeatInterval: NodeJS.Timeout;

  const stream = new ReadableStream({
    start(controller) {
      globalWithTunnel.mcpSseConnections!.set(sessionId, controller);

      setTimeout(() => {
        try {
          // Write padding to bypass any proxy buffering limits (e.g. Nginx, Cloudflare)
          controller.enqueue(encoder.encode(`: ${' '.repeat(8192)}\n\n`));

          // Resolve absolute URL for the POST target
          const postUrl = `${protocol}://${host}/api/mcp?key=${encodeURIComponent(key)}&sessionId=${encodeURIComponent(sessionId)}`;
          // Never log the API key — redact it from the URL.
          const redactedUrl = postUrl.replace(/key=[^&]+/, 'key=REDACTED');
          console.log(`[MCP DEBUG] SSE Connection Writing endpoint URL: ${redactedUrl}`);
          controller.enqueue(encoder.encode(`event: endpoint\ndata: ${postUrl}\n\n`));
        } catch (err) {
          console.error("Failed to enqueue initial SSE events:", err);
        }
      }, 50);

      // Send keep-alive comments periodically
      heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`:\n\n`));
        } catch {
          clearInterval(heartbeatInterval);
          globalWithTunnel.mcpSseConnections!.delete(sessionId);
        }
      }, 15000);
    },
    cancel() {
      console.log(`[MCP DEBUG] SSE Connection closed/canceled for SessionId: ${sessionId}`);
      clearInterval(heartbeatInterval);
      globalWithTunnel.mcpSseConnections!.delete(sessionId);
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Content-Encoding': 'identity',
      ...CORS_HEADERS,
    },
  });
}


export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ── Auth token cache (avoids DB lookup on every request) ──────────────
const _tokenOrgCache = new Map<string, { orgId: string; expiresAt: number }>();
const TOKEN_CACHE_TTL = 5 * 60_000; // 5 minutes

async function validateAuth(request: Request): Promise<boolean> {
  const authHeader = request.headers.get('authorization');
  const token = authHeader ? authHeader.replace('Bearer ', '').trim() : '';
  const method = request.method || '?';
  const url = new URL(request.url);
  const queryKey = url.searchParams.get('key') || '';

  // ── Cloud mode ────────────────────────────────────────────────────
  if (!isOSS) {
    // 1. Middleware-injected header. This is ONLY present when the
    //    middleware verified a real API key (or Supabase session) and
    //    stripped any client-supplied identity headers — see middleware.ts.
    const midOrg = request.headers.get('x-organization-id');
    console.log(`[MCP Auth] method=${method} midOrg=${!!midOrg} hasBearer=${!!token} queryKey=${!!queryKey}`);
    if (midOrg) { console.log('[MCP Auth] ✓ middleware session'); return true; }

    // 2/3. Bearer token or query key — must actually resolve to an org.
    //    Presence alone is NOT sufficient (prevents spoofed credentials).
    const candidate = token || queryKey;
    if (candidate && supabaseAdmin) {
      try {
        const cached = _tokenOrgCache.get(candidate);
        if (cached && cached.expiresAt > Date.now()) { console.log('[MCP Auth] ✓ cached API key'); return true; }
        const { data, error } = await supabaseAdmin
          .from('organizations')
          .select('id')
          .eq('api_key', candidate)
          .maybeSingle();
        if (!error && data) {
          _tokenOrgCache.set(candidate, { orgId: data.id, expiresAt: Date.now() + TOKEN_CACHE_TTL });
          console.log('[MCP Auth] ✓ valid API key');
          return true;
        }
      } catch (err) {
        console.error('[MCP Auth] key lookup failed:', err);
      }
    }

    // 4. No valid credentials at all — deny
    console.log('[MCP Auth] ✗ DENIED — no valid credentials');
    return false;
  }

  // ── OSS mode ──────────────────────────────────────────────────────
  // 1. Resolve effective key from Env or settings.json
  let effectiveKey = process.env.LIVEFOLIO_API_KEY || '';

  if (!effectiveKey) {
    effectiveKey = process.env.LiveFolio_API_KEY || '';
  }

  if (!effectiveKey) {
    try {
      const settingsPath = path.join(process.cwd(), 'settings.json');
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        effectiveKey = settings.mcpKey || '';
      }
    } catch {}
  }

  // If no key is configured anywhere, allow LOCAL requests only
  // (developer convenience). Remote/tunnel access always requires a key.
  if (!effectiveKey) {
    const host = request.headers.get('host') || '';
    if (!isLocalHost(host)) {
      console.log('[MCP Auth] ✗ DENIED — no key configured for remote access');
      return false;
    }
    return true;
  }

  // 2. Validate against Header (Bearer token)
  if (token && token === effectiveKey) return true;

  // 3. Validate against Query Param (easy client config)
  if (url.searchParams.get('key') === effectiveKey) return true;

  return false;
}

/** Resolve org ID from the current request headers (works in both middleware and OAuth paths) */
async function resolveOrgIdFromHeaders(): Promise<string> {
  const headerList = await headers();
  const middlewareOrg = headerList.get('x-organization-id');
  if (middlewareOrg) return middlewareOrg;

  // Try OAuth Bearer token
  const authHeader = headerList.get('authorization');
  const token = authHeader ? authHeader.replace('Bearer ', '').trim() : '';
  if (token && supabaseAdmin) {
    const cached = _tokenOrgCache.get(token);
    if (cached && cached.expiresAt > Date.now()) return cached.orgId;

    const { data, error } = await supabaseAdmin
      .from('organizations')
      .select('id')
      .eq('api_key', token)
      .single();

    if (!error && data) {
      _tokenOrgCache.set(token, { orgId: data.id, expiresAt: Date.now() + TOKEN_CACHE_TTL });
      return data.id;
    }
  }

  throw new Error('Unauthorized');
}

/**
 * Resolve the user id that user-scoped tools (profile, handle, follow,
 * seller account, purchases) act on behalf of. Middleware injects
 * x-user-id for session and org-API-key requests; the OAuth Bearer path
 * has no user header, so fall back to the org Owner. Throws a clear error
 * when neither resolves.
 */
async function resolveActingUserId(orgId: string): Promise<string> {
  const headerList = await headers();
  const headerUserId = headerList.get('x-user-id');
  if (headerUserId && headerUserId !== '00000000-0000-0000-0000-000000000000') {
    return headerUserId;
  }
  if (supabaseAdmin) {
    const { data: owner } = await supabaseAdmin
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', orgId)
      .eq('role', 'Owner')
      .limit(1)
      .maybeSingle();
    if (owner) return owner.user_id;
  }
  throw new Error('This action requires a user identity, but the MCP session has none. Reconnect with a workspace API key or a signed-in session.');
}

/**
 * Verify the acting user holds one of the given roles in the org.
 * Always checks organization_members — client-supplied role headers are
 * stripped by middleware and must never be trusted.
 */
async function requireRole(orgId: string, userId: string, roles: string[]): Promise<string> {
  if (!supabaseAdmin) throw new Error('Database connection unavailable.');
  const { data, error } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) throw new Error('You are not a member of this workspace.');
  if (!roles.includes(data.role)) {
    throw new Error(`This action requires the ${roles.join(' or ')} role in the workspace.`);
  }
  return data.role;
}

/** Strict destructive confirmation — rejects truthy strings like "true". */
function requireConfirmed(confirmed: unknown): void {
  if (confirmed !== true) {
    throw new Error("Destructive action requires confirmed: true (the exact boolean) to proceed.");
  }
}

export async function POST(request: Request) {
  if (!(await validateAuth(request))) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized. Missing or invalid LiveFolio_API_KEY." },
        id: null
      },
      { status: 401, headers: { ...CORS_HEADERS, 'WWW-Authenticate': wwwAuthenticate() } }
    );
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get('sessionId') || request.headers.get('mcp-session-id');

  console.log(`[MCP DEBUG] POST Request: ${request.method} ${request.url}, sessionId: ${sessionId}`);

  const jsonResponse = (payload: unknown, init?: ResponseInit) => {
    if (sessionId && globalWithTunnel.mcpSseConnections?.has(sessionId)) {
      const controller = globalWithTunnel.mcpSseConnections.get(sessionId);
      const encoder = new TextEncoder();
      try {
        console.log(`[MCP DEBUG] POST Session ${sessionId} enqueuing message (payload redacted)`);
        controller!.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(payload)}\n\n`));
        return new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
        });
      } catch (err) {
        console.error(`[MCP DEBUG] SSE stream write error for session ${sessionId}:`, err);
        globalWithTunnel.mcpSseConnections.delete(sessionId);
      }
    }
    return NextResponse.json(payload, { ...init, headers: { ...(init?.headers || {}), ...CORS_HEADERS } });
  };

  try {
    const body = await request.json();
    const { jsonrpc, method, params, id } = body;
    // Log only method + id — never the payload (may contain folio content).
    console.log(`[MCP DEBUG] POST Request body method: ${method}, id: ${id}`);

    if (jsonrpc !== "2.0") {
      return jsonResponse({
        jsonrpc: "2.0",
        error: { code: -32600, message: "Invalid Request. Only JSON-RPC 2.0 is supported." },
        id: id || null
      });
    }

    // Standard MCP methods
    if (method === 'initialize') {
      return jsonResponse({
        jsonrpc: "2.0",
        result: {
          protocolVersion: params?.protocolVersion || "2024-11-05",
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: "LiveFolio-MCP",
            version: "1.0.0"
          },
          instructions: [
            "WHAT YOU CAN DO — capability map (a 'project' IS a folio):",
            "FOLIOS: list_projects · get_project (includes visibility + analytics) · create_project (html/mode/design) · update_project (files/title/description — versioned) · delete_project (confirmed:true) · duplicate_project.",
            "FEEDBACK: get_curated_brief · get_active_design_system · add_comment (pins with x/y/selector) · moderate_comment (resolve|reopen|delete) · add_reaction (👍 ❤️ 💡 🔥).",
            "SHARING & MONEY: manage_sharing (publish/privacy/access key — no version bump) · manage_paid_access (price/preview) · manage_listing (Explore marketplace + license + eligibility).",
            "MARKETPLACE: search_marketplace (browse) · buy_project (returns a checkout URL — relay it to the user) · get_purchases (session_id → grant poll, else history) · manage_seller_account (Stripe Connect status|onboard URL relay).",
            "WORKSPACE: list_workspaces · manage_workspace (create|update|delete|add_folio) · manage_member (no action = list; invite|update_role|remove).",
            "PROFILE & SOCIAL: manage_profile (no action = read) · claim_handle (no username = suggestions) · follow_profile · get_public_profile (discover a creator's catalog by @username).",
            "CONVENTIONS:",
            "- 'No args = read' applies to manage_listing, manage_sharing, manage_paid_access, manage_profile, manage_member, claim_handle, get_purchases.",
            "- Destructive tools (delete_project, manage_workspace delete) require confirmed:true — the exact boolean.",
            "- Purchases and seller onboarding happen via URL relay: you return the URL to the user, they click it in their browser, then you poll (get_purchases) or check (manage_seller_account).",
            "- Listing a folio for sale requires the owner's Seller Terms acceptance and a one-time rights affirmation — HUMAN consent steps you cannot perform; manage_listing (read mode) reports what is missing and where the owner must click.",
            "- User-scoped tools act as the workspace Owner when connected with a workspace API key.",
            "When creating folios, ALWAYS ask the user first: 1. Folio type (project_mode): deck, document, spreadsheet, dashboard, or infography. 2. Which workspace folder it belongs to (list_workspaces). 3. Whether they want it published, priced, or listed in Explore afterwards — guide them to manage_sharing / manage_paid_access / manage_listing when they do."
          ].join("\n")
        },
        id
      });
    }

    if (method === 'notifications/initialized') {
      console.log(`[MCP DEBUG] MCP Client successfully initialized connection`);
      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    if (method === 'tools/list') {
      const tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> = [
        {
          name: "list_projects",
          description: "List all existing LiveFolio projects/folios. Returns IDs, titles, descriptions, file counts, version counts, and open comment counts. Call this first to discover what projects exist before creating or updating.",
          inputSchema: {
            type: "object",
            properties: {},
            required: []
          }
        },
        {
          name: "get_project",
          description: "Retrieve the full details of a specific LiveFolio project, including the complete source code of all its files in the latest version, all open feedback comments, project mode, design system preferences, version history, and sharing/visibility state (status: draft|published, isPrivate, hasAccessKey).",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "The ID of the project to retrieve" }
            },
            required: ["project_id"]
          }
        },
        {
          name: "create_project",
          description: "Create a new LiveFolio folio (interactive document, slide deck, spreadsheet, dashboard, or infography) with a title, initial HTML content, and optional design / functional preference modes. You can include separate files (like CSS, JS, or images) in the files directory structure. To create binary assets (like PNG/JPEG/SVG images), write them as base64-encoded Data URLs (e.g. 'data:image/png;base64,...'). They will be automatically decoded and served relative to the HTML (e.g. <img src='assets/pic.png'>). Sharing, pricing, and marketplace settings are managed separately AFTER creation with manage_sharing, manage_paid_access, and manage_listing.",
          inputSchema: {
            type: "object",
            properties: {
              title: { type: "string", description: "The title of the folio" },
              initial_html: { type: "string", description: "The full HTML content of index.html" },
              description: { type: "string", description: "Optional description of the folio" },
              project_mode: { type: "string", enum: ["deck", "document", "spreadsheet", "dashboard", "infography"], description: "The target mode based on human psychology and functional intent. Defaults to 'deck' if omitted." },
              design_preferences: {
                type: "object",
                description: "Custom design and brand preferences",
                properties: {
                  theme: { type: "string" },
                  typography: { type: "string" },
                  palette: { type: "string" },
                  customColors: {
                    type: "object",
                    properties: {
                      primary: { type: "string" },
                      secondary: { type: "string" },
                      accent: { type: "string" }
                    }
                  },
                  customGuidelines: { type: "string" },
                  libraries: { type: "array", items: { type: "string" } }
                }
              },
              reference_files: {
                type: "array",
                description: "Reference documents or uploaded source texts for the workspace context",
                items: {
                  type: "object",
                  properties: {
                    filename: { type: "string" },
                    size: { type: "number" },
                    content: { type: "string" }
                  },
                  required: ["filename", "content"]
                }
              },
              project_id: { type: "string", description: "Optional. The ID of a workspace folder to add this folio to." },
              thumbnail_url: { type: "string", description: "Optional. Public URL of an image to use as the folio's thumbnail / cover image." }
            },
            required: ["title", "initial_html"]
          }
        },
        {
          name: "update_project",
          description: "Update the files, title, description, or thumbnail of an existing LiveFolio folio. Merges the provided files with existing ones so you only need to pass files that changed; each file change creates a new version checkpoint. Title/description/thumbnail changes without file changes do NOT create a version. Sharing (publish/privacy/access key), pricing, and marketplace listing are managed with manage_sharing, manage_paid_access, and manage_listing — not here. For binary files (like images), write them as base64-encoded Data URLs (e.g., 'data:image/png;base64,...') and they will be automatically decoded and served at that file path.",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "The ID of the project to update" },
              updated_files: {
                type: "object",
                description: "Optional. Mapping of filename to full file content, e.g. { 'index.html': '...', 'assets/logo.png': 'data:image/png;base64,...' }. Omit (or send {}) for title/description/thumbnail-only updates.",
                additionalProperties: { type: "string" }
              },
              change_message: { type: "string", description: "Optional. Commit summary for the new version when files change." },
              title: { type: "string", description: "Optional. New title for the folio" },
              description: { type: "string", description: "Optional. New description for the folio" },
              thumbnail_url: { type: "string", description: "Optional. Updates the folio's thumbnail / cover image (public image URL)." }
            },
            required: ["project_id"]
          }
        },
        {
          name: "get_curated_brief",
          description: "Get all open human feedback pins and comments from a LiveFolio project, compiled into a structured markdown design brief. Use this to understand what reviewers want changed before calling update_project.",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "The ID of the project" }
            },
            required: ["project_id"]
          }
        },
        {
          name: "get_active_design_system",
          description: "Retrieve the current styling patterns, fonts, palette tokens, and LiveFolio aesthetic guidelines for a project. Call this before generating or editing HTML to ensure visual consistency.",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "The ID of the project" }
            },
            required: ["project_id"]
          }
        }
      ];

      // Dual-mode tools (folio lifecycle + feedback) — same names in both
      // modes, per-mode behavior. Defined in Phase 1.
      tools.push(
        {
          name: "delete_project",
          description: "PERMANENTLY DELETE a folio — this cannot be undone. Requires confirmed:true (exact boolean).",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "The ID of the folio to delete" },
              confirmed: { type: "boolean", description: "Must be exactly true to proceed." }
            },
            required: ["project_id", "confirmed"]
          }
        },
        {
          name: "add_comment",
          description: "Add a review comment or canvas pin to a folio. Pins carry coordinates (x, y) and an optional DOM selector so they land on the exact element. Comments are general discussion.",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "The ID of the folio" },
              text: { type: "string", description: "Comment or pin text (required)" },
              type: { type: "string", enum: ["pin", "comment"], description: "Default: 'pin'." },
              x: { type: "number", description: "Pin only: x position (percent, 0-100)" },
              y: { type: "number", description: "Pin only: y position (percent, 0-100)" },
              selector: { type: "string", description: "Pin only: optional DOM selector of the target element" },
              elementHtml: { type: "string", description: "Pin only: optional snapshot of the element HTML" },
              slide_index: { type: "number", description: "Pin only: optional 0-based index of the containing section/slide" },
              section_label: { type: "string", description: "Pin only: optional heading/label text of the containing section" },
              version_id: { type: "string", description: "Optional. Target version — defaults to the latest" },
              filename: { type: "string", description: "Optional. File the pin refers to" }
            },
            required: ["project_id", "text"]
          }
        },
        {
          name: "moderate_comment",
          description: "Moderate a comment or pin: resolve it, reopen it, or permanently delete it. Resolve = mark as handled (hides from open-feedback lists); reopen = undo a resolve.",
          inputSchema: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["resolve", "reopen", "delete"], description: "The moderation action" },
              project_id: { type: "string", description: "The ID of the folio" },
              comment_id: { type: "string", description: "The ID of the comment/pin" }
            },
            required: ["action", "project_id", "comment_id"]
          }
        },
        {
          name: "add_reaction",
          description: "Add one reaction (increments the emoji's count by 1) to a folio. Supported emojis: 👍 ❤️ 💡 🔥. Reaction counts are aggregate — removing a reaction is not supported.",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "The ID of the folio" },
              emoji: { type: "string", enum: ["👍", "❤️", "💡", "🔥"], description: "The emoji reaction to add" }
            },
            required: ["project_id", "emoji"]
          }
        },
        {
          name: "manage_sharing",
          description: "Read or change a folio's sharing/visibility settings: publishing status (draft = owner-only, published = publicly accessible), private/public with access key, guest comments, and presentation mode. Call with no fields beyond project_id to read the current settings. Changing settings never creates a version.",
          inputSchema: {
            type: "object",
            properties: {
              project_id: { type: "string", description: "The ID of the folio" },
              status: { type: "string", enum: ["draft", "published"], description: "Set publishing status" },
              isPrivate: { type: "boolean", description: "Make the folio private (viewers need an access key)" },
              accessKey: { type: "string", description: "Password/access key required when private" },
              allowComments: { type: "boolean", description: "Allow guests to leave comments and reactions" },
              presentationModeOnly: { type: "boolean", description: "Show only in fullscreen presentation mode" }
            },
            required: ["project_id"]
          }
        }
      );

      if (isOSS) {
        tools.push(
          {
            name: "get_sharing_status",
            description: "Retrieve the global public tunnel status (active state, current live public URL, and custom tunnel URL config) and optionally inspect the public-sharing permission of a specific project.",
            inputSchema: {
              type: "object",
              properties: {
                project_id: { type: "string", description: "Optional project ID to query publicTunnelEnabled permission for" }
              },
              required: []
            }
          },
          {
            name: "toggle_sharing_tunnel",
            description: "Start or stop the global background public sharing tunnel process (Cloudflare/untun) to control whether local folios can be shared online.",
            inputSchema: {
              type: "object",
              properties: {
                action: { type: "string", enum: ["start", "stop"], description: "The action to perform: 'start' to open the tunnel, 'stop' to close it" }
              },
              required: ["action"]
            }
          },
          {
            name: "set_folio_public_access",
            description: "Enable or disable public web access for a specific folio over the active public tunnel, making it visible to external reviewers.",
            inputSchema: {
              type: "object",
              properties: {
                project_id: { type: "string", description: "The ID of the project to configure public access for" },
                enabled: { type: "boolean", description: "Set to true to allow public web access, false to restrict access to local network only" }
              },
              required: ["project_id", "enabled"]
            }
          }
        );
      }

      // Cloud-only tools (marketplace, monetization, workspace, members,
      // profile, social) — never advertised in OSS mode.
      if (!isOSS) {
        tools.push(
          {
            name: "duplicate_project",
            description: "Copy a folio into your own account. For paid folios this requires an active purchase grant AND the seller's allowCopy setting; otherwise a clear error explains why. The copy lands as a draft titled \"... (copy)\".",
            inputSchema: {
              type: "object",
              properties: {
                project_id: { type: "string", description: "The ID of the folio to copy" }
              },
              required: ["project_id"]
            }
          },
          {
            name: "manage_paid_access",
            description: "Read or change a folio's paid-access (gate) configuration: price, purchase model (one_time/rental/subscription), currency, preview mode, and post-purchase allowCopy/allowDownload. Call with no fields beyond project_id to read the current config. To remove a gate, set paid_access.enabled: false. ASK the user for price details before setting a gate.",
            inputSchema: {
              type: "object",
              properties: {
                project_id: { type: "string", description: "The ID of the folio" },
                paid_access: {
                  type: "object",
                  description: "Optional. The gate config to apply. Omit to read the current config.",
                  properties: {
                    enabled: { type: "boolean", description: "Master switch. true = paid access required. false = free." },
                    priceType: { type: "string", enum: ["one_time", "rental", "subscription"], description: "Purchase model. 'one_time' (single payment), 'rental' (access for N days), 'subscription' (recurring)." },
                    amountCents: { type: "integer", description: "Price in cents (minimum 100 = $1.00)." },
                    currency: { type: "string", enum: ["usd", "eur", "gbp"], description: "ISO currency code, lowercase." },
                    rentalDays: { type: "integer", description: "Rental only: access duration in days (1–3650)." },
                    interval: { type: "string", enum: ["month", "year"], description: "Subscription only: billing interval." },
                    previewMode: { type: "string", enum: ["none", "timed", "first_page"], description: "Free preview: 'none' (full paywall), 'timed' (visible N seconds then re-locks), 'first_page' (first page viewable)." },
                    previewSeconds: { type: "integer", description: "Timed preview only: 5–600 seconds." },
                    allowCopy: { type: "boolean", description: "Seller-controlled: buyers with access may duplicate. Default false." },
                    allowDownload: { type: "boolean", description: "Seller-controlled: buyers with access may download a ZIP. Default false." }
                  },
                  required: ["enabled", "priceType", "amountCents", "currency", "previewMode"]
                }
              },
              required: ["project_id"]
            }
          },
          {
            name: "manage_listing",
            description: "Read or change a folio's Explore marketplace listing: listed flag, category, tags, creation method, and the license buyers receive. Call with no fields beyond project_id to read the current listing PLUS the workspace's listing eligibility (Seller Terms accepted, account standing) and the human steps required if listing is blocked. Listing requires the owner's Seller Terms acceptance (human consent — an agent can never accept it) and a per-folio rights affirmation, which carries forward once given.",
            inputSchema: {
              type: "object",
              properties: {
                project_id: { type: "string", description: "The ID of the folio" },
                listed: { type: "boolean", description: "Opt-in to the public Explore index. false removes it." },
                category: { type: "string", enum: ["templates", "websites", "dashboards", "reports", "presentations", "marketing", "tools", "components", "games", "ai-apps"], description: "Curated Explore shelf" },
                tags: { type: "array", items: { type: "string" }, description: "Free-form tags (max 8, lowercase)" },
                creation: { type: "string", enum: ["human_made", "ai_assisted", "ai_generated", "human_ai"], description: "'Made with AI' axis" },
                license: {
                  type: "object",
                  description: "Explicit license the buyer receives.",
                  properties: {
                    kind: { type: "string", enum: ["personal", "commercial"], description: "'personal' = own use only · 'commercial' = commercial use allowed" },
                    allowModify: { type: "boolean", description: "Buyer may modify" },
                    allowResale: { type: "boolean", description: "Buyer may resell / redistribute" },
                    requireAttribution: { type: "boolean", description: "Attribution required on derived works" },
                    maxProjects: { type: ["integer", "null"], description: "Max projects the buyer may use it in. null = unlimited" }
                  }
                }
              },
              required: ["project_id"]
            }
          },
          {
            name: "search_marketplace",
            description: "Browse the public Explore marketplace for listed folios. Returns published, listed, moderation-clean folios with canonical share links, prices, and author usernames. Use this when the user wants to discover or shop folios.",
            inputSchema: {
              type: "object",
              properties: {
                category: { type: "string", enum: ["templates", "websites", "dashboards", "reports", "presentations", "marketing", "tools", "components", "games", "ai-apps"], description: "Optional Explore category filter" },
                tag: { type: "string", description: "Optional tag filter" },
                query: { type: "string", description: "Optional free-text search over title/description" },
                offset: { type: "integer", description: "Pagination offset (default 0)" },
                limit: { type: "integer", description: "Page size (default 48, max 48)" }
              },
              required: []
            }
          },
          {
            name: "buy_project",
            description: "Start a purchase for a paid folio or gated workspace. Creates a checkout session and returns a URL — relay it to the user and ask them to complete the payment in their browser, then poll get_purchases with the session_id until granted. You never handle payment details yourself. Requires the seller to have completed Stripe Connect onboarding; a clear error is returned if not.",
            inputSchema: {
              type: "object",
              properties: {
                project_id: { type: "string", description: "The ID of the folio to buy (workspace gates are resolved automatically)" }
              },
              required: ["project_id"]
            }
          },
          {
            name: "get_purchases",
            description: "Read purchase state. With session_id: poll whether that checkout's access grant has been provisioned (webhooks can lag the payment redirect — poll again if not yet granted). Without session_id: returns the user's full purchase history.",
            inputSchema: {
              type: "object",
              properties: {
                session_id: { type: "string", description: "Optional. The checkout session id to poll. Omit for the full purchase history." }
              },
              required: []
            }
          },
          {
            name: "manage_seller_account",
            description: "Manage the user's Stripe Connect seller account. action 'status': connection state + sales summary (revenue, sales count). action 'onboard': creates/reuses the seller's Stripe Express account and returns an onboarding URL — relay it to the user; arriving at the return page does NOT mean onboarding is complete (a webhook flips the status to active).",
            inputSchema: {
              type: "object",
              properties: {
                action: { type: "string", enum: ["status", "onboard"], description: "The seller-account action" }
              },
              required: ["action"]
            }
          },
          {
            name: "list_workspaces",
            description: "List the workspace folders that organize folios, with id, name, slug, is_public, and folio_count. Use these IDs to organize folios via manage_workspace.",
            inputSchema: { type: "object", properties: {}, required: [] }
          },
          {
            name: "manage_workspace",
            description: "Manage workspace folders that organize folios. action 'create': new folder (name, optional description, optional is_public). 'update': rename, description, or public visibility. 'delete': PERMANENTLY DELETE the folder — folios inside are detached, NOT deleted — requires confirmed:true. 'add_folio': move a folio into the folder.",
            inputSchema: {
              type: "object",
              properties: {
                action: { type: "string", enum: ["create", "update", "delete", "add_folio"], description: "The workspace action" },
                project_id: { type: "string", description: "The folder ID (update/delete/add_folio)" },
                name: { type: "string", description: "Folder name (create required; update optional)" },
                description: { type: "string", description: "Optional folder description (create/update)" },
                is_public: { type: "boolean", description: "Show on the public profile (create/update)" },
                folio_id: { type: "string", description: "The folio to move (add_folio)" },
                confirmed: { type: "boolean", description: "Must be exactly true for delete" }
              },
              required: ["action"]
            }
          },
          {
            name: "manage_member",
            description: "Manage workspace members. No action field beyond the defaults = list members. action 'invite': add a teammate by email (role Admin|Member) — direct-add if the account exists, otherwise sends an email invitation. 'update_role': change a member's role (Admin|Member). 'remove': remove a member from the workspace. Owner is immutable; only Owner/Admin can manage members.",
            inputSchema: {
              type: "object",
              properties: {
                action: { type: "string", enum: ["invite", "update_role", "remove"], description: "The member action. Omit to list members." },
                email: { type: "string", description: "invite only: the teammate's email" },
                role: { type: "string", enum: ["Admin", "Member"], description: "invite/update_role only" },
                member_id: { type: "string", description: "update_role/remove only: the member's user id" }
              },
              required: []
            }
          },
          {
            name: "manage_profile",
            description: "Read or update the acting user's public profile. No action field = read (returns profile, follow counts, and seller-terms state). action 'update': change full_name, bio, website, avatar_url, is_public, accent_color (#RRGGBB), featured_folio_id, or username (claims the @handle — invalid/taken handles return a clear error).",
            inputSchema: {
              type: "object",
              properties: {
                action: { type: "string", enum: ["update"], description: "Omit to read the profile." },
                full_name: { type: "string" },
                bio: { type: "string" },
                website: { type: "string" },
                avatar_url: { type: "string" },
                is_public: { type: "boolean" },
                accent_color: { type: "string", description: "Hex color like #FF3B00" },
                featured_folio_id: { type: "string" },
                username: { type: "string", description: "Claim a new @username" }
              },
              required: []
            }
          },
          {
            name: "claim_handle",
            description: "Claim a @username handle for the acting user, or get suggestions. With username: claims it (errors map to invalid format / reserved / taken). Without username: returns 3 available suggestions seeded from the account name.",
            inputSchema: {
              type: "object",
              properties: {
                username: { type: "string", description: "Optional. The handle to claim. Omit for suggestions." }
              },
              required: []
            }
          },
          {
            name: "follow_profile",
            description: "Follow or unfollow a creator by @username (toggle). Returns the new following state and follower count. Following a creator surfaces their public folios. Cannot follow yourself.",
            inputSchema: {
              type: "object",
              properties: {
                username: { type: "string", description: "The @username of the creator" }
              },
              required: ["username"]
            }
          },
          {
            name: "get_public_profile",
            description: "Read another creator's public profile by @username: bio, avatar, follower/following counts, their published public folios (with share links, prices, and Explore status), and their public workspaces. Use this to discover a creator's catalog — the agent-side counterpart of browsing a profile page. Suspended or private profiles return a clear not-found.",
            inputSchema: {
              type: "object",
              properties: {
                username: { type: "string", description: "The @username of the creator (omit the @)" }
              },
              required: ["username"]
            }
          }
        );
      }

      return jsonResponse({
        jsonrpc: "2.0",
        result: { tools },
        id
      });
    }

    if (method === 'tools/call') {
      const { name, arguments: toolArgs } = params || {};
      const responseContent = await handleToolCall(name, toolArgs, request);

      return jsonResponse({
        jsonrpc: "2.0",
        result: responseContent,
        id
      });
    }

    // Direct RPC methods for clients that don't wrap in tools/call
    if (method === 'list_projects') {
      const result = await handleListProjects(request);
      return jsonResponse({ jsonrpc: "2.0", result, id });
    }

    if (method === 'get_project') {
      const result = await handleGetProject(params, request);
      return jsonResponse({ jsonrpc: "2.0", result, id });
    }

    if (method === 'create_project') {
      const result = await handleCreateProject(params, request);
      return jsonResponse({ jsonrpc: "2.0", result, id });
    }

    if (method === 'update_project') {
      const result = await handleUpdateProject(params, request);
      return jsonResponse({ jsonrpc: "2.0", result, id });
    }

    if (method === 'get_curated_brief') {
      const result = await handleGetCuratedBrief(params);
      return jsonResponse({ jsonrpc: "2.0", result, id });
    }

    if (method === 'get_active_design_system') {
      const result = await handleGetActiveDesignSystem(params);
      return jsonResponse({ jsonrpc: "2.0", result, id });
    }

    if (method === 'get_sharing_status') {
      const result = await handleGetSharingStatus(params);
      return jsonResponse({ jsonrpc: "2.0", result, id });
    }

    if (method === 'toggle_sharing_tunnel') {
      const result = await handleToggleSharingTunnel(params, request);
      return jsonResponse({ jsonrpc: "2.0", result, id });
    }

    if (method === 'set_folio_public_access') {
      const result = await handleSetFolioPublicAccess(params, request);
      return jsonResponse({ jsonrpc: "2.0", result, id });
    }

    if (method === 'list_workspaces') {
      const result = await handleListWorkspaces();
      return jsonResponse({ jsonrpc: "2.0", result, id });
    }

    if (method === 'manage_workspace') {
      const result = await handleManageWorkspace(params);
      return jsonResponse({ jsonrpc: "2.0", result, id });
    }

    return jsonResponse({
      jsonrpc: "2.0",
      error: { code: -32601, message: `Method not found: ${method}` },
      id
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool handlers may throw non-Error values; .message is read defensively
  } catch (err: any) {
    console.error("MCP Server Error:", err);
    return jsonResponse({
      jsonrpc: "2.0",
      error: { code: -32603, message: err.message || "Internal JSON-RPC Error." },
      id: null
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
async function handleToolCall(name: string, args: any, request?: Request) {
  try {
    switch (name) {
      case 'list_projects': {
        const res = await handleListProjects();
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }]
        };
      }
      case 'get_project': {
        const res = await handleGetProject(args);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }]
        };
      }
      case 'create_project': {
        const res = await handleCreateProject(args);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }]
        };
      }
      case 'update_project': {
        const res = await handleUpdateProject(args);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }]
        };
      }
      case 'get_curated_brief': {
        const res = await handleGetCuratedBrief(args);
        return {
          content: [{ type: 'text', text: typeof res.brief === 'string' ? res.brief : JSON.stringify(res, null, 2) }]
        };
      }
      case 'get_active_design_system': {
        const res = await handleGetActiveDesignSystem(args);
        return {
          content: [{ type: 'text', text: typeof res.themeAnalysis === 'string' ? res.themeAnalysis : JSON.stringify(res, null, 2) }]
        };
      }
      case 'get_sharing_status': {
        const res = await handleGetSharingStatus(args);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }]
        };
      }
      case 'toggle_sharing_tunnel': {
        const res = await handleToggleSharingTunnel(args, request);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }]
        };
      }
      case 'set_folio_public_access': {
        const res = await handleSetFolioPublicAccess(args, request);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }]
        };
      }
      case 'delete_project': {
        const res = await handleDeleteProject(args);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      }
      case 'duplicate_project': {
        const res = await handleDuplicateProject(args);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      }
      case 'add_comment': {
        const res = await handleAddComment(args);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      }
      case 'moderate_comment': {
        const res = await handleModerateComment(args);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      }
      case 'add_reaction': {
        const res = await handleAddReaction(args);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      }
      case 'manage_sharing': {
        const res = await handleManageSharing(args);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      }
      case 'manage_paid_access': {
        const res = await handleManagePaidAccess(args);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      }
      case 'manage_listing': {
        const res = await handleManageListing(args);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      }
      case 'search_marketplace': {
        const res = await handleSearchMarketplace(args);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      }
      case 'buy_project': {
        const res = await handleBuyProject(args);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      }
      case 'get_purchases': {
        const res = await handleGetPurchases(args);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      }
      case 'manage_seller_account': {
        const res = await handleManageSellerAccount(args);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      }
      case 'list_workspaces': {
        const res = await handleListWorkspaces();
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      }
      case 'manage_workspace': {
        const res = await handleManageWorkspace(args);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      }
      case 'manage_member': {
        const res = await handleManageMember(args);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      }
      case 'manage_profile': {
        const res = await handleManageProfile(args);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      }
      case 'claim_handle': {
        const res = await handleClaimHandle(args);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      }
      case 'follow_profile': {
        const res = await handleFollowProfile(args);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      }
      case 'get_public_profile': {
        const res = await handleGetPublicProfile(args);
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      }
      default:
        return {
          content: [{ type: 'text', text: `Error: Tool '${name}' not found.` }],
          isError: true
        };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool execution may throw non-Error values; .message is read defensively
  } catch (e: any) {
    return {
      content: [{ type: 'text', text: `Error executing tool: ${e.message}` }],
      isError: true
    };
  }
}

function getRequestOrigin(request?: Request): string {
  // Use configured app URL first, then derive from request, never fall back to localhost
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');
  }
  if (!request) return 'https://livefolio.cloud';
  const host = request.headers.get('host');
  if (!host || host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
    return 'https://livefolio.cloud';
  }
  const protocol = request.headers.get('x-forwarded-proto') || 'https';
  return `${protocol}://${host}`;
}

async function handleListProjects(request?: Request) {
  let db: HTMLFile[] = [];

  if (!isOSS) {
    const orgId = await resolveOrgIdFromHeaders();
    if (!supabaseAdmin) throw new Error("Supabase is not initialized.");

    const { data, error } = await supabaseAdmin
      .from('folios')
      .select('*')
      .eq('organization_id', orgId)
      .order('updated_at', { ascending: false });

    if (error) throw error;
    db = (data as FolioRecord[]).map(transformFolioRecord);
  } else {
    db = await readDB();
  }

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
      studio_url: `${origin}/studio/${p.id}`
    };
  });

  return { projects: summary, total: summary.length };
}

function sanitizeAuthor(author?: string): string {
  if (!author) return 'Anonymous';
  // If it's an email, redact it to prevent leakage of internal identities
  if (author.includes('@')) {
    const [name] = author.split('@');
    return `${name.slice(0, 2)}... (Verified User)`;
  }
  return author;
}

/**
 * Sanitizes folio-authored snippet text before it lands in the brief's
 * markdown — section labels come from the folio's own headings and can carry
 * markdown metacharacters or newlines. Collapse whitespace, escape the
 * characters that would corrupt the table/list rendering, cap the length.
 */
function sanitizeBriefText(s?: string): string {
  if (!s) return '';
  return s.replace(/[\r\n]+/g, ' ').replace(/([|*_`])/g, '\\$1').slice(0, 80);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
async function handleGetProject(args: any, request?: Request) {
  const { project_id } = args || {};
  if (!project_id) throw new Error("Argument 'project_id' is required.");

  let project: HTMLFile;

  if (!isOSS) {
    const orgId = await resolveOrgIdFromHeaders();
    if (!supabaseAdmin) throw new Error("Supabase is not initialized.");

    const { data, error } = await supabaseAdmin
      .from('folios')
      .select('*')
      .eq('id', project_id)
      .eq('organization_id', orgId)
      .single();

    // Security: no global-lookup "self-healing" reassignment — a folio that
    // is not found under the caller's org is not visible to them.
    if (error || !data) {
      throw new Error(`Project with ID '${project_id}' not found.`);
    }

    project = transformFolioRecord(data as FolioRecord);
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
    studio_url: `${origin}/studio/${project.id}`
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
async function handleCreateProject(args: any, request?: Request) {
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
    if (!supabaseAdmin) throw new Error("Supabase is not initialized.");

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
      studio_url: `${origin}/studio/${created.id}`
    };
  } else {
    await runTransaction(async (db) => {
      db.push(newProject);
    });

    return {
      success: true,
      project_id: cleanId,
      share_url: `${shareBase}/share/${cleanId}`,
      studio_url: `${origin}/studio/${cleanId}`
    };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
async function handleUpdateProject(args: any, request?: Request) {
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
  if (!isOSS) {
    const orgId = await resolveOrgIdFromHeaders();
    const email = 'agent@livefolio.cloud';
    if (!supabaseAdmin) throw new Error("Supabase is not initialized.");

    // Fetch current project
    const { data: current, error: fetchError } = await supabaseAdmin
      .from('folios')
      .select('*')
      .eq('id', project_id)
      .eq('organization_id', orgId)
      .single();

    // Security: no global-lookup "self-healing" reassignment — a folio that
    // is not found under the caller's org is not theirs to modify.
    if (fetchError || !current) throw new Error(`Project with ID '${project_id}' not found.`);
    const project = transformFolioRecord(current as FolioRecord);
    const lastVersion = project.versions[project.versions.length - 1];

    let storedBytes = 0;
    if (hasFileChanges) {
      // Merge or replace files — offload base64 images to asset store
      let mergedFiles = { ...lastVersion.files, ...updated_files };
      const processed = await processUploadFiles(mergedFiles, project_id, orgId);
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
      project.versions = await applyVersionRetention(project.versions, orgId);
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

    // Listing guard — flipping a folio INTO a listing requires account
    // standing + rights affirmation (existing affirmations carry forward).
    if (listingMeta?.listed) {
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
    if (listing !== undefined) {
      // Never wipe the rights affirmation on later listing edits/unlists.
      project.listing = preserveAttestation(listingMeta, project.listing);
    }

    // Preserve the folio's existing organization — don't overwrite on update
    const folioOrgId = (current as FolioRecord).organization_id || orgId;
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
    // Agent edits must be visible immediately — the raw/share/studio paths
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
        const nextVerNum = project.versions.length + 1;
        versionId = `v${nextVerNum}`;

        const newVersion: HTMLVersion = {
          versionId,
          commitMessage: change_message || `Revised via MCP Client (v${nextVerNum})`,
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
    share_url: `${shareBase}/share/${project_id}`,
    studio_url: `${origin}/studio/${project_id}`
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
async function handleGetCuratedBrief(args: any) {
  const { project_id } = args || {};
  if (!project_id) throw new Error("Argument 'project_id' is required.");

  let project: HTMLFile;
  if (!isOSS) {
    const orgId = await resolveOrgIdFromHeaders();
    if (!supabaseAdmin) throw new Error("Supabase is not initialized.");

    const { data, error } = await supabaseAdmin
      .from('folios')
      .select('*')
      .eq('id', project_id)
      .eq('organization_id', orgId)
      .single();

    if (error || !data) throw new Error(`Project with ID '${project_id}' not found.`);
    project = transformFolioRecord(data as FolioRecord);
  } else {
    const db = await readDB();
    const found = db.find(p => p.id === project_id);
    if (!found) throw new Error(`Project with ID '${project_id}' not found.`);
    project = found;
  }

  const comments = project.comments || [];
  // Only include spatial pins in the design brief (not general discussion comments)
  const openPins = comments.filter(c => !c.resolved && (!c.type || c.type === 'pin'));

  // Synthesize a structured design brief in markdown format
  let brief = `# LiveFolio Design Brief: ${project.title}\n\n`;
  brief += `**Description**: ${project.description}\n`;
  brief += `**Project ID**: \`${project.id}\`\n`;
  brief += `**Project Intent Mode**: \`${project.projectMode || 'document'}\`\n\n`;

  brief += `## 🎨 Current Open Feedback & Visual Annotations\n`;
  if (openPins.length === 0) {
    brief += `No unresolved pinpoint comments at the moment. General layout improvements can still be done.\n`;
  } else {
    brief += `Please resolve the following visual design annotations left by reviewers on the live canvas:\n\n`;

    // Sort pins by slide index and then by position
    const sortedPins = [...openPins].sort((a, b) => {
      if ((a.slideIndex ?? -1) !== (b.slideIndex ?? -1)) {
        return (a.slideIndex ?? -1) - (b.slideIndex ?? -1);
      }
      return (a.y ?? 0) - (b.y ?? 0);
    });

    sortedPins.forEach((c, index) => {
      const slideInfo = c.slideIndex !== undefined
        ? `Slide Index: **${c.slideIndex}**${c.sectionLabel ? ` — ${sanitizeBriefText(c.sectionLabel)}` : ''}`
        : 'Whole Page / Global';
      brief += `### Pin #${index + 1}: ${c.text}\n`;
      brief += `- **Author**: *${sanitizeAuthor(c.author)}*\n`;
      brief += `- **File Target**: \`${c.filename}\`\n`;
      brief += `- **Context/Slide**: ${slideInfo}\n`;
      brief += `- **Canvas Position**: X: \`${c.x ? c.x.toFixed(1) + '%' : '0%'}\`, Y: \`${c.y ? c.y.toFixed(1) + '%' : '0%'}\`\n`;
      if (c.selector) {
        brief += `- **Target DOM Selector**: \`${c.selector}\`\n`;
      }
      if (c.elementHtml) {
        brief += `- **Target Element Snippet**:\n\`\`\`html\n${c.elementHtml}\n\`\`\`\n`;
      }
      brief += `\n`;
    });
  }

  const lastVersion = project.versions[project.versions.length - 1];
  brief += `## 📂 Existing Sandbox Files\n`;
  brief += `The project has the following active files:\n`;
  Object.keys(lastVersion.files).forEach(f => {
    brief += `- \`${f}\` (${lastVersion.files[f].length} characters)\n`;
  });

  return {
    title: project.title,
    description: project.description,
    brief,
    openComments: openPins
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
async function handleGetActiveDesignSystem(args: any) {
  const { project_id } = args || {};
  if (!project_id) throw new Error("Argument 'project_id' is required.");

  let project: HTMLFile;
  if (!isOSS) {
    const orgId = await resolveOrgIdFromHeaders();
    if (!supabaseAdmin) throw new Error("Supabase is not initialized.");

    const { data, error } = await supabaseAdmin
      .from('folios')
      .select('*')
      .eq('id', project_id)
      .eq('organization_id', orgId)
      .single();

    if (error || !data) throw new Error(`Project with ID '${project_id}' not found.`);
    project = transformFolioRecord(data as FolioRecord);
  } else {
    const db = await readDB();
    const found = db.find(p => p.id === project_id);
    if (!found) throw new Error(`Project with ID '${project_id}' not found.`);
    project = found;
  }

  const lastVersion = project.versions[project.versions.length - 1];
  const indexHtml = lastVersion?.files["index.html"] || "";

  // Extract from index.html if database has no records
  const fontMatches = indexHtml.match(/family=([^&"'>]+)/g) || [];
  const htmlFonts = fontMatches.map(f => f.replace("family=", "").replace(/\+/g, " "));
  const usesTailwind = indexHtml.includes("cdn.tailwindcss.com");

  // Read preferences
  const prefs: Partial<NonNullable<HTMLFile['designPreferences']>> = project.designPreferences || {};
  const theme = prefs.theme || (usesTailwind ? 'Premium SaaS Deck' : 'Warm Editorial');
  const typography = prefs.typography || 'Lora & Inter';
  const palette = prefs.palette || 'Honey Amber';
  const customColors: { primary?: string; secondary?: string; accent?: string } = prefs.customColors || {};
  const libraries = prefs.libraries || (usesTailwind ? ['Tailwind CSS Core'] : []);
  const customGuidelines = prefs.customGuidelines || '';
  const projectMode = project.projectMode || 'document';

  // 9-section DESIGN.md synthesis
  let themeAnalysis = `# 🎨 LiveFolio Unified Design System: ${project.title}\n\n`;
  themeAnalysis += `This document serves as the single source of truth for all co-creation and agentic modifications. Ensure all surgical updates conform strictly to these design guidelines.\n\n`;

  themeAnalysis += `--- \n\n`;

  // SECTION 1
  themeAnalysis += `### 1. Visual Theme Style & Brand Identity\n`;
  themeAnalysis += `- **Active Theme Preset**: \`${theme}\`\n`;
  const themeDesc = ({
    'Warm Editorial': 'Elegant paper ivory feel focusing on literary prestige, soft sepia margins, and classical borders.',
    'Premium SaaS Deck': 'Modern SaaS pitch aesthetic featuring sharp structural grids, clean high-contrast dividers, and tech-driven visual badges.',
    'Glassmorphic Quartz': 'Dark high-end frosted interface with rich background gradients, glass backdrops, and glowing borders.',
    'Retro Console': 'Dark terminal glowing vintage prompt style with neon amber monospace accents and solid terminal panels.'
  } as Record<string, string>)[theme] || 'Custom custom-made brand styling layout.';
  themeAnalysis += `- **Identity Description**: ${themeDesc}\n\n`;

  // SECTION 2
  themeAnalysis += `### 2. Harmonious Palette & Custom Brand Hex Colors\n`;
  themeAnalysis += `- **Color Palette Preset**: \`${palette}\`\n`;
  const paletteColors = ({
    'Honey Amber': 'Warm Ivory Background (\`#FAF8F5\`), Accent Honey Amber (\`#D97706\`), and Dark Charcoal Text (\`#1C1917\`)',
    'Cobalt Ocean': 'Slate Tint Background (\`#F8FAFC\`), Accent Deep Cobalt (\`#1D4ED8\`), and Navy Slate Text (\`#0F172A\`)',
    'Quartz Rose': 'Rose Blush Background (\`#FFFDFB\`), Accent Rose Crimson (\`#BE185D\`), and Dark Charcoal Text (\`#2D1C22\`)',
    'Sage Forest': 'Pale Sage Background (\`#F4F6F2\`), Accent Forest Green (\`#15803D\`), and Deep Bark Text (\`#1E251E\`)',
    'Clay Canyon': 'Sand Cream Background (\`#FCFAF7\`), Accent Terracotta Clay (\`#C2410C\`), and Charcoal Stone Text (\`#292524\`)',
    'Night Emerald': 'Deep Obsidian Background (\`#090D16\`), Accent Glowing Emerald (\`#10B981\`), and Crisp White Text (\`#F1F5F9\`)'
  } as Record<string, string>)[palette] || 'Standard neutral colors.';
  themeAnalysis += `- **Standard Palettes**: ${paletteColors}\n`;
  if (customColors.primary || customColors.secondary || customColors.accent) {
    themeAnalysis += `- **Enforced Custom Colors**:\n`;
    if (customColors.primary) themeAnalysis += `  - Primary Hex: \`${customColors.primary}\`\n`;
    if (customColors.secondary) themeAnalysis += `  - Secondary Hex: \`${customColors.secondary}\`\n`;
    if (customColors.accent) themeAnalysis += `  - Accent Hex: \`${customColors.accent}\`\n`;
  }
  themeAnalysis += `\n`;

  // SECTION 3
  themeAnalysis += `### 3. Typography Scaling & Font Selection\n`;
  themeAnalysis += `- **Typography Pair**: \`${typography}\`\n`;
  const fontSpec = ({
    'Lora & Inter': 'Lora (Classic Serif) for headers to emphasize prestige, Inter (Clean Sans-Serif) for high-readability body copy.',
    'Outfit & Roboto Mono': 'Outfit (Bold Geometric Sans) for modern punchy headers, Roboto Mono for high-tech numbers and labels.',
    'Space Grotesk & Plus Jakarta Sans': 'Space Grotesk (Tech/Editorial) for high-impact metric headers, Plus Jakarta Sans (Elegantly Curved) for active body controls.',
    'Playfair Display & Georgia': 'Playfair Display (High-Contrast Serif) for luxurious headlines, Georgia (Standard Editorial) for longform paragraphs.'
  } as Record<string, string>)[typography] || 'Standard typography pairs.';
  themeAnalysis += `- **Font Specifications**: ${fontSpec}\n`;
  if (htmlFonts.length > 0) {
    themeAnalysis += `- **Discovered HTML Import Fonts**: ${Array.from(new Set(htmlFonts)).map(f => `\`${f}\``).join(', ')}\n`;
  }
  themeAnalysis += `\n`;

  // SECTION 4
  themeAnalysis += `### 4. Elevation, Shadow, & Border Radii Guidelines\n`;
  themeAnalysis += `- **SaaS/Deck Radii**: Use premium rounded shapes (\`rounded-2xl\` or \`rounded-3xl\`) for main interactive wrappers.\n`;
  themeAnalysis += `- **Glassmorphism Spec**: For frosted layouts, use: \`bg-white/5 border border-white/10 backdrop-blur-md shadow-lg\` on dark modes, or \`bg-white/60 border border-black/5 backdrop-blur-md\` on light modes.\n`;
  themeAnalysis += `- **Borders**: Prefer extremely thin borders (\`border border-zinc-200/60\` or \`border-stone-200/50\`) over heavy grids.\n\n`;

  // SECTION 5
  themeAnalysis += `### 5. Responsive Grid & Workspace Container Specifications\n`;
  themeAnalysis += `- **Width Alignment**: Always constrain contents within clear editorial margins (\`max-w-6xl mx-auto px-6\` or \`max-w-4xl\` depending on section density).\n`;
  themeAnalysis += `- **Grid Structure**: Use mobile-first grids (\`grid grid-cols-1 md:grid-cols-3 gap-6\`) to adapt perfectly to tablet and mobile screens.\n\n`;

  // SECTION 6
  themeAnalysis += `### 6. Interaction Micro-animations & Interactive Elements\n`;
  themeAnalysis += `- **Hover Scaling**: All clickable buttons and triggers must scale slightly and smoothly on hover: \`transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]\`.\n`;
  themeAnalysis += `- **Input Interactions**: Focus outlines on form fields and sliders must use theme accent highlights (\`focus:outline-indigo-500\` or custom colors) to look active and alive.\n\n`;

  // SECTION 7
  themeAnalysis += `### 7. Intent Mode Layout Best Practices\n`;
  themeAnalysis += `- **Target Project Intent**: \`${projectMode.toUpperCase()}\`\n`;
  const modeGuidelineText = ({
    'deck': `- **Slides Presentation Model**: Replaces PowerPoint slides. Output distinct horizontal slide panels (\`.slide-node\`). Active slide must have \`.active\` with a smooth transition. Provide keyboard listener navigation scripts and clean arrow button footer controllers.`,
    'document': `- **Longform Editorial Model**: Replaces PDFs/Word. Deliver high-contrast readable vertical texts with sticky side outline summaries on the left column linking to section anchors. Include collapsible disclosures for methodology context.`,
    'spreadsheet': `- **Recalculator Sheet Model**: Replaces Excel grids. Build fully responsive table structures with cells wrapping metric number fields. Configure synchronous Javascript triggers to recalculate totals, margins, and summaries live as the user changes inputs.`,
    'dashboard': `- **Metrics Visualizer Model**: Replaces PowerBI views. Focus on structured card decks, clear status percentages, and active SVG/Chart.js graphs.`,
    'infography': `- **Visual Data Story Model**: Replaces static infographics and visual reports. Design a continuous-scroll canvas with large statistical hero numbers, annotated charts, timeline strips, and before/after comparison panels. Use oversized numerals, subtle divider accents, and a restrained editorial palette. Information density is high but the visual rhythm keeps it scannable — alternate between data-heavy sections and breathing room.`
  } as Record<string, string>)[projectMode] || '';
  themeAnalysis += `${modeGuidelineText}\n\n`;

  // SECTION 8
  themeAnalysis += `### 8. Approved Script & External Library Injections\n`;
  if (libraries.length === 0) {
    themeAnalysis += `- No third-party integrations required. Keep pages light and static.\n`;
  } else {
    themeAnalysis += `The project has approved the following external scripts and widgets:\n`;
    libraries.forEach((lib) => {
      themeAnalysis += `- **${lib}**:\n`;
      if (lib === 'Tailwind CSS Core') themeAnalysis += `  - CDN: \`https://cdn.tailwindcss.com\`\n`;
      if (lib === 'Chart.js Summary Visuals') themeAnalysis += `  - CDN: \`https://cdn.jsdelivr.net/npm/chart.js\` (Use to display elegant responsive charts inside metric blocks)\n`;
      if (lib === 'Canvas Confetti Effects') themeAnalysis += `  - CDN: \`https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js\`\n`;
      if (lib === 'Animate.css Reveals') themeAnalysis += `  - CDN: \`https://cdnjs.cloudflare.com/ajax/libs/animate.css/4.1.1/animate.min.css\`\n`;
      if (lib === 'Lucide Icons') themeAnalysis += `  - CDN: \`https://cdn.jsdelivr.net/npm/lucide/dist/umd/lucide.min.js\`\n`;
    });
  }
  themeAnalysis += `\n`;

  // SECTION 9
  themeAnalysis += `### 9. Visual Anti-AI-Slop & Editorial "Do's and Don'ts" Checklists\n`;
  themeAnalysis += `#### ✅ DO:\n`;
  themeAnalysis += `- Write complete, working scripts for interactive inputs and transition selectors.\n`;
  themeAnalysis += `- Apply gorgeous color contrasts using HSL customized themes over default raw secondary colors.\n`;
  themeAnalysis += `- Implement print-ready styles and responsive page breaks.\n`;
  themeAnalysis += `#### ❌ DON'T:\n`;
  themeAnalysis += `- Do not write comments like \`// rest of your code goes here\` or leave empty containers.\n`;
  themeAnalysis += `- Do not load massive multi-megabyte frameworks. Rely on clean native JS logic for calculators and navigations.\n`;
  if (customGuidelines && customGuidelines.trim()) {
    themeAnalysis += `\n#### 📌 Project Specific Custom Enforcements:\n`;
    themeAnalysis += `> "${customGuidelines.trim()}"\n`;
  }

  return {
    usesTailwind,
    fonts: Array.from(new Set(htmlFonts)),
    themeAnalysis,
    projectMode,
    theme,
    palette,
    typography
  };
}

function getCustomTunnelUrl(): string {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      return data.customTunnelUrl || '';
    }
  } catch (err) {
    console.error('Error reading customTunnelUrl from settings:', err);
  }
  return '';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
async function handleGetSharingStatus(args: any) {
  if (!isOSS) {
    throw new Error('Sharing and tunneling tools are only available in local OSS mode.');
  }

  const { project_id } = args || {};
  let projectPublicAccess: boolean | undefined = undefined;

  if (project_id) {
    const db = await readDB();
    const project = db.find(p => p.id === project_id);
    if (!project) {
      throw new Error(`Project with ID '${project_id}' not found.`);
    }
    projectPublicAccess = !!project.publicTunnelEnabled;
  }

  return {
    active: !!globalWithTunnel.activeTunnel,
    url: globalWithTunnel.activeUrl || null,
    customTunnelUrl: getCustomTunnelUrl(),
    project_id: project_id || null,
    public_tunnel_enabled: projectPublicAccess
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
async function handleToggleSharingTunnel(args: any, request?: Request) {
  if (!isOSS) {
    throw new Error('Sharing and tunneling tools are only available in local OSS mode.');
  }

  const { action } = args || {};
  if (action !== 'start' && action !== 'stop') {
    throw new Error("Argument 'action' must be either 'start' or 'stop'.");
  }

  if (action === 'start') {
    if (globalWithTunnel.activeTunnel) {
      return {
        success: true,
        url: globalWithTunnel.activeUrl,
        message: 'Tunnel already running'
      };
    }

    // Determine target local port (defaults to 3000)
    let localPort = 3000;
    if (request) {
      const host = request.headers.get('host') || 'localhost:3000';
      const portString = host.split(':')[1] || '3000';
      localPort = parseInt(portString, 10) || 3000;
    }

    // Start new untun tunnel targeting our active local port
    const tunnel = await startTunnel({ port: localPort, acceptCloudflareNotice: true });
    if (!tunnel) {
      throw new Error('Failed to establish tunnel');
    }
    const url = await tunnel.getURL();

    globalWithTunnel.activeTunnel = tunnel;
    globalWithTunnel.activeUrl = url;

    return {
      success: true,
      url: url,
      message: 'Tunnel started successfully'
    };
  } else {
    // action === 'stop'
    if (globalWithTunnel.activeTunnel) {
      await globalWithTunnel.activeTunnel.close();
      globalWithTunnel.activeTunnel = undefined;
      globalWithTunnel.activeUrl = undefined;
    }
    return {
      success: true,
      message: 'Tunnel stopped successfully'
    };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
async function handleSetFolioPublicAccess(args: any, request?: Request) {
  const { project_id, enabled } = args || {};
  if (!project_id) {
    throw new Error("Argument 'project_id' is required.");
  }
  if (enabled === undefined) {
    throw new Error("Argument 'enabled' (boolean) is required.");
  }

  await runTransaction(async (db) => {
    const pIndex = db.findIndex(p => p.id === project_id);
    if (pIndex === -1) {
      throw new Error(`Project with ID '${project_id}' not found.`);
    }

    db[pIndex].publicTunnelEnabled = !!enabled;
    db[pIndex].updatedAt = new Date().toISOString();
  });

  const origin = getRequestOrigin(request);
  const activeUrl = globalWithTunnel.activeUrl;
  const shareBase = activeUrl || origin;

  return {
    success: true,
    project_id,
    public_tunnel_enabled: !!enabled,
    share_url: `${shareBase}/share/${project_id}`
  };
}

// ── Phase 1: delete / duplicate / feedback ──────────────────────────────

/** Permanently delete a folio (dual-mode). confirmed must be exactly true. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
async function handleDeleteProject(args: any) {
  const { project_id, confirmed } = args || {};
  if (!project_id) throw new Error("Argument 'project_id' is required.");
  requireConfirmed(confirmed);

  if (!isOSS) {
    const orgId = await resolveOrgIdFromHeaders();
    if (!supabaseAdmin) throw new Error('Supabase is not initialized.');

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

/** Copy a folio into the caller's account (cloud-only, grant/allowCopy aware). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
async function handleDuplicateProject(args: any) {
  if (isOSS) throw new Error('Duplicate is a cloud feature and is not available in OSS mode.');
  const { project_id } = args || {};
  if (!project_id) throw new Error("Argument 'project_id' is required.");

  const orgId = await resolveOrgIdFromHeaders();
  const userId = await resolveActingUserId(orgId);
  if (!supabaseAdmin) throw new Error('Supabase is not initialized.');

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
  let copyErrors = 0;
  for (const hash of Array.from(hashes)) {
    const { error: cpErr } = await supabaseAdmin.storage
      .from('folio-assets')
      .copy(`${sellerOrgId}/${folio.id}/${hash}`, `${orgId}/${newId}/${hash}`);
    if (cpErr) copyErrors++;
  }
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

/** Add a review comment or canvas pin (dual-mode). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
async function handleAddComment(args: any) {
  const { project_id, text, type, x, y, selector, elementHtml, slide_index, section_label, version_id, filename } = args || {};
  if (!project_id) throw new Error("Argument 'project_id' is required.");
  if (!text || typeof text !== 'string') throw new Error("Argument 'text' is required.");

  const commentType = type === 'comment' || type === 'pin' ? type : 'pin';
  const newComment: HTMLComment = {
    id: crypto.randomUUID(),
    author: 'AI Agent (MCP)',
    text: text.trim(),
    createdAt: new Date().toISOString(),
    versionId: version_id || 'latest',
    filename: filename || 'index.html',
    resolved: false,
    type: commentType,
    x: typeof x === 'number' ? x : undefined,
    y: typeof y === 'number' ? y : undefined,
    selector: typeof selector === 'string' ? selector : undefined,
    elementHtml: typeof elementHtml === 'string' ? elementHtml : undefined,
    slideIndex: typeof slide_index === 'number' ? slide_index : undefined,
    sectionLabel: typeof section_label === 'string' ? section_label : undefined,
  };

  if (!isOSS) {
    const orgId = await resolveOrgIdFromHeaders();
    if (!supabaseAdmin) throw new Error('Supabase is not initialized.');

    const { data: current, error: fetchError } = await supabaseAdmin
      .from('folios')
      .select('id, organization_id, comments, allow_comments')
      .eq('id', project_id)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (fetchError || !current) throw new Error(`Project with ID '${project_id}' not found.`);
    if (current.allow_comments === false) {
      throw new Error('Comments are disabled for this folio.');
    }
    // Note: the REST guest path also requires an access key on private folios;
    // the MCP caller is an authenticated workspace member (org-scoped select),
    // so no key round-trip is needed.

    const { error: updateError } = await supabaseAdmin
      .rpc('append_folio_comment', {
        p_folio_id: current.id,
        p_comment: newComment,
      });
    if (updateError) throw updateError;
    projectMemoryCache.invalidate(current.id);
    return { success: true, comment: newComment };
  }

  const result = await runTransaction(async (db) => {
    const idx = db.findIndex((p) => p.id === project_id);
    if (idx === -1) throw new Error(`Project with ID '${project_id}' not found.`);
    const project = db[idx];
    if (!project.comments) project.comments = [];
    project.comments.push(newComment);
    project.updatedAt = new Date().toISOString();
    db[idx] = project;
    return newComment;
  });
  return { success: true, comment: result };
}

/** Resolve / reopen / delete a comment or pin (dual-mode). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
async function handleModerateComment(args: any) {
  const { action, project_id, comment_id } = args || {};
  if (!project_id) throw new Error("Argument 'project_id' is required.");
  if (!comment_id) throw new Error("Argument 'comment_id' is required.");
  if (!['resolve', 'reopen', 'delete'].includes(action)) {
    throw new Error("Argument 'action' must be one of: resolve, reopen, delete.");
  }

  if (!isOSS) {
    const orgId = await resolveOrgIdFromHeaders();
    if (!supabaseAdmin) throw new Error('Supabase is not initialized.');

    const { data: current, error: fetchError } = await supabaseAdmin
      .from('folios')
      .select('id, comments')
      .eq('id', project_id)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (fetchError || !current) throw new Error(`Project with ID '${project_id}' not found.`);
    const comments: HTMLComment[] = current.comments || [];
    const comment = comments.find((c: HTMLComment) => c.id === comment_id);
    if (!comment) throw new Error('Comment not found.');

    if (action === 'delete') {
      const kept = comments.filter((c: HTMLComment) => c.id !== comment_id);
      const { error: updateError } = await supabaseAdmin
        .from('folios')
        .update({ comments: kept, updated_at: new Date().toISOString() })
        .eq('id', current.id)
        .eq('organization_id', orgId);
      if (updateError) throw updateError;
    } else {
      comment.resolved = action === 'resolve';
      const { error: updateError } = await supabaseAdmin
        .from('folios')
        .update({ comments, updated_at: new Date().toISOString() })
        .eq('id', current.id)
        .eq('organization_id', orgId);
      if (updateError) throw updateError;
    }
    projectMemoryCache.invalidate(current.id);
    return { success: true, action, comment_id };
  }

  await runTransaction(async (db) => {
    const idx = db.findIndex((p) => p.id === project_id);
    if (idx === -1) throw new Error(`Project with ID '${project_id}' not found.`);
    const project = db[idx];
    const comments = project.comments || [];
    const comment = comments.find((c) => c.id === comment_id);
    if (!comment) throw new Error('Comment not found.');
    if (action === 'delete') {
      project.comments = comments.filter((c) => c.id !== comment_id);
    } else {
      comment.resolved = action === 'resolve';
    }
    project.updatedAt = new Date().toISOString();
    db[idx] = project;
  });
  return { success: true, action, comment_id };
}

const VALID_REACTION_EMOJIS = ['👍', '❤️', '💡', '🔥'];
const MAX_REACTION_COUNT = 1_000_000;

/** Increment an aggregate emoji reaction count (dual-mode). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
async function handleAddReaction(args: any) {
  const { project_id, emoji } = args || {};
  if (!project_id) throw new Error("Argument 'project_id' is required.");
  if (!VALID_REACTION_EMOJIS.includes(emoji)) {
    throw new Error(`Argument 'emoji' must be one of: ${VALID_REACTION_EMOJIS.join(' ')}.`);
  }

  if (!isOSS) {
    const orgId = await resolveOrgIdFromHeaders();
    if (!supabaseAdmin) throw new Error('Supabase is not initialized.');

    const { data: current, error: fetchError } = await supabaseAdmin
      .from('folios')
      .select('id, reactions')
      .eq('id', project_id)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (fetchError || !current) throw new Error(`Project with ID '${project_id}' not found.`);
    const reactions: Record<string, number> = { ...(current.reactions || {}) };
    reactions[emoji] = Math.min(MAX_REACTION_COUNT, (reactions[emoji] || 0) + 1);

    const { error: updateError } = await supabaseAdmin
      .from('folios')
      .update({ reactions, updated_at: new Date().toISOString() })
      .eq('id', current.id)
      .eq('organization_id', orgId);
    if (updateError) throw updateError;
    return { success: true, reactions };
  }

  const result = await runTransaction(async (db) => {
    const idx = db.findIndex((p) => p.id === project_id);
    if (idx === -1) throw new Error(`Project with ID '${project_id}' not found.`);
    const project = db[idx];
    const reactions: Record<string, number> = { ...(project.reactions || {}) };
    reactions[emoji] = Math.min(MAX_REACTION_COUNT, (reactions[emoji] || 0) + 1);
    project.reactions = reactions;
    project.updatedAt = new Date().toISOString();
    db[idx] = project;
    return reactions;
  });
  return { success: true, reactions: result };
}

// ── Phase 2: sharing / paid access / listing / marketplace ─────────────

/** Read or change sharing/visibility settings (dual-mode, no version bump). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
async function handleManageSharing(args: any) {
  const { project_id, status, isPrivate, accessKey, allowComments, presentationModeOnly } = args || {};
  if (!project_id) throw new Error("Argument 'project_id' is required.");

  const hasChanges =
    status !== undefined || isPrivate !== undefined || accessKey !== undefined ||
    allowComments !== undefined || presentationModeOnly !== undefined;

  if (!isOSS) {
    const orgId = await resolveOrgIdFromHeaders();
    if (!supabaseAdmin) throw new Error('Supabase is not initialized.');

    const { data: current, error: fetchError } = await supabaseAdmin
      .from('folios')
      .select('id, is_private, access_key, allow_comments, presentation_mode_only, status')
      .eq('id', project_id)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (fetchError || !current) throw new Error(`Project with ID '${project_id}' not found.`);

    if (!hasChanges) {
      return {
        status: current.status || 'published',
        isPrivate: current.is_private ?? false,
        hasAccessKey: !!current.access_key,
        allowComments: current.allow_comments ?? true,
        presentationModeOnly: current.presentation_mode_only ?? false,
      };
    }

    if (status !== undefined && status !== 'draft' && status !== 'published') {
      throw new Error("status must be 'draft' or 'published'.");
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (status !== undefined) patch.status = status;
    if (isPrivate !== undefined) patch.is_private = !!isPrivate;
    if (accessKey !== undefined) patch.access_key = accessKey || null;
    if (allowComments !== undefined) patch.allow_comments = !!allowComments;
    if (presentationModeOnly !== undefined) patch.presentation_mode_only = !!presentationModeOnly;

    const { error: updateError } = await supabaseAdmin
      .from('folios')
      .update(patch)
      .eq('id', current.id)
      .eq('organization_id', orgId);
    if (updateError) throw updateError;
    projectMemoryCache.invalidate(current.id);

    return {
      success: true,
      status: patch.status ?? current.status ?? 'published',
      isPrivate: patch.is_private ?? current.is_private ?? false,
      hasAccessKey: !!(patch.access_key ?? current.access_key),
      allowComments: patch.allow_comments ?? current.allow_comments ?? true,
      presentationModeOnly: patch.presentation_mode_only ?? current.presentation_mode_only ?? false,
    };
  }

  // OSS — flat DB fields only.
  if (!hasChanges) {
    const db = await readDB();
    const project = db.find((p) => p.id === project_id);
    if (!project) throw new Error(`Project with ID '${project_id}' not found.`);
    return {
      status: project.status || 'published',
      isPrivate: project.isPrivate ?? false,
      hasAccessKey: !!project.accessKey,
      allowComments: project.allowComments ?? true,
      presentationModeOnly: project.presentationModeOnly ?? false,
    };
  }

  const result = await runTransaction(async (db) => {
    const idx = db.findIndex((p) => p.id === project_id);
    if (idx === -1) throw new Error(`Project with ID '${project_id}' not found.`);
    const project = db[idx];
    if (status !== undefined) project.status = status === 'published' ? 'published' : 'draft';
    if (isPrivate !== undefined) project.isPrivate = !!isPrivate;
    if (accessKey !== undefined) project.accessKey = accessKey || undefined;
    if (allowComments !== undefined) project.allowComments = !!allowComments;
    if (presentationModeOnly !== undefined) project.presentationModeOnly = !!presentationModeOnly;
    project.updatedAt = new Date().toISOString();
    db[idx] = project;
    return {
      status: project.status,
      isPrivate: project.isPrivate,
      hasAccessKey: !!project.accessKey,
      allowComments: project.allowComments,
      presentationModeOnly: project.presentationModeOnly,
    };
  });
  return { success: true, ...result };
}

/** Read or change a folio's paid-access gate (cloud-only). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
async function handleManagePaidAccess(args: any) {
  if (isOSS) throw new Error('Paid access is a cloud feature and is not available in OSS mode.');
  const { project_id, paid_access } = args || {};
  if (!project_id) throw new Error("Argument 'project_id' is required.");
  const orgId = await resolveOrgIdFromHeaders();
  if (!supabaseAdmin) throw new Error('Supabase is not initialized.');

  const { data: current, error: fetchError } = await supabaseAdmin
    .from('folios')
    .select('id, paid_access')
    .eq('id', project_id)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (fetchError || !current) throw new Error(`Project with ID '${project_id}' not found.`);

  // Read mode — no paid_access field provided.
  if (paid_access === undefined) {
    return { paid_access: current.paid_access ?? null };
  }

  // Explicit null clears the gate entirely.
  if (paid_access === null) {
    const { error } = await supabaseAdmin
      .from('folios')
      .update({ paid_access: null, updated_at: new Date().toISOString() })
      .eq('id', current.id)
      .eq('organization_id', orgId);
    if (error) throw error;
    return { success: true, paid_access: null };
  }

  const cfg = sanitizePaidAccess(paid_access);
  if (!cfg) {
    throw new Error(
      'Invalid paid_access config: expected { enabled, priceType, amountCents, currency, previewMode } with rentalDays (rental), interval (subscription), or previewSeconds (timed) as required by each mode.'
    );
  }

  const { error } = await supabaseAdmin
    .from('folios')
    .update({ paid_access: cfg, updated_at: new Date().toISOString() })
    .eq('id', current.id)
    .eq('organization_id', orgId);
  if (error) throw error;
  return { success: true, paid_access: cfg };
}

/** Read or change Explore listing metadata + eligibility (cloud-only). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
async function handleManageListing(args: any) {
  if (isOSS) throw new Error('Marketplace listings are a cloud feature and are not available in OSS mode.');
  const { project_id, listed, category, tags, creation, license } = args || {};
  if (!project_id) throw new Error("Argument 'project_id' is required.");
  const orgId = await resolveOrgIdFromHeaders();
  if (!supabaseAdmin) throw new Error('Supabase is not initialized.');

  const { data: current, error: fetchError } = await supabaseAdmin
    .from('folios')
    .select('*')
    .eq('id', project_id)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (fetchError || !current) throw new Error(`Project with ID '${project_id}' not found.`);

  const folio = transformFolioRecord(current as FolioRecord);
  const existing = folio.listing || null;

  // Read mode — no listing fields provided: current listing + eligibility.
  const hasChanges =
    listed !== undefined || category !== undefined || tags !== undefined ||
    creation !== undefined || license !== undefined;
  if (!hasChanges) {
    const eligibility = await assertCanList(orgId);
    return {
      listing: existing,
      eligibility: {
        canList: eligibility.ok,
        reason: eligibility.ok ? null : eligibility.reason,
        how_to_fix: eligibility.ok
          ? null
          : 'The workspace Owner must accept the Seller Terms (Share menu → Marketplace listing, or /tos) and the account must not be suspended. Accepting legal terms is a human action — the agent can never do it on the user\'s behalf.',
      },
    };
  }

  // Merge incoming fields over the existing listing (or defaults).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- merge buffer accepts mixed field types until sanitizeListing validates the result
  const base: any = existing
    ? { ...existing }
    : { listed: false, category: null, tags: [], creation: null, license: null, rightsAttestedAt: null };
  if (listed !== undefined) base.listed = !!listed;
  if (category !== undefined) base.category = category;
  if (tags !== undefined) base.tags = tags;
  if (creation !== undefined) base.creation = creation;
  if (license !== undefined) base.license = license;

  const sanitized = sanitizeListing(base);
  if (!sanitized) {
    throw new Error(
      'Invalid listing metadata: listed must be a boolean; category/creation must be from the allowed enums; tags max 8 lowercase; license requires kind + allowModify/allowResale/requireAttribution booleans.'
    );
  }

  const merged = preserveAttestation(sanitized, existing) || sanitized;

  const guardError = await listingWriteGuard({
    orgId,
    listed: merged.listed,
    rightsAttestedAt: merged.rightsAttestedAt,
    existingAttested: !!existing?.rightsAttestedAt,
  });
  if (guardError) {
    if (guardError === 'LISTING_NEEDS_SELLER_AGREEMENT') {
      throw new Error('Listing blocked: the workspace Owner has not accepted the Seller Terms. The Owner must accept them (Share menu → Marketplace listing, or /tos) — this is a human consent step the agent cannot perform.');
    }
    if (guardError === 'LISTING_SELLER_SUSPENDED') {
      throw new Error('Listing blocked: the seller account is suspended.');
    }
    throw new Error(
      'Listing blocked: this folio needs a rights affirmation ("I own this content or have the necessary rights/licenses"). The Owner must affirm once via the Share menu → Marketplace listing; the affirmation then carries forward on every update.'
    );
  }

  const patch: Record<string, unknown> = {
    listed: merged.listed,
    category: merged.category,
    tags: merged.tags,
    creation: merged.creation,
    license: merged.license,
    rights_attested_at: merged.rightsAttestedAt,
    updated_at: new Date().toISOString(),
  };
  const { error: updateError } = await supabaseAdmin
    .from('folios')
    .update(patch)
    .eq('id', current.id)
    .eq('organization_id', orgId);
  if (updateError) throw updateError;
  projectMemoryCache.invalidate(current.id);
  return { success: true, listing: merged };
}

/** Browse the public Explore marketplace (cloud-only). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
async function handleSearchMarketplace(args: any) {
  if (isOSS) throw new Error('Marketplace search is a cloud feature and is not available in OSS mode.');
  if (!supabaseAdmin) throw new Error('Supabase is not initialized.');

  const { category, tag, query, offset, limit } = args || {};
  const CATEGORY_VALUES = ['templates', 'websites', 'dashboards', 'reports', 'presentations', 'marketing', 'tools', 'components', 'games', 'ai-apps'];
  const pageSize = Math.min(Math.max(1, Number(limit) || 48), 48);
  const pageOffset = Math.max(0, Number(offset) || 0);

  let q = supabaseAdmin
    .from('folios_metadata')
    .select('id, organization_id, title, slug, description, project_mode, thumbnail_url, paid_access, listed, category, tags, creation, license, reactions, comments, versions, updated_at')
    .eq('status', 'published')
    .eq('is_private', false)
    .eq('moderation_status', 'ok')
    .eq('listed', true)
    .order('updated_at', { ascending: false })
    .range(pageOffset, pageOffset + pageSize - 1);

  if (typeof category === 'string' && CATEGORY_VALUES.includes(category)) {
    q = q.eq('category', category);
  }
  if (typeof tag === 'string' && tag.trim()) {
    q = q.contains('tags', [tag.trim().toLowerCase()]);
  }
  if (typeof query === 'string' && query.trim()) {
    const term = query.trim().slice(0, 100);
    q = q.or(`title.ilike.%${term}%,description.ilike.%${term}%`);
  }

  const { data: folios, error } = await q;
  if (error) throw new Error(`Marketplace search failed: ${error.message}`);

  const rows = folios || [];
  const orgIds = Array.from(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped Supabase marketplace rows
    new Set(rows.map((f: any) => f.organization_id).filter((v: unknown): v is string => Boolean(v)))
  );

  // Resolve each folio's author (@username) for canonical card links —
  // organization → Owner membership → profile username (suspended excluded).
  const ownerByOrg = new Map<string, string | null>();
  const profileIds = new Set<string>();
  if (orgIds.length > 0) {
    const { data: memberships } = await supabaseAdmin
      .from('organization_members')
      .select('organization_id, user_id')
      .in('organization_id', orgIds)
      .eq('role', 'Owner');
    for (const m of memberships || []) {
      ownerByOrg.set(m.organization_id, m.user_id);
      profileIds.add(m.user_id);
    }
  }
  const usernameById = new Map<string, string | null>();
  const suspendedIds = new Set<string>();
  if (profileIds.size > 0) {
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, username, account_status')
      .in('id', Array.from(profileIds));
    for (const p of profiles || []) {
      usernameById.set(p.id, p.username ?? null);
      if (p.account_status === 'suspended') suspendedIds.add(p.id);
    }
  }

  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://livefolio.cloud').replace(/\/+$/, '');
  const items = rows
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped Supabase marketplace rows
    .filter((f: any) => {
      const ownerId = ownerByOrg.get(f.organization_id);
      return !(ownerId && suspendedIds.has(ownerId));
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped Supabase marketplace rows
    .map((f: any) => {
      const ownerId = ownerByOrg.get(f.organization_id);
      const username = ownerId ? usernameById.get(ownerId) || null : null;
      const shareUrl = username && f.slug
        ? `${base}/@${username}/${f.slug}`
        : `${base}/share/${f.id}`;
      return {
        project_id: f.id,
        title: f.title,
        description: f.description,
        author_username: username,
        category: f.category,
        tags: f.tags || [],
        creation: f.creation,
        license: f.license,
        project_mode: f.project_mode,
        paid: !!(f.paid_access && f.paid_access.enabled),
        price: f.paid_access?.enabled
          ? { amount_cents: f.paid_access.amountCents, currency: f.paid_access.currency, price_type: f.paid_access.priceType }
          : null,
        share_url: shareUrl,
        thumbnail_url: f.thumbnail_url,
        updated_at: f.updated_at,
      };
    });

  return {
    listings: items,
    page: Math.floor(pageOffset / pageSize) + 1,
    offset: pageOffset,
    has_more: rows.length === pageSize,
  };
}

/** Start a purchase for a gated folio — returns a checkout URL to relay (cloud-only). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
async function handleBuyProject(args: any) {
  if (isOSS) throw new Error('Purchases are a cloud feature and are not available in OSS mode.');
  const { project_id } = args || {};
  if (!project_id) throw new Error("Argument 'project_id' is required.");
  const orgId = await resolveOrgIdFromHeaders();
  const userId = await resolveActingUserId(orgId);

  const result = await createGateCheckoutSession({
    userId,
    email: null, // resolved from auth admin inside the lib when needed
    targetType: 'folio',
    targetId: project_id,
    returnFolioId: null,
    returnPath: null,
  });

  if (!result.ok) {
    const map: Record<string, string> = {
      STRIPE_NOT_CONFIGURED: 'Stripe is not configured on this instance.',
      DATABASE_UNAVAILABLE: 'Database connection unavailable.',
      TARGET_NOT_FOUND: 'Folio not found (or unavailable for sale).',
      NO_GATE_CONFIGURED: 'This folio has no paid-access gate configured — it is free.',
      SUBSCRIPTIONS_NOT_YET_SUPPORTED: 'Subscription purchases are not supported yet.',
      CREATOR_NOT_CONNECTED: 'The seller has not completed Stripe Connect onboarding yet and cannot receive payments.',
      MOCK_GRANT_FAILED: 'The mock grant failed to provision.',
      FAILED: result.message || 'The checkout session could not be created.',
    };
    throw new Error(map[result.code] || result.message || result.code);
  }

  return {
    success: true,
    checkout_url: result.url,
    mock: result.mock === true,
    session_id: result.sessionId || null,
    instructions:
      'Relay the checkout_url to the user and ask them to complete payment in their browser. Then poll get_purchases with the session_id until granted.',
  };
}

/** Purchase status poll (session_id) or full history (no session_id). Cloud-only. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
async function handleGetPurchases(args: any) {
  if (isOSS) throw new Error('Purchases are a cloud feature and are not available in OSS mode.');
  if (!supabaseAdmin) throw new Error('Supabase is not initialized.');
  const { session_id } = args || {};
  const orgId = await resolveOrgIdFromHeaders();
  const userId = await resolveActingUserId(orgId);

  if (typeof session_id === 'string' && session_id) {
    const { data, error } = await supabaseAdmin
      .from('purchase_grants')
      .select('id, target_type, target_id, amount_cents, currency, granted_at')
      .eq('stripe_session_id', session_id)
      .eq('buyer_id', userId)
      .maybeSingle();
    if (error) throw new Error(`Failed to verify purchase: ${error.message}`);
    return {
      granted: !!data,
      purchase: data
        ? {
            target_type: data.target_type,
            target_id: data.target_id,
            amount_cents: data.amount_cents,
            currency: data.currency,
            granted_at: data.granted_at,
          }
        : null,
      note: data ? null : 'The webhook can lag the payment redirect — poll again shortly if the user just completed checkout.',
    };
  }

  // History — mirror /api/billing/purchases.
  await claimPendingGrants(userId, '');

  const { data: grants, error } = await supabaseAdmin
    .from('purchase_grants')
    .select('*')
    .eq('buyer_id', userId)
    .order('granted_at', { ascending: false });
  if (error) throw new Error(`Failed to load purchases: ${error.message}`);

  const rows = grants || [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped purchase_grants rows
  const folioIds = rows.filter((g: any) => g.target_type === 'folio').map((g: any) => g.target_id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped purchase_grants rows
  const workspaceIds = rows.filter((g: any) => g.target_type === 'workspace').map((g: any) => g.target_id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed DB rows for purchase targets (folios/projects)
  let folios: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed DB rows for purchase targets (folios/projects)
  let projects: any[] = [];
  if (folioIds.length > 0) {
    const { data } = await supabaseAdmin.from('folios').select('id, title, slug').in('id', folioIds);
    folios = data || [];
  }
  if (workspaceIds.length > 0) {
    const { data } = await supabaseAdmin.from('projects').select('id, name, slug, organization_id').in('id', workspaceIds);
    projects = data || [];
  }

  const ownerByOrg = new Map<string, string | null>();
  const orgIds = Array.from(new Set(projects.map((p) => p.organization_id).filter(Boolean)));
  if (orgIds.length > 0) {
    const { data: members } = await supabaseAdmin
      .from('organization_members')
      .select('organization_id, user_id')
      .in('organization_id', orgIds)
      .eq('role', 'Owner');
    const ownerIds = Array.from(new Set((members || []).map((m: { user_id: string }) => m.user_id)));
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, username')
      .in('id', ownerIds);
    const usernameById = new Map<string, string | null>((profiles || []).map((p: { id: string; username: string | null }) => [p.id, p.username ?? null]));
    for (const m of members || []) {
      ownerByOrg.set(m.organization_id, usernameById.get(m.user_id) ?? null);
    }
  }

  const folioById = new Map(folios.map((f) => [f.id, f]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://livefolio.cloud').replace(/\/+$/, '');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped purchase_grants rows
  const purchases = rows.map((g: any) => {
    const isWorkspace = g.target_type === 'workspace';
    const target = isWorkspace ? projectById.get(g.target_id) : folioById.get(g.target_id);
    const username = isWorkspace ? ownerByOrg.get(target?.organization_id) ?? null : null;
    return {
      target_type: g.target_type,
      target_id: g.target_id,
      title: target ? (isWorkspace ? target.name : target.title) : null,
      link: target
        ? isWorkspace && username && target.slug
          ? `${base}/u/${username}/w/${target.slug}`
          : `${base}/share/${target.slug || g.target_id}`
        : null,
      amount_cents: g.amount_cents,
      currency: g.currency,
      status: g.status,
      expires_at: g.expires_at,
      granted_at: g.granted_at,
    };
  });

  return { purchases, total: purchases.length };
}

/** Stripe Connect seller account status or onboarding URL (cloud-only). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
async function handleManageSellerAccount(args: any) {
  if (isOSS) throw new Error('Seller accounts are a cloud feature and are not available in OSS mode.');
  if (!supabaseAdmin) throw new Error('Supabase is not initialized.');
  const { action } = args || {};
  if (!['status', 'onboard'].includes(action)) {
    throw new Error("Argument 'action' must be one of: status, onboard.");
  }
  const orgId = await resolveOrgIdFromHeaders();
  const userId = await resolveActingUserId(orgId);

  if (action === 'onboard') {
    const result = await createSellerOnboardingLink({ userId, email: null });
    if (!result.ok) {
      if (result.code === 'ALREADY_CONNECTED') {
        throw new Error('The seller account is already connected (status active).');
      }
      throw new Error(result.message || result.code);
    }
    return {
      success: true,
      onboarding_url: result.url,
      instructions:
        'Relay the onboarding_url to the user and ask them to complete Stripe onboarding in their browser. Note: arriving at the return page does NOT mean onboarding is complete — the account status flips to active via webhook shortly after.',
    };
  }

  // status — Connect state + sales summary (mirror connect/status + connect/sales).
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('stripe_account_id, stripe_account_status')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error('Failed to load profile.');

  const { data: memberships, error: membershipsErr } = await supabaseAdmin
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', userId)
    .eq('role', 'Owner');
  if (membershipsErr) throw new Error('Failed to load sales.');

  const ownerOrgIds: string[] = (memberships || []).map((m: { organization_id: string }) => m.organization_id);
  let totalGrossCents = 0;
  let totalFeesCents = 0;
  let totalNetCents = 0;
  let salesCount = 0;

  if (ownerOrgIds.length > 0) {
    const { data: folios } = await supabaseAdmin.from('folios').select('id').in('organization_id', ownerOrgIds);
    const { data: projects } = await supabaseAdmin.from('projects').select('id').in('organization_id', ownerOrgIds);
    const folioIds: string[] = (folios || []).map((f: { id: string }) => f.id);
    const projectIds: string[] = (projects || []).map((p: { id: string }) => p.id);

    let grants: Array<{ amount_cents: number | null; status: string | null }> = [];
    if (folioIds.length > 0) {
      const { data } = await supabaseAdmin
        .from('purchase_grants')
        .select('amount_cents, status')
        .eq('target_type', 'folio')
        .in('target_id', folioIds);
      grants = grants.concat(data || []);
    }
    if (projectIds.length > 0) {
      const { data } = await supabaseAdmin
        .from('purchase_grants')
        .select('amount_cents, status')
        .eq('target_type', 'workspace')
        .in('target_id', projectIds);
      grants = grants.concat(data || []);
    }

    for (const g of grants) {
      if (g.status === 'refunded') continue; // refunds excluded
      const gross = g.amount_cents || 0;
      const fees = platformFeeCents(gross);
      totalGrossCents += gross;
      totalFeesCents += fees;
      totalNetCents += gross - fees;
      salesCount++;
    }
  }

  const status = (profile?.stripe_account_status as string | null | undefined) ?? 'none';
  return {
    connected: status === 'active',
    account_status: status,
    account_id: profile?.stripe_account_id ?? null,
    sales: {
      count: salesCount,
      gross_cents: totalGrossCents,
      platform_fees_cents: totalFeesCents,
      net_cents: totalNetCents,
    },
  };
}

// ── Phase 3: workspace folders / members / profile / social ────────────

/** List workspace folders (cloud-only — renamed from list_folio_projects). */
async function handleListWorkspaces() {
  if (isOSS) throw new Error('Workspace folders are a cloud feature and are not available in OSS mode.');
  const orgId = await resolveOrgIdFromHeaders();
  if (!supabaseAdmin) throw new Error('Supabase is not initialized.');

  const { data: projects, error } = await supabaseAdmin
    .from('projects')
    .select('id, name, slug, description, is_public, organization_id, created_at, updated_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true });

  if (error) throw error;

  const { data: folios, error: folioErr } = await supabaseAdmin
    .from('folios')
    .select('project_id')
    .eq('organization_id', orgId)
    .not('project_id', 'is', null);

  if (folioErr) throw folioErr;

  const counts = new Map<string, number>();
  for (const f of folios || []) {
    const pid = f.project_id as string;
    counts.set(pid, (counts.get(pid) || 0) + 1);
  }

  return {
    workspaces: (projects || []).map((p: { id: string; name: string | null; slug: string | null; description: string | null; is_public: boolean | null }) => ({
      project_id: p.id,
      name: p.name,
      slug: p.slug,
      description: p.description,
      is_public: p.is_public,
      folio_count: counts.get(p.id) || 0,
    })),
    total: (projects || []).length,
  };
}

/** Manage workspace folders: create / update / delete / add_folio (cloud-only). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
async function handleManageWorkspace(args: any) {
  if (isOSS) throw new Error('Workspace folders are a cloud feature and are not available in OSS mode.');
  const { action, project_id, name, description, is_public, folio_id, confirmed } = args || {};
  if (!['create', 'update', 'delete', 'add_folio'].includes(action)) {
    throw new Error("Argument 'action' must be one of: create, update, delete, add_folio.");
  }
  const orgId = await resolveOrgIdFromHeaders();
  if (!supabaseAdmin) throw new Error('Supabase is not initialized.');

  if (action === 'create') {
    if (!name || typeof name !== 'string') throw new Error("Argument 'name' is required for create.");
    const slugBase = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'untitled';
    const slug = `${slugBase}-${crypto.randomBytes(4).toString('hex')}`;
    const { data, error } = await supabaseAdmin
      .from('projects')
      .insert({
        name: name.trim(),
        description: description || null,
        is_public: is_public === true,
        slug,
        organization_id: orgId,
      })
      .select('id, name, slug, description, is_public')
      .single();
    if (error) throw error;
    return { success: true, workspace: data };
  }

  if (!project_id) throw new Error("Argument 'project_id' is required for update/delete/add_folio.");

  if (action === 'update') {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name !== undefined) patch.name = String(name).trim();
    if (description !== undefined) patch.description = description;
    if (is_public !== undefined) patch.is_public = !!is_public;
    const { data, error } = await supabaseAdmin
      .from('projects')
      .update(patch)
      .eq('id', project_id)
      .eq('organization_id', orgId)
      .select('id, name, slug, description, is_public')
      .single();
    if (error) throw new Error('Workspace folder not found or access denied.');
    return { success: true, workspace: data };
  }

  if (action === 'delete') {
    requireConfirmed(confirmed);
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('id', project_id)
      .eq('organization_id', orgId)
      .maybeSingle();
    if (fetchErr || !existing) throw new Error('Workspace folder not found or access denied.');

    const { error: deleteErr } = await supabaseAdmin
      .from('projects')
      .delete()
      .eq('id', project_id)
      .eq('organization_id', orgId);
    if (deleteErr) throw deleteErr;
    // Folios inside are detached (project_id FK SET NULL), NOT deleted.
    return { success: true, project_id, note: 'Folios inside the folder were detached, not deleted.' };
  }

  // add_folio
  if (!folio_id) throw new Error("Argument 'folio_id' is required for add_folio.");
  const { data: project, error: projErr } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', project_id)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (projErr || !project) throw new Error('Workspace folder not found or access denied.');

  const { data: folio, error: folioErr } = await supabaseAdmin
    .from('folios')
    .select('id')
    .eq('id', folio_id)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (folioErr || !folio) throw new Error('Folio not found or access denied.');

  const { error: updateErr } = await supabaseAdmin
    .from('folios')
    .update({ project_id, updated_at: new Date().toISOString() })
    .eq('id', folio_id);
  if (updateErr) throw updateErr;
  return { success: true, folio_id, project_id };
}

/** List / invite / update role / remove workspace members (cloud-only). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
async function handleManageMember(args: any) {
  if (isOSS) throw new Error('Membership management is a cloud feature and is not available in OSS mode.');
  if (!supabaseAdmin) throw new Error('Supabase is not initialized.');
  const { action, email, role, member_id } = args || {};
  const orgId = await resolveOrgIdFromHeaders();
  const userId = await resolveActingUserId(orgId);

  // List — no action.
  if (!action) {
    const { data: dbMembers, error } = await supabaseAdmin
      .from('organization_members')
      .select('id, user_id, role, created_at')
      .eq('organization_id', orgId);
    if (error) throw error;

    const members = await Promise.all(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped organization_members rows
      (dbMembers || []).map(async (m: any) => {
        let memberEmail = '';
        let memberName = 'Teammate';
        try {
          if (typeof supabaseAdmin.auth.admin.getUser === 'function') {
            const { data: authUser } = await supabaseAdmin.auth.admin.getUser(m.user_id);
            memberEmail = authUser?.user?.email || '';
            memberName = authUser?.user?.user_metadata?.full_name || memberEmail.split('@')[0] || 'Teammate';
          }
        } catch { /* defaults */ }
        return {
          member_id: m.id,
          user_id: m.user_id,
          email: memberEmail || 'teammate@company.com',
          name: memberName,
          role: m.role,
          created_at: m.created_at,
          is_self: m.user_id === userId,
        };
      })
    );
    return { members, total: members.length };
  }

  await requireRole(orgId, userId, ['Owner', 'Admin']);

  if (action === 'invite') {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Please provide a valid teammate email address.');
    }
    if (!['Admin', 'Member'].includes(role)) {
      throw new Error("Argument 'role' must be 'Admin' or 'Member'.");
    }

    const quota = await getOrganizationQuota(orgId);
    if (quota.plan === 'Free' || quota.plan === 'Pro') {
      throw new Error('Teammate seating is a Team plan feature. Please upgrade the workspace subscription to invite teammates.');
    }
    if (quota.plan === 'Team') {
      const seatsLimit = Math.max(1, Math.floor((quota.monthly_message_limit || 0) / 1000));
      const { count: memberCount } = await supabaseAdmin
        .from('organization_members')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', orgId);
      const { count: pendingCount } = await supabaseAdmin
        .from('organization_invitations')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .is('consumed_at', null);
      const used = (memberCount || 0) + (pendingCount || 0);
      if (used >= seatsLimit) {
        throw new Error(`The plan includes ${seatsLimit} seat(s) and they are all in use.`);
      }
    }

    const { data: userList, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
    if (listErr) throw listErr;
    const existingUser = userList?.users?.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped Supabase auth user row
      (u: any) => u.email?.toLowerCase() === email.toLowerCase()
    );

    if (existingUser) {
      const { error: insertErr } = await supabaseAdmin
        .from('organization_members')
        .insert({ organization_id: orgId, user_id: existingUser.id, role });
      if (insertErr) {
        if (insertErr.code === '23505') {
          throw new Error('This user is already a member of the workspace.');
        }
        throw insertErr;
      }
      return { success: true, direct: true, message: `User ${email} identified — added directly to the workspace.` };
    }

    const inviteToken = crypto.randomBytes(24).toString('hex');
    const { error: insertInviteErr } = await supabaseAdmin
      .from('organization_invitations')
      .insert({
        organization_id: orgId,
        email: email.toLowerCase(),
        role,
        token: inviteToken,
        invited_by: userId,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });
    if (insertInviteErr) throw insertInviteErr;

    let orgName = 'LiveFolio';
    try {
      const { data: org } = await supabaseAdmin.from('organizations').select('name').eq('id', orgId).single();
      if (org?.name) orgName = org.name;
    } catch { /* non-critical */ }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://livefolio.cloud';
    const inviteUrl = `${baseUrl}/register?invite=${inviteToken}&email=${encodeURIComponent(email)}&org=${orgId}&role=${role}&orgName=${encodeURIComponent(orgName)}`;
    await sendOrgInviteEmail({
      to: email,
      orgName,
      inviterName: userId, // service-role context; the UI passes a name — acceptable placeholder
      role: role as 'Admin' | 'Member',
      inviteUrl,
    });
    return { success: true, direct: false, message: `Invitation email sent to ${email}.` };
  }

  if (!member_id) throw new Error(`Argument 'member_id' is required for ${action}.`);

  const { data: targetMember, error: fetchErr } = await supabaseAdmin
    .from('organization_members')
    .select('role, user_id')
    .eq('id', member_id)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (fetchErr || !targetMember) throw new Error('Teammate seat not found in this workspace.');

  const actingRole = await requireRole(orgId, userId, ['Owner', 'Admin']);

  if (targetMember.role === 'Owner') {
    throw new Error('The Owner role cannot be changed or removed.');
  }

  if (action === 'update_role') {
    if (!['Admin', 'Member'].includes(role)) throw new Error("Argument 'role' must be 'Admin' or 'Member'.");
    if (actingRole === 'Admin' && targetMember.role === 'Admin') {
      throw new Error('Admins cannot modify fellow Admins.');
    }
    const { error: updateErr } = await supabaseAdmin
      .from('organization_members')
      .update({ role })
      .eq('id', member_id);
    if (updateErr) throw updateErr;
    return { success: true, message: `Member role updated to ${role}.` };
  }

  // remove
  const isSelfRemoval = targetMember.user_id === userId;
  if (!isSelfRemoval && actingRole === 'Admin' && targetMember.role === 'Admin') {
    throw new Error('Admins cannot remove fellow Admins.');
  }
  const { error: deleteErr } = await supabaseAdmin
    .from('organization_members')
    .delete()
    .eq('id', member_id);
  if (deleteErr) throw deleteErr;
  return { success: true, message: 'Member removed from the workspace.' };
}

/** Read or update the acting user's profile (cloud-only). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
async function handleManageProfile(args: any) {
  if (isOSS) throw new Error('Profiles are a cloud feature and are not available in OSS mode.');
  if (!supabaseAdmin) throw new Error('Supabase is not initialized.');
  const { action } = args || {};
  const orgId = await resolveOrgIdFromHeaders();
  const userId = await resolveActingUserId(orgId);

  if (action !== 'update') {
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('id, username, full_name, avatar_url, bio, website, is_public, background_url, accent_color, seller_terms_accepted_at, seller_terms_version, account_status, featured_folio_id, updated_at, created_at')
      .eq('id', userId)
      .maybeSingle();
    if (error || !profile) throw new Error('Profile not found.');

    const counts = await getProfileFollowCounts(userId);
    return {
      profile: { ...profile, followers: counts.followers, following: counts.following },
    };
  }

  const { username, full_name, bio, website, avatar_url, is_public, accent_color, featured_folio_id } = args || {};

  if (accent_color !== undefined && accent_color !== null && !/^#[0-9a-fA-F]{6}$/.test(accent_color)) {
    throw new Error('accent_color must be a #RRGGBB hex color or null.');
  }

  if (featured_folio_id !== undefined && featured_folio_id !== null) {
    const { data: folio } = await supabaseAdmin
      .from('folios')
      .select('id')
      .eq('id', featured_folio_id)
      .eq('organization_id', orgId)
      .maybeSingle();
    if (!folio) throw new Error('featured_folio_id must be one of your own folios.');
  }

  // Username changes go through the claim RPC (invalid/taken → clear error).
  if (typeof username === 'string' && username.trim()) {
    const claimed = await claimHandle(userId, username.trim());
    if (!claimed) {
      throw new Error('Username is unavailable: it may be invalid, reserved, or already taken. Try claim_handle without a username for suggestions.');
    }
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (full_name !== undefined) patch.full_name = String(full_name);
  if (bio !== undefined) patch.bio = String(bio);
  if (website !== undefined) patch.website = String(website);
  if (avatar_url !== undefined) patch.avatar_url = avatar_url;
  if (is_public !== undefined) patch.is_public = !!is_public;
  if (accent_color !== undefined) patch.accent_color = accent_color;
  if (featured_folio_id !== undefined) patch.featured_folio_id = featured_folio_id;

  const { data: updated, error } = await supabaseAdmin
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select('id, username, full_name, avatar_url, bio, website, is_public, accent_color, featured_folio_id')
    .maybeSingle();
  if (error) throw error;
  return { success: true, profile: updated };
}

/** Claim a @username or get suggestions (cloud-only). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
async function handleClaimHandle(args: any) {
  if (isOSS) throw new Error('Handles are a cloud feature and are not available in OSS mode.');
  const { username } = args || {};
  const orgId = await resolveOrgIdFromHeaders();
  const userId = await resolveActingUserId(orgId);

  if (typeof username === 'string' && username.trim()) {
    const claimed = await claimHandle(userId, username.trim());
    if (!claimed) {
      const availability = await isHandleAvailable(username.trim());
      if (!availability.available && availability.reason === 'taken') {
        throw new Error(`@${username.trim()} is already taken.`);
      }
      throw new Error(`@${username.trim()} is not available: it may be invalid or reserved. Use claim_handle without a username for suggestions.`);
    }
    return { success: true, username: claimed };
  }

  const suggestions = await suggestHandles(userId);
  return { suggestions };
}

/** Follow / unfollow a creator by @username (cloud-only). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
async function handleFollowProfile(args: any) {
  if (isOSS) throw new Error('Follows are a cloud feature and are not available in OSS mode.');
  if (!supabaseAdmin) throw new Error('Supabase is not initialized.');
  const { username } = args || {};
  if (!username || typeof username !== 'string') throw new Error("Argument 'username' is required.");

  const orgId = await resolveOrgIdFromHeaders();
  const userId = await resolveActingUserId(orgId);

  const targetId = await resolveProfileId(username.trim());
  if (!targetId) throw new Error(`Profile '@${username}' not found.`);
  if (targetId === userId) throw new Error('Cannot follow yourself.');

  const { data: existing } = await supabaseAdmin
    .from('profile_followers')
    .select('id')
    .eq('follower_id', userId)
    .eq('following_id', targetId)
    .maybeSingle();

  if (existing) {
    await supabaseAdmin
      .from('profile_followers')
      .delete()
      .eq('follower_id', userId)
      .eq('following_id', targetId);
  } else {
    const { error: insertErr } = await supabaseAdmin
      .from('profile_followers')
      .insert({ follower_id: userId, following_id: targetId });
    if (insertErr) throw insertErr;
  }

  const counts = await getProfileFollowCounts(targetId);
  return { following: !existing, follower_count: counts.followers };
}

/** Read a creator's public profile + catalog by @username (cloud-only). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
async function handleGetPublicProfile(args: any) {
  if (isOSS) throw new Error('Public profiles are a cloud feature and are not available in OSS mode.');
  if (!supabaseAdmin) throw new Error('Supabase is not initialized.');
  const { username } = args || {};
  if (!username || typeof username !== 'string') throw new Error("Argument 'username' is required.");

  const targetId = await resolveProfileId(username.trim());
  if (!targetId) throw new Error(`Profile '@${username}' not found.`);

  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('id, username, full_name, avatar_url, bio, website, is_public, background_url, accent_color, created_at')
    .eq('id', targetId)
    .maybeSingle();
  if (error || !profile) throw new Error(`Profile '@${username}' not found.`);
  if (profile.is_public === false) {
    return { profile: { username: profile.username, full_name: profile.full_name, is_public: false }, note: 'This profile is private.' };
  }

  const counts = await getProfileFollowCounts(targetId);

  // Public folios live in the org where this creator is Owner.
  const { data: membership } = await supabaseAdmin
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', targetId)
    .eq('role', 'Owner')
    .maybeSingle();

  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://livefolio.cloud').replace(/\/+$/, '');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed DB rows for a creator's public folios
  let folios: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed DB rows for a creator's public workspaces
  let workspaces: any[] = [];

  if (membership) {
    const orgId = membership.organization_id;
    const { data: folioRows, error: folioErr } = await supabaseAdmin
      .from('folios')
      .select('id, title, slug, description, project_mode, thumbnail_url, paid_access, listed, category, tags, creation, license, reactions, updated_at')
      .eq('organization_id', orgId)
      .eq('status', 'published')
      .eq('is_private', false)
      .eq('moderation_status', 'ok')
      .order('updated_at', { ascending: false });
    if (folioErr) throw folioErr;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped Supabase folio rows
    folios = (folioRows || []).map((f: any) => ({
      project_id: f.id,
      title: f.title,
      description: f.description,
      share_url: f.slug ? `${base}/@${profile.username}/${f.slug}` : `${base}/share/${f.id}`,
      project_mode: f.project_mode,
      thumbnail_url: f.thumbnail_url,
      listed_in_explore: f.listed === true,
      category: f.category,
      tags: f.tags || [],
      paid: !!(f.paid_access && f.paid_access.enabled),
      price: f.paid_access?.enabled
        ? { amount_cents: f.paid_access.amountCents, currency: f.paid_access.currency, price_type: f.paid_access.priceType }
        : null,
      reactions: f.reactions || {},
      updated_at: f.updated_at,
    }));

    const { data: projectRows, error: projErr } = await supabaseAdmin
      .from('projects')
      .select('id, name, slug, description, is_public')
      .eq('organization_id', orgId)
      .eq('is_public', true);
    if (projErr) throw projErr;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped Supabase project rows
    workspaces = (projectRows || []).map((p: any) => ({
      project_id: p.id,
      name: p.name,
      url: p.slug ? `${base}/u/${profile.username}/w/${p.slug}` : null,
      description: p.description,
    }));
  }

  return {
    profile: {
      username: profile.username,
      full_name: profile.full_name,
      avatar_url: profile.avatar_url,
      bio: profile.bio,
      website: profile.website,
      accent_color: profile.accent_color,
      joined_at: profile.created_at,
    },
    stats: { followers: counts.followers, following: counts.following },
    folios,
    folio_count: folios.length,
    workspaces,
  };
}
