'use client';

/**
 * OSS stub for components/profile/FollowCounts.tsx — swapped in by
 * bin/sync-oss.js (STUB_SWAPS).
 *
 * The follow circle is a cloud concept (Supabase profiles/followers tables);
 * the whole components/profile/ directory is excluded from the OSS sync.
 * This stub keeps the identical export surface so the app-shell Settings
 * General section keeps compiling — its <FollowCounts> usage sits inside an
 * `isCloud` block, so this component never renders in OSS mode.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub mirrors the Cloud signature; props unused in OSS (never rendered)
export default function FollowCounts(props: {
  username: string;
  followers?: number | null;
  following?: number | null;
  isOwner: boolean;
}) {
  return null;
}
