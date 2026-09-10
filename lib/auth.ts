import { headers } from 'next/headers';
import { isOSS } from './env';
import { getEnterpriseAdminClient } from '@/ee/db/supabase';

export interface AdminSession {
  userId: string;
  email: string;
  orgId: string;
  role: string;
}

/**
 * Validates the current request has admin-level access.
 * In OSS mode, all users are admins.
 * In Cloud mode, only platform admins (server-verified app_metadata flag)
 * can access platform-wide admin panels. Ownership of a personal workspace
 * does NOT grant platform admin — it would be satisfied by every user.
 * Returns null if access is denied.
 */
export async function getAdminSession(): Promise<AdminSession | null> {
  const ctx = await getAuthContext();
  if (!ctx.userId) return null;

  if (isOSS) {
    return {
      userId: ctx.userId,
      email: ctx.email || 'local@livefolio.oss',
      orgId: ctx.orgId || 'local-workspace',
      role: ctx.role || 'Owner',
    };
  }

  // Cloud mode: only platform admins can access platform-wide admin panels.
  // The flag lives in app_metadata (server-only, NOT user-editable) and is
  // re-verified against the auth provider here rather than trusted from headers.
  try {
    const adminClient = getEnterpriseAdminClient();
    if (adminClient) {
      const { data: authUser, error } = await adminClient.auth.admin.getUserById(ctx.userId);
      if (!error && authUser?.user?.app_metadata?.is_platform_admin === true) {
        return {
          userId: ctx.userId,
          email: ctx.email || '',
          orgId: ctx.orgId || '',
          role: 'Owner',
        };
      }
    }
  } catch (err) {
    console.error('Admin session verification failed:', err);
  }

  return null;
}

export interface AuthContext {
  userId: string | null;
  email: string | null;
  orgId: string | null;
  role: string | null;
}

/**
 * Retrieves the current authentication context from request headers.
 * In OSS mode, returns null values as auth is disabled.
 * In Cloud mode, reads from simulation headers or real auth provider.
 * Integrates high-fidelity self-healing provisioning to auto-create user workspaces on bypasses.
 */
export async function getAuthContext(): Promise<AuthContext> {
  if (isOSS) {
    return {
      userId: 'oss-local-user',
      email: 'local@LiveFolio.oss',
      orgId: 'local-workspace',
      role: 'Owner'
    };
  }

  const headerList = await headers();
  const userId = headerList.get('x-user-id');
  const email = headerList.get('x-user-email');
  let orgId = headerList.get('x-organization-id');
  let role = headerList.get('x-user-role');

  // ── Defense-in-depth: verify membership against the DB ─────────────────
  // Headers are stripped at the middleware edge, but handlers must not rely
  // on that alone. If a non-placeholder org is claimed, confirm the user is
  // actually a member and take the role from the DB (never from headers).
  if (userId && orgId && orgId !== '00000000-0000-0000-0000-000000000000') {
    try {
      const adminClient = getEnterpriseAdminClient();
      if (adminClient) {
        const { data: membership } = await adminClient
          .from('organization_members')
          .select('role')
          .eq('organization_id', orgId)
          .eq('user_id', userId)
          .maybeSingle();

        if (membership) {
          role = membership.role;
        } else {
          // Claimed org is not one the user belongs to — fall back to the
          // user's real memberships so a spoofed org never takes effect.
          const { data: realMemberships } = await adminClient
            .from('organization_members')
            .select('organization_id, role')
            .eq('user_id', userId);

          if (realMemberships && realMemberships.length > 0) {
            // Callback param annotated: the OSS stub types the admin client
            // as any, which leaves .find callbacks without contextual typing.
            const ownerMembership = realMemberships.find((m: { role: string }) => m.role === 'Owner');
            const bestMembership = ownerMembership || realMemberships[0];
            orgId = bestMembership.organization_id;
            role = bestMembership.role;
          } else {
            orgId = null;
            role = null;
          }
        }
      }
    } catch (err) {
      console.error('Failed to verify org membership in auth context:', err);
    }
  }

  // Self-heal/provision organization if the user has the fallback orgId
  if (userId && orgId === '00000000-0000-0000-0000-000000000000') {
    try {
      const adminClient = getEnterpriseAdminClient();
      if (adminClient) {
        // 1. Double check if they have a real organization member record (handles race conditions)
        const { data: memberships } = await adminClient
          .from('organization_members')
          .select('organization_id, role')
          .eq('user_id', userId);

        if (memberships && memberships.length > 0) {
          // Prefer the org where the user is Owner (their personal workspace).
          // If they're only a Member everywhere, pick the first one.
          // (Callback param annotated — see the sibling block above.)
          const ownerMembership = memberships.find((m: { role: string }) => m.role === 'Owner');
          const bestMembership = ownerMembership || memberships[0];
          orgId = bestMembership.organization_id;
          role = bestMembership.role;
          // Limits are now derived dynamically from the active org's plan —
          // no static limit columns to sync on profiles.
        } else {
          // 2. Provision user profile and a personal organization workspace
          const userEmail = email || 'user@LiveFolio.cloud';
          const fullName = userEmail.split('@')[0] || 'Cloud Developer';
          const orgName = fullName.endsWith('s') ? `${fullName} Workspace` : `${fullName}'s Workspace`;

          // Ensure profile exists in public.profiles with per-user usage defaults
          await adminClient
            .from('profiles')
            .upsert({
              id: userId,
              full_name: fullName,
              updated_at: new Date().toISOString()
            }, { onConflict: 'id' });

          // Insert new personal organization
          const { data: newOrg, error: orgErr } = await adminClient
            .from('organizations')
            .insert({
              name: orgName,
              plan: 'Free',
              monthly_message_count: 0,
              monthly_message_limit: 60
            })
            .select('id')
            .single();

          if (orgErr) {
            console.error('Error auto-provisioning organization in auth context:', orgErr);
          } else if (newOrg) {
            orgId = newOrg.id;
            role = 'Owner';

            // Connect user to their brand new organization as Owner
            await adminClient
              .from('organization_members')
              .insert({
                organization_id: orgId,
                user_id: userId,
                role: 'Owner'
              });

            // Update user metadata in Supabase Auth so middleware caches this orgId going forward
            await adminClient.auth.admin.updateUserById(userId, {
              user_metadata: {
                organization_id: orgId,
                organization_role: 'Owner'
              }
            });
          }
        }
      }
    } catch (err) {
      console.error('Failed self-healing onboarding in getAuthContext:', err);
    }
  }

  return {
    userId,
    email,
    orgId,
    role,
  };
}
