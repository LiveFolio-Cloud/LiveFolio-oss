import type { InboxGrantInput } from '@/lib/inbox';

/**
 * The caller's shares, on a self-hosted install.
 *
 * The hosted version reads the caller's active granted-access records so a
 * "shared with you" row can reach the Inbox. A self-hosted install has one
 * operator and no sharing: nobody to share to, nothing to read, nothing to
 * return.
 *
 * The Inbox route calls this only on its hosted branch — the self-hosted branch
 * builds its feed from the flat-file store and returns before reaching here —
 * so this supplies the shape the route expects and nothing else.
 */

/** Nothing is shared with anyone here. */
export async function loadCallerGrants(_userId: string | null): Promise<InboxGrantInput[]> {
  return [];
}
