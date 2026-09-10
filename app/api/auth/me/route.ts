import { NextResponse } from 'next/server';

/**
 * OSS stub for app/api/auth/me/route.ts — swapped in by bin/sync-oss.js
 * (STUB_SWAPS), replacing the Cloud route, which dynamically imports
 * @supabase/ssr (a dependency excluded from OSS — the type-check fails even
 * on the guarded branch).
 *
 * OSS mode has no auth: this is the Cloud route's own isOSS early-return.
 * The share viewer's comment/reaction/report chrome calls this endpoint and
 * expects an unauthenticated `{ user: null }` 401.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ user: null }, { status: 401 });
}
