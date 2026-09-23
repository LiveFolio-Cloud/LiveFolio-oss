import { AIFactory } from './factory';
import {
  AIProviderResponse,
  AIPromptContext,
  ToolDefinition,
  ToolEnabledAIProvider,
} from './provider.interface';

/**
 * OSS stub for lib/ai/tool-fallback.ts.
 *
 * The Cloud original is the server-side managed-provider fallback chain. It
 * names the hosted model lineup and, more importantly, its *ranking* — which
 * provider is the cost-optimised primary and which are the fallbacks. That
 * ordering is a commercial decision (it is how the hosted chat is kept cheap)
 * and it must not be published. An OSS install has no managed providers at
 * all: it is bring-your-own-key, so there is no chain to walk.
 *
 * Export surface is kept identical because `app/api/files/[id]/ai/route.ts`
 * imports `generateWithToolFallback` at module top level (`:25`).
 *
 * CALL SITE IS MODE-GATED, so this stub is not on an OSS runtime path:
 * `route.ts:506` computes `useTools = isCloud && …`, and the Cloud call is the
 * only one. OSS takes the `provider.generateCompletion(...)` branch — one
 * provider, the caller's own key, exactly what this stub does.
 *
 * Rather than throw, the stub reproduces that same single-provider behaviour:
 * if it is ever reached it answers with the model it was given, instead of
 * failing the request. There is no fallback chain and no provider preference —
 * that is the missing commercial logic, and its absence is the point.
 */

/**
 * Always empty in OSS.
 *
 * The Cloud implementation returns the managed providers that may be tried
 * after the primary, filtered to those whose API key is configured. OSS has no
 * managed providers, so there is never a fallback to offer.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- mirrors the Cloud signature; OSS has no managed providers to filter
export function getToolFallbackModels(primaryModel: string): string[] {
  return [];
}

/**
 * Answer with the caller's own model — the OSS (BYOK) path.
 *
 * The Cloud implementation walks the managed-provider priority list until one
 * succeeds. This stub calls exactly the model it is handed and returns that
 * result; a failure surfaces as-is rather than being retried against a
 * provider the operator never configured.
 */
export async function generateWithToolFallback(
  userPrompt: string,
  context: AIPromptContext,
  tools: ToolDefinition[],
  primaryModel: string,
  onStatus?: (status: string) => void
): Promise<AIProviderResponse> {
  onStatus?.(`Trying ${primaryModel}…`);
  const provider = AIFactory.getProvider(primaryModel) as unknown as ToolEnabledAIProvider;
  return provider.generateCompletionWithTools(userPrompt, context, tools, onStatus);
}
