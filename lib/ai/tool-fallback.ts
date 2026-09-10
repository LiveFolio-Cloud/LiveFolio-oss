/**
 * Server-side provider fallback chain for tool-use (Epic #96).
 *
 * In Cloud mode the model is auto-resolved server-side — there is NO model
 * selector in the UI.  When the primary provider fails (API error, rate limit,
 * timeout, or reasoner model that doesn't support tools), this module walks
 * the managed-provider priority list to find the next working provider.
 *
 * The chain is:
 *   1. DeepSeek  (cost-optimized primary)
 *   2. Gemini    (first fallback)
 *   3. Claude    (final fallback)
 *
 * This is entirely transparent to the client — zero UI changes.
 */

import { AIFactory } from './factory';
import {
  AIProviderResponse,
  AIPromptContext,
  ToolDefinition,
  ToolEnabledAIProvider,
} from './provider.interface';
import {
  MANAGED_PROVIDER_PRIORITY,
  ResolvedManagedModel,
} from './resolve-managed-model';
import { estimateTotalTokens, getModelMaxInputTokens } from './context-compressor';

/** Providers that support native function-calling (ordered by priority). */
const TOOL_CAPABLE_PROVIDERS: Array<ResolvedManagedModel['provider']> = [
  'deepseek',
  'gemini',
  'anthropic',
];

/**
 * Build the ordered fallback model list starting *after* the given primary.
 * Only includes providers whose API key is configured in the environment.
 */
export function getToolFallbackModels(primaryModel: string): string[] {
  const cleaned = primaryModel.trim().toLowerCase();
  const fallbacks: string[] = [];

  let primaryFound = false;
  for (const candidate of MANAGED_PROVIDER_PRIORITY) {
    // Only tool-capable providers
    if (!TOOL_CAPABLE_PROVIDERS.includes(candidate.provider)) continue;

    if (primaryFound) {
      const key = process.env[candidate.envKey];
      if (key && key.trim()) {
        fallbacks.push(candidate.model);
      }
    }

    if (cleaned.startsWith(candidate.provider) || cleaned === candidate.model) {
      primaryFound = true;
    }
  }

  return fallbacks;
}

/**
 * Try the primary model first, then each fallback in order.  Returns the
 * FIRST successful `AIProviderResponse`, or throws the error from the last
 * fallback if all fail.
 *
 * @param userPrompt  — the user's chat message
 * @param context     — full AI prompt context (files, history, design system, …)
 * @param tools       — tool definitions available to the AI
 * @param primaryModel — model to try first (from resolveManagedModel() or BYOK)
 * @param onStatus    — optional streaming-status callback forwarded to providers
 */
export async function generateWithToolFallback(
  userPrompt: string,
  context: AIPromptContext,
  tools: ToolDefinition[],
  primaryModel: string,
  onStatus?: (status: string) => void
): Promise<AIProviderResponse> {
  const fallbacks = getToolFallbackModels(primaryModel);
  const modelsToTry = [primaryModel, ...fallbacks];

  // Estimate total input tokens once (same for all providers)
  const estimatedInputTokens = estimateTotalTokens({
    system: context.systemInstruction || '',
    chat: context.chatHistoryText || '',
    files: JSON.stringify(context.currentFiles || {}),
    attachments: context.attachmentsText || '',
    design: context.designSystemText || '',
    prompt: userPrompt,
  });

  const skipReasons: string[] = [];

  for (const model of modelsToTry) {
    // Skip reasoner variant (no function-calling support)
    if (AIFactory.isReasoner(model)) {
      const reason = `${model} skipped (reasoner does not support tools)`;
      console.log(`[tool-fallback] ${reason}`);
      skipReasons.push(reason);
      continue;
    }

    // Token-budget gate — skip models whose context window is too small
    const maxInput = getModelMaxInputTokens(model);
    if (estimatedInputTokens > maxInput) {
      const reason = `${model} skipped (prompt too large: ~${estimatedInputTokens.toLocaleString()} tokens > ${maxInput.toLocaleString()} max)`;
      console.warn(`[tool-fallback] ${reason}`);
      skipReasons.push(reason);
      continue;
    }

    try {
      onStatus?.(`Trying ${model}…`);
      const provider = AIFactory.getProvider(model) as unknown as ToolEnabledAIProvider;
      const result = await provider.generateCompletionWithTools(
        userPrompt,
        context,
        tools,
        onStatus
      );
      // If we got here, the call succeeded
      if (model !== primaryModel) {
        console.log(`[tool-fallback] ${primaryModel} failed, succeeded with ${model}`);
      }
      return result;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- provider errors are untyped; .message is read uniformly below
    } catch (err: any) {
      console.warn(`[tool-fallback] ${model} failed: ${err.message}`);
      skipReasons.push(`${model} failed: ${err.message}`);
      // Continue to next fallback
    }
  }

  // All providers exhausted — aggregate reasons
  const reasonList = skipReasons.length > 0
    ? `\n${skipReasons.map((r, i) => `  ${i + 1}. ${r}`).join('\n')}`
    : '';
  throw new Error(
    `All tool-capable providers exhausted.${reasonList}\n` +
    `Estimated prompt size: ~${estimatedInputTokens.toLocaleString()} tokens. ` +
    `Try narrowing your focus to a single page, starting a new session (Clear Chat), or reducing attached files.`
  );
}
