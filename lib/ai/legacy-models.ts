/**
 * Legacy model IDs — the stored-preference blacklist for OSS / BYOK sessions.
 *
 * Older cloud builds wrote these four IDs into `LiveFolio_selected_model` as
 * managed defaults. They mean nothing to an OSS visitor (there is no managed
 * provider, and no BYOK/local model answers to them), so every surface that
 * reads the stored preference drops them and lets the live model list choose
 * instead.
 *
 * ⚠️ THIS LIST DECIDES WHICH MODEL A USER ENDS UP WITH. It was duplicated
 * verbatim in `ChatHero.tsx` (the no-folio hero on `/app`) and in
 * `FolioChatPanel.tsx` (the Chat tab of a folio). The two copies happened to
 * agree — byte for byte, same four entries, same order — but nothing kept them
 * in step: a drift between them would have handed the same visitor a different
 * model depending on which surface they opened. One list, imported by both.
 * Do not re-inline it.
 *
 * Scope: this is ONLY the purge-on-read set. `FolioChatPanel`'s cloud default
 * (it substitutes `'gemini-1.5-flash'` when Cloud has nothing stored) is a
 * different concern and deliberately does NOT live here — that string is a
 * value written INTO the preference, not one purged out of it.
 */

/** Order preserved from the two original copies so the set stays auditable
 *  against git history. */
export const LEGACY_MODEL_IDS: readonly string[] = [
  'gemini-1.5-flash',
  'gpt-4o-mini',
  'gemini-3.5-flash',
  'ollama/llama3',
];

const LEGACY_MODEL_ID_SET: ReadonlySet<string> = new Set(LEGACY_MODEL_IDS);

/** True when a stored `LiveFolio_selected_model` value is one of the legacy
 *  cloud defaults that OSS must discard. */
export function isLegacyModelId(modelId: string): boolean {
  return LEGACY_MODEL_ID_SET.has(modelId);
}
