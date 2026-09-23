import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { isOSS } from '@/lib/env';
import { isLocalHost } from '@/lib/network';
import { supabaseAdmin } from '@/lib/supabase';
import crypto from 'crypto';
import { globalWithTunnel, _tokenOrgCache, writeTokenOrgCache } from '@/lib/mcp/shared';
import type { SseSession } from '@/lib/mcp/shared';
import { handleListProjects, handleGetProject, handleCreateProject, handleUpdateProject, handleDeleteProject, handleDuplicateProject, handleArchiveFolio, handleUnarchiveFolio } from '@/lib/mcp/tools/folios';
import { handleGetCuratedBrief, handleGetActiveDesignSystem, handleAddComment, handleModerateComment, handleAddReaction } from '@/lib/mcp/tools/feedback';
import { handleGetSharingStatus, handleToggleSharingTunnel, handleSetFolioPublicAccess, handleManageSharing } from '@/lib/mcp/tools/sharing';
import { handleManagePaidAccess, handleManageListing, handleSearchMarketplace, handleBuyProject, handleGetPurchases, handleManageSellerAccount, MARKETPLACE_TOOLS, MARKETPLACE_INSTRUCTION_LINES } from '@/lib/mcp/tools/marketplace';
import { handleListWorkspaces, handleManageWorkspace, handleManageMember } from '@/lib/mcp/tools/workspace';
import { handleManageProfile, handleClaimHandle, handleFollowProfile, handleGetPublicProfile } from '@/lib/mcp/tools/social';

/** Hard bound on concurrent SSE streams held in memory (per server process). */
const SSE_SESSION_MAX = 500;

/** A stream with no client activity for this long is considered abandoned. */
const SSE_SESSION_IDLE_TTL_MS = 30 * 60_000;

/** Heartbeat cadence; the sweep piggybacks on it (never more often than this). */
const SSE_SWEEP_INTERVAL_MS = 15_000;

let _sseLastSweepAt = 0;

/**
 * Identity that owns an SSE stream, derived from what authenticated the
 * request. The middleware-verified `x-organization-id` is authoritative and is
 * present for BOTH bearer- and query-key-authenticated `/api/mcp` requests, so
 * a client that reconnects (or POSTs back to the endpoint URL it was handed)
 * with the same credentials derives the same value. Requests that carry no
 * middleware identity (OSS, `isOSS`) fall back to a fingerprint of the
 * credential actually presented.
 */
async function resolveSseOwnerKey(request: Request): Promise<string> {
  const midOrg = request.headers.get('x-organization-id');
  if (midOrg) return `org:${midOrg}`;

  const authHeader = request.headers.get('authorization');
  const token = authHeader ? authHeader.replace('Bearer ', '').trim() : '';
  const url = new URL(request.url);
  const credential = token || url.searchParams.get('key') || '';

  // Cloud: a raw bearer/query key that resolves to an org carries that org's
  // identity — the same org the middleware would have injected.
  if (!isOSS && credential && supabaseAdmin) {
    try {
      const cached = _tokenOrgCache.get(credential);
      if (cached && cached.expiresAt > Date.now()) return `org:${cached.orgId}`;

      const { data, error } = await supabaseAdmin
        .from('organizations')
        .select('id')
        .eq('api_key', credential)
        .maybeSingle();
      if (!error && data) {
        writeTokenOrgCache(credential, data.id);
        return `org:${data.id}`;
      }
    } catch (err) {
      console.error('[MCP SSE] owner identity lookup failed:', err);
    }
  }

  if (credential) {
    // Never store the credential itself — only a digest.
    return `cred:${crypto.createHash('sha256').update(credential).digest('hex')}`;
  }
  return isOSS ? 'oss:local' : 'cloud:anonymous';
}

/** Drop a session's entry and tear down its stream + heartbeat. */
function dropSseSession(sessionId: string, session: SseSession): void {
  globalWithTunnel.mcpSseConnections!.delete(sessionId);
  try {
    session.stop?.();
  } catch { /* interval already cleared */ }
  try {
    session.controller.close();
  } catch { /* stream already closed/errored — nothing left to release */ }
}

/**
 * Reap idle sessions. Runs at most once per SSE_SWEEP_INTERVAL_MS globally
 * (called from the 15s heartbeat) so N streams don't each sweep the map.
 */
function sweepSseSessions(now: number): void {
  if (now - _sseLastSweepAt < SSE_SWEEP_INTERVAL_MS) return;
  _sseLastSweepAt = now;
  // forEach (not `for...of`) — this tsconfig target can't downlevel-iterate a
  // Map, and deleting the current entry inside forEach is well-defined.
  globalWithTunnel.mcpSseConnections!.forEach((session, id) => {
    if (now - session.lastActivityAt >= SSE_SESSION_IDLE_TTL_MS) {
      console.log(`[MCP DEBUG] Reaping idle SSE session ${id}`);
      dropSseSession(id, session);
    }
  });
}

/**
 * Register a stream, evicting stale/oldest entries when the map is full.
 * Returns null when the caller could not be admitted (stream closed instead).
 */
function registerSseSession(
  sessionId: string,
  controller: ReadableStreamDefaultController,
  owner: string
): SseSession | null {
  const map = globalWithTunnel.mcpSseConnections!;
  const now = Date.now();
  sweepSseSessions(now);

  if (map.size >= SSE_SESSION_MAX) {
    // Reclaim expired entries first; only if that frees nothing do we evict
    // least-recently-active (Map preserves insertion order; POSTs re-insert).
    while (map.size >= SSE_SESSION_MAX) {
      const oldestId = map.keys().next().value as string | undefined;
      if (oldestId === undefined) break;
      const oldest = map.get(oldestId);
      if (!oldest) {
        map.delete(oldestId);
        continue;
      }
      console.warn(`[MCP SSE] Session cap (${SSE_SESSION_MAX}) reached — evicting ${oldestId}`);
      dropSseSession(oldestId, oldest);
    }
  }

  const session: SseSession = { controller, owner, createdAt: now, lastActivityAt: now };
  map.set(sessionId, session);
  return session;
}

/**
 * Look up a session, dropping it when it has idled past the TTL. Returns null
 * for unknown/expired ids so callers fall back to a plain JSON-RPC response.
 */
function readSseSession(sessionId: string): SseSession | null {
  const map = globalWithTunnel.mcpSseConnections!;
  const session = map.get(sessionId);
  if (!session) return null;
  const now = Date.now();
  if (now - session.lastActivityAt >= SSE_SESSION_IDLE_TTL_MS) {
    console.log(`[MCP DEBUG] SSE session ${sessionId} expired (idle)`);
    dropSseSession(sessionId, session);
    return null;
  }
  return session;
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
  // Bind the stream to whoever authenticated this GET (see resolveSseOwnerKey).
  const ownerKey = await resolveSseOwnerKey(request);

  console.log(`[MCP DEBUG] GET SSE Connection approved. SessionId generated: ${sessionId}`);

  const encoder = new TextEncoder();
  let heartbeatInterval: NodeJS.Timeout;

  const stream = new ReadableStream({
    start(controller) {
      const session = registerSseSession(sessionId, controller, ownerKey);
      if (!session) {
        // Cap reached with nothing evictable — end the stream instead of
        // growing the map past its bound.
        console.error(`[MCP DEBUG] SSE Connection refused: session cap reached`);
        try { controller.close(); } catch { /* already closed */ }
        return;
      }

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
        // Reap abandoned sessions on the heartbeat cadence. The sweep is
        // rate-limited globally, so N open streams don't each walk the map.
        sweepSseSessions(Date.now());
        try {
          controller.enqueue(encoder.encode(`:\n\n`));
        } catch {
          clearInterval(heartbeatInterval);
          globalWithTunnel.mcpSseConnections!.delete(sessionId);
        }
      }, SSE_SWEEP_INTERVAL_MS);
      // Let the map's eviction/sweep path clear this stream's interval too.
      session.stop = () => clearInterval(heartbeatInterval);
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
          writeTokenOrgCache(candidate, data.id);
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

const TOOLS: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> = (() => {
  const tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> = [
    {
      name: "list_projects",
      description: "List all existing LiveFolio projects/folios. Returns IDs, titles, descriptions, file counts, version counts, open comment counts, and an `archived` flag per folio. Archived folios are omitted by default — pass include_archived:true to see them too. Call this first to discover what projects exist before creating or updating.",
      inputSchema: {
        type: "object",
        properties: {
          include_archived: { type: "boolean", description: "Include archived folios in the results. Default false — archived folios are hidden." }
        },
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
    },
    {
      name: "archive_folio",
      description: "Archive a folio: it is unpublished and unlisted from Explore, and hidden from all public surfaces (share links, profile, workspace pages) — only the owner keeps access, in the Archived section. The folio is NOT deleted and still counts toward storage quota. Reversible with unarchive_folio, which returns it as a DRAFT (it never republishes itself). Idempotent.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "The ID of the folio to archive" }
        },
        required: ["project_id"]
      }
    },
    {
      name: "unarchive_folio",
      description: "Restore an archived folio. It comes back as a DRAFT and stays unlisted — nothing republishes automatically. Use manage_sharing with status:'published' afterwards if the owner wants it live again.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "The ID of the folio to unarchive" }
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
      // Commercial tool definitions live in lib/mcp/tools/marketplace.ts,
      // which is excluded from the self-hosted build because these
      // descriptions name the paid-purchase and seller-onboarding flow while
      // this route file ships. Spread at this exact position so registry
      // order is unchanged; the self-hosted tree gets an empty array.
      ...MARKETPLACE_TOOLS,
      {
        name: "list_workspaces",
        description: "List the workspace folders that organize folios, with id, name, slug, is_public, folio_count, and an `archived` flag. Archived workspaces are omitted by default — pass include_archived:true to see them too. Use these IDs to organize folios via manage_workspace.",
        inputSchema: {
          type: "object",
          properties: {
            include_archived: { type: "boolean", description: "Include archived workspaces in the results. Default false — archived workspaces are hidden." }
          },
          required: []
        }
      },
      {
        name: "manage_workspace",
        description: "Manage workspace folders that organize folios. action 'create': new folder (name, optional description, optional is_public). 'update': rename, description, or public visibility. 'delete': PERMANENTLY DELETE the folder — folios inside are detached, NOT deleted — requires confirmed:true. 'add_folio': move a folio into the folder. 'archive': hide the folder and unpublish/unlist EVERY folio inside it (nothing is deleted; archived folios still count toward storage). 'unarchive': restore the folder and its folios as DRAFTS — nothing republishes automatically.",
        inputSchema: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["create", "update", "delete", "add_folio", "archive", "unarchive"], description: "The workspace action" },
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
  return tools;
})();

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

  // Resolve (and reap, if idle) the target stream once, up front. An unknown
  // or expired id is not an error: the caller still gets a plain JSON-RPC
  // response below, exactly as before.
  const sseSession = sessionId ? readSseSession(sessionId) : null;

  // Ownership: a session id that belongs to another identity must never be
  // enqueued onto — otherwise any authenticated caller holding a leaked id
  // could inject payloads into that tenant's stream. Rejected with the same
  // challenge shape as a failed validateAuth().
  if (sseSession && sseSession.owner !== (await resolveSseOwnerKey(request))) {
    console.warn(`[MCP DEBUG] POST rejected: session ${sessionId} was not opened by this identity`);
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized. This MCP session belongs to a different identity." },
        id: null
      },
      { status: 401, headers: { ...CORS_HEADERS, 'WWW-Authenticate': wwwAuthenticate() } }
    );
  }

  const jsonResponse = (payload: unknown, init?: ResponseInit) => {
    if (sseSession && sessionId) {
      const encoder = new TextEncoder();
      try {
        console.log(`[MCP DEBUG] POST Session ${sessionId} enqueuing message (payload redacted)`);
        sseSession.controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(payload)}\n\n`));
        sseSession.lastActivityAt = Date.now();
        // Re-insert at the tail (Map preserves insertion order) so an active
        // session is the last one evicted when the map is at its cap.
        globalWithTunnel.mcpSseConnections!.delete(sessionId);
        globalWithTunnel.mcpSseConnections!.set(sessionId, sseSession);
        return new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
        });
      } catch (err) {
        console.error(`[MCP DEBUG] SSE stream write error for session ${sessionId}:`, err);
        globalWithTunnel.mcpSseConnections!.delete(sessionId);
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
            // Commercial capability lines live in the excluded marketplace module.
            // A runtime isOSS guard cannot hide a string from a bundle, so they
            // must be physically absent from this file.
            ...MARKETPLACE_INSTRUCTION_LINES,
            "FOLIOS: list_projects (include_archived:true to see archived) · get_project (includes visibility + analytics) · create_project (html/mode/design) · update_project (files/title/description — versioned) · delete_project (confirmed:true) · duplicate_project · archive_folio / unarchive_folio (unarchive returns a DRAFT — never auto-republished; an archived folio is unpublished, unlisted, and hidden everywhere public, but still counts toward storage).",
            "FEEDBACK: get_curated_brief · get_active_design_system · add_comment (pins with x/y/selector) · moderate_comment (resolve|reopen|delete) · add_reaction (👍 ❤️ 💡 🔥).",
            "WORKSPACE: list_workspaces (include_archived:true to see archived) · manage_workspace (create|update|delete|add_folio|archive|unarchive) · manage_member (no action = list; invite|update_role|remove).",
            "PROFILE & SOCIAL: manage_profile (no action = read) · claim_handle (no username = suggestions) · follow_profile · get_public_profile (discover a creator's catalog by @username).",
            "CONVENTIONS:",
            "- Archiving is NOT the same as unpublishing. manage_sharing with status:'draft' only unpublishes — the folio stays in the active list. Only archive_folio archives. Confirm with get_project (archived / archived_at); a folio that reads status:'draft' with archived:false was unpublished, not archived. If archive_folio is missing from your tool list, your list is stale — re-read the tools before telling the user an archive succeeded.",
            "- 'No args = read' applies to manage_listing, manage_sharing, manage_paid_access, manage_profile, manage_member, claim_handle, get_purchases.",
            "- Destructive tools (delete_project, manage_workspace delete) require confirmed:true — the exact boolean.",
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
      return jsonResponse({
        jsonrpc: "2.0",
        result: { tools: TOOLS },
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

    // Direct RPC aliases for clients that don't wrap calls in `tools/call`.
    // This is a long-standing public surface, so the aliases stay — but they
    // no longer keep a second, hand-wired dispatch table. Both paths resolve
    // the same entry from TOOL_HANDLERS, which is exactly why every advertised
    // tool is now reachable here: the hand-wired list covered 11 of the 30,
    // and the other 19 fell through to `-32601 Method not found`.
    //
    // Argument shape is deliberately unchanged: this path hands the handler the
    // raw `params` object, while `tools/call` hands it `params.arguments`. The
    // handlers read e.g. `include_archived` off whatever they are given.
    //
    // Response shape is unchanged too: direct RPC returns the handler's raw
    // result, while `tools/call` wraps it in an MCP content envelope.
    const directHandler = TOOL_HANDLERS.get(method);
    if (directHandler) {
      const result = await directHandler(params, request);
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
type ToolHandler = (args: any, request?: Request) => Promise<any>;

/**
 * Single source of truth for tool dispatch, keyed by the tool name advertised
 * in `TOOLS`. Both entry points resolve through this table:
 *
 *   - `tools/call`  → `handleToolCall` (wraps the result in MCP content)
 *   - direct RPC    → the method-name aliases in POST (raw result)
 *
 * Keeping them on one table is what stops the two paths drifting in *which*
 * tools exist or *what* arguments a handler receives. A Map (not a plain
 * object) is deliberate: `TOOL_HANDLERS.get('toString')` is undefined, so an
 * RPC method named after an Object.prototype member still gets `-32601`.
 */
const TOOL_HANDLERS = new Map<string, ToolHandler>([
  // `list_projects` is the one handler whose signature is (request, args) —
  // the wrapper normalises it to the (args, request) shape of every other
  // entry, so both dispatch paths call it identically.
  ['list_projects', (args, request) => handleListProjects(request, args)],
  ['get_project', handleGetProject],
  ['create_project', handleCreateProject],
  ['update_project', handleUpdateProject],
  ['get_curated_brief', handleGetCuratedBrief],
  ['get_active_design_system', handleGetActiveDesignSystem],
  ['get_sharing_status', handleGetSharingStatus],
  ['toggle_sharing_tunnel', handleToggleSharingTunnel],
  ['set_folio_public_access', handleSetFolioPublicAccess],
  ['delete_project', handleDeleteProject],
  ['duplicate_project', handleDuplicateProject],
  ['add_comment', handleAddComment],
  ['moderate_comment', handleModerateComment],
  ['add_reaction', handleAddReaction],
  ['manage_sharing', handleManageSharing],
  ['archive_folio', handleArchiveFolio],
  ['unarchive_folio', handleUnarchiveFolio],
  ['manage_paid_access', handleManagePaidAccess],
  ['manage_listing', handleManageListing],
  ['search_marketplace', handleSearchMarketplace],
  ['buy_project', handleBuyProject],
  ['get_purchases', handleGetPurchases],
  ['manage_seller_account', handleManageSellerAccount],
  ['list_workspaces', handleListWorkspaces],
  ['manage_workspace', handleManageWorkspace],
  ['manage_member', handleManageMember],
  ['manage_profile', handleManageProfile],
  ['claim_handle', handleClaimHandle],
  ['follow_profile', handleFollowProfile],
  ['get_public_profile', handleGetPublicProfile],
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
async function handleToolCall(name: string, args: any, request?: Request) {
  try {
    // Resolve the handler from the shared dispatch table — the same table the
    // direct-RPC aliases use, so the two paths cannot disagree about which
    // tools exist or what arguments a handler receives. (This path passes
    // `params.arguments`; the direct path passes the raw `params`.)
    const handler = TOOL_HANDLERS.get(name);
    if (!handler) {
      return {
        content: [{ type: 'text', text: `Error: Tool '${name}' not found.` }],
        isError: true
      };
    }

    const res = await handler(args, request);

    // Everything else is serialized for transport with compact JSON.stringify —
    // indentation is not meaningful to the calling agent and `null, 2` inflated
    // both the wire payload and the CPU spent formatting multi-MB folio reads.
    // Two tools are the exception: their payload IS a pre-rendered document, so
    // the text is that document's body rather than JSON.
    const text =
      name === 'get_curated_brief' && typeof res.brief === 'string' ? res.brief
      : name === 'get_active_design_system' && typeof res.themeAnalysis === 'string' ? res.themeAnalysis
      : JSON.stringify(res);

    return { content: [{ type: 'text', text }] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool execution may throw non-Error values; .message is read defensively
  } catch (e: any) {
    return {
      content: [{ type: 'text', text: `Error executing tool: ${e.message}` }],
      isError: true
    };
  }
}
