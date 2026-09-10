import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { readDB, runTransaction, HTMLComment } from '@/lib/db';
import { isOSS } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase';
import { getAuthContext } from '@/lib/auth';
import { decryptToken } from '@/lib/encryption';
import { projectMemoryCache } from '@/lib/project-cache';
import { extractUUIDFromSlug } from '@/lib/utils';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { getPublicOrigin } from '@/lib/network';
import crypto from 'crypto';

import { buildCommentPinnedBlock } from '@/ee/integrations/slack/blocks';

function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/**
 * Cloud identity fallback for owner-only comment ops (resolve/delete).
 *
 * The middleware only injects x-user-id / x-organization-id while the
 * Supabase session cookie verifies; with a stale/expired cookie
 * getAuthContext() sees no org and handlers 401'd even the real owner
 * (silent no-op deletes). Re-resolve straight from the session cookie —
 * the same pattern /api/raw uses — preferring the user's Owner workspace.
 */
async function resolveOrgFromSessionCookie(): Promise<{ userId: string; orgId: string } | null> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    if (!supabaseUrl || !supabaseAnonKey) return null;
    const cookieStore = await cookies();
    const { createServerClient } = await import('@/lib/supabase');
    const clientSupabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} },
    });
    const { data: { user } } = await clientSupabase.auth.getUser();
    if (!user) return null;
    const { data: memberships } = await supabaseAdmin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', user.id);
    if (!memberships || memberships.length === 0) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DB rows carry a string role; only Owner vs the rest matters here
    const owner = memberships.find((m: any) => m.role === 'Owner');
    const best = owner || memberships[0];
    return { userId: user.id, orgId: best.organization_id };
  } catch (err) {
    console.error('[comments] session fallback failed:', err);
    return null;
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    let targetId = id;
    const { orgId } = await getAuthContext();
    const { searchParams } = new URL(request.url);
    const typeFilter = searchParams.get('type'); // 'pin' | 'comment' | undefined (all)

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
      if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      const allComments = project.comments || [];
      if (typeFilter === 'comment') return NextResponse.json(allComments.filter((c: HTMLComment) => c.type === 'comment'));
      if (typeFilter === 'pin') return NextResponse.json(allComments.filter((c: HTMLComment) => !c.type || c.type === 'pin'));
      return NextResponse.json(allComments);
    }

    // Cloud Mode
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const queryId = extractUUIDFromSlug(targetId);
    let { data, error } = await supabaseAdmin
      .from('folios')
      .select('comments')
      .eq('id', queryId)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (!data && !error && queryId !== targetId) {
      const res = await supabaseAdmin
        .from('folios')
        .select('comments')
        .eq('id', targetId)
        .eq('organization_id', orgId)
        .maybeSingle();
      if (!res.error && res.data) data = res.data;
      error = res.error;
    }

    if (error || !data) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    const allComments = (data.comments || []) as HTMLComment[];
    if (typeFilter === 'comment') return NextResponse.json(allComments.filter((c: HTMLComment) => c.type === 'comment'));
    if (typeFilter === 'pin') return NextResponse.json(allComments.filter((c: HTMLComment) => !c.type || c.type === 'pin'));
    return NextResponse.json(allComments);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: err may be any thrown value; only logged
  } catch (err: any) {
    console.error('[comments] handler error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    let targetId = id;
    const { email } = await getAuthContext();
    const body = await request.json();
    const { text, versionId, filename, x, y, selector, elementHtml, author, type, parentId, slideIndex, sectionLabel } = body;

    if (!text || !versionId || !filename) {
      return NextResponse.json({ error: 'Missing comment parameters' }, { status: 400 });
    }

    // Cloud: posting requires a signed-in user. OSS always resolves a local
    // identity, so this only affects anonymous cloud visitors (and private
    // access-key holders — pinning/reviewing requires an account, matching
    // the Discussion panel). MCP agents post through their own handler.
    if (!isOSS && !email) {
      return NextResponse.json({ error: 'Sign in required to add comments.' }, { status: 401 });
    }

    // Validate type
    const commentType = (type === 'comment' || type === 'pin') ? type : 'pin';

    const newComment: HTMLComment = {
      id: crypto.randomUUID(),
      author: email || author || 'Guest',
      text: text.trim(),
      createdAt: new Date().toISOString(),
      versionId,
      filename,
      resolved: false,
      type: commentType,
      x: typeof x === 'number' ? x : undefined,
      y: typeof y === 'number' ? y : undefined,
      selector: typeof selector === 'string' ? selector : undefined,
      elementHtml: typeof elementHtml === 'string' ? elementHtml : undefined,
      slideIndex: typeof slideIndex === 'number' ? slideIndex : undefined,
      sectionLabel: typeof sectionLabel === 'string' ? sectionLabel : undefined,
      parentId: typeof parentId === 'string' ? parentId : undefined,
    };

    // Rate limit guest comment posts (per IP) to prevent spam/abuse.
    const clientIp = getClientIp(request);
    const postLimit = checkRateLimit(`comment-post:ip:${clientIp}`, 30, 15 * 60_000, 60 * 60_000);
    if (!postLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many comments. Please try again later.' },
        { status: 429 }
      );
    }

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
      if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

      const result = await runTransaction(async (db) => {
        const pIndex = db.findIndex((p) => p.id === targetId);
        if (pIndex === -1) throw new Error('Project not found');
        const project = db[pIndex];
        if (!project.comments) project.comments = [];
        project.comments.push(newComment);
        project.updatedAt = new Date().toISOString();
        db[pIndex] = project;
        return newComment;
      });
      return NextResponse.json({ success: true, comment: result });
    }

    // Cloud Mode — extract UUID from human-readable slug before querying
    const queryId = extractUUIDFromSlug(targetId);

    // SELECT only the columns we need (comments, allow_comments, title, privacy)
    // NOT the full row — avoids transferring 1-10 MB of version HTML on every comment POST.
    let { data: current, error: fetchError } = await supabaseAdmin
      .from('folios')
      .select('id, organization_id, comments, allow_comments, title, is_private, access_key')
      .eq('id', queryId)
      .maybeSingle();

    if (!current && !fetchError && queryId !== targetId) {
      const res = await supabaseAdmin
        .from('folios')
        .select('id, organization_id, comments, allow_comments, title, is_private, access_key')
        .eq('id', targetId)
        .maybeSingle();
      if (!res.error && res.data) current = res.data;
      fetchError = res.error;
    }

    if (fetchError || !current) throw new Error('Project not found');
    const effectiveOrgId = current.organization_id;

    if (current.allow_comments === false) {
      return NextResponse.json({ error: 'Comments are disabled for this folio.' }, { status: 403 });
    }

    // Private folios require a valid access key to comment.
    if (current.is_private) {
      const accessKeyParam = ((body.accessKey as string) || '').trim();
      const serverKey = (current.access_key || '').trim();
      if (!serverKey || !accessKeyParam || !timingSafeEqualStr(accessKeyParam, serverKey)) {
        return NextResponse.json({ error: 'Access Denied: Invalid access key.' }, { status: 403 });
      }
    }

    // Atomic append via server-only RPC — concurrent comments no longer lose
    // updates (read-modify-write race). The RPC also re-checks allow_comments.
    const { error: updateError } = await supabaseAdmin
      .rpc('append_folio_comment', {
        p_folio_id: current.id,
        p_comment: newComment,
      });

    if (updateError) throw updateError;
    projectMemoryCache.invalidate(current.id);

    // Trigger Two-Way Slack / Discord Comment Notifications asynchronously
    const origin = getPublicOrigin(request);
    setTimeout(async () => {
      try {
        const { data: integrations, error: integError } = await supabaseAdmin
          .from('organization_integrations')
          .select('*')
          .eq('organization_id', effectiveOrgId);

        if (integError || !integrations || integrations.length === 0) {
          return;
        }

        const studioUrl = `${origin}/studio/${id}`;
                const folioTitle = current.title || 'Untitled Folio';

        for (const integration of integrations) {
          if (integration.platform === 'slack') {
            try {
              const rawBotToken = decryptToken(integration.encrypted_bot_token);
              const channel = integration.default_channel_id || 'general';
              const blockPayload = buildCommentPinnedBlock({
                folioId: id,
                folioTitle,
                author: newComment.author,
                text: newComment.text,
                previewUrl: studioUrl
              });

              await fetch('https://slack.com/api/chat.postMessage', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${rawBotToken}`
                },
                body: JSON.stringify({
                  channel: channel,
                  text: blockPayload.text,
                  blocks: blockPayload.blocks
                })
              });
            } catch (slackErr) {
              console.error('Failed to dispatch comment notification to Slack:', slackErr);
            }
          } else if (integration.platform === 'discord') {
            try {
              const rawBotToken = decryptToken(integration.encrypted_bot_token);
              const channelId = integration.default_channel_id;

              if (channelId) {
                const isGeneralComment = commentType === 'comment';
                const embed = {
                  title: isGeneralComment
                    ? `💬 New Comment on "${folioTitle}"`
                    : `📌 New Comment Pinned on "${folioTitle}"`,
                  description: `**${newComment.author}:** "${newComment.text}"`,
                  color: isGeneralComment ? 3447003 : 5814783, // Blue for comments, Indigo for pins
                  url: studioUrl,
                  footer: { text: 'LiveFolio Studio Reviews' }
                };

                const components = [
                  {
                    type: 1, // ACTION_ROW
                    components: [
                      {
                        type: 2, // BUTTON
                        style: 5, // LINK
                        label: isGeneralComment ? '💬 Reply to Comment' : '💬 Reply on Canvas',
                        url: studioUrl
                      }
                    ]
                  }
                ];

                await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bot ${rawBotToken}`
                  },
                  body: JSON.stringify({
                    embeds: [embed],
                    components
                  })
                });
              }
            } catch (discordErr) {
              console.error('Failed to dispatch comment notification to Discord:', discordErr);
            }
          }
        }
      } catch (syncErr) {
        console.error('Error during two-way comments synchronization:', syncErr);
      }
    }, 10);

    return NextResponse.json({ success: true, comment: newComment });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: err may be any thrown value; only logged
  } catch (err: any) {
    console.error('[comments] handler error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    let targetId = id;
    let { orgId } = await getAuthContext();
    const body = await request.json();
    const { commentId, resolved } = body;

    if (isOSS) {
      const db = await readDB();
      let project = db.find((p) => p.id === targetId);
      if (!project && targetId.includes('-')) {
        const parts = targetId.split('-');
        const lastPart = parts[parts.length - 1];
        project = db.find((p) => p.id === lastPart);
        if (project) {
          targetId = project.id;
        }
      }
      if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

      const result = await runTransaction(async (db) => {
        const pIndex = db.findIndex((p) => p.id === targetId);
        if (pIndex === -1) throw new Error('Project not found');
        const project = db[pIndex];
        const comment = project.comments?.find(c => c.id === commentId);
        if (!comment) throw new Error('Comment not found');
        comment.resolved = resolved;
        project.updatedAt = new Date().toISOString();
        db[pIndex] = project;
        return comment;
      });
      return NextResponse.json({ success: true, comment: result });
    }

    // Cloud Mode
    if (!orgId) {
      // Stale middleware headers (expired cookie) — resolve from the session
      // cookie directly before giving up.
      const resolved = await resolveOrgFromSessionCookie();
      if (!resolved) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      orgId = resolved.orgId;
    }

    const queryId = extractUUIDFromSlug(targetId);
    // SELECT only the comments column — not the full 1-10 MB row
    let { data: current, error: fetchError } = await supabaseAdmin
      .from('folios')
      .select('id, comments')
      .eq('id', queryId)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (!current && !fetchError && queryId !== targetId) {
      const res = await supabaseAdmin
        .from('folios')
        .select('id, comments')
        .eq('id', targetId)
        .eq('organization_id', orgId)
        .maybeSingle();
      if (!res.error && res.data) current = res.data;
      fetchError = res.error;
    }

    if (fetchError || !current) throw new Error('Project not found');
    const comments: HTMLComment[] = current.comments || [];
    const comment = comments.find((c: HTMLComment) => c.id === commentId);
    if (!comment) throw new Error('Comment not found');

    comment.resolved = resolved;

    // Column-specific update: only write the comments column
    const { error: updateError } = await supabaseAdmin
      .from('folios')
      .update({ comments, updated_at: new Date().toISOString() })
      .eq('id', current.id)
      .eq('organization_id', orgId);

    if (updateError) throw updateError;
    projectMemoryCache.invalidate(current.id);
    return NextResponse.json({ success: true, comment });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: err may be any thrown value; only logged
  } catch (err: any) {
    console.error('[comments] handler error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    let targetId = id;
    let { orgId } = await getAuthContext();
    const { searchParams } = new URL(request.url);
    const commentId = searchParams.get('commentId');

    if (!commentId) {
      return NextResponse.json({ error: 'Missing commentId param' }, { status: 400 });
    }

    if (isOSS) {
      const db = await readDB();
      let project = db.find((p) => p.id === targetId);
      if (!project && targetId.includes('-')) {
        const parts = targetId.split('-');
        const lastPart = parts[parts.length - 1];
        project = db.find((p) => p.id === lastPart);
        if (project) {
          targetId = project.id;
        }
      }
      if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

      await runTransaction(async (db) => {
        const pIndex = db.findIndex((p) => p.id === targetId);
        if (pIndex === -1) throw new Error('Project not found');
        const project = db[pIndex];
        if (project.comments) project.comments = project.comments.filter(c => c.id !== commentId);
        project.updatedAt = new Date().toISOString();
        db[pIndex] = project;
      });
      return NextResponse.json({ success: true });
    }

    // Cloud Mode
    if (!orgId) {
      // Stale middleware headers (expired cookie) — resolve from the session
      // cookie directly before giving up.
      const resolved = await resolveOrgFromSessionCookie();
      if (!resolved) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      orgId = resolved.orgId;
    }

    const queryId = extractUUIDFromSlug(targetId);
    // SELECT only the comments column — not the full 1-10 MB row
    let { data: current, error: fetchError } = await supabaseAdmin
      .from('folios')
      .select('id, comments')
      .eq('id', queryId)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (!current && !fetchError && queryId !== targetId) {
      const res = await supabaseAdmin
        .from('folios')
        .select('id, comments')
        .eq('id', targetId)
        .eq('organization_id', orgId)
        .maybeSingle();
      if (!res.error && res.data) current = res.data;
      fetchError = res.error;
    }

    if (fetchError || !current) throw new Error('Project not found');
    const comments: HTMLComment[] = (current.comments || []).filter(
      (c: HTMLComment) => c.id !== commentId
    );

    // Column-specific update: only write the comments column
    const { error: updateError } = await supabaseAdmin
      .from('folios')
      .update({ comments, updated_at: new Date().toISOString() })
      .eq('id', current.id)
      .eq('organization_id', orgId);

    if (updateError) throw updateError;
    projectMemoryCache.invalidate(current.id);
    return NextResponse.json({ success: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: err may be any thrown value; only logged
  } catch (err: any) {
    console.error('[comments] handler error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
