import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * UUID v4 pattern: 8-4-4-4-12 hexadecimal characters.
 */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Extracts a UUID from the end of a human-readable slug.
 *
 * Slugs are formed like `my-project-da25bc6d-8cc6-4bf9-8588-9e448aa8cbb2`.
 * This returns the UUID portion (`da25bc6d-8cc6-4bf9-8588-9e448aa8cbb2`)
 * or the original string if no UUID is found.
 */
export function extractUUIDFromSlug(slug: string): string {
  const match = slug.match(UUID_RE);
  return match ? match[0] : slug;
}

/**
 * Returns true if the string looks like a standalone UUID.
 */
export function isUUID(value: string): boolean {
  return UUID_RE.test(value) && value.length === 36;
}
