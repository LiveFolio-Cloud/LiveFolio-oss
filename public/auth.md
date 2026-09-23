# LiveFolio Agent Authentication (auth.md)

Welcome, AI Agent! This document describes how you can autonomously register accounts and authenticate with LiveFolio on behalf of users.

**Base URL:** `https://livefolio.cloud` (or your deployed instance)
**MCP Endpoint:** `POST /api/mcp` (JSON-RPC 2.0 over Streamable HTTP; a legacy SSE GET transport also exists)
**Discovery:** `/.well-known/oauth-protected-resource` (metadata + endpoint list)

---

## Supported Flows

| Flow | Use Case | Auth Method |
|------|----------|-------------|
| **Agent Verified (ID-JAG)** | Hosted LLM platforms (ChatGPT, Claude) — instant, no user interaction | Signed JWT with email claim |
| **User Claimed (OTP)** | CLI agents (Claude Code, Cursor) — user verifies via email | One-click authorize link (magic link) with 6-digit OTP fallback |

---

## Flow 1: Agent Verified (ID-JAG) — Instant API Key

Use this when you are a platform partner with signed-JWT credentials. No OTP. No user interaction. You get an API key back immediately.

> **Note:** Hosted LiveFolio instances require **HS256-signed JWTs** issued under a shared secret. Unsigned (`alg: none`) JWTs are rejected on hosted instances and only accepted in local OSS development when explicitly enabled. If you are a platform partner without credentials, contact LiveFolio to receive a signing secret.

### Step 1: Construct the JWT

Create an **HS256-signed** JWT with these claims:

```json
{
  "email": "user@example.com",
  "sub": "user@example.com",
  "iss": "your-agent-name",
  "iat": 1719705600,
  "exp": 1719709200,
  "aud": "livefolio"
}
```

Sign it with the shared secret:

```bash
# Bash example (HS256):
HEADER=$(echo -n '{"alg":"HS256","typ":"JWT"}' | base64 -w0 | tr '+/' '-_' | tr -d '=')
PAYLOAD=$(echo -n '{"email":"user@example.com","sub":"user@example.com","iss":"my-agent","iat":'$(date +%s)',"exp":'$(($(date +%s)+3600))',"aud":"livefolio"}' | base64 -w0 | tr '+/' '-_' | tr -d '=')
SIG=$(echo -n "${HEADER}.${PAYLOAD}" | openssl dgst -sha256 -hmac "$LIVEFOLIO_JWT_SECRET" -binary | base64 -w0 | tr '+/' '-_' | tr -d '=')
JWT="${HEADER}.${PAYLOAD}.${SIG}"
```

### Step 2: Send the assertion

```http
POST /api/agent/auth
Content-Type: application/json

{
  "type": "identity_assertion",
  "assertion": "<signed-jwt>",
  "requested_credential_type": "api_key"
}
```

### Step 3: Receive your API key

```json
{
  "status": "completed",
  "credential": {
    "access_token": "lf_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "token_type": "Bearer",
    "organization": {
      "id": "098c3b90-d1d3-4b68-9beb-52ecfbbe734f",
      "name": "user's Workspace",
      "plan": "Free"
    }
  }
}
```

---

## Flow 2: User Claimed (OTP) — One-Click Authorize

Use this for local CLI agents where the user can check their email.

### Step 1: Start anonymous session

```http
POST /api/agent/auth
Content-Type: application/json

{
  "type": "anonymous",
  "requested_credential_type": "api_key"
}
```

Response:
```json
{
  "registration_session_id": "abc123...",
  "status": "pending_claim",
  "credential": {
    "token": "lf_preclaim_...",
    "token_type": "APIKey",
    "expires_at": "2026-07-01T00:30:00.000Z"
  }
}
```

**The `lf_preclaim_…` token is a polling credential, not an MCP key.** It authenticates `GET /api/agent/auth/session` only — it 401s on `/api/mcp` and every other REST endpoint. Save it; do not send it as the MCP Bearer token.

### Step 2: Claim the user's email

```http
POST /api/agent/auth/claim
Content-Type: application/json

{
  "email": "user@example.com",
  "registration_session_id": "abc123..."
}
```

Response:
```json
{
  "registration_session_id": "abc123...",
  "status": "awaiting_otp",
  "account": "existing",
  "verification_method": "email_otp",
  "provider": "resend",
  "claim_url": "https://livefolio.cloud/api/agent/auth/verify?token=...&session=abc123...",
  "claim_token": "...",
  "claim_token_expires_at": "2026-07-01T00:45:00.000Z"
}
```

The `account` field tells you what happens on authorization:
- `"existing"` — the email already has a LiveFolio account. Authorizing **links your agent to the existing workspace** (reusing its API key). No duplicate account is created. (If the account exists but has no workspace yet, one is created for it.)
- `"new"` — a new account and workspace will be created on authorization.

The user receives an email containing a one-click **Authorize** link (the `claim_url`) and a 6-digit fallback code.

### Step 3a (preferred): One-click authorize — relay the link and poll

Give the user the `claim_url`: *"Click this link to authorize LiveFolio."* The page offers one click ("Authorize Agent" for existing accounts, "Create My Workspace" for new ones) — no code needed. The link is a magic link (inbox possession proves identity) and expires after 15 minutes.

While the user authorizes, poll for completion:

```http
GET /api/agent/auth/session?registration_session_id=abc123...
Authorization: Bearer lf_preclaim_...
```

Pending response:
```json
{ "registration_session_id": "abc123...", "status": "awaiting_otp", "account": "existing" }
```

Completed response:
```json
{
  "registration_session_id": "abc123...",
  "status": "completed",
  "account": "created",
  "credential": {
    "access_token": "lf_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "token_type": "Bearer",
    "expires_at": null,
    "organization": { "id": "098c3b90-...", "name": "Workspace Name", "plan": "Free" }
  }
}
```

> `account` in the completed response echoes the claim: `"created"` when the workspace was created by this session, `"existing"` when authorization linked an existing account.

### Step 3b (fallback): 6-digit code

Only if the user cannot use the link, ask for the 6-digit code from their email and complete:

```http
POST /api/agent/auth/claim/complete
Content-Type: application/json

{
  "code": "123456",
  "registration_session_id": "abc123..."
}
```

Response:
```json
{
  "registration_session_id": "abc123...",
  "status": "completed",
  "account": "created",
  "credential": {
    "access_token": "lf_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "token_type": "Bearer",
    "expires_at": null,
    "organization": { "id": "098c3b90-...", "name": "Workspace Name", "plan": "Free" }
  }
}
```

---

## Using the Credential

All MCP requests must include the API key as a Bearer token:

```http
POST /api/mcp
Content-Type: application/json
Authorization: Bearer lf_live_your_token_here

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {}
}
```

Recommended client config (Streamable HTTP):

```json
{
  "mcpServers": {
    "livefolio": {
      "type": "http",
      "url": "https://livefolio.cloud/api/mcp",
      "headers": { "Authorization": "Bearer lf_live_your_token_here" }
    }
  }
}
```

**Token format:** `lf_live_` prefix, 48 hex characters.
**Token storage:** Persist the token. It survives server restarts and can be reused.

A cold request to `/api/mcp` without valid credentials returns HTTP 401 with a `WWW-Authenticate` header pointing at `/.well-known/oauth-protected-resource` — agents can self-discover the registration flow from that challenge.

---

## Rate Limits & Expiry

| Limit | Window |
|-------|--------|
| Claim requests per IP | 10 per 15 minutes (30-min lockout) |
| Claim requests per email | 3 per 15 minutes |
| Verify/complete attempts per IP | 30 per 15 minutes |
| Verify/complete attempts per session | 5 (30-min lockout) |
| Registration session | expires 15 minutes after creation |
| OTP code | expires 10 minutes after claim |
| Claim token (one-click link) | expires 15 minutes after claim |

Rate-limited responses include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and `Retry-After` headers.

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` from `/api/mcp` | Missing or invalid Bearer token | Use `Authorization: Bearer lf_live_...` (the `lf_preclaim_…` token is polling-only) |
| `400 Missing type` | Request body missing `type` field | Set `"type": "identity_assertion"` or `"type": "anonymous"` |
| `400 Invalid assertion format` | JWT doesn't have 3 parts | Ensure base64 encoding is correct |
| `401 assertion verification failed` | JWT payload missing email, or unsigned on a hosted instance | Include `"email"`/`"sub"` claim; hosted instances require HS256 platform-partner signatures |
| `401 Identity assertion rejected` | Hosted instance requires signed JWTs | Contact LiveFolio for platform-partner credentials |
| `404 Registration session not found` | Session expired or wrong ID | Restart from Step 1 (sessions expire after 15 minutes) |
| `410 session expired` | OTP or claim token timed out | Ask your agent to send a new link/code |
| `429 Too many attempts` | Rate limit hit | Wait for `Retry-After` and retry |
