/**
 * use-local-storage — the registry of `localStorage` keys in use, plus the
 * SSR-safe read/write primitives.
 *
 * WHY THE KEYS ARE A REGISTRY AND NOT A RENAME
 * -------------------------------------------
 * Three naming schemes have accumulated in this repo and they are all still
 * live in users' browsers:
 *
 *   LiveFolio_*   — the original Python-style keys (model, providers, BYOK
 *                   keys, chat persona, design prefs, shell layout).
 *   livefolio-*   — kebab, added later (theme, cookie consent).
 *   livefolio_*   — snake, added later still (code draft, tour, handle skip).
 *
 * `LS_KEYS` below records the existing literals VERBATIM. Renaming one — even
 * to make the set internally consistent — silently resets that preference for
 * everyone who already has it stored, so the schemes stay as they are. Treat
 * the values as a persisted wire format, not as style.
 *
 * WHAT TO ADOPT WHEN
 * ------------------
 *   readLocalStorage / writeLocalStorage   the two entry points, for effects
 *                                          and one-shot reads (drafts,
 *                                          migration, restore-on-mount).
 *
 * Both are SSR-safe: on the server `read` returns `null` and `write` is a
 * no-op, so importing this from a component that renders on both sides can
 * never touch `window`.
 */

/**
 * Every static localStorage key in the codebase, copied literally.
 *
 * Grouped by the naming scheme each one uses — see the file header for why the
 * schemes differ and why they are not being unified.
 */
export const LS_KEYS = {
  // ── LiveFolio_* — AI provider + BYOK credentials ──────────────────────
  /** Which AI backend the chat is pointed at: 'managed' | 'local' | 'byok'. */
  apiProvider: 'LiveFolio_api_provider',
  /** The chosen model id, e.g. 'ollama/llama3'. */
  selectedModel: 'LiveFolio_selected_model',
  /** Base URL of the user's local Ollama server. */
  ollamaHost: 'LiveFolio_ollama_host',
  openaiApiKey: 'LiveFolio_openai_api_key',
  anthropicApiKey: 'LiveFolio_anthropic_api_key',
  geminiApiKey: 'LiveFolio_gemini_api_key',
  deepseekApiKey: 'LiveFolio_deepseek_api_key',
  /** The user's own LiveFolio API key, mirrored from the settings popup. */
  apiKey: 'LiveFolio_API_KEY',

  // ── LiveFolio_* — chat persona + creation-surface design prefs ────────
  personaName: 'LiveFolio_dash_persona_name',
  personaRole: 'LiveFolio_dash_persona_role',
  designTheme: 'LiveFolio_design_theme',
  designTypography: 'LiveFolio_design_typography',
  designPalette: 'LiveFolio_design_palette',
  designLibraries: 'LiveFolio_design_libraries',

  // ── LiveFolio_* — app shell layout ────────────────────────────────────
  sidebarCollapsed: 'LiveFolio_sidebar_collapsed',
  appSidebarView: 'LiveFolio_app_sidebar_view',

  // ── livefolio-* (kebab) ───────────────────────────────────────────────
  theme: 'livefolio-theme',
  cookieConsent: 'livefolio-cookie-consent',

  // ── livefolio_* (snake) ───────────────────────────────────────────────
  codeDraft: 'livefolio_code_draft',
  tourSeen: 'livefolio_tour_v2',
  handleSkip: 'livefolio_handle_skip_v1',
} as const;

/**
 * Keys that carry a variable part, kept as builders so the pattern (and the
 * scheme it belongs to) is written down once. Values are unchanged.
 */
export const LS_DYNAMIC_KEYS = {
  /** BYOK key for a provider id — equivalent to the four `_api_key` literals. */
  providerApiKey: (provider: string): string => `LiveFolio_${provider}_api_key`,
  /** Persisted per-folio editor store. */
  appStore: (folioId: string): string => `LiveFolio_app_${folioId}`,
  /** Persisted per-folio view mode. */
  appView: (folioId: string): string => `LiveFolio_app_view.${folioId}`,
} as const;

/** Read a key, or `null` when absent — never throws, never runs on the server. */
export function readLocalStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Storage blocked (private mode, disabled cookies) — behave as if unset.
    return null;
  }
}

/** Write a key — a no-op when storage is unavailable. Never throws. */
export function writeLocalStorage(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked or over quota — state stays in memory only.
  }
}

/*
 * REMOVED (refactor/dedupe-and-perf): `useLocalStorage` — a generic
 * `useState`-mirrored-to-storage hook, and the `LocalStorageCodec` /
 * `JSON_CODEC` / `STRING_CODEC` trio that existed only to parameterize its
 * `codec` argument.
 *
 * It shipped with zero adopters, and every caller it was written for still
 * reads/writes storage directly through `readLocalStorage` /
 * `writeLocalStorage` above. A generic hook is only worth its hydration and
 * SSR subtleties once something needs it; until then the two primitives are
 * the whole surface. Re-add a hook only alongside a real caller.
 *
 * The registries above are deliberately kept — `LS_KEYS` is imported by
 * `components/folio/CodeView.tsx`, and recording the three live naming
 * schemes is the file's other purpose.
 */
