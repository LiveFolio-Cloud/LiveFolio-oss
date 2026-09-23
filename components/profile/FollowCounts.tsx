'use client';

/**
 * Self-hosted stub for components/profile/FollowCounts.tsx.
 *
 * The follow circle is a cloud concept (Supabase profiles/followers tables);
 * the whole components/profile/ directory is excluded from the self-hosted build.
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
