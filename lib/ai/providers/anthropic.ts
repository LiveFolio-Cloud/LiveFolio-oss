import { AIProvider, AIPromptContext, AIProviderResponse, ToolDefinition, ToolCall } from '../provider.interface';

export class AnthropicProvider implements AIProvider {
  private selectedModel: string;

  constructor(model: string = 'claude-3-5-sonnet-20241022') {
    this.selectedModel = model;
  }

  async generateCompletion(
    userPrompt: string,
    context: AIPromptContext
  ): Promise<AIProviderResponse> {
    const apiKey = context.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('Anthropic API key is not configured. Please define it in your settings or environment.');
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
- Do not write any introduction, commentary, or conversational text outside of the JSON object. Keep your explanation inside the JSON object's "explanation" field.
- Output 100% complete, working files. Never write placeholders like '// rest of code'.
`;

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.selectedModel,
          system: context.systemInstruction,
          messages: [
            { role: 'user', content: modelInputPrompt }
          ],
          max_tokens: 4000,
          temperature: 0.2,
        }),
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Anthropic API returned status ${res.status}: ${errBody}`);
      }

      const data = await res.json();
      const rawText = data.content?.[0]?.text;

      if (!rawText) {
        throw new Error("Anthropic returned an empty completion response.");
      }

      // Robust JSON extraction
      let cleanText = rawText.trim();
      if (cleanText.includes('```')) {
        const jsonMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonMatch && jsonMatch[1]) {
          cleanText = jsonMatch[1].trim();
        }
      }

      const parsed = JSON.parse(cleanText);
      return {
        updatedFiles: parsed.updatedFiles || [],
        explanation: parsed.explanation || "Co-created refined visual components via Anthropic Claude."
      };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fetch/API errors are untyped; .message is read uniformly below
    } catch (err: any) {
      console.error("Anthropic completion exception:", err);
      throw new Error(`Anthropic generation failed: ${err.message || err}`);
    }
  }

  /**
   * Tool-use completion (Epic #96).
   *
   * Uses Anthropic's native `tool_use` content blocks.  The API expects
   * `input_schema` (not `parameters`) on tool definitions.  Responses may
   * contain `tool_use` blocks in the `content` array alongside `text` blocks.
   */
  async generateCompletionWithTools(
    userPrompt: string,
    context: AIPromptContext,
    tools: ToolDefinition[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- param kept so the signature matches ToolEnabledAIProvider; Anthropic reports status via tool_use blocks, not this callback
    _onToolCallStatus?: (status: string) => void
  ): Promise<AIProviderResponse> {
    const apiKey = context.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('Anthropic API key is not configured.');
    }

    const promptText = `
${context.chatHistoryText}${context.attachmentsText}
Website Title: "${context.projectTitle}"
Website Purpose: "${context.projectDescription}"
Active Filename Focus: "${context.pageContext}"
${context.designSystemText || ''}

Active Project Files Map:
${JSON.stringify(context.currentFiles, null, 2)}

User Direct Action Request:
"${userPrompt}"

Use the available tools when appropriate.  If the user's request can be fulfilled by a tool, call it.
Otherwise respond with a natural explanation.
`;

    // Convert ToolDefinitions to Anthropic tool format (uses `input_schema`)
    const anthropicTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.selectedModel,
          system: context.systemInstruction,
          messages: [{ role: 'user', content: promptText }],
          tools: anthropicTools,
          max_tokens: 4000,
          temperature: 0.2,
        }),
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Anthropic API returned status ${res.status}: ${errBody}`);
      }

      const data = await res.json();

      // Check for tool_use blocks in the content array
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- data comes from res.json() (any); annotation required under noImplicitAny
      const toolUseBlocks = (data.content || []).filter((c: any) => c.type === 'tool_use');
      if (toolUseBlocks.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- toolUseBlocks derives from res.json() (any); annotation required under noImplicitAny
        const toolCalls: ToolCall[] = toolUseBlocks.map((tu: any) => ({
          id: tu.id,
          name: tu.name,
          arguments: JSON.stringify(tu.input),
        }));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- data comes from res.json() (any); annotation required under noImplicitAny
        const textBlock = (data.content || []).find((c: any) => c.type === 'text');
        return {
          updatedFiles: [],
          explanation: textBlock?.text || '',
          toolCalls,
          finishReason: 'tool_calls',
        };
      }

      // No tool calls — standard text response
      const rawText = data.content?.[0]?.text;
      if (!rawText) {
        throw new Error('Anthropic returned an empty completion response.');
      }

      return {
        updatedFiles: [],
        explanation: rawText,
      };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fetch/API errors are untyped; .message is read uniformly below
    } catch (err: any) {
      console.error('Anthropic tool-use exception:', err);
      throw new Error(`Anthropic tool-use generation failed: ${err.message || err}`);
    }
  }
}
