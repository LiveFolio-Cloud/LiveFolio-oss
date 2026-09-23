import { NextResponse } from 'next/server';
import { getPublicOrigin } from '@/lib/network';

export const dynamic = 'force-dynamic';

/**
 * GET /llm.txt → /llms.txt
 *
 * Agents try both spellings; redirect the less-common one to the canonical
 * llms.txt served from public/. 308 preserves the method and avoids long-lived
 * client caching of the redirect.
 *
 * The redirect target must use the PUBLIC origin: behind the Render proxy,
 * request.url resolves to the internal bind address (e.g. 0.0.0.0:10000), so
 * prefer NEXT_PUBLIC_APP_URL and fall back to the forwarded host headers.
 */
export function GET(request: Request) {
  return NextResponse.redirect(new URL('/llms.txt', getPublicOrigin(request)), 308);
}
