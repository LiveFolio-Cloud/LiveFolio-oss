import { AIProvider, AIPromptContext, AIProviderResponse } from '../provider.interface';

export class OpenAIProvider implements AIProvider {
  private selectedModel: string;

  constructor(model: string = 'gpt-4o') {
    this.selectedModel = model;
  }

  async generateCompletion(
    userPrompt: string,
    context: AIPromptContext
  ): Promise<AIProviderResponse> {
    const apiKey = context.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key is not configured. Please define it in your settings or environment.');
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

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.selectedModel,
          messages: [
            { role: 'system', content: context.systemInstruction },
            { role: 'user', content: modelInputPrompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2,
        }),
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`OpenAI API returned status ${res.status}: ${errBody}`);
      }

      const data = await res.json();
      const rawText = data.choices?.[0]?.message?.content;

      if (!rawText) {
        throw new Error("OpenAI returned an empty completion response.");
      }

      const parsed = JSON.parse(rawText.trim());
      return {
        updatedFiles: parsed.updatedFiles || [],
        explanation: parsed.explanation || "Co-created refined visual components via OpenAI."
      };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fetch/API errors are untyped; .message is read uniformly below
    } catch (err: any) {
      console.error("OpenAI completion exception:", err);
      throw new Error(`OpenAI generation failed: ${err.message || err}`);
    }
  }
}
