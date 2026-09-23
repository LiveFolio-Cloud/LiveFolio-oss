/**
 * OSS stub — no PostHog analytics.
 * This is the self-hosted build's swap for PostHogProvider.tsx.
 */
export default function PostHogProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
