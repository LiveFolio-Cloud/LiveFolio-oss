/**
 * MCP tool handlers — workspace folders and members.
 */
import { isOSS } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase';
import { getOrganizationQuota } from '@/ee/middleware/usageCapping';
import { teammateSeating } from '@/lib/plans';
import { archiveWorkspace, unarchiveWorkspace } from '@/lib/archive';
import { sendOrgInviteEmail } from '@/lib/email';
import crypto from 'crypto';
import { requireSupabaseAdmin, resolveOrgIdFromHeaders, resolveActingUserId, requireRole, requireConfirmed } from '@/lib/mcp/shared';
import { listAllAuthUsers } from '@/lib/auth-users';

// ── Phase 3: workspace folders / members / profile / social ────────────

/** List workspace folders (cloud-only — renamed from list_folio_projects). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
export async function handleListWorkspaces(args?: any) {
  if (isOSS) throw new Error('Workspace folders are a cloud feature and are not available in OSS mode.');
  const includeArchived = args?.include_archived === true;
  const orgId = await resolveOrgIdFromHeaders();
  requireSupabaseAdmin();

  const base = supabaseAdmin
    .from('projects')
    .select('id, name, slug, description, is_public, organization_id, created_at, updated_at, archived_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true });
  // Archived workspaces are hidden unless explicitly asked for.
  const { data: projects, error } = await (includeArchived ? base : base.is('archived_at', null));

  if (error) throw error;

  const { data: folios, error: folioErr } = await supabaseAdmin
    .from('folios')
    .select('project_id')
    .eq('organization_id', orgId)
    .not('project_id', 'is', null);

  if (folioErr) throw folioErr;

  const counts = new Map<string, number>();
  for (const f of folios || []) {
    const pid = f.project_id as string;
    counts.set(pid, (counts.get(pid) || 0) + 1);
  }

  return {
    workspaces: (projects || []).map((p: { id: string; name: string | null; slug: string | null; description: string | null; is_public: boolean | null; archived_at?: string | null }) => ({
      project_id: p.id,
      name: p.name,
      slug: p.slug,
      description: p.description,
      is_public: p.is_public,
      archived: !!p.archived_at,
      folio_count: counts.get(p.id) || 0,
    })),
    total: (projects || []).length,
  };
}

/** Manage workspace folders: create / update / delete / add_folio (cloud-only). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
export async function handleManageWorkspace(args: any) {
  if (isOSS) throw new Error('Workspace folders are a cloud feature and are not available in OSS mode.');
  const { action, project_id, name, description, is_public, folio_id, confirmed } = args || {};
  if (!['create', 'update', 'delete', 'add_folio', 'archive', 'unarchive'].includes(action)) {
    throw new Error("Argument 'action' must be one of: create, update, delete, add_folio, archive, unarchive.");
  }
  const orgId = await resolveOrgIdFromHeaders();
  requireSupabaseAdmin();

  if (action === 'create') {
    if (!name || typeof name !== 'string') throw new Error("Argument 'name' is required for create.");
    const slugBase = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'untitled';
    const slug = `${slugBase}-${crypto.randomBytes(4).toString('hex')}`;
    const { data, error } = await supabaseAdmin
      .from('projects')
      .insert({
        name: name.trim(),
        description: description || null,
        is_public: is_public === true,
        slug,
        organization_id: orgId,
      })
      .select('id, name, slug, description, is_public')
      .single();
    if (error) throw error;
    return { success: true, workspace: data };
  }

  if (!project_id) throw new Error("Argument 'project_id' is required for update/delete/add_folio/archive/unarchive.");

  // Archive sweeps every folio in the workspace through the same invariant as
  // a folio archive — see lib/archive.ts.
  if (action === 'archive') {
    const state = await archiveWorkspace(project_id, orgId);
    if (!state) throw new Error('Workspace folder not found or access denied.');
    return {
      success: true,
      project_id: state.id,
      archived: true,
      archived_at: state.archivedAt,
      archived_folios: state.affectedFolios,
      note: 'Workspace archived — its folios are unpublished, unlisted, and hidden from every public surface. Nothing was deleted and they still count toward storage. Restore with action:"unarchive".',
    };
  }

  if (action === 'unarchive') {
    const state = await unarchiveWorkspace(project_id, orgId);
    if (!state) throw new Error('Workspace folder not found or access denied.');
    return {
      success: true,
      project_id: state.id,
      archived: false,
      archived_at: null,
      restored_folios: state.affectedFolios,
      note: 'Workspace and its folios restored as drafts. Nothing republished automatically — publish them again when the owner is ready.',
    };
  }

  if (action === 'update') {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name !== undefined) patch.name = String(name).trim();
    if (description !== undefined) patch.description = description;
    if (is_public !== undefined) patch.is_public = !!is_public;
    const { data, error } = await supabaseAdmin
      .from('projects')
      .update(patch)
      .eq('id', project_id)
      .eq('organization_id', orgId)
      .select('id, name, slug, description, is_public')
      .single();
    if (error) throw new Error('Workspace folder not found or access denied.');
    return { success: true, workspace: data };
  }

  if (action === 'delete') {
    requireConfirmed(confirmed);
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('id', project_id)
      .eq('organization_id', orgId)
      .maybeSingle();
    if (fetchErr || !existing) throw new Error('Workspace folder not found or access denied.');

    const { error: deleteErr } = await supabaseAdmin
      .from('projects')
      .delete()
      .eq('id', project_id)
      .eq('organization_id', orgId);
    if (deleteErr) throw deleteErr;
    // Folios inside are detached (project_id FK SET NULL), NOT deleted.
    return { success: true, project_id, note: 'Folios inside the folder were detached, not deleted.' };
  }

  // add_folio
  if (!folio_id) throw new Error("Argument 'folio_id' is required for add_folio.");
  const { data: project, error: projErr } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', project_id)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (projErr || !project) throw new Error('Workspace folder not found or access denied.');

  const { data: folio, error: folioErr } = await supabaseAdmin
    .from('folios')
    .select('id')
    .eq('id', folio_id)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (folioErr || !folio) throw new Error('Folio not found or access denied.');

  const { error: updateErr } = await supabaseAdmin
    .from('folios')
    .update({ project_id, updated_at: new Date().toISOString() })
    .eq('id', folio_id);
  if (updateErr) throw updateErr;
  return { success: true, folio_id, project_id };
}

/** List / invite / update role / remove workspace members (cloud-only). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
export async function handleManageMember(args: any) {
  if (isOSS) throw new Error('Membership management is a cloud feature and is not available in OSS mode.');
  requireSupabaseAdmin();
  const { action, email, role, member_id } = args || {};
  const orgId = await resolveOrgIdFromHeaders();
  const userId = await resolveActingUserId(orgId);

  // List — no action.
  if (!action) {
    const { data: dbMembers, error } = await supabaseAdmin
      .from('organization_members')
      .select('id, user_id, role, created_at')
      .eq('organization_id', orgId);
    if (error) throw error;

    const members = await Promise.all(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped organization_members rows
      (dbMembers || []).map(async (m: any) => {
        let memberEmail = '';
        let memberName = 'Teammate';
        try {
          if (typeof supabaseAdmin.auth.admin.getUser === 'function') {
            const { data: authUser } = await supabaseAdmin.auth.admin.getUser(m.user_id);
            memberEmail = authUser?.user?.email || '';
            memberName = authUser?.user?.user_metadata?.full_name || memberEmail.split('@')[0] || 'Teammate';
          }
        } catch { /* defaults */ }
        return {
          member_id: m.id,
          user_id: m.user_id,
          email: memberEmail || 'teammate@company.com',
          name: memberName,
          role: m.role,
          created_at: m.created_at,
          is_self: m.user_id === userId,
        };
      })
    );
    return { members, total: members.length };
  }

  await requireRole(orgId, userId, ['Owner', 'Admin']);

  if (action === 'invite') {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Please provide a valid teammate email address.');
    }
    if (!['Admin', 'Member'].includes(role)) {
      throw new Error("Argument 'role' must be 'Admin' or 'Member'.");
    }

    const quota = await getOrganizationQuota(orgId);
    // Which plans include seating, and how many seats they carry, is packaging
    // — it lives in lib/plans (Cloud) and lib/plans.oss (self-hosted, uncapped).
    const seating = teammateSeating(quota.plan, quota.monthly_message_limit);
    if (!seating.canInvite) {
      throw new Error(seating.inviteBlockedMessage);
    }
    const seatLimit = seating.seatLimit;
    if (seatLimit !== null) {
      const { count: memberCount } = await supabaseAdmin
        .from('organization_members')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', orgId);
      const { count: pendingCount } = await supabaseAdmin
        .from('organization_invitations')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .is('consumed_at', null);
      const used = (memberCount || 0) + (pendingCount || 0);
      if (used >= seatLimit) {
        throw new Error(`The plan includes ${seatLimit} seat(s) and they are all in use.`);
      }
    }

    const userList = await listAllAuthUsers(supabaseAdmin);
    const existingUser = userList.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped Supabase auth user row
      (u: any) => u.email?.toLowerCase() === email.toLowerCase()
    );

    if (existingUser) {
      const { error: insertErr } = await supabaseAdmin
        .from('organization_members')
        .insert({ organization_id: orgId, user_id: existingUser.id, role });
      if (insertErr) {
        if (insertErr.code === '23505') {
          throw new Error('This user is already a member of the workspace.');
        }
        throw insertErr;
      }
      return { success: true, direct: true, message: `User ${email} identified — added directly to the workspace.` };
    }

    const inviteToken = crypto.randomBytes(24).toString('hex');
    const { error: insertInviteErr } = await supabaseAdmin
      .from('organization_invitations')
      .insert({
        organization_id: orgId,
        email: email.toLowerCase(),
        role,
        token: inviteToken,
        invited_by: userId,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });
    if (insertInviteErr) throw insertInviteErr;

    let orgName = 'LiveFolio';
    try {
      const { data: org } = await supabaseAdmin.from('organizations').select('name').eq('id', orgId).single();
      if (org?.name) orgName = org.name;
    } catch { /* non-critical */ }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://livefolio.cloud';
    const inviteUrl = `${baseUrl}/register?invite=${inviteToken}&email=${encodeURIComponent(email)}&org=${orgId}&role=${role}&orgName=${encodeURIComponent(orgName)}`;
    await sendOrgInviteEmail({
      to: email,
      orgName,
      inviterName: userId, // service-role context; the UI passes a name — acceptable placeholder
      role: role as 'Admin' | 'Member',
      inviteUrl,
    });
    return { success: true, direct: false, message: `Invitation email sent to ${email}.` };
  }

  if (!member_id) throw new Error(`Argument 'member_id' is required for ${action}.`);

  const { data: targetMember, error: fetchErr } = await supabaseAdmin
    .from('organization_members')
    .select('role, user_id')
    .eq('id', member_id)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (fetchErr || !targetMember) throw new Error('Teammate seat not found in this workspace.');

  const actingRole = await requireRole(orgId, userId, ['Owner', 'Admin']);

  if (targetMember.role === 'Owner') {
    throw new Error('The Owner role cannot be changed or removed.');
  }

  if (action === 'update_role') {
    if (!['Admin', 'Member'].includes(role)) throw new Error("Argument 'role' must be 'Admin' or 'Member'.");
    if (actingRole === 'Admin' && targetMember.role === 'Admin') {
      throw new Error('Admins cannot modify fellow Admins.');
    }
    const { error: updateErr } = await supabaseAdmin
      .from('organization_members')
      .update({ role })
      .eq('id', member_id);
    if (updateErr) throw updateErr;
    return { success: true, message: `Member role updated to ${role}.` };
  }

  // remove
  const isSelfRemoval = targetMember.user_id === userId;
  if (!isSelfRemoval && actingRole === 'Admin' && targetMember.role === 'Admin') {
    throw new Error('Admins cannot remove fellow Admins.');
  }
  const { error: deleteErr } = await supabaseAdmin
    .from('organization_members')
    .delete()
    .eq('id', member_id);
  if (deleteErr) throw deleteErr;
  return { success: true, message: 'Member removed from the workspace.' };
}
