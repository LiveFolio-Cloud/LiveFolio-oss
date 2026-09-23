import { isOSS } from './env';
import { supabaseAdmin } from './supabase';
import { NEW_WORKSPACE_MESSAGE_LIMIT } from './plans';
import { findAuthUserByEmail } from './auth-users';
import crypto from 'crypto';

export interface ProvisionedWorkspace {
  apiKey: string;
  organization: {
    id: string;
    name: string;
    plan: string;
  };
}

/** Find a user by email using listUsers (works on all Supabase client versions). */
async function findUserByEmail(email: string): Promise<{ id: string } | null> {
  if (!supabaseAdmin) return null;
  try {
    // Try getUserByEmail first (newer clients)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- feature-detects an admin method missing from some supabase-js version typings
    if (typeof (supabaseAdmin.auth.admin as any)?.getUserByEmail === 'function') {
      const { data } = await supabaseAdmin.auth.admin.getUserByEmail(email);
      if (data?.user) return { id: data.user.id };
    }
  } catch { /* fall through to listUsers */ }

  try {
    // Fallback: walk every page of listUsers (the old read page 1 only,
    // so invitees past ~100 users were silently not found).
    const match = await findAuthUserByEmail(supabaseAdmin, email);
    if (match) return { id: match.id };
  } catch { /* not found */ }

  return null;
}

/**
 * Whether an email already belongs to a LiveFolio account.
 * Cloud mode: looks the email up in Supabase Auth. OSS mode has no accounts,
 * so every email is 'new'. Computed at request time — never persisted.
 */
export async function getEmailAccountStatus(email: string): Promise<'existing' | 'new'> {
  if (isOSS || !supabaseAdmin) return 'new';
  const user = await findUserByEmail(email.trim().toLowerCase());
  return user ? 'existing' : 'new';
}

/**
 * Resolve an existing user's workspace and API key — read-only, never creates
 * anything. Returns null when the email has no account (or no workspace yet).
 * In OSS mode returns the single local workspace key.
 */
export async function getExistingWorkspaceForEmail(email: string): Promise<ProvisionedWorkspace | null> {
  if (isOSS || !supabaseAdmin) {
    // OSS: one local workspace. Mirror the provisioner's OSS branch so the
    // session-poll endpoint can return a credential after completion.
    const localKey = process.env.LIVEFOLIO_API_KEY || 'lf_local_dev_key';
    return { apiKey: localKey, organization: { id: 'local-workspace', name: 'Local OSS Workspace', plan: 'Free' } };
  }

  const cleanEmail = email.trim().toLowerCase();
  const existingUser = await findUserByEmail(cleanEmail);
  if (!existingUser) return null;

  const { data: memberships } = await supabaseAdmin
    .from('organization_members')
    .select('organization_id, role')
    .eq('user_id', existingUser.id)
    .limit(1);

  if (!memberships || memberships.length === 0) return null;

  const orgId = memberships[0].organization_id;
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name, plan, api_key')
    .eq('id', orgId)
    .single();

  if (!org) return null;

  let apiKey = org.api_key;
  if (!apiKey) {
    apiKey = `lf_live_${crypto.randomBytes(24).toString('hex')}`;
    await supabaseAdmin.from('organizations').update({ api_key: apiKey }).eq('id', orgId);
  }
  return { apiKey, organization: { id: org.id, name: org.name, plan: org.plan || 'Free' } };
}

/**
 * Given a verified email address, provisions a workspace and returns an API key.
 * In OSS mode: returns the configured local key.
 * In Cloud mode: finds or creates the user, their org, and an API key.
 *
 * @param emailConfirmed - true when the caller has proof of email control
 *   (e.g. a verified OTP). When false (e.g. an unsigned/signed identity
 *   assertion), the created account is NOT auto-confirmed so that an
 *   attacker cannot pre-register accounts for other people's emails.
 */
export async function provisionAgentWorkspace(
  email: string,
  opts: { emailConfirmed?: boolean } = {}
): Promise<ProvisionedWorkspace> {
  if (isOSS) {
    let localKey = process.env.LIVEFOLIO_API_KEY || '';
    if (!localKey) localKey = 'lf_local_dev_key';
    return {
      apiKey: localKey,
      organization: { id: 'local-workspace', name: 'Local OSS Workspace', plan: 'Free' },
    };
  }

  if (!supabaseAdmin) throw new Error('Supabase client is not initialized in Cloud mode.');

  const cleanEmail = email.trim().toLowerCase();

  try {
    // 1-2. If the email already has an account + workspace, reuse it (no duplicates).
    const existing = await getExistingWorkspaceForEmail(cleanEmail);
    if (existing) return existing;

    let userId: string | null = null;
    const existingUser = await findUserByEmail(cleanEmail);
    if (existingUser) {
      userId = existingUser.id;
    }

    // 3. Create new user if needed
    if (!userId) {
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: cleanEmail,
        password: randomPassword,
        // Only auto-confirm when email control was proven (OTP flow).
        email_confirm: opts.emailConfirmed === true,
      });

      if (createError) {
        // Race condition: user was created between lookup and now
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- createError's code field is not present on every supabase-js error typing
        if ((createError as any)?.code === 'email_exists') {
          const retry = await findUserByEmail(cleanEmail);
          if (retry) userId = retry.id;
        }
        if (!userId) {
          console.error('[Auth Provisioner] Failed to create user:', createError);
          throw new Error('Failed to provision user account.');
        }
      } else if (newUser?.user) {
        userId = newUser.user.id;
      }
    }

    if (!userId) throw new Error('Could not resolve user identity.');

    // 4. Provision profile + api key. For the org, double-check memberships
    // to avoid creating duplicate workspaces from concurrent provisioning calls.
    const fullName = cleanEmail.split('@')[0] || 'Developer';
    const orgName = fullName.endsWith('s') ? `${fullName} Workspace` : `${fullName}'s Workspace`;
    const apiKey = `lf_live_${crypto.randomBytes(24).toString('hex')}`;

    // ATOMIC: the old select → re-check → insert sequence had no lock, so
    // concurrent provisioning calls could each see "no memberships" and each
    // insert an org. The RPC takes a per-user advisory xact lock, re-checks
    // under it, and inserts org + membership in one transaction. It also
    // upserts the profile row (p_full_name), replacing the separate upsert
    // that used to sit here.
    const { data: provisioned, error: provErr } = await supabaseAdmin
      .rpc('provision_personal_workspace', {
        p_user_id: userId,
        p_org_name: orgName,
        // Allowance comes from lib/plans (Cloud-only, stub-swapped in OSS).
        p_message_limit: NEW_WORKSPACE_MESSAGE_LIMIT,
        p_api_key: apiKey,
        p_full_name: fullName,
      });

    if (provErr || !provisioned || typeof provisioned.organization_id !== 'string') {
      console.error('[Auth Provisioner] Failed to create org:', provErr);
      throw new Error('Failed to provision organization workspace.');
    }

    const orgId = provisioned.organization_id;

    if (provisioned.created === false) {
      // Another concurrent call had already created the org — reuse it and
      // fill the API key if it is missing (same behaviour as before).
      const { data: existingOrg } = await supabaseAdmin
        .from('organizations')
        .select('id, name, plan, api_key')
        .eq('id', orgId)
        .single();
      if (existingOrg) {
        const orgPlan = existingOrg.plan || 'Free';
        if (!existingOrg.api_key) {
          await supabaseAdmin.from('organizations').update({ api_key: apiKey }).eq('id', orgId);
        }
        return { apiKey: existingOrg.api_key || apiKey, organization: { id: orgId, name: existingOrg.name, plan: orgPlan } };
      }
    }

    try {
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: { organization_id: orgId, organization_role: 'Owner' },
      });
    } catch { /* non-critical */ }

    return { apiKey, organization: { id: orgId, name: orgName, plan: 'Free' } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase errors are untyped; .message is read uniformly below
  } catch (err: any) {
    console.error('[Auth Provisioner] Provisioning failed:', err);
    throw new Error(err.message || 'Error occurred during workspace provisioning.');
  }
}
