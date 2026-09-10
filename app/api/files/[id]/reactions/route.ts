import { NextResponse } from 'next/server';
import { readDB, runTransaction } from '@/lib/db';
import { isOSS } from '@/lib/env';
import { getAuthContext } from '@/lib/auth';
import { supabaseAdmin, transformFolioRecord, transformToFolioRecord, FolioRecord } from '@/lib/supabase';
import { projectMemoryCache } from '@/lib/project-cache';
import { extractUUIDFromSlug } from '@/lib/utils';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const VALID_EMOJIS = ['👍', '❤️', '💡', '🔥'];
// Sanity cap so a malicious client cannot set absurd reaction counts.
const MAX_COUNT = 1_000_000;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    // Cloud: reacting requires a signed-in user — all review interactions on
    // shared folios are account-gated (pins, discussion, reactions). OSS
    // resolves a local identity, so it stays anonymous-friendly.
    const { email } = await getAuthContext();
    if (!isOSS && !email) {
      return NextResponse.json({ error: 'Sign in required to react.' }, { status: 401 });
    }

    // Rate limit reaction updates per IP (public endpoint).
    const clientIp = getClientIp(request);
    const rateLimit = checkRateLimit(`reactions:ip:${clientIp}`, 60, 15 * 60_000, 60 * 60_000);
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
    }

    const body = await request.json();
    const { reactions } = body;

    if (!reactions || typeof reactions !== 'object') {
      return NextResponse.json({ error: 'Invalid reactions format.' }, { status: 400 });
    }

    // Clean and validate the incoming reactions map to prevent injection
    const cleanedReactions: { [key: string]: number } = {};
    for (const emoji of VALID_EMOJIS) {
      const count = reactions[emoji];
      if (typeof count === 'number' && count >= 0) {
        cleanedReactions[emoji] = Math.min(MAX_COUNT, Math.floor(count));
      }
    }

    let targetId = id;

    if (isOSS) {
      const db = await readDB();
      let project = db.find((p) => p.id === targetId);
      if (!project && targetId.includes('-')) {
        const parts = targetId.split('-');
        for (let i = 1; i <= parts.length; i++) {
          const candidate = parts.slice(-i).join('-');
          const found = db.find((p) => p.id === candidate);
          if (found) { project = found; targetId = project.id; break; }
        }
      }
      if (!project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      }

      const result = await runTransaction(async (db) => {
        const pIndex = db.findIndex((p) => p.id === targetId);
        if (pIndex === -1) throw new Error('Project not found');
        const project = db[pIndex];
        
        // Merge or set
        project.reactions = {
          ...(project.reactions || {}),
          ...cleanedReactions
        };
        project.updatedAt = new Date().toISOString();
        db[pIndex] = project;
        return project.reactions;
      });
      return NextResponse.json({ success: true, reactions: result });
    }

    // Cloud Mode — extract UUID from human-readable slug before querying
    const queryId = extractUUIDFromSlug(targetId);

    let { data: current, error: fetchError } = await supabaseAdmin
      .from('folios')
      .select('*')
      .eq('id', queryId)
      .maybeSingle();

    if (!current && !fetchError && queryId !== targetId) {
      // Fallback: try the full slug (edge case for manually-created non-UUID IDs)
      const res = await supabaseAdmin
        .from('folios')
        .select('*')
        .eq('id', targetId)
        .maybeSingle();
      if (!res.error && res.data) current = res.data;
      fetchError = res.error;
    }

    if (fetchError || !current) throw new Error('Project not found');
    const project = transformFolioRecord(current as FolioRecord);
    targetId = project.id;

    project.reactions = {
      ...(project.reactions || {}),
      ...cleanedReactions
    };
    project.updatedAt = new Date().toISOString();

    const dbRecord = transformToFolioRecord(project, current.organization_id);
    const { error: updateError } = await supabaseAdmin
      .from('folios')
      .update(dbRecord)
      .eq('id', targetId);

    if (updateError) throw updateError;
    projectMemoryCache.invalidate(targetId);
    return NextResponse.json({ success: true, reactions: project.reactions });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: err may be any thrown value; only logged
  } catch (err: any) {
    console.error('Reactions update error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return POST(request, context);
}
