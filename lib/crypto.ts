/**
 * Shared constant-time primitives.
 *
 * Consolidates the hand-rolled constant-time string comparisons scattered across
 * `app/api/**` and `lib/**`. Full inventory and the behavioural comparison of
 * every copy.
 *
 * `safeEqual` is the single shared implementation those call sites now use — 12
 * modules import it: 11 routes under `app/api/**` (`oauth/authorize`; the four
 * `agent/auth` routes; the Slack integration webhook; `files/[id]` comments,
 * public and sync; the resend webhook; and the raw asset route) plus
 * `lib/gating/preview.ts`.
 *
 * Security-critical: every importer compares a secret, signature or token
 * against attacker-supplied input, so the guarantees documented on `safeEqual`
 * below are load-bearing. Do not "simplify" the comparison.
 */
import crypto from 'node:crypto';

/**
 * Constant-time string comparison for secrets, tokens, signatures and OTPs.
 *
 * Returns `true` only when both arguments are strings with identical UTF-8
 * bytes. It never throws.
 *
 * Guarantees, chosen as the union of every existing copy:
 *
 * - **Never throws.** A non-string argument (`undefined`, `null`, a number, an
 *   object) returns `false`. Only the `integrations/slack` copy handled that
 *   (via a blanket `try`/`catch`); every other copy threw `ERR_INVALID_ARG_TYPE`
 *   out of `Buffer.from`. `typeof` is checked explicitly rather than relying on
 *   a `try`/`catch`, because `Buffer.from([1, 2])` is *valid* and would
 *   otherwise silently compare array contents.
 *
 * - **Length-safe.** `crypto.timingSafeEqual` throws
 *   `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH` when the two buffers differ in byte
 *   length, so every copy had to cope with that somehow. Unequal lengths yield
 *   `false` here, never an exception.
 *
 * - **No early return.** The common shape in this repo,
 *   `ba.length === bb.length && crypto.timingSafeEqual(ba, bb)`, short-circuits:
 *   a probe whose length differs returns in O(1) without any comparison, which
 *   leaks *whether* the guess was the right length. This implementation always
 *   performs the full comparison over `max(len)` bytes and folds the length
 *   check into the result, so it never takes a length-dependent early exit.
 *   Return values are unchanged; only the time taken on unequal-length input
 *   is. Callers that want the old short-circuit instead can write
 *   `a.length === b.length && safeEqual(a, b)`.
 *
 * Known divergence: comparisons are over UTF-8 bytes, matching 10 of the 14
 * existing copies. The four `constantTimeEq` copies in `app/api/agent/auth/**`
 * compare UTF-16 code units, which differ from byte comparison for strings
 * containing *unpaired* surrogates — `'\uD800'` and `'�'` both encode to
 * `EF BF BD`, so this returns `true` where they return `false`. Every real
 * caller compares ASCII (access keys, hex/base64url signatures, 6-digit OTPs),
 * where the two agree exactly.
 */
export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;

  try {
    const ba = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');

    // Zero-pad both sides to a common length so the comparison below always
    // runs over exactly `max(len)` bytes, whether or not the lengths matched.
    const n = Math.max(ba.length, bb.length);
    const pa = Buffer.alloc(n);
    const pb = Buffer.alloc(n);
    ba.copy(pa);
    bb.copy(pb);

    // The padded compare is only meaningful when the lengths actually match,
    // hence the trailing `&&`. It is evaluated second, so the constant-time
    // comparison above always runs.
    return crypto.timingSafeEqual(pa, pb) && ba.length === bb.length;
  } catch {
    return false;
  }
}
