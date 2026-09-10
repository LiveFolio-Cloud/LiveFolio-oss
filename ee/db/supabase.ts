/**
 * OSS stub for ee/db/supabase.ts.
 *
 * The OSS build has no cloud auth or Supabase connection. This stub keeps the
 * EXACT same export surface as the Cloud original so the files that import it
 * still type-check and run, but contains zero Supabase package imports.
 */

/**
 * Enterprise Server-Side Supabase Client (Cookie-Aware)
 *
 * OSS stub: no cloud auth, so this returns null. The server-side guard is
 * preserved to match the original contract.
 */
export async function createServerSupabaseClient() {
  // Server-side guard
  if (typeof window !== 'undefined') {
    throw new Error('createServerSupabaseClient cannot be loaded on the client side.');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberate: mirrors the real client's return surface without importing @supabase into the OSS stub
  return null as any;
}

/**
 * Enterprise PostgreSQL Admin Scoped Connection (Bypasses RLS)
 *
 * OSS stub: always null (matches the original's null-return contract when
 * Supabase is not configured).
 */
export function getEnterpriseAdminClient() {
  if (typeof window !== 'undefined') {
    throw new Error('getEnterpriseAdminClient cannot be executed on the client side.');
  }

  // `null as any` (not bare null) — consumers narrow the truthy branch
  // against the Supabase client type; a bare-null return type narrows
  // that branch to `never` and breaks type-checking in the OSS tree.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberate: any preserves consumer narrowing without importing @supabase into the OSS stub
  return null as any;
}

/**
 * Retrieve seats usage or subscription metrics for an organization.
 *
 * OSS stub: returns the same fallback the original returns when no admin
 * client is available.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub mirrors the Cloud signature; orgId unused in OSS
export async function getOrganizationSeatMetrics(orgId: string) {
  return { seatsUsed: 1, seatLimit: 5 };
}
