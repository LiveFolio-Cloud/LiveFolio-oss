import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://livefolio.cloud').replace(/\/+$/, '');

  return NextResponse.json(
    {
      agent_auth: {
        auth_md_url: `${baseUrl}/auth.md`,
        registration_endpoint: `${baseUrl}/api/agent/auth`,
        claim_endpoint: `${baseUrl}/api/agent/auth/claim`,
        claim_complete_endpoint: `${baseUrl}/api/agent/auth/claim/complete`,
        session_endpoint: `${baseUrl}/api/agent/auth/session`,
        supported_identity_types: ['anonymous', 'identity_assertion'],
        supported_credential_types: ['api_key', 'access_token'],
      },
      // MCP auth spec (RFC 9728): where to find the authorization server.
      authorization_servers: [`${baseUrl}/.well-known/oauth-authorization-server`],
    },
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    }
  );
}
