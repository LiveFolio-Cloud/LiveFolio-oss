import { HTMLFile } from './db';

interface CacheEntry {
  project: HTMLFile;
  expiresAt: number;
}

const projectCache = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes cache TTL for instant page navigation!

/**
 * Shared in-memory cache for dynamic folio project records.
 * Drastically speeds up asset serving in the Studio iframe by eliminating N+1 DB queries.
 * Safe to cache for long durations because writes are proactively invalidated.
 */
export const projectMemoryCache = {
  get(id: string): HTMLFile | null {
    const cached = projectCache.get(id);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.project;
    }
    return null;
  },

  set(id: string, project: HTMLFile, ttlMs: number = DEFAULT_TTL_MS): void {
    projectCache.set(id, {
      project,
      expiresAt: Date.now() + ttlMs
    });
  },

  invalidate(id: string): void {
    projectCache.delete(id);
  },

  clear(): void {
    projectCache.clear();
  }
};
