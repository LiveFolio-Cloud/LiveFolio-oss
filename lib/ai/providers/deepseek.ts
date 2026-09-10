import { AIProvider, AIPromptContext, AIProviderResponse, ToolDefinition, ToolCall } from '../provider.interface';

export class DeepSeekProvider implements AIProvider {
  private selectedModel: string;

  constructor(model: string = 'deepseek-chat') {
    this.selectedModel = model;
  }

  async generateCompletion(
    userPrompt: string,
    context: AIPromptContext
  ): Promise<AIProviderResponse> {
    const apiKey = context.apiKey || process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error('DeepSeek API key is not configured. Please define it in your settings or environment.');
    }

    const modelInputPrompt = `
${context.chatHistoryText}${context.attachmentsText}Website Title: "${context.projectTitle}"
Website Purpose: "${context.projectDescription}"
Active Filename Focus: "${context.pageContext}"
${context.designSystemText || ''}

Active Project Files Map:
${JSON.stringify(context.currentFiles, null, 2)}

User Direct Action Request:
"${userPrompt}"

IMPORTANT:
- Respond ONLY with a valid JSON object matching this schema:
{
  "updatedFiles": [
    { "filename": "string", "code": "string" }
  ],
  "explanation": "string"
}
- If layout changes are requested, return ALL project files in the JSON output, fully writing out the modified files and retaining files that didn't change.
- If this is a general query, brainstorming, or clarification step, return an empty array [] for "updatedFiles".
- Do not write any markdown wrappers (like \`\`\`json) outside of the JSON block if possible, or if you do, keep it clean.
- Output 100% complete, working files. Never write placeholders like '// rest of code'.
`;

    const isReasoner = this.selectedModel === 'deepseek-reasoner';

    // Build request payload. Note: deepseek-reasoner does not support temperature or response_format
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- body gains optional fields below and is JSON-serialized; DeepSeek accepts extras
    const body: any = {
      model: this.selectedModel,
      messages: [
        { role: 'system', content: context.systemInstruction },
        { role: 'user', content: modelInputPrompt }
      ]
    };

    if (!isReasoner) {
      body.temperature = 0.2;
      body.response_format = { type: 'json_object' };
    }

    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`DeepSeek API returned status ${res.status}: ${errBody}`);
      }

      const data = await res.json();
      const rawText = data.choices?.[0]?.message?.content;

      if (!rawText) {
        throw new Error("DeepSeek returned an empty completion response.");
      }

      // Robust JSON extraction for reasoner model
      let cleanText = rawText.trim();
      if (cleanText.includes('```')) {
        const jsonMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonMatch && jsonMatch[1]) {
          cleanText = jsonMatch[1].trim();
        }
      }

      // Try JSON parse — fall back to plain text on malformed/truncated output
      try {
        const parsed = JSON.parse(cleanText);
        return {
          updatedFiles: parsed.updatedFiles || [],
          explanation: parsed.explanation || "Co-created refined visual components via DeepSeek."
        };
      } catch {
        return {
          updatedFiles: [],
          explanation: rawText.trim() || "Co-created refined visual components via DeepSeek."
        };
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fetch/API errors are untyped; .message is read uniformly below
    } catch (err: any) {
      console.error("DeepSeek completion exception:", err);
      throw new Error(`DeepSeek generation failed: ${err.message || err}`);
    }
  }

  /**
   * Tool-use completion (Epic #96).
   *
   * DeepSeek's API is OpenAI-compatible — we send a `tools` array with
   * `type: "function"` items and `tool_choice: "auto"`.  The response may
   * contain `tool_calls` on the assistant message instead of (or alongside)
   * a text `content`.
   *
   * DeepSeek-reasoner does not support function calling — this method throws
   * for that model so the caller can fall back gracefully.
   */
  async generateCompletionWithTools(
    userPrompt: string,
    context: AIPromptContext,
    tools: ToolDefinition[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- param kept so the signature matches ToolEnabledAIProvider; DeepSeek reports status via tool_calls, not this callback
    _onToolCallStatus?: (status: string) => void
  ): Promise<AIProviderResponse> {
    const apiKey = context.apiKey || process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error('DeepSeek API key is not configured.');
    }

    const isReasoner = this.selectedModel === 'deepseek-reasoner';
    if (isReasoner) {
      throw new Error('DeepSeek reasoner does not support function calling. Fall back to another provider.');
    }

    const modelInputPrompt = `
${context.chatHistoryText}${context.attachmentsText}Website Title: "${context.projectTitle}"
Website Purpose: "${context.projectDescription}"
Active Filename Focus: "${context.pageContext}"
${context.designSystemText || ''}

Active Project Files Map:
${JSON.stringify(context.currentFiles, null, 2)}

User Direct Action Request:
"${userPrompt}"

When a tool is appropriate, call it with the correct parameters.  Otherwise respond with a JSON object:
{
  "updatedFiles": [],
  "explanation": "Your explanation here"
}
`;

    // Convert our ToolDefinitions to OpenAI-compatible function definitions
    const openaiTools = tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenAI-compatible tools require JSON Schema; our inputSchema is close but structurally different
        parameters: t.inputSchema as any,
      },
    }));

    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.selectedModel,
          messages: [
            { role: 'system', content: context.systemInstruction },
            { role: 'user', content: modelInputPrompt },
          ],
          tools: openaiTools,
          tool_choice: 'auto',
          temperature: 0.2,
        }),
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`DeepSeek API returned status ${res.status}: ${errBody}`);
      }

      const data = await res.json();
      const message = data.choices?.[0]?.message;

      if (!message) {
        throw new Error('DeepSeek returned an empty completion response.');
      }

      // Check for tool calls first (Epic #96)
      if (message.tool_calls?.length) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- message derives from res.json() (any); annotation required under noImplicitAny
        const toolCalls: ToolCall[] = message.tool_calls.map((tc: any) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        }));
        return {
          updatedFiles: [],
          explanation: message.content || '',
          toolCalls,
          finishReason: 'tool_calls',
        };
      }

      // Fallback: standard JSON response (or plain text if the AI chose to chat)
      const rawText: string = message.content || '';
      if (!rawText) {
        throw new Error('DeepSeek returned an empty completion response.');
      }

      let cleanText = rawText.trim();
      if (cleanText.includes('```')) {
        const jsonMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonMatch && jsonMatch[1]) {
          cleanText = jsonMatch[1].trim();
        }
      }

      // Try JSON parse — if it fails, treat as plain-text explanation
      try {
        const parsed = JSON.parse(cleanText);
        return {
          updatedFiles: parsed.updatedFiles || [],
          explanation: parsed.explanation || 'Co-created via DeepSeek.',
          interactiveCard: parsed.interactiveCard,
        };
      } catch {
        // Not JSON — return the raw text as an explanation with no file changes
        return {
          updatedFiles: [],
          explanation: rawText.trim() || 'Co-created via DeepSeek.',
        };
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fetch/API errors are untyped; .message is read uniformly below
    } catch (err: any) {
      console.error('DeepSeek tool-use exception:', err);
      throw new Error(`DeepSeek tool-use generation failed: ${err.message || err}`);
    }
  }
}
