/**
 * Username (handle) rules — pure, zero-import so client and server share
 * ONE source of truth (mirrors the DB claim_username regex).
 *
 * Rules: lowercase letters/digits/hyphens/underscores; 3–30 chars; must
 * start and end with alphanumeric. The DB also accepts a single letter
 * (`^[a-z0-9]$`) but that contradicts its own error message — we enforce
 * 3+ everywhere (server wrapper + client) and store lowercased.
 */

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 30;
const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/;

/** Platform-reserved handles (routes, product surfaces, safety). */
export const RESERVED_HANDLES = new Set([
  'about', 'account', 'admin', 'api', 'app', 'auth', 'callback', 'careers',
  'cdn', 'chat', 'community', 'contact', 'dashboard', 'docs', 'download',
  'earnings', 'explore', 'help', 'home', 'legal', 'login', 'logout',
  'marketplace', 'mcp', 'me', 'media', 'new', 'onboarding', 'orders',
  'policies', 'portal', 'pricing', 'privacy', 'profile', 'register',
  'root', 'sdk', 'search', 'settings', 'share', 'signin', 'signup',
  'sitemap', 'status', 'store', 'studio', 'support', 'teams', 'terms',
  'tos', 'u', 'user', 'users', 'w', 'www',
]);

/** Normalize user input → lowercase, allowed charset only. */
export function normalizeHandle(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

/** Structural validity (charset + length + start/end) — NOT availability. */
export function isValidHandle(input: string): boolean {
  if (input.length < HANDLE_MIN || input.length > HANDLE_MAX) return false;
  return HANDLE_RE.test(input);
}

/** Reserved check (structural validity implied). */
export function isReservedHandle(input: string): boolean {
  return RESERVED_HANDLES.has(input);
}

/** Free-form seed → a valid handle-shaped string (may still be short). */
export function toHandleSeed(input: string): string {
  const s = normalizeHandle(input);
  return s.replace(/^[-_]+|[-_]+$/g, '').slice(0, HANDLE_MAX);
}

/** Pad a short seed to at least HANDLE_MIN chars (deterministic). */
export function padHandle(seed: string, salt = 'a'): string {
  if (!seed) return `user${salt}`;
  if (seed.length >= HANDLE_MIN) return seed;
  return seed + salt.repeat(HANDLE_MIN - seed.length);
}
