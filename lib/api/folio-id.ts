/**
 * Hyphen-suffix folio-ID resolution (OSS flat-file mode).
 *
 * A share URL may carry a human-readable slug whose tail is the folio UUID
 * (`my-deck-da25bc6d-8cc6-4bf9-8588-9e448aa8cbb2`). Routes resolve it by
 * trying progressively longer hyphen-separated SUFFIXES and taking the first
 * one that a lookup accepts.
 *
 * ── Why this does NOT reuse `extractUUIDFromSlug` (lib/utils.ts) ─────────
 * They look interchangeable and are not:
 * - `extractUUIDFromSlug` is a pure regex — it returns the trailing UUID
 *   WITHOUT checking it exists. Callers then fall back to a second lookup of
 *   the whole slug.
 * - this loop is DB-VERIFIED and suffix-ordered — it can resolve a short or
 *   non-UUID id that is not a UUID at all, provided a row has that id.
 * Swapping the loop for the regex helper would change which ids a share URL
 * resolves, so the loop is preserved here as its own primitive.
 */

/**
 * Tries `parts.slice(-1)`, `parts.slice(-2)` … of `targetId` against `lookup`
 * and returns the first hit. `lookup` returning null/undefined means miss.
 *
 * Returns `null` when `targetId` has no hyphen, or when nothing matches —
 * in which case the caller keeps its original `targetId`, exactly as the
 * inline loops did (they only ever reassigned on a hit).
 */
export function resolveByHyphenSuffix<T>(
  targetId: string,
  lookup: (candidateId: string) => T | undefined | null
): { id: string; value: T } | null {
  if (!targetId.includes('-')) return null;
  const parts = targetId.split('-');
  for (let i = 1; i <= parts.length; i++) {
    const candidate = parts.slice(-i).join('-');
    const value = lookup(candidate);
    if (value) return { id: candidate, value };
  }
  return null;
}
