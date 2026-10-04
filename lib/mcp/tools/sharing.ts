/**
 * MCP tool handlers — sharing and visibility: status, dev tunnel,
 * public-access flag, and manage_sharing (publish/privacy/access key +
 * `state_write`, who may edit the data a folio collects).
 */
import { readDB, runTransaction } from '@/lib/db';
import fs from 'fs';
import { startTunnel } from 'untun';
import { isOSS } from '@/lib/env';
import { isStateWriteMode } from '@/lib/folio-state';
import { supabaseAdmin } from '@/lib/supabase';
import { projectMemoryCache } from '@/lib/project-cache';
import { SETTINGS_FILE, globalWithTunnel, requireSupabaseAdmin, resolveOrgIdFromHeaders, getRequestOrigin } from '@/lib/mcp/shared';

export function getCustomTunnelUrl(): string {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      return data.customTunnelUrl || '';
    }
  } catch (err) {
    console.error('Error reading customTunnelUrl from settings:', err);
  }
  return '';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
export async function handleGetSharingStatus(args: any) {
  if (!isOSS) {
    throw new Error('Sharing and tunneling tools are only available in local OSS mode.');
  }

  const { project_id } = args || {};
  let projectPublicAccess: boolean | undefined = undefined;

  if (project_id) {
    const db = await readDB();
    const project = db.find(p => p.id === project_id);
    if (!project) {
      throw new Error(`Project with ID '${project_id}' not found.`);
    }
    projectPublicAccess = !!project.publicTunnelEnabled;
  }

  return {
    active: !!globalWithTunnel.activeTunnel,
    url: globalWithTunnel.activeUrl || null,
    customTunnelUrl: getCustomTunnelUrl(),
    project_id: project_id || null,
    public_tunnel_enabled: projectPublicAccess
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
export async function handleToggleSharingTunnel(args: any, request?: Request) {
  if (!isOSS) {
    throw new Error('Sharing and tunneling tools are only available in local OSS mode.');
  }

  const { action } = args || {};
  if (action !== 'start' && action !== 'stop') {
    throw new Error("Argument 'action' must be either 'start' or 'stop'.");
  }

  if (action === 'start') {
    if (globalWithTunnel.activeTunnel) {
      return {
        success: true,
        url: globalWithTunnel.activeUrl,
        message: 'Tunnel already running'
      };
    }

    // Determine target local port (defaults to 3000)
    let localPort = 3000;
    if (request) {
      const host = request.headers.get('host') || 'localhost:3000';
      const portString = host.split(':')[1] || '3000';
      localPort = parseInt(portString, 10) || 3000;
    }

    // Start new untun tunnel targeting our active local port
    const tunnel = await startTunnel({ port: localPort, acceptCloudflareNotice: true });
    if (!tunnel) {
      throw new Error('Failed to establish tunnel');
    }
    const url = await tunnel.getURL();

    globalWithTunnel.activeTunnel = tunnel;
    globalWithTunnel.activeUrl = url;

    return {
      success: true,
      url: url,
      message: 'Tunnel started successfully'
    };
  } else {
    // action === 'stop'
    if (globalWithTunnel.activeTunnel) {
      await globalWithTunnel.activeTunnel.close();
      globalWithTunnel.activeTunnel = undefined;
      globalWithTunnel.activeUrl = undefined;
    }
    return {
      success: true,
      message: 'Tunnel stopped successfully'
    };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
export async function handleSetFolioPublicAccess(args: any, request?: Request) {
  const { project_id, enabled } = args || {};
  if (!project_id) {
    throw new Error("Argument 'project_id' is required.");
  }
  if (enabled === undefined) {
    throw new Error("Argument 'enabled' (boolean) is required.");
  }

  await runTransaction(async (db) => {
    const pIndex = db.findIndex(p => p.id === project_id);
    if (pIndex === -1) {
      throw new Error(`Project with ID '${project_id}' not found.`);
    }

    db[pIndex].publicTunnelEnabled = !!enabled;
    db[pIndex].updatedAt = new Date().toISOString();
  });

  const origin = getRequestOrigin(request);
  const activeUrl = globalWithTunnel.activeUrl;
  const shareBase = activeUrl || origin;

  return {
    success: true,
    project_id,
    public_tunnel_enabled: !!enabled,
    share_url: `${shareBase}/share/${project_id}`
  };
}

// ── Phase 2: sharing / paid access / listing / marketplace ─────────────

/**
 * `state_write` is the one field here that is not about who can SEE the folio:
 * it is who may edit the DATA the folio collects (its `HTMLFile.stateWrite` /
 * `folios.state_write` mirror, `undefined` = the column's `'off'` default).
 * Both axes ride the same row update; neither is ever derived from the other.
 */

/** Read or change sharing/visibility settings (dual-mode, no version bump). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
export async function handleManageSharing(args: any) {
  const { project_id, status, isPrivate, accessKey, allowComments, presentationModeOnly, stateWrite } = args || {};
  if (!project_id) throw new Error("Argument 'project_id' is required.");

  // Validate the enum before either store is touched: one error, identical in
  // both modes, and the column's CHECK constraint can never be the thing that
  // reports a bad mode. Only `undefined` means "leave it alone" — a `null` (or
  // any other value) is refused rather than silently ignored, so an agent that
  // sends the wrong thing hears about it.
  if (stateWrite !== undefined && !isStateWriteMode(stateWrite)) {
    throw new Error(
      "Argument 'stateWrite' must be 'off', 'anonymous' or 'signed_in' — it controls who may edit the data this folio collects."
    );
  }

  const hasChanges =
    status !== undefined || isPrivate !== undefined || accessKey !== undefined ||
    allowComments !== undefined || presentationModeOnly !== undefined ||
    stateWrite !== undefined;

  if (!isOSS) {
    const orgId = await resolveOrgIdFromHeaders();
    requireSupabaseAdmin();

    const { data: current, error: fetchError } = await supabaseAdmin
      .from('folios')
      .select('id, is_private, access_key, allow_comments, presentation_mode_only, status, archived_at, state_write')
      .eq('id', project_id)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (fetchError || !current) throw new Error(`Project with ID '${project_id}' not found.`);

    // An archived folio cannot be published in place — it has to come out of
    // the archive first, landing as a draft. Without this the archive would be
    // trivially bypassable by any agent that can call manage_sharing.
    if (status === 'published' && current.archived_at) {
      throw new Error(
        `Folio '${project_id}' is archived. Call unarchive_folio first — it returns as a draft — then publish.`
      );
    }

    if (!hasChanges) {
      return {
        status: current.status || 'published',
        isPrivate: current.is_private ?? false,
        hasAccessKey: !!current.access_key,
        allowComments: current.allow_comments ?? true,
        presentationModeOnly: current.presentation_mode_only ?? false,
        // Who may edit the data the folio collects — absent on rows created
        // before the column existed, and on any deployment where the read
        // predates it; both mean 'off'.
        stateWrite: isStateWriteMode(current.state_write) ? current.state_write : 'off',
        archived: !!current.archived_at,
      };
    }

    if (status !== undefined && status !== 'draft' && status !== 'published') {
      throw new Error("status must be 'draft' or 'published'.");
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (status !== undefined) patch.status = status;
    if (isPrivate !== undefined) patch.is_private = !!isPrivate;
    if (accessKey !== undefined) patch.access_key = accessKey || null;
    if (allowComments !== undefined) patch.allow_comments = !!allowComments;
    if (presentationModeOnly !== undefined) patch.presentation_mode_only = !!presentationModeOnly;
    // Deliberately the only place the data-editing mode is written, and it
    // rides the same row update as the visibility fields without ever being
    // derived from them.
    if (stateWrite !== undefined) patch.state_write = stateWrite;

    const { error: updateError } = await supabaseAdmin
      .from('folios')
      .update(patch)
      .eq('id', current.id)
      .eq('organization_id', orgId);
    if (updateError) throw updateError;
    projectMemoryCache.invalidate(current.id);

    return {
      success: true,
      status: patch.status ?? current.status ?? 'published',
      isPrivate: patch.is_private ?? current.is_private ?? false,
      hasAccessKey: !!(patch.access_key ?? current.access_key),
      allowComments: patch.allow_comments ?? current.allow_comments ?? true,
      presentationModeOnly: patch.presentation_mode_only ?? current.presentation_mode_only ?? false,
      stateWrite: patch.state_write ?? (isStateWriteMode(current.state_write) ? current.state_write : 'off'),
    };
  }

  // OSS — flat DB fields only.
  if (!hasChanges) {
    const db = await readDB();
    const project = db.find((p) => p.id === project_id);
    if (!project) throw new Error(`Project with ID '${project_id}' not found.`);
    return {
      status: project.status || 'published',
      isPrivate: project.isPrivate ?? false,
      hasAccessKey: !!project.accessKey,
      allowComments: project.allowComments ?? true,
      presentationModeOnly: project.presentationModeOnly ?? false,
      stateWrite: project.stateWrite ?? 'off',
      archived: !!project.archivedAt,
    };
  }

  const result = await runTransaction(async (db) => {
    const idx = db.findIndex((p) => p.id === project_id);
    if (idx === -1) throw new Error(`Project with ID '${project_id}' not found.`);
    const project = db[idx];
    // Same archive backstop as the cloud path.
    if (status === 'published' && project.archivedAt) {
      throw new Error(
        `Folio '${project_id}' is archived. Call unarchive_folio first — it returns as a draft — then publish.`
      );
    }
    if (status !== undefined) project.status = status === 'published' ? 'published' : 'draft';
    if (isPrivate !== undefined) project.isPrivate = !!isPrivate;
    if (accessKey !== undefined) project.accessKey = accessKey || undefined;
    if (allowComments !== undefined) project.allowComments = !!allowComments;
    if (presentationModeOnly !== undefined) project.presentationModeOnly = !!presentationModeOnly;
    // The flat-file mirror of the cloud `state_write` column (the same
    // contract the state API's OSS arm reads: absent means 'off').
    if (stateWrite !== undefined) project.stateWrite = stateWrite;
    project.updatedAt = new Date().toISOString();
    db[idx] = project;
    return {
      status: project.status,
      isPrivate: project.isPrivate,
      hasAccessKey: !!project.accessKey,
      allowComments: project.allowComments,
      presentationModeOnly: project.presentationModeOnly,
      stateWrite: project.stateWrite ?? 'off',
    };
  });
  return { success: true, ...result };
}
