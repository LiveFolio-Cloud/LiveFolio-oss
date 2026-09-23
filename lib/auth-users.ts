/**
 * Pagination-safe listing of Auth users.
 *
 * Supabase's `auth.admin.listUsers` is paginated (max 1000/page, default 50).
 * Four call sites used to read page 1 only, so invitee lookups silently
 * missed anyone past the first page — they were misclassified as "new user"
 * and re-invited, or not found at all. 28 users today, but the cliff sits at
 * ~50-100.
 *
 * The parameter type is STRUCTURAL on purpose: this module ships to the
 * self-hosted distribution, which does not install the Supabase SDK, so it
 * cannot import the package's client type.
 */

export interface AuthUserLite {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

interface AdminAuthApi {
  listUsers(options?: { page?: number; perPage?: number }): Promise<{
    data?: { users?: AuthUserLite[] } | null;
    error?: unknown;
  }>;
}

export interface AdminClientLike {
  auth: { admin: AdminAuthApi };
}

/** Walk every page of listUsers until a short page, returning all users. */
export async function listAllAuthUsers(admin: AdminClientLike): Promise<AuthUserLite[]> {
  const users: AuthUserLite[] = [];
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data || !Array.isArray(data.users) || data.users.length === 0) break;
    users.push(...data.users);
    if (data.users.length < 1000) break;
    page += 1;
  }
  return users;
}

/** Find one user by exact (case-insensitive) email across ALL pages. */
export async function findAuthUserByEmail(
  admin: AdminClientLike,
  email: string,
): Promise<AuthUserLite | null> {
  const target = email.toLowerCase();
  const all = await listAllAuthUsers(admin);
  return all.find((u) => u.email?.toLowerCase() === target) ?? null;
}
