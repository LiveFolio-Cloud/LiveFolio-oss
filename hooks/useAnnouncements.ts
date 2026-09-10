/**
 * OSS stub — no admin announcements polling. Always returns empty.
 * bin/sync-oss.js swaps this in for useAnnouncements.ts during sync.
 */
export function useAnnouncements() {
  return { banners: [], modals: [], maintenance: false, all: [], loading: false };
}
