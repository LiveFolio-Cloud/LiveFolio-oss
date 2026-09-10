import { AIProvider } from './provider.interface';
import { OllamaProvider } from './providers/ollama';
import { GeminiProvider } from './providers/gemini';
import { OpenAIProvider } from './providers/openai';
import { AnthropicProvider } from './providers/anthropic';
import { DeepSeekProvider } from './providers/deepseek';

export class AIFactory {
  /**
   * Retrieves the appropriate AIProvider instance based on the selected model string.
   * Supports standard models and local Ollama models (prefixed with 'ollama/').
   */
  static getProvider(modelString: string = 'gemini-2.5-flash'): AIProvider {
    const cleaned = modelString.trim().toLowerCase();

    // Auto-upgrade deprecated gemini-1.5-flash to gemini-2.5-flash
    const resolvedModel = cleaned === 'gemini-1.5-flash' ? 'gemini-2.5-flash' : modelString;
    const resolvedCleaned = resolvedModel.trim().toLowerCase();

    // 1. Local Ollama Provider Mapping
    if (resolvedCleaned.startsWith('ollama/')) {
      const ollamaModel = resolvedModel.substring(7); // Keep original casing for Ollama
      return new OllamaProvider(ollamaModel);
    }

    // 2. OpenAI Provider Mapping
    if (resolvedCleaned.startsWith('gpt-') || resolvedCleaned === 'o1-mini' || resolvedCleaned === 'o1-preview') {
      return new OpenAIProvider(resolvedModel); // Pass full casing (e.g., gpt-4o, gpt-4o-mini)
    }

    // 3. Anthropic Provider Mapping
    if (resolvedCleaned.startsWith('claude-')) {
      // Map shorter aliases to correct API model strings if needed
      const fullModelName = resolvedCleaned === 'claude-3-5-sonnet'
        ? 'claude-3-5-sonnet-20241022'
        : resolvedCleaned === 'claude-3-5-haiku'
        ? 'claude-3-5-haiku-20241022'
        : resolvedModel;
      return new AnthropicProvider(fullModelName);
    }

    // 4. DeepSeek Provider Mapping
    if (resolvedCleaned.startsWith('deepseek-')) {
      return new DeepSeekProvider(resolvedModel);
    }

    // 5. Gemini Provider Mapping (Default and Fallback)
    return new GeminiProvider(resolvedModel);
  }

  /**
   * Whether the given model string maps to a provider that supports native
   * function-calling / tool-use (Epic #96).
   *
   * DeepSeek, Gemini, and Claude all support tools.  Ollama and OpenAI are
   * not wired up for tool-use in this epic and return false.
   */
  static supportsTools(modelString: string): boolean {
    const cleaned = modelString.trim().toLowerCase();
    // Ollama — local models, no function-calling API
    if (cleaned.startsWith('ollama/')) return false;
    // OpenAI — not in scope for this epic (can be added later)
    if (cleaned.startsWith('gpt-') || cleaned === 'o1-mini' || cleaned === 'o1-preview') return false;
    // DeepSeek, Claude, and the default Gemini all support tools
    return true;
  }

  /**
   * Returns true when the model is the DeepSeek reasoner variant (which does
   * NOT support function calling despite the provider normally supporting it).
   */
  static isReasoner(modelString: string): boolean {
    return modelString.trim().toLowerCase() === 'deepseek-reasoner';
  }
}
