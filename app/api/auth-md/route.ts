import { NextResponse } from 'next/server';

/**
 * GET /api/auth-md
 *
 * Machine-readable JSON version of auth.md for AI agents.
 * Returns structured endpoint schemas, curl examples, and supported flows.
 *
 * AI agents (ChatGPT, Claude, Gemini) fetch this to understand how to
 * register and authenticate with LiveFolio programmatically.
 */

export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://livefolio.cloud';

  return NextResponse.json({
    // ── JSON-LD / Schema.org metadata for AI crawlers ────────────────────
    '@context': 'https://schema.org',
    '@type': 'WebAPI',
    name: 'LiveFolio Agent Authentication (auth.md)',
    description:
      'AI agents can autonomously register accounts and authenticate with LiveFolio on behalf of users. Three flows: signed-JWT (ID-JAG) for hosted platforms, one-click email authorization (magic link with OTP fallback) for CLI agents, and OAuth 2.0 + PKCE for desktop/IDE MCP connectors.',
    url: `${baseUrl}/auth.md`,
    version: '1.2.0',
    provider: {
      '@type': 'Organization',
      name: 'LiveFolio',
      url: baseUrl,
    },

    // ── Base configuration ──────────────────────────────────────────────
    baseUrl,
    mcpEndpoint: `${baseUrl}/api/mcp`,

    // ── Supported flows ──────────────────────────────────────────────────
    flows: [
      {
        id: 'identity_assertion',
        name: 'Agent Verified (ID-JAG)',
        description:
          'Instant API key via signed JWT identity assertion. Hosted instances require HS256-signed JWTs (platform-partner credentials). Unsigned (alg:none) JWTs are rejected on hosted and accepted only in local OSS development when explicitly enabled. Best for hosted LLM platforms (ChatGPT, Claude API, Gemini).',
        steps: [
          {
            step: 1,
            title: 'Construct identity assertion JWT',
            method: null,
            endpoint: null,
            notes: 'Platform partners receive a shared signing secret. Sign with HS256 and include an exp claim. Hosted instances never accept unsigned JWTs.',
            request: {
              jwt_header: { alg: 'HS256', typ: 'JWT' },
              jwt_payload: {
                email: 'user@example.com',
                sub: 'user@example.com',
                iss: 'your-agent-name',
                iat: 1719705600,
                aud: 'livefolio',
                exp: 1719792000,
              },
              encoding: 'base64url(header).base64url(payload).signature',
            },
            curl: "# Create HS256-signed JWT (requires LIVEFOLIO_JWT_SECRET)\nHEADER=$(echo -n '{\"alg\":\"HS256\",\"typ\":\"JWT\"}' | base64 -w0 | tr '/+' '_-' | tr -d '=')\nPAYLOAD=$(echo -n '{\"email\":\"user@example.com\",\"sub\":\"user@example.com\",\"iss\":\"my-agent\",\"iat\":'$(date +%s)',\"aud\":\"livefolio\"}' | base64 -w0 | tr '/+' '_-' | tr -d '=')\nSIGNING_INPUT=\"${HEADER}.${PAYLOAD}\"\nSIGNATURE=$(echo -n \"$SIGNING_INPUT\" | openssl dgst -sha256 -hmac \"$LIVEFOLIO_JWT_SECRET\" -binary | base64 -w0 | tr '/+' '_-' | tr -d '=')\nJWT=\"${SIGNING_INPUT}.${SIGNATURE}\"",
          },
          {
            step: 2,
            title: 'POST identity assertion',
            method: 'POST',
            endpoint: '/api/agent/auth',
            request: {
              body: {
                type: 'identity_assertion',
                assertion: '<JWT>',
              },
            },
            response: {
              status: 'completed',
              credential: {
                access_token: 'lf_live_...',
                token_type: 'Bearer',
                organization: { id: 'uuid', name: 'org-name', plan: 'Free' },
              },
            },
            curl: `curl -X POST ${baseUrl}/api/agent/auth \\\n  -H "Content-Type: application/json" \\\n  -d '{"type":"identity_assertion","assertion":"'$JWT'"}'`,
          },
        ],
      },
      {
        id: 'otp_claim',
        name: 'User Claimed (One-Click Authorize)',
        description:
          'One-click email authorization (magic link) with 6-digit OTP fallback. The user clicks the emailed claim_url and the agent polls for completion — no code copy-paste. Best for CLI agents (Claude Code, Cursor).',
        steps: [
          {
            step: 1,
            title: 'Create registration session',
            method: 'POST',
            endpoint: '/api/agent/auth',
            request: { body: { type: 'anonymous' } },
            response: {
              registration_session_id: 'uuid',
              status: 'pending_claim',
              credential: {
                token: 'lf_preclaim_...',
                token_type: 'APIKey',
                expires_at: 'ISO8601',
              },
            },
            notes: 'The lf_preclaim_ token is a POLLING credential — it authenticates GET /api/agent/auth/session only (401 on /api/mcp and other REST endpoints). Save it.',
            curl: `curl -X POST ${baseUrl}/api/agent/auth \\\n  -H "Content-Type: application/json" \\\n  -d '{"type":"anonymous"}'`,
          },
          {
            step: 2,
            title: 'Claim with email (triggers authorization email)',
            method: 'POST',
            endpoint: '/api/agent/auth/claim',
            request: {
              body: {
                registration_session_id: '<session-id>',
                email: 'user@example.com',
              },
            },
            response: {
              registration_session_id: 'uuid',
              status: 'awaiting_otp',
              account: "enum: 'existing' | 'new'",
              verification_method: 'email_otp',
              provider: 'resend',
              claim_url: `${baseUrl}/api/agent/auth/verify?token=<claim_token>&session=<session-id>`,
              claim_token: '<claim_token>',
              claim_token_expires_at: 'ISO8601',
              rate_limit: { remaining: 9, reset_at: 'ISO8601' },
            },
            notes: "account: 'existing' links the agent to the existing workspace (no duplicate account); 'new' creates an account + workspace on authorization.",
            curl: `curl -X POST ${baseUrl}/api/agent/auth/claim \\\n  -H "Content-Type: application/json" \\\n  -d '{"registration_session_id":"<session-id>","email":"user@example.com"}'`,
          },
          {
            step: 3,
            title: 'Relay the claim_url and poll for completion',
            method: 'GET',
            endpoint: '/api/agent/auth/session?registration_session_id=<session-id>',
            request: {
              headers: { Authorization: 'Bearer lf_preclaim_...' },
            },
            response: {
              registration_session_id: 'uuid',
              status: "enum: 'pending_claim' | 'awaiting_otp' | 'completed'",
              account: "enum: 'existing' | 'new'",
              credential: {
                access_token: 'lf_live_...',
                token_type: 'Bearer',
                expires_at: null,
                organization: { id: 'uuid', name: 'org-name', plan: 'Free' },
              },
            },
            notes: "Give the user the claim_url: the emailed CTA and the page offer one-click authorize ('Authorize Agent' for existing accounts, 'Create My Workspace' for new ones). Poll until status: 'completed', then read credential.access_token.",
            curl: `curl ${baseUrl}/api/agent/auth/session?registration_session_id=<session-id> \\\n  -H "Authorization: Bearer lf_preclaim_..."`,
          },
          {
            step: 4,
            title: 'Fallback: complete with 6-digit OTP code',
            method: 'POST',
            endpoint: '/api/agent/auth/claim/complete',
            request: {
              body: {
                registration_session_id: '<session-id>',
                code: '123456',
              },
            },
            response: {
              registration_session_id: 'uuid',
              status: 'completed',
              account: "enum: 'existing' | 'new'",
              credential: {
                access_token: 'lf_live_...',
                token_type: 'Bearer',
                expires_at: null,
                organization: { id: 'uuid', name: 'org-name', plan: 'Free' },
              },
            },
            notes: 'Only when the user cannot use the one-click link.',
            curl: `curl -X POST ${baseUrl}/api/agent/auth/claim/complete \\\n  -H "Content-Type: application/json" \\\n  -d '{"registration_session_id":"<session-id>","code":"123456"}'`,
          },
        ],
      },
      {
        id: 'oauth_pkce',
        name: 'OAuth 2.0 + PKCE',
        description:
          'Standard OAuth 2.0 authorization_code flow with S256 PKCE. For desktop/IDE MCP connectors (Claude Code desktop, Cursor, Windsurf). Auto-discovery via /.well-known/oauth-authorization-server.',
        steps: [
          {
            step: 1,
            title: 'Discover OAuth endpoints',
            method: 'GET',
            endpoint: '/.well-known/oauth-authorization-server',
            response: {
              issuer: baseUrl,
              authorization_endpoint: `${baseUrl}/api/oauth/authorize`,
              token_endpoint: `${baseUrl}/api/oauth/token`,
              registration_endpoint: `${baseUrl}/api/oauth/register`,
              revocation_endpoint: `${baseUrl}/api/oauth/revoke`,
              response_types_supported: ['code'],
              grant_types_supported: ['authorization_code'],
              code_challenge_methods_supported: ['S256'],
              token_endpoint_auth_methods_supported: ['none'],
              scopes_supported: ['mcp:read', 'mcp:write', 'folios:read', 'folios:write'],
              response_modes_supported: ['query', 'fragment'],
            },
            curl: `curl ${baseUrl}/.well-known/oauth-authorization-server`,
          },
          {
            step: 2,
            title: 'Register as OAuth client',
            method: 'POST',
            endpoint: '/api/oauth/register',
            request: {
              body: {
                client_name: 'My Agent',
                redirect_uris: ['http://localhost:PORT/callback'],
                grant_types: ['authorization_code'],
                token_endpoint_auth_method: 'none',
              },
            },
            response: {
              client_id: 'my-agent-xxxxxxxxxxxxxxxx',
              client_name: 'My Agent',
              redirect_uris: ['http://localhost:PORT/callback'],
              grant_types: ['authorization_code'],
              token_endpoint_auth_method: 'none',
              scope: 'mcp:read mcp:write folios:read folios:write',
              client_id_issued_at: 1719705600,
              client_secret_expires_at: 0,
              client_secret: '',
            },
            curl: `curl -X POST ${baseUrl}/api/oauth/register \\\n  -H "Content-Type: application/json" \\\n  -d '{"client_name":"My Agent","redirect_uris":["http://localhost:9876/callback"]}'`,
          },
          {
            step: 3,
            title: 'Generate PKCE code verifier + challenge',
            method: null,
            endpoint: null,
            description: 'Generate crypto.randomBytes(32) → base64url as code_verifier. Compute SHA256(verifier) → base64url as code_challenge.',
          },
          {
            step: 4,
            title: 'Open browser for user consent',
            method: 'GET',
            endpoint: '/api/oauth/authorize',
            description: 'User approves consent screen in browser. Redirected back with ?code=...&state=...',
            request: {
              query: {
                client_id: '<client_id>',
                redirect_uri: '<redirect_uri>',
                code_challenge: '<challenge>',
                code_challenge_method: 'S256',
                state: '<random_state>',
                scope: 'mcp:read mcp:write folios:read folios:write',
              },
            },
          },
          {
            step: 5,
            title: 'Exchange code for API key',
            method: 'POST',
            endpoint: '/api/oauth/token',
            request: {
              body: {
                grant_type: 'authorization_code',
                code: '<code_from_redirect>',
                code_verifier: '<pkce_verifier>',
                client_id: '<client_id>',
                redirect_uri: '<redirect_uri>',
              },
            },
            response: {
              access_token: 'lf_live_...',
              token_type: 'Bearer',
              expires_in: 315360000,
              scope: 'mcp:read mcp:write folios:read folios:write',
              organization: { id: 'uuid', name: 'org-name', plan: 'Free' },
            },
            curl: `curl -X POST ${baseUrl}/api/oauth/token \\\n  -H "Content-Type: application/json" \\\n  -d '{"grant_type":"authorization_code","code":"<code>","code_verifier":"<verifier>","client_id":"<client_id>","redirect_uri":"<redirect_uri>"}'`,
          },
          {
            step: 6,
            title: 'Revoke token (optional)',
            method: 'POST',
            endpoint: '/api/oauth/revoke',
            description: 'Revoke an API key per RFC 7009.',
            request: {
              body: {
                token: '<access_token>',
                token_type_hint: 'access_token',
              },
            },
            response: '200 OK (empty body)',
            curl: `curl -X POST ${baseUrl}/api/oauth/revoke \\\n  -H "Content-Type: application/json" \\\n  -d '{"token":"<access_token>","token_type_hint":"access_token"}'`,
          },
        ],
      },
    ],

    // ── Token usage ──────────────────────────────────────────────────────
    authentication: {
      type: 'Bearer',
      header: 'Authorization: Bearer <access_token>',
      token_prefix: 'lf_live_',
      expires: 'never (until revoked via /api/oauth/revoke)',
    },

    // ── Error response format ────────────────────────────────────────────
    errorFormat: {
      type: 'object',
      properties: {
        error: { type: 'string', description: 'Human-readable error message' },
        attempts_remaining: { type: 'number', description: 'Remaining OTP attempts before lockout (verify endpoint only)' },
      },
    },

    // ── MCP tools (for AI agent consumption) ─────────────────────────────
    mcp: {
      endpoint: `${baseUrl}/api/mcp`,
      protocol: 'JSON-RPC 2.0 over Streamable HTTP (stateless POST); legacy SSE GET transport also supported',
      transport: 'streamable-http',
      recommendedClientConfig: {
        type: 'http',
        url: `${baseUrl}/api/mcp`,
        headers: { Authorization: 'Bearer lf_live_...' },
      },
      serverInfo: { name: 'LiveFolio-MCP', version: '1.1.0' },
      tools: [
        {
          name: 'list_projects',
          description: 'List all folios the agent has access to',
          arguments: {},
        },
        {
          name: 'get_project',
          description: 'Get full project data including versions, visibility, and analytics',
          arguments: { project_id: 'string (required)' },
        },
        {
          name: 'create_project',
          description: 'Create a new folio with HTML files (sharing/pricing/listing configured after via manage_* tools)',
          arguments: {
            title: 'string (required)',
            initial_html: 'string (required)',
            description: 'string',
            project_mode: "enum: 'deck' | 'document' | 'spreadsheet' | 'dashboard' | 'infography'",
            design_preferences: 'object',
            project_id: 'string (workspace folder)',
            thumbnail_url: 'string',
          },
        },
        {
          name: 'update_project',
          description: 'Update files (versioned) or title/description/thumbnail (no version)',
          arguments: {
            project_id: 'string (required)',
            updated_files: 'object (filename → content, optional)',
            change_message: 'string',
            title: 'string',
            description: 'string',
            thumbnail_url: 'string',
          },
        },
        {
          name: 'delete_project',
          description: 'Permanently delete a folio — requires confirmed: true',
          arguments: { project_id: 'string (required)', confirmed: 'boolean (must be exactly true)' },
        },
        {
          name: 'duplicate_project',
          description: 'Copy a folio into the acting account (paid folios require a grant + allowCopy) — cloud only',
          arguments: { project_id: 'string (required)' },
        },
        {
          name: 'get_curated_brief',
          description: 'Get a structured markdown design brief from open feedback pins',
          arguments: { project_id: 'string (required)' },
        },
        {
          name: 'get_active_design_system',
          description: 'Get the active design system analysis for a project',
          arguments: { project_id: 'string (required)' },
        },
        {
          name: 'add_comment',
          description: 'Add a comment or canvas pin (x/y/selector)',
          arguments: { project_id: 'string (required)', text: 'string (required)', type: "enum: 'pin' | 'comment'", x: 'number', y: 'number', selector: 'string' },
        },
        {
          name: 'moderate_comment',
          description: 'Moderate a comment/pin',
          arguments: { action: "enum: 'resolve' | 'reopen' | 'delete'", project_id: 'string (required)', comment_id: 'string (required)' },
        },
        {
          name: 'add_reaction',
          description: 'Increment an aggregate emoji reaction (👍 ❤️ 💡 🔥)',
          arguments: { project_id: 'string (required)', emoji: 'enum (4 emojis)' },
        },
        {
          name: 'manage_sharing',
          description: 'Read/change publish status, privacy, access key, comments, presentation mode (no version bump)',
          arguments: { project_id: 'string (required)', status: "enum: 'draft' | 'published'", isPrivate: 'boolean', accessKey: 'string', allowComments: 'boolean', presentationModeOnly: 'boolean' },
        },
        {
          name: 'manage_paid_access',
          description: 'Read/change the paid-access gate (price/preview/allowCopy) — cloud only',
          arguments: { project_id: 'string (required)', paid_access: 'object (omit to read, null to clear)' },
        },
        {
          name: 'manage_listing',
          description: 'Read/change Explore marketplace listing + license; read mode returns eligibility + human steps — cloud only',
          arguments: { project_id: 'string (required)', listed: 'boolean', category: 'enum (10 shelves)', tags: 'string[]', creation: 'enum', license: 'object' },
        },
        {
          name: 'search_marketplace',
          description: 'Browse the public Explore marketplace — cloud only',
          arguments: { category: 'string', tag: 'string', query: 'string', offset: 'integer', limit: 'integer' },
        },
        {
          name: 'buy_project',
          description: 'Start a purchase — returns a checkout URL to relay to the user — cloud only',
          arguments: { project_id: 'string (required)' },
        },
        {
          name: 'get_purchases',
          description: 'session_id → grant poll; no args → purchase history — cloud only',
          arguments: { session_id: 'string (optional)' },
        },
        {
          name: 'manage_seller_account',
          description: 'Stripe Connect seller account — cloud only',
          arguments: { action: "enum: 'status' | 'onboard'" },
        },
        {
          name: 'list_workspaces',
          description: 'List workspace folders that organize folios — cloud only',
          arguments: {},
        },
        {
          name: 'manage_workspace',
          description: 'Manage workspace folders — cloud only',
          arguments: { action: "enum: 'create' | 'update' | 'delete' | 'add_folio'", project_id: 'string', name: 'string', description: 'string', is_public: 'boolean', folio_id: 'string', confirmed: 'boolean' },
        },
        {
          name: 'manage_member',
          description: 'Manage workspace members — cloud only',
          arguments: { action: "enum: 'invite' | 'update_role' | 'remove' (omit to list)", email: 'string', role: "enum: 'Admin' | 'Member'", member_id: 'string' },
        },
        {
          name: 'manage_profile',
          description: 'Read/update the acting profile — cloud only',
          arguments: { action: "enum: 'update' (omit to read)", full_name: 'string', bio: 'string', website: 'string', avatar_url: 'string', is_public: 'boolean', accent_color: 'string', featured_folio_id: 'string', username: 'string' },
        },
        {
          name: 'claim_handle',
          description: 'Claim a @username (no username → suggestions) — cloud only',
          arguments: { username: 'string (optional)' },
        },
        {
          name: 'follow_profile',
          description: 'Toggle follow/unfollow a creator — cloud only',
          arguments: { username: 'string (required)' },
        },
        {
          name: 'get_public_profile',
          description: 'Read a creator\'s public profile + catalog (bio, stats, folios, workspaces) — cloud only',
          arguments: { username: 'string (required)' },
        },
      ],
    },

    // ── Discovery ────────────────────────────────────────────────────────
    discovery: {
      wellKnown: `${baseUrl}/.well-known/oauth-authorization-server`,
      humanReadable: `${baseUrl}/auth.md`,
      machineReadable: `${baseUrl}/api/auth-md`,
      llmsTxt: `${baseUrl}/llms.txt`,
    },
  });
}
