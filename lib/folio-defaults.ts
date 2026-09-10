/**
 * Folio creation defaults — the single source of truth for every creation
 * entry point (Epic #135, GitHub #142).
 *
 * Before this file existed, FIVE entry points applied divergent defaults:
 *
 * 1. MCP `create_project`         — app/api/mcp/route.ts (handleCreateProject)
 *    mode: 'document' · description: 'Created via Universal LiveFolio MCP'
 *    v1 commit: 'Initial publish via MCP Client'
 * 2. REST `POST /api/files`       — app/api/files/route.ts
 *    mode: 'deck' · description: 'Custom HTML Multipages'
 *    v1 commit: 'Genesis Initial Draft Commit'
 *    (no allowComments / presentationModeOnly persisted at all)
 * 3. AI `POST /api/files/ai-create` — app/api/files/ai-create/route.ts
 *    mode: AI-extracted · description: AI-extracted
 *    v1 commit: `AI-generated ${mode}: ${title}`
 * 4. Dashboard instant onboard    — app/dashboard/page.tsx (handleInstantOnboard)
 *    mode: 'deck' (explicit) · description: `An interactive ${mode} project.`
 *    (posts to #2, so inherits its commit message)
 * 5. Library instant onboard      — app/dashboard/library/page.tsx (handleInstantOnboard)
 *    same as #4
 *
 * This module unifies the *fallback* values. Callers that pass explicit values
 * (e.g. MCP agents always set `project_mode`) still win — these are defaults,
 * not overrides.
 *
 * OSS-safe: no imports at all — safe for both flat-file (OSS) and Supabase
 * (Cloud) modes, and syncs to the OSS repo unchanged.
 */

/**
 * Unified creation defaults consumed by ALL entry points.
 *
 * Why each value was chosen:
 *
 * - `projectMode: 'deck'` — REST + both dashboard instant paths (3 of 5 entry
 *   points, and the most common human creation flow) already default to
 *   'deck'. MCP was the outlier with 'document', but MCP callers explicitly
 *   pass `project_mode` in practice (the tool schema documents it), so
 *   unifying on 'deck' changes nothing for real agent traffic.
 *
 * - `description: 'An interactive folio.'` — replaces the 3 divergent
 *   descriptions ('Created via Universal LiveFolio MCP', 'Custom HTML
 *   Multipages', `An interactive ${mode} project.`). Neutral, short, and
 *   accurate for every mode; does not leak the creation channel into
 *   user-visible metadata.
 *
 * - `isPrivate: false` — every entry point already defaulted to public;
 *   folios are a sharing product, so public-by-default is intentional.
 *
 * - `allowComments: true` — MCP's existing default; REST/ai-create never
 *   persisted it, and readers treat `undefined` as enabled, so `true` is the
 *   behavior-preserving explicit value.
 *
 * - `presentationModeOnly: false` — MCP's existing default; opt-in feature,
 *   off unless the caller asks for it.
 *
 * - `status: 'draft'` — all 5 entry points already default to 'draft'
 *   (`body.status || 'draft'` / `args?.status || 'draft'`); publishing is an
 *   explicit act.
 */
export const FOLIO_DEFAULTS = {
  projectMode: 'deck' as const,    // Most common UI creation path; MCP callers explicitly override
  description: 'An interactive folio.',  // Neutral; shorter than the 3 divergent descriptions today
  isPrivate: false,
  allowComments: true,
  presentationModeOnly: false,
  status: 'draft' as const,
} as const;

/**
 * Canonical version-1 identifiers and commit messages.
 *
 * Every entry point creates the first `HTMLVersion` with `versionId: 'v1'`
 * but a different `commitMessage`. The channel-specific messages are kept
 * (they are useful provenance in version history) but centralized here so
 * they can never drift again:
 *
 * - `initial`   — the shared first-version id ('v1') used by all creators.
 * - `commitMCP` — used by MCP `create_project` (app/api/mcp/route.ts).
 * - `commitAPI` — used by REST `POST /api/files` (app/api/files/route.ts),
 *   and therefore by both dashboard instant-onboard paths that post to it.
 * - `commitAI`  — used by `POST /api/files/ai-create`; parameterized on the
 *   generated mode and title, matching its existing template literal.
 * - `commitWebhook` — used by the inbound webhook (app/api/webhooks/inbound/route.ts).
 */
export const VERSION_MESSAGES = {
  initial: 'v1',
  commitMCP: 'Initial publish via MCP Client',
  commitAPI: 'Genesis Initial Draft Commit',
  commitAI: (mode: string, title: string) => `AI-generated ${mode}: ${title}`,
  commitWebhook: 'Initial publish via Webhook',
} as const;
