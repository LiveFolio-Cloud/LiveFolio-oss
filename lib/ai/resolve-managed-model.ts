/**
 * Managed model auto-selection (Cloud mode).
 *
 * In Cloud mode the platform owns the provider API keys, so users should not
 * have to pick a model. This resolver chooses one automatically based on which
 * managed provider keys are configured, following a fixed priority order:
 *
 *   1. DeepSeek  (default)        — DEEPSEEK_API_KEY
 *   2. Gemini    (1st fallback)   — GEMINI_API_KEY
 *   3. Claude    (last named)     — ANTHROPIC_API_KEY
 *   4. OpenAI    (final fallback) — OPENAI_API_KEY
 *
 * The concrete default model ids here MUST stay in sync with the managed list
 * built in `app/api/models/route.ts`.
 *
 * Returns `null` when no managed provider key is configured, so callers can
 * render a friendly "AI is not configured" state instead of erroring.
 */

export interface ResolvedManagedModel {
  model: string;
  provider: 'deepseek' | 'gemini' | 'anthropic' | 'openai';
}

/** Priority-ordered managed providers and their default model id. */
export const MANAGED_PROVIDER_PRIORITY: Array<{
  provider: ResolvedManagedModel['provider'];
  envKey: string;
  model: string;
}> = [
  { provider: 'deepseek', envKey: 'DEEPSEEK_API_KEY', model: 'deepseek-chat' },
  { provider: 'gemini', envKey: 'GEMINI_API_KEY', model: 'gemini-2.5-flash' },
  { provider: 'anthropic', envKey: 'ANTHROPIC_API_KEY', model: 'claude-3-5-sonnet-20241022' },
  { provider: 'openai', envKey: 'OPENAI_API_KEY', model: 'gpt-4o-mini' },
];

/**
 * Resolve the managed model to use based on configured environment keys.
 * Pure — depends only on `process.env`. Cloud-only concern; never used on the
 * OSS BYOK/local path.
 */
export function resolveManagedModel(): ResolvedManagedModel | null {
  for (const candidate of MANAGED_PROVIDER_PRIORITY) {
    const key = process.env[candidate.envKey];
    if (key && key.trim()) {
      return { model: candidate.model, provider: candidate.provider };
    }
  }
  return null;
}
