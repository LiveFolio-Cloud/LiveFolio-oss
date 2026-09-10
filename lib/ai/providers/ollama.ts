import { AIProvider, AIPromptContext, AIProviderResponse } from '../provider.interface';

export class OllamaProvider implements AIProvider {
  private host: string;
  private selectedModel: string;

  constructor(model: string = 'llama3', host: string = 'http://localhost:11434') {
    this.selectedModel = model;
    this.host = host;
  }

  async generateCompletion(
    userPrompt: string,
    context: AIPromptContext
  ): Promise<AIProviderResponse> {
    const fullPrompt = `
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
- Do not write any text outside of the JSON object.
- Output 100% complete, working files. No placeholders.
`;

    try {
      const res = await fetch(`${this.host}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.selectedModel,
          prompt: fullPrompt,
          system: context.systemInstruction,
          stream: false,
          format: 'json',
          options: {
            temperature: 0.2,
          }
        }),
      });

      if (!res.ok) {
        throw new Error(`Ollama server returned status ${res.status}`);
      }

      const data = await res.json();
      const rawText = data.response;

      if (!rawText) {
        throw new Error("Local Ollama returned an empty completion response.");
      }

      // Try to parse JSON output
      try {
        const parsed = JSON.parse(rawText.trim());
        return {
          updatedFiles: parsed.updatedFiles || [],
          explanation: parsed.explanation || "Co-created design adjustments locally via Ollama."
        };
      } catch {
        console.error("Failed to parse Ollama JSON response. Raw text was:", rawText);
        // Fallback: wrap the text as an explanation with empty files
        return {
          updatedFiles: [],
          explanation: rawText
        };
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fetch errors are untyped; .message is read uniformly below
    } catch (err: any) {
      console.error("Ollama completion exception:", err);
      throw new Error(`Failed to contact local Ollama CLI server. Please check if Ollama is running on ${this.host}. Error: ${err.message}`);
    }
  }
}
