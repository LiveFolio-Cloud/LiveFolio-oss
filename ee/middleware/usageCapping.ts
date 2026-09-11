/**
 * OSS stub for ee/middleware/usageCapping.ts.
 *
 * The OSS build has no Supabase and no billing tiers — every workspace is
 * treated as an unlimited local workspace. This stub keeps the EXACT same
 * export surface (interfaces + function signatures + return types) as the
 * Cloud original, but each function body is only the OSS-safe-default branch.
 * Contains zero Supabase package imports.
 */

// ─── Interfaces ───────────────────────────────────────────────────

export interface OrganizationQuota {
  id: string;
  name: string;
  // Full Cloud plan union — callers compare against every tier (e.g. the MCP
  // invite action: `plan === 'Free' || plan === 'Pro'` then `=== 'Team'`). A
  // narrower union here narrows to `never` on the second comparison and fails
  // the OSS type-check.
  plan: 'Free' | 'Pro' | 'Team' | 'Enterprise';
  monthly_message_count: number;
  monthly_message_limit: number;
  /** Stripe renewal state — never set in OSS (no billing). */
  subscription_status?: string | null;
}

export interface UserQuota {
  monthly_message_count: number;
  monthly_message_limit: number;
}

export interface UserStorageQuota {
  storage_used_bytes: number;
  storage_limit_bytes: number;
}

// ─── Organization Quota (display / billing overview) ───────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub mirrors the Cloud signature; orgId unused in OSS
export async function getOrganizationQuota(orgId: string): Promise<OrganizationQuota> {
  return {
    id: 'local-workspace',
    name: 'Local OSS Workspace',
    plan: 'Enterprise',
    monthly_message_count: 0,
    monthly_message_limit: 999999,
  };
}

// ─── Per-User AI Prompt Quota ─────────────────────────────────────

/**
 * Retrieves per-user AI prompt usage and limit.
 * OSS: unlimited.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub mirrors the Cloud signature; params unused in OSS
export async function getUserQuota(userId: string, orgId: string): Promise<UserQuota> {
  return { monthly_message_count: 0, monthly_message_limit: 999999 };
}

/**
 * Atomically increments the per-user prompt counter after a successful AI completion.
 * OSS: no-op.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub mirrors the Cloud signature; userId unused in OSS
export async function incrementUserUsage(userId: string): Promise<void> {
  return;
}

/**
 * @deprecated Use incrementUserUsage instead.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub mirrors the Cloud signature; param unused in OSS
export async function incrementOrganizationUsage(_orgId: string): Promise<void> {
  // No-op — per-user tracking is handled by incrementUserUsage.
}

/**
 * Asserts whether a user has available message quota remaining.
 * OSS: always allowed, unlimited.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub mirrors the Cloud signature; params unused in OSS
export async function assertMessageQuota(userId: string, orgId: string): Promise<{
  allowed: boolean;
  quota: UserQuota & { plan?: string };
}> {
  return { allowed: true, quota: { monthly_message_count: 0, monthly_message_limit: 999999 } };
}

// ─── Per-User Storage Quota ───────────────────────────────────────

/**
 * Retrieves per-user storage usage and limit.
 * OSS: unlimited.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub mirrors the Cloud signature; params unused in OSS
export async function getUserStorageQuota(userId: string, orgId: string): Promise<UserStorageQuota> {
  return { storage_used_bytes: 0, storage_limit_bytes: Number.MAX_SAFE_INTEGER };
}

/**
 * Asserts whether a user has enough storage remaining for an operation.
 * OSS: always allowed, unlimited.
 */
export async function assertStorageQuota(
  userId: string,
  additionalBytes: number = 0, // eslint-disable-line @typescript-eslint/no-unused-vars -- stub mirrors the Cloud signature; params unused in OSS
  orgId: string // eslint-disable-line @typescript-eslint/no-unused-vars -- stub mirrors the Cloud signature; params unused in OSS
): Promise<{
  allowed: boolean;
  quota: UserStorageQuota & { plan?: string };
  code?: string;
}> {
  return {
    allowed: true,
    quota: { storage_used_bytes: 0, storage_limit_bytes: Number.MAX_SAFE_INTEGER },
  };
}
