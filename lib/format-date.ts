/**
 * format-date — the date renderings the comment + history surfaces use.
 *
 * These are NOT a single "format a date" function with options. Each one is a
 * distinct, deliberately chosen output (locale + option table), and two of them
 * render differently on purpose:
 *
 *   formatMonthDay    "Sep 19"      — en-US, month + day. Comment timestamps.
 *   formatVisitorDate "9/19/2026"   — whatever the VISITOR's locale says, with
 *                                     no options at all. Version history.
 *
 * The visitor-locale one is not a bug or an oversight: it lets a reader see
 * dates in their own format. Do not "unify" it onto `formatMonthDay` — that
 * would change what every non-US visitor reads.
 *
 * Both accept an ISO string or an already-constructed Date and never mutate
 * the time value, so they are drop-in for the inline calls they replace.
 */

/** Coerce to a Date without shifting the time value. */
function toDate(input: Date | string): Date {
  return input instanceof Date ? input : new Date(input);
}

/** "Sep 19" — en-US, abbreviated month + numeric day. */
export function formatMonthDay(input: Date | string): string {
  return toDate(input).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** The visitor's own locale, no options — whatever their browser renders. */
export function formatVisitorDate(input: Date | string): string {
  return toDate(input).toLocaleDateString();
}
