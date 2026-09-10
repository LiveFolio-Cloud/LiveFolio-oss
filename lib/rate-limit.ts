/**
 * Simple in-memory rate limiter for OTP and other auth endpoints.
 *
 * Tracks attempts by key (IP, session ID, email) within a time window.
 * Designed for single-instance deployments. For multi-instance, replace
 * with Redis or a database-backed store.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
  lockedUntil?: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  const keysToDelete: string[] = [];
  store.forEach((entry, key) => {
    if (entry.resetAt < now && !entry.lockedUntil) {
      keysToDelete.push(key);
    }
    // Also clean expired lockouts
    if (entry.lockedUntil && entry.lockedUntil < now) {
      keysToDelete.push(key);
    }
  });
  keysToDelete.forEach((key) => store.delete(key));
}, 300_000);

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  /** The maxAttempts value of the window this result was computed for. */
  limit: number;
  lockedUntil?: number;
  reason?: string;
}

/**
 * Check if a request should be rate-limited.
 *
 * @param key - Unique identifier (IP, session ID, email)
 * @param maxAttempts - Max allowed attempts in the window (default 5)
 * @param windowMs - Time window in milliseconds (default 15 minutes)
 * @param lockoutMs - Lockout duration after exceeding maxAttempts (default 30 minutes)
 */
export function checkRateLimit(
  key: string,
  maxAttempts: number = 5,
  windowMs: number = 15 * 60_000,
  lockoutMs: number = 30 * 60_000
): RateLimitResult {
  const now = Date.now();
  const entry = store.get(key);

  // No prior attempts, or the entry is fully expired (window AND lockout).
  // A still-active lockout must never be reset by an expired window.
  if (!entry || (entry.resetAt < now && (!entry.lockedUntil || entry.lockedUntil < now))) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxAttempts - 1, resetAt: now + windowMs, limit: maxAttempts };
  }

  const current = store.get(key)!;

  // Check if currently locked out
  if (current.lockedUntil && current.lockedUntil > now) {
    const remainingLockSec = Math.ceil((current.lockedUntil - now) / 1000);
    return {
      allowed: false,
      remaining: 0,
      resetAt: current.resetAt,
      limit: maxAttempts,
      lockedUntil: current.lockedUntil,
      reason: `Too many attempts. Try again in ${remainingLockSec}s.`,
    };
  }

  // Window has expired and there is no active lockout — start a fresh window
  if (current.resetAt < now) {
    current.count = 1;
    current.resetAt = now + windowMs;
    current.lockedUntil = undefined;
    store.set(key, current);
    return { allowed: true, remaining: maxAttempts - 1, resetAt: current.resetAt, limit: maxAttempts };
  }

  // Increment count
  current.count++;

  // Check if exceeded max attempts
  if (current.count > maxAttempts) {
    current.lockedUntil = now + lockoutMs;
    store.set(key, current);
    return {
      allowed: false,
      remaining: 0,
      resetAt: current.resetAt,
      limit: maxAttempts,
      lockedUntil: current.lockedUntil,
      reason: `Too many attempts. Account locked for ${Math.ceil(lockoutMs / 60_000)} minutes.`,
    };
  }

  store.set(key, current);
  return {
    allowed: true,
    remaining: maxAttempts - current.count,
    resetAt: current.resetAt,
    limit: maxAttempts,
  };
}

/**
 * Reset rate limit for a key (e.g., after successful verification).
 */
export function resetRateLimit(key: string): void {
  store.delete(key);
}

/**
 * Build standard rate-limit response headers from one or more limit results.
 *
 * When multiple results are passed (e.g. per-IP + per-email), the strictest
 * bucket binds the headers: a denied result always wins; otherwise the bucket
 * with the fewest remaining attempts. `Retry-After` is set only when a result
 * is denied (lockout end, or window reset as a fallback).
 */
export function buildRateLimitHeaders(...results: RateLimitResult[]): Record<string, string> {
  const denied = results.find((r) => !r.allowed);
  const binding = denied ?? results.reduce((a, b) => (b.remaining <= a.remaining ? b : a));
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(binding.limit),
    'X-RateLimit-Remaining': String(Math.max(0, binding.remaining)),
    'X-RateLimit-Reset': String(Math.ceil(binding.resetAt / 1000)),
  };
  if (denied) {
    const retryAfter = denied.lockedUntil
      ? Math.max(1, Math.ceil((denied.lockedUntil - Date.now()) / 1000))
      : Math.max(1, Math.ceil((denied.resetAt - Date.now()) / 1000));
    headers['Retry-After'] = String(retryAfter);
  }
  return headers;
}

/**
 * Get the client IP from a request.
 *
 * Forwarding headers (x-forwarded-for) are only trusted when TRUST_PROXY=true
 * (i.e. the deployment sits behind a proxy that overwrites them). Otherwise a
 * client could spoof x-forwarded-for to bypass IP-based rate limits.
 */
export function getClientIp(request: Request): string {
  const trustProxy = process.env.TRUST_PROXY === 'true';

  if (trustProxy) {
    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded) return forwarded.split(',')[0].trim();
    const realIp = request.headers.get('x-real-ip');
    if (realIp) return realIp;
  } else {
    const realIp = request.headers.get('x-real-ip');
    if (realIp) return realIp;
  }

  return '127.0.0.1';
}
