import { NextResponse } from 'next/server';
import { createRegistrationSession } from '@/lib/agent-auth-store';
import { provisionAgentWorkspace } from '@/lib/auth-provisioner';
import { isOSS } from '@/lib/env';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

/**
 * Shared secret for JWT identity assertion verification.
 * Set LIVEFOLIO_JWT_SECRET in environment to enable signed JWT verification.
 * When unset, unsigned (alg: none) JWTs are accepted ONLY when
 * LIVEFOLIO_ALLOW_UNSIGNED_JWT=true AND the app runs in OSS mode.
 * Cloud mode always requires the secret — it never accepts unsigned JWTs.
 */
function getJwtSecret(): string | null {
  return process.env.LIVEFOLIO_JWT_SECRET || null;
}

/**
 * Verify an identity assertion JWT.
 * Fail-closed behavior:
 * - If LIVEFOLIO_JWT_SECRET is configured: requires HS256 + valid signature
 *   (+ exp claim) — signature compared in constant time.
 * - Otherwise: unsigned JWTs are rejected unless explicitly allowed in OSS.
 */
function verifyIdentityAssertion(assertion: string): { email: string } | { error: string } {
  const parts = assertion.split('.');
  if (parts.length !== 3) {
    return { error: "Invalid identity assertion format. Must be a valid JWT with 3 parts." };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JWT header is unvalidated JSON whose claims (alg) are probed defensively below
  let header: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JWT payload is unvalidated JSON whose claims (email/sub/aud/exp) are probed defensively below
  let payload: any;

  try {
    const headerRaw = Buffer.from(parts[0], 'base64url').toString('utf-8');
    header = JSON.parse(headerRaw);
  } catch {
    return { error: "Invalid JWT header. Must be valid base64url-encoded JSON." };
  }

  try {
    const payloadRaw = Buffer.from(parts[1], 'base64url').toString('utf-8');
    payload = JSON.parse(payloadRaw);
  } catch {
    return { error: "Invalid JWT payload. Must be valid base64url-encoded JSON." };
  }

  const secret = getJwtSecret();

  // If a shared secret is configured, require HS256 with constant-time compare
  if (secret) {
    if (header.alg !== 'HS256') {
      return { error: `JWT algorithm must be HS256 when signed identity assertions are configured. Got: ${header.alg}` };
    }

    // Verify HMAC-SHA256 signature (constant-time)
    const signingInput = `${parts[0]}.${parts[1]}`;
    const expectedSig = crypto.createHmac('sha256', secret).update(signingInput).digest('base64url');
    const expectedBuf = Buffer.from(expectedSig);
    const actualBuf = Buffer.from(parts[2] || '');
    if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
      return { error: "JWT signature verification failed." };
    }

    // Require an expiration claim on the signed path (production)
    if (!payload.exp) {
      return { error: "JWT must include an 'exp' claim." };
    }
  } else {
    // No secret configured — fail closed unless explicitly allowed in OSS
    const allowUnsigned = process.env.LIVEFOLIO_ALLOW_UNSIGNED_JWT === 'true' && isOSS;
    if (!allowUnsigned) {
      // Platform partners receive signed-JWT credentials — unsigned assertions
      // are never accepted on hosted instances.
      return {
        error: "Identity assertion rejected: this server requires signed JWTs. " +
          "Platform partners receive signed-JWT credentials." +
          (isOSS ? " For local OSS development, unsigned JWTs can be explicitly allowed." : ""),
      };
    }
    if (header.alg && header.alg !== 'none') {
      return { error: `JWT algorithm '${header.alg}' requires a signed-JWT configuration.` };
    }
  }

  // Validate required claims
  const email = payload.email || payload.sub;
  if (!email || typeof email !== 'string') {
    return { error: "Identity assertion JWT does not contain a valid 'email' or 'sub' claim." };
  }

  if (!email.includes('@')) {
    return { error: `Invalid email in assertion: ${email}` };
  }

  // Validate audience if present
  if (payload.aud && payload.aud !== 'livefolio') {
    return { error: `Unexpected audience: ${payload.aud}. Expected: livefolio` };
  }

  // Validate expiration if present
  if (payload.exp) {
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      return { error: "JWT has expired." };
    }
  }

  return { email };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { type, assertion, requested_credential_type } = body;

    if (!type) {
      return NextResponse.json(
        { error: "Missing required parameter: 'type'." },
        { status: 400 }
      );
    }

    // Flow 1: Agent Verified Flow (Identity Assertion JWT / ID-JAG)
    if (type === 'identity_assertion') {
      if (!assertion) {
        return NextResponse.json(
          { error: "Missing required parameter: 'assertion' for identity_assertion type." },
          { status: 400 }
        );
      }

      // Verify the assertion (with optional JWT signature check)
      const result = verifyIdentityAssertion(assertion);
      if ('error' in result) {
        return NextResponse.json(
          { error: `Identity assertion verification failed: ${result.error}` },
          { status: 401 }
        );
      }

      try {
        // High-fidelity self-healing provisioning based on verified assertion identity
        const provisioned = await provisionAgentWorkspace(result.email);

        return NextResponse.json(
          {
            status: 'completed',
            credential: {
              access_token: provisioned.apiKey,
              token_type: 'Bearer',
              organization: provisioned.organization,
            },
          },
          { status: 200 }
        );
      } catch (err: unknown) {
        console.error('[Agent Auth Route] Provisioning failed:', err);
        return NextResponse.json(
          { error: 'Workspace provisioning failed. Please try again later.' },
          { status: 500 }
        );
      }
    }

    // Flow 2: User Claimed Flow (Anonymous Start)
    if (type === 'anonymous') {
      const { id, preclaimToken } = await createRegistrationSession();

      const requestedType = requested_credential_type || 'api_key';
      const expiresAt = new Date(Date.now() + 15 * 60000).toISOString();

      return NextResponse.json(
        {
          registration_session_id: id,
          status: 'pending_claim',
          credential: {
            token: preclaimToken,
            token_type: requestedType === 'api_key' ? 'APIKey' : 'Bearer',
            expires_at: expiresAt,
          },
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { error: `Unsupported registration type: '${type}'. Supported types: 'anonymous', 'identity_assertion'.` },
      { status: 400 }
    );

  } catch (err: unknown) {
    console.error('[Agent Auth API Error]:', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

// Support pre-flight CORS requests
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
