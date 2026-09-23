/**
 * Design-preference defaults — the ONE place where the surfaces that seed a
 * folio's design state are reconciled.
 *
 * WHY THIS FILE EXISTS
 * -------------------
 * `DESIGN_DEFAULTS` had been copy-pasted into four places and had silently
 * diverged, so a new folio's starting design depended on which surface
 * created it (the as-shipped state before the unification):
 *
 *   surface                                   theme           typography                  palette
 *   ----------------------------------------  --------------  --------------------------  ------------
 *   /app hero            (ChatHero.tsx)        Editorial       Cabinet Grotesk & Inter     Cobalt Ocean
 *   New-folio modal      (create-folio-state)  Night Emerald   Cabinet Grotesk & Inter     Cobalt Ocean
 *   Editor mirrors       (folio-store.ts)      Warm Editorial  Lora & Inter                Honey Amber
 *   Editor tab           (FolioView.tsx)       Warm Editorial  Lora & Inter                Honey Amber
 *   MCP `create`         (app/api/mcp)         Warm Editorial  Lora & Inter                Honey Amber
 *
 * Only `libraries` agreed everywhere, and `projectMode` existed in just one.
 *
 * THEME: RESOLVED TO 'Editorial'
 * ------------------------------
 * The product owner ratified a single theme: EVERY surface now starts at
 * 'Editorial', the hero value. It won because it is the only candidate that is
 * both a real design-systems/ directory and currently shipping on a live
 * creation surface:
 *
 *   'Editorial'      -> design-systems/editorial/DESIGN.md      ✅ + theme map ❌
 *   'Warm Editorial' -> design-systems/warm-editorial/DESIGN.md ✅ + theme map ✅
 *   'Night Emerald'  -> no DESIGN.md ❌ + no theme map ❌
 *                        (`night-emerald` is not one of the 141 design-systems/
 *                         directories — 'Night Emerald' is a PALETTE name, so
 *                         the create-modal slot was a palette value pasted into
 *                         a theme slot. On the resolving chat paths that theme
 *                         reached the model as nothing at all.)
 *
 * 'Editorial' is now a key in the `themePrompt` map in
 * `lib/ai/prompt-builder.ts` and in the MCP `themeDesc` map, so the style hint
 * is present alongside the strict spec. (It previously had no entry, so the MCP
 * generated document fell back to "Custom custom-made brand styling layout.".)
 * The five other themes offered by the new-folio modal were given entries at
 * the same time, and the three `themePrompt` keys that had no matching
 * design-systems/ folder ('Premium SaaS Deck', 'Glassmorphic Quartz',
 * 'Retro Console') are now mapped to `premium` / `glassmorphic` / `retro`.
 *
 * TYPOGRAPHY: 'Cabinet Grotesk & Inter' RETIRED
 * ---------------------------------------------
 * The hero and create-modal defaults used to be 'Cabinet Grotesk & Inter'.
 * Cabinet Grotesk cannot render in this app at all: there is no font file in
 * `public/fonts/`, it is not an @fontsource package (only `space-grotesk` and
 * `plus-jakarta-sans` are installed), and its CDN (api.fontshare.com) is not in
 * the CSP — only Google Fonts is. Every folio created on those surfaces told
 * the model to use a font the browser would always drop.
 *
 * It was replaced by 'Space Grotesk & Inter' — Space Grotesk is what the brand
 * stack already fell back to, and it loads from Google Fonts. The old key is
 * retained in the prompt maps ONLY so folios that saved it still receive a
 * description, and that description now tells the model to use Space Grotesk.
 * Cabinet Grotesk remains correct for OG images (`FONT_DISPLAY_OG`), which are
 * rendered server-side where no CSP applies.
 *
 * ALL THREE FIELDS NOW AGREE
 * --------------------------
 * Every surface seeds the same values, so a folio's starting look no longer
 * depends on where it was created:
 *
 *   theme:      'Editorial'              (DESIGN.md + themePrompt entry)
 *   typography: 'Space Grotesk & Inter'  (loadable; see the note above)
 *   palette:    'Cobalt Ocean'           (resolves in both prompt maps)
 *
 * The hero/create-modal set won because it is what the live human creation
 * surface already used. The three named constants below are kept as
 * documentation of which surface each set originated from; their values are now
 * identical, so they could be collapsed into a single export whenever the
 * per-surface names stop being useful.
 *
 * BRAND FONT STACK
 * ----------------
 * The brand stack is declared once, in `lib/fonts.ts` (`FONT_DISPLAY`,
 * `FONT_SANS`, `FONT_DISPLAY_OG`). `lib/fonts.ts` imports nothing, so it is
 * safe to pull into any client bundle — do NOT import `components/og/kit.tsx`
 * instead, which is ~450 lines and would be dragged into those bundles.
 * The loader declarations live in `app/fonts.ts` (`next/font/local`).
 */

/** Every surface's design-defaults shape. */
export interface DesignDefaults {
  theme: string;
  typography: string;
  palette: string;
  libraries: string[];
  projectMode: 'deck' | 'document' | 'spreadsheet' | 'dashboard' | 'infography';
}

/**
 * The only fields every surface already agrees on. `theme` / `typography` /
 * `palette` are deliberately ABSENT so no surface can inherit a value that is
 * still under debate — each one below names them explicitly.
 *
 * `theme` is no longer under debate (it is 'Editorial' everywhere, see the
 * header); it stays explicit here so the three constants keep one shape and
 * `typography` / `palette` remain visibly per-surface.
 */
export const DESIGN_DEFAULTS: Pick<DesignDefaults, 'libraries' | 'projectMode'> = {
  libraries: ['Tailwind CSS Core', 'Lucide Icons'],
  projectMode: 'document',
};

/**
 * `app/(app)/_components/chat-view/ChatHero.tsx` — the `/app` no-folio hero,
 * the live human creation surface. Was the file-local `DESIGN_DEFAULTS`.
 *
 * NOTE: its theme, 'Editorial', must be a name from design-systems/ for the
 * DesignDrawer (`/api/design-systems`) to match it.
 */
export const HERO_DESIGN_DEFAULTS: DesignDefaults = {
  ...DESIGN_DEFAULTS,
  libraries: [...DESIGN_DEFAULTS.libraries],
  theme: 'Editorial',
  // Was 'Cabinet Grotesk & Inter'. Cabinet Grotesk has no font file anywhere in
  // this app and its CDN is not in the CSP, so that pairing could never render
  // — every folio created here named a font the browser would always drop.
  // 'Space Grotesk & Inter' is what the brand stack actually falls back to and
  // loads from Google Fonts. Keep in step with DesignDrawer's TYPOGRAPHY_PAIRINGS.
  typography: 'Space Grotesk & Inter',
  palette: 'Cobalt Ocean',
};

/**
 * `lib/create-folio-state.ts` via `components/dashboard/CreateFolioModal.tsx`
 * (the sidebar's "+ New folio"). Was that module's exported `DESIGN_DEFAULTS`.
 *
 * NOTE: the theme was 'Night Emerald' — a palette name, not a design-systems/
 * theme (see the header). 'Editorial' is now ratified, so this surface now
 * starts where the hero starts. `'Editorial'` is a member of that modal's
 * `THEME_OPTIONS` list, so the picker renders the value as a normal option
 * instead of prepending a foreign one.
 */
export const CREATE_MODAL_DESIGN_DEFAULTS: DesignDefaults = {
  ...DESIGN_DEFAULTS,
  libraries: [...DESIGN_DEFAULTS.libraries],
  theme: 'Editorial',
  // See HERO_DESIGN_DEFAULTS above — 'Cabinet Grotesk & Inter' was unloadable.
  typography: 'Space Grotesk & Inter',
  palette: 'Cobalt Ocean',
};

/**
 * `lib/app-shell/folio-store.ts` design mirrors + `FolioView.tsx` drawer
 * state — both forked verbatim from the legacy studio editor. These are the
 * fallbacks used when a folio has no saved `designPreferences`. The `theme`
 * matches the MCP server's own non-Tailwind fallback in `app/api/mcp/route.ts`
 * (`get_active_design_system`; keep the two in step).
 *
 * `theme` moved from 'Warm Editorial' to 'Editorial' to match the hero;
 * `typography` and `palette` moved here too. This was the legacy studio
 * editor's fork ('Lora & Inter' / 'Honey Amber') while the hero ran
 * 'Space Grotesk & Inter' / 'Cobalt Ocean', so a folio's starting look still
 * depended on which surface created it. All three fields now match the hero
 * across every surface, and all three resolve: 'Editorial' has a DESIGN.md and
 * a themePrompt entry, 'Space Grotesk & Inter' / 'Cobalt Ocean' both have hints.
 *
 * `tests/lib/app-shell/folio-store.test.ts` pins the theme by literal
 * ('Editorial') and the rest through `DESIGN_DEFAULTS` (the re-export in
 * `lib/app-shell/folio-store.ts`) — update both when this moves.
 */
export const EDITOR_DESIGN_DEFAULTS: DesignDefaults = {
  ...DESIGN_DEFAULTS,
  libraries: [...DESIGN_DEFAULTS.libraries],
  theme: 'Editorial',
  typography: 'Space Grotesk & Inter',
  palette: 'Cobalt Ocean',
};
