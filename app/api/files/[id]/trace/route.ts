import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { isOSS } from '@/lib/env';
import { extractUUIDFromSlug } from '@/lib/utils';
import { decryptTracePayload, extractTraceTokens } from '@/lib/folio-keys';

export const dynamic = 'force-dynamic';

/**
 * POST /api/files/[id]/trace — trace a leaked copy back to its buyer.
 *
 * The seller (any org member of the folio) pastes the leaked HTML/JS — a
 * file found on a client's site, GitHub, an AI agent's output — and this
 * endpoint extracts every embedded trace marker (see lib/folio-keys.ts),
 * decrypts them, and reports who bought the folio, when, and through which
 * channel (live view / duplicate / download). Markers that don't belong to
 * this folio are reported with `foreign: true`.
 *
 * Deterministic per-request: no markers in the content → empty result,
 * never an error.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (isOSS) {
    return NextResponse.json({ error: 'Not available in OSS mode.' }, { status: 403 });
  }
  try {
    const { orgId, userId } = await getAuthContext();
    if (!orgId || !userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'Database connection unavailable.' }, { status: 500 });
    }

    const { id } = await context.params;
    const queryId = extractUUIDFromSlug(id);

    const { data: row, error } = await supabaseAdmin
      .from('folios')
      .select('id, organization_id')
      .eq('id', queryId)
      .maybeSingle();
    if (error || !row) {
      return NextResponse.json({ error: 'Folio not found.' }, { status: 404 });
    }
    const folioOrgId = row.organization_id as string;

    // Only the seller's own team may trace their folio.
    const { data: membership } = await supabaseAdmin
      .from('organization_members')
      .select('id')
      .eq('organization_id', folioOrgId)
      .eq('user_id', userId)
      .limit(1);
    if (!membership || membership.length === 0) {
      return NextResponse.json({ error: 'Only the folio workspace can trace copies.' }, { status: 403 });
    }

    const { content } = (await request.json().catch(() => ({}))) as { content?: unknown };
    if (typeof content !== 'string' || content.length === 0) {
      return NextResponse.json({ error: 'Paste the leaked content to scan for markers.' }, { status: 400 });
    }
    if (content.length > 4_000_000) {
      return NextResponse.json({ error: 'Content is too large to scan (max 4MB).' }, { status: 413 });
    }

    const tokens = extractTraceTokens(content);
    const seen = new Set<string>();
    const found: Array<{
      folioId: string;
      foreign: boolean;
      channel: string;
      tracedAt: string;
      userId: string;
    }> = [];

    for (const token of tokens) {
      const payload = decryptTracePayload(token);
      if (!payload || seen.has(payload.u)) continue;
      seen.add(payload.u);
      found.push({
        folioId: payload.f,
        foreign: payload.f !== row.id,
        channel: payload.k,
        tracedAt: new Date(payload.t).toISOString(),
        userId: payload.u,
      });
    }

    // Resolve buyer emails (auth admin) — best-effort, never fails the scan.
    const buyers = await Promise.all(
      found.map(async (f) => {
        let email: string | null = null;
        let name: string | null = null;
        try {
          if (typeof supabaseAdmin.auth.admin.getUser === 'function') {
            const { data } = await supabaseAdmin.auth.admin.getUser(f.userId);
            email = data?.user?.email ?? null;
            name = data?.user?.user_metadata?.full_name ?? null;
          }
        } catch { /* keep nulls */ }
        return { ...f, email, name };
      })
    );

    return NextResponse.json({
      success: true,
      scanned: tokens.length,
      markers: buyers,
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: err may be any thrown value; only logged
  } catch (err: any) {
    console.error('Trace failed:', err?.message || err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
