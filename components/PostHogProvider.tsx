/**
 * OSS stub — no PostHog analytics.
 * bin/sync-oss.js swaps this in for PostHogProvider.tsx during sync.
 */
export default function PostHogProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
