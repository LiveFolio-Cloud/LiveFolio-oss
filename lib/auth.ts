import { headers } from 'next/headers';
import { isOSS } from './env';
import { NEW_WORKSPACE_MESSAGE_LIMIT } from './plans';
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

// ── Membership verification memo ───────────────────────────────────────
// getAuthContext() has ~74 call sites, and lib/db.ts calls it a second time
// inside readDB/writeDB/runTransaction — so a single Cloud request can pay the
// `organization_members` round trip (or two, on the spoofed-org fallback)
// several times for the same answer.
//
// React.cache() does NOT help here: it only memoises inside a React render.
// A Route Handler installs no cache dispatcher, so `cache()` degrades to a
// plain unmemoised call there (verified against this Next version: an RSC page
// deduped, a route handler did not). This is therefore a bounded, short-TTL
// map — see the staleness analysis at MEMBERSHIP_CACHE_TTL_MS.
//
// SECURITY: the CLAIMED org is part of the cache key, and this lookup only
// ever *corrects* header claims (middleware re-derives both org and role from
// the DB on every protected request — that authoritative check is untouched).
// A removed user can only hit a positive entry while a request still claims
// the removed org, which is exactly what middleware stops doing once the
// membership row is gone. Only successful lookups are cached: a DB error is
// never remembered, so a transient outage cannot pin someone to a deny.
const PLACEHOLDER_ORG_ID = '00000000-0000-0000-0000-000000000000';

/** 30s: the window in which a *still-claimed* org keeps its cached verdict. */
const MEMBERSHIP_CACHE_TTL_MS = 30_000;
const MEMBERSHIP_CACHE_MAX = 500;

interface MembershipVerdict {
  orgId: string | null;
  role: string | null;
}

const _membershipCache = new Map<string, MembershipVerdict & { expiresAt: number }>();

function readMembershipCache(key: string): MembershipVerdict | null {
  const hit = _membershipCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    _membershipCache.delete(key); // evict expired on read so the map tracks live entries only
    return null;
  }
  // Re-insert at the tail (Map preserves insertion order) so a hot key is the
  // last evicted under pressure.
  _membershipCache.delete(key);
  _membershipCache.set(key, hit);
  return { orgId: hit.orgId, role: hit.role };
}

function writeMembershipCache(key: string, orgId: string | null, role: string | null): void {
  if (_membershipCache.size >= MEMBERSHIP_CACHE_MAX) {
    // Reclaim expired entries first; only if that frees nothing do we evict
    // oldest-first. Either path keeps the map at or below the bound.
    // forEach (not `for...of`) — this tsconfig target can't downlevel-iterate a
    // Map, and deleting the current entry inside forEach is well-defined.
    _membershipCache.forEach((v, k) => {
      if (v.expiresAt <= Date.now()) _membershipCache.delete(k);
    });
    while (_membershipCache.size >= MEMBERSHIP_CACHE_MAX) {
      const oldest = _membershipCache.keys().next().value;
      if (oldest === undefined) break;
      _membershipCache.delete(oldest);
    }
  }
  _membershipCache.set(key, { orgId, role, expiresAt: Date.now() + MEMBERSHIP_CACHE_TTL_MS });
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
  if (userId && orgId && orgId !== PLACEHOLDER_ORG_ID) {
    // JSON-array key: unambiguous, so two different (user, org) pairs can
    // never collide into one entry.
    const cacheKey = JSON.stringify([userId, orgId]);
    const cachedVerdict = readMembershipCache(cacheKey);
    if (cachedVerdict) {
      // Same outcome the queries below would have produced, minus the round
      // trip. The claimed org rides in the key, so this is only ever reachable
      // while a request still claims this exact org.
      orgId = cachedVerdict.orgId;
      role = cachedVerdict.role;
    } else {
      try {
        const adminClient = getEnterpriseAdminClient();
        if (adminClient) {
          const { data: membership, error: membershipErr } = await adminClient
            .from('organization_members')
            .select('role')
            .eq('organization_id', orgId)
            .eq('user_id', userId)
            .maybeSingle();

          if (membership) {
            role = membership.role;
            if (!membershipErr) writeMembershipCache(cacheKey, orgId, role);
          } else {
            // Claimed org is not one the user belongs to — fall back to the
            // user's real memberships so a spoofed org never takes effect.
            const { data: realMemberships, error: fallbackErr } = await adminClient
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
              if (!fallbackErr) writeMembershipCache(cacheKey, orgId, role);
            } else {
              orgId = null;
              role = null;
              // Fail-closed verdicts are cached too, but only when the DB
              // actually answered: a transient error must never be remembered
              // as a fact for the next 30s.
              if (!fallbackErr) writeMembershipCache(cacheKey, null, null);
            }
          }
        }
      } catch (err) {
        console.error('Failed to verify org membership in auth context:', err);
      }
    }
  }

  // Self-heal/provision organization if the user has the fallback orgId.
  // Deliberately NOT cached: this branch writes (it provisions), and it only
  // applies to the placeholder org claim.
  if (userId && orgId === PLACEHOLDER_ORG_ID) {
    try {
      const adminClient = getEnterpriseAdminClient();
      if (adminClient) {
        // 1. Double check if they have a real organization member record.
        //    ORDER BY created_at makes the Owner/Member pick deterministic —
        //    without it, Postgres may scan the rows in any order and a
        //    membership UPDATE/VACUUM could silently change which org wins.
        const { data: memberships } = await adminClient
          .from('organization_members')
          .select('organization_id, role')
          .eq('user_id', userId)
          .order('created_at', { ascending: true });

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
          // 2. Provision user profile and a personal organization workspace.
          //    ATOMIC: the previous select-then-insert had no lock, so N
          //    concurrent requests each saw "no memberships" and each
          //    inserted an org — that race is exactly how users ended up
          //    owning 4 workspaces. The RPC takes a per-user advisory xact
          //    lock, re-checks under it, and inserts org + membership in one
          //    transaction (see the org-provisioning schema revision).
          const userEmail = email || 'user@LiveFolio.cloud';
          const fullName = userEmail.split('@')[0] || 'Cloud Developer';
          const orgName = fullName.endsWith('s') ? `${fullName} Workspace` : `${fullName}'s Workspace`;

          const { data: provisioned, error: provErr } = await adminClient
            .rpc('provision_personal_workspace', {
              p_user_id: userId,
              p_org_name: orgName,
              // The new-workspace allowance lives in lib/plans (Cloud) so the
              // figure never reaches the OSS tree.
              p_message_limit: NEW_WORKSPACE_MESSAGE_LIMIT,
              p_full_name: fullName,
            });

          if (provErr) {
            console.error('Error auto-provisioning organization in auth context:', provErr);
          } else if (provisioned && typeof provisioned.organization_id === 'string') {
            orgId = provisioned.organization_id;
            role = 'Owner';

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
