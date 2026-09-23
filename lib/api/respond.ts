import { NextResponse } from 'next/server';

/**
 * The two JSON envelopes the REST surface uses.
 *
 * This module deliberately does NOT normalise copy. The API today emits
 * `'Internal server error'`, `'Internal Server Error'` and `'Internal server
 * error.'` — three spellings of the same condition — plus several distinct
 * 402 messages for `STORAGE_EXCEEDED`. Clients and tests may match on those
 * strings, so they are passed through verbatim: the win here is ONE
 * construction path, not consistent copy. Normalising belongs in its own
 * change with its own review.
 *
 * Byte-identity: `err('Internal server error', { status: 500 })` serialises to
 * exactly `{"error":"Internal server error"}` — same single key, same order,
 * same status/headers as the `NextResponse.json({ error: '...' }, { status })`
 * call it replaces.
 */

/** `{ error: message }` — message passed through untouched. */
export function err(message: string, init?: ResponseInit): NextResponse {
  return NextResponse.json({ error: message }, init);
}

/**
 * `{ success: true }`, optionally spread with extra fields.
 *
 * `extra` is spread INTO the body after `success`, so it can never overwrite
 * the flag; callers that need additional keys pass them here rather than
 * building a second envelope.
 */
export function ok(
  extra?: Record<string, unknown>,
  init?: ResponseInit
): NextResponse {
  return NextResponse.json({ success: true, ...(extra || {}) }, init);
}
