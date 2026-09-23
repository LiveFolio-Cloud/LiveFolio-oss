/* ------------------------------------------------------------------ *
 *  Font definitions — declared once, here, so `next/font/local` can    *
 *  self-host them, hash the family names and inject the preload tags.  *
 *                                                                      *
 *  The files come straight out of the @fontsource packages already in  *
 *  node_modules (no network at build time, no `next/font/google`).     *
 *  They replace the eight fontsource CSS imports that used to live in  *
 *  `app/layout.tsx`: those emitted 28 @font-face rules with no preload *
 *  and no subsetting, so text was only discovered after the stylesheet *
 *  parsed.                                                             *
 *                                                                      *
 *  LATIN SUBSET ONLY — 8 files, ~99 KB. The latin file covers Latin-1  *
 *  (every Western European accent) plus the typographic punctuation    *
 *  the UI uses. Latin-ext / Vietnamese / Cyrillic-ext now fall back to *
 *  the system stack; CJK and emoji already did. Preloading every       *
 *  subset of both families would mean 24 preload links / ~380 KB on    *
 *  every route, which is worse than the status quo.                    *
 *                                                                      *
 *  Space Grotesk is preloaded (it is the face that actually renders —  *
 *  headings plus every FONT_DISPLAY surface). Plus Jakarta Sans is     *
 *  declared with `preload: false`: it stays available through          *
 *  `--font-plus-jakarta` for anything that asks for it, but <body>     *
 *  carries Tailwind's `font-sans` utility whose --font-sans token is   *
 *  the Tailwind default, so the base rule in globals.css is already    *
 *  overridden and PJS is not on the critical path.                     *
 *                                                                      *
 *  NB: change the fallbacks here — `lib/fonts.ts` carries the stacks.  *
 * ------------------------------------------------------------------ */
import localFont from 'next/font/local';

export const spaceGrotesk = localFont({
  src: [
    {
      path: '../node_modules/@fontsource/space-grotesk/files/space-grotesk-latin-400-normal.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../node_modules/@fontsource/space-grotesk/files/space-grotesk-latin-500-normal.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: '../node_modules/@fontsource/space-grotesk/files/space-grotesk-latin-600-normal.woff2',
      weight: '600',
      style: 'normal',
    },
    {
      path: '../node_modules/@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff2',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--font-space-grotesk',
  display: 'swap',
});

export const plusJakarta = localFont({
  src: [
    {
      path: '../node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-400-normal.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-500-normal.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: '../node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-600-normal.woff2',
      weight: '600',
      style: 'normal',
    },
    {
      path: '../node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-700-normal.woff2',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--font-plus-jakarta',
  display: 'swap',
  preload: false,
});
