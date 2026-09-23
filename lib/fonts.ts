/* ------------------------------------------------------------------ */
/*  The brand font stacks — one definition, imported everywhere.       */
/*                                                                     */
/*  The families themselves are declared once as `next/font/local`     */
/*  instances in `app/fonts.ts` (root layout), which self-hosts the    */
/*  @fontsource woff2 files and injects the <link rel="preload"> tags. */
/*  next/font hashes the real family name, so every consumer must     */
/*  reference the CSS variable it publishes:                          */
/*                                                                     */
/*    --font-space-grotesk   (Space Grotesk 400/500/600/700)           */
/*    --font-plus-jakarta    (Plus Jakarta Sans 400/500/600/700)       */
/*                                                                     */
/*  The quoted family after the comma is a safety net for the case     */
/*  where the variable is undefined (a surface rendered outside the    */
/*  root layout). `var(--x)` alone would make the whole declaration    */
/*  invalid-at-computed-value-time and drop the element to the         */
/*  initial font (Times).                                             */
/*                                                                     */
/*  IMPORTANT: this module imports NOTHING on purpose. It is pulled    */
/*  into client bundles by ~26 surfaces that set an inline            */
/*  `fontFamily`; `components/og/kit.tsx` (which holds the same        */
/*  constants for the OG renderers) is ~450 lines and must never be    */
/*  dragged into those bundles.                                        */
/* ------------------------------------------------------------------ */

/** Display / brand stack — headlines, wordmarks, numerals. */
export const FONT_DISPLAY = 'var(--font-space-grotesk, "Space Grotesk"), sans-serif';

/** Body stack — long-form prose and UI copy. */
export const FONT_SANS =
  'var(--font-plus-jakarta, "Plus Jakarta Sans"), system-ui, -apple-system, sans-serif';

/**
 * OG-only stack. `components/og/kit.tsx` does NOT use CSS: it fetches the
 * brand face *server side* from Fontshare and embeds it in the
 * ImageResponse (`loadBrandFont`, cabinet-grotesk → Space Grotesk
 * fallback). Cabinet Grotesk therefore genuinely resolves for OG images —
 * it is not a dead reference here — so it must stay first or every
 * generated poster silently drops to Space Grotesk.
 */
export const FONT_DISPLAY_OG = '"Cabinet Grotesk", "Space Grotesk", sans-serif';
