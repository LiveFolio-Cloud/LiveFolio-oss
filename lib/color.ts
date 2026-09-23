/**
 * color — hex helpers for the creator-chosen page color.
 *
 * `isLightHex` was defined twice, byte-identically: on the public profile page
 * and on the workspace page, whose comment literally read "same helper as the
 * profile page". Both decide which ink (dark or light) stays readable on the
 * creator's background, so they must agree — a divergence would render one
 * surface unreadable. Body moved verbatim.
 */

/**
 * Rough relative-luminance check for a hex color — true when the color is
 * light enough that dark ink should be used. Anything that isn't a 6-digit
 * hex (including the empty string) is treated as light.
 */
export function isLightHex(hex: string): boolean {
  const h = hex.replace('#', '');
  if (h.length !== 6) return true;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}
