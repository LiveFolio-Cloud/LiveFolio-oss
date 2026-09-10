import { AIProvider, AIPromptContext, AIProviderResponse, ToolDefinition, ToolCall } from '../provider.interface';
import { GoogleGenAI, Type } from '@google/genai';

export class GeminiProvider implements AIProvider {
  private selectedModel: string;

  constructor(model: string = 'gemini-2.5-flash') {
    this.selectedModel = model;
  }

  async generateCompletion(
    userPrompt: string,
    context: AIPromptContext
  ): Promise<AIProviderResponse> {
    const apiKey = context.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('Gemini API key is not configured. Please define it in your settings or environment.');
    }

    // Initialize with standard object config for @google/genai
    const ai = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'LiveFolio-oss-client'
        }
      }
    });

    // --- PHASE 1: STRATEGIC PLANNING ---
    const plannerPrompt = `
${context.chatHistoryText || ''}${context.attachmentsText || ''}
Website Context:
Title: "${context.projectTitle}"
Description: "${context.projectDescription}"
Active File: "${context.pageContext}"
${context.designSystemText || ''}

Active Project Files Map:
${JSON.stringify(context.currentFiles, null, 2)}

User Request:
"${userPrompt}"

Please provide a 3-4 bullet point structural plan for addressing this.
Identify files to change and Tailwind classes to use. Do NOT output code yet.
`;

    try {
      // Use the .models.generateContent API which is stable in the installed SDK
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- @google/genai's typed .generateContent surface mismatches the installed SDK version; keep the cast
      const planResponse = await (ai as any).models.generateContent({
        model: this.selectedModel,
        contents: [{ role: 'user', parts: [{ text: plannerPrompt }] }],
        config: { systemInstruction: context.systemInstruction, temperature: 0.2 }
      });

      const planText = planResponse.text;

      // --- PHASE 2: CODE GENERATION ---
      const generatorPrompt = `
PLAN:
${planText}

Based on the plan, return ONLY the modified files in this JSON format:
{
  "updatedFiles": [{ "filename": "string", "code": "string" }],
  "explanation": "Markdown text",
  "interactiveCard": { ... optional ... }
}

IMPORTANT RULES FOR CODE GENERATION:
1. The "code" field for each updated file must contain the 100% complete and fully valid code of the file. Do not output placeholders, omissions, or truncated segments.
2. If you are making a surgical modification (e.g., target inspect mode), you MUST preserve all other existing codes, styles, scripts, layouts, and structures in the file exactly as they are in the "Active Project Files Map". Do NOT rewrite, change colors, reformat, or alter other unrelated elements under any circumstances! Keep them 100% identical byte-for-byte.
`;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- @google/genai's typed .generateContent surface mismatches the installed SDK version; keep the cast
      const genResult = await (ai as any).models.generateContent({
        model: this.selectedModel,
        contents: [
          { role: 'user', parts: [{ text: plannerPrompt }] },
          { role: 'model', parts: [{ text: planText }] },
          { role: 'user', parts: [{ text: generatorPrompt }] }
        ],
        config: {
          systemInstruction: context.systemInstruction + "\n\nIMPORTANT: You must return a 100% complete and valid JSON object. Do not truncate the code fields. If the file is too large, only return the changed sections if requested, otherwise prioritize the core structure.",
          temperature: 0.2,
          maxOutputTokens: 16384,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              updatedFiles: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    filename: { type: Type.STRING },
                    code: { type: Type.STRING }
                  },
                  required: ["filename", "code"]
                }
              },
              explanation: { type: Type.STRING },
              interactiveCard: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING },
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  actions: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        label: { type: Type.STRING },
                        value: { type: Type.STRING },
                        primary: { type: Type.BOOLEAN }
                      },
                      required: ["label", "value"]
                    }
                  }
                },
                required: ["title", "description", "actions"]
              }
            },
            required: ["updatedFiles", "explanation"]
          }
        }
      });

      const rawResultText = genResult.text;

      // --- PHASE 3: THE HEALER ---
      let cleanJson = rawResultText.trim();

      if (cleanJson.startsWith('```json')) {
        cleanJson = cleanJson.replace(/^```json/, '').replace(/```$/, '').trim();
      } else if (cleanJson.startsWith('```')) {
        cleanJson = cleanJson.replace(/^```/, '').replace(/```$/, '').trim();
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- parsed JSON response whose loose shape (updatedFiles/explanation/interactiveCard) is validated field-by-field below
      let parsedResult: any;

      try {
        parsedResult = JSON.parse(cleanJson);
      } catch (e) {
        console.warn("Gemini JSON parse failed, running state-machine healer...", e);

        let healed = "";
        let inString = false;
        let escapeNext = false;
        const stack: ('object' | 'array')[] = [];
        let started = false;

        for (let i = 0; i < cleanJson.length; i++) {
          const char = cleanJson[i];

          if (!started) {
            if (char === '{') {
              stack.push('object');
              started = true;
              healed += char;
            } else if (char === '[') {
              stack.push('array');
              started = true;
              healed += char;
            }
            continue;
          }

          if (escapeNext) {
            if (char === '\n') healed += '\\n';
            else if (char === '\r') healed += '\\r';
            else if (char === '\t') healed += '\\t';
            else healed += char;
            escapeNext = false;
            continue;
          }

          if (char === '\\') {
            healed += char;
            if (inString) {
              escapeNext = true;
            }
            continue;
          }

          if (char === '"') {
            inString = !inString;
            healed += char;
            continue;
          }

          if (inString) {
            if (char === '\n') healed += '\\n';
            else if (char === '\r') healed += '\\r';
            else if (char === '\t') healed += '\\t';
            else healed += char;
            continue;
          }

          healed += char;

          if (char === '{') stack.push('object');
          else if (char === '}') {
            if (stack[stack.length - 1] === 'object') stack.pop();
          } else if (char === '[') stack.push('array');
          else if (char === ']') {
            if (stack[stack.length - 1] === 'array') stack.pop();
          }

          if (stack.length === 0) {
            break;
          }
        }

        if (inString) {
          let backslashCount = 0;
          let idx = healed.length - 1;
          while (idx >= 0 && healed[idx] === '\\') {
            backslashCount++;
            idx--;
          }
          if (backslashCount % 2 !== 0) {
            healed = healed.slice(0, -1);
          }
          healed += '"';
        }

        let cleaned = healed.trim();
        let changed = true;
        while (changed) {
          changed = false;
          const before = cleaned;

          while (cleaned.endsWith(',') || cleaned.endsWith(':')) {
            cleaned = cleaned.slice(0, -1).trim();
          }

          if (cleaned.endsWith('"')) {
            let idx = cleaned.length - 2;
            while (idx >= 0) {
              if (cleaned[idx] === '"') {
                let bsCount = 0;
                let k = idx - 1;
                while (k >= 0 && cleaned[k] === '\\') {
                  bsCount++;
                  k--;
                }
                if (bsCount % 2 === 0) {
                  break;
                }
              }
              idx--;
            }

            if (idx > 0) {
              let prevIdx = idx - 1;
              while (prevIdx >= 0 && /\s/.test(cleaned[prevIdx])) {
                prevIdx--;
              }
              if (prevIdx >= 0 && (cleaned[prevIdx] === ',' || cleaned[prevIdx] === '{')) {
                if (cleaned[prevIdx] === '{') {
                  stack.pop();
                }
                cleaned = cleaned.slice(0, prevIdx).trim();
              }
            }
          }

          if (cleaned !== before) {
            changed = true;
          }
        }

        while (stack.length > 0) {
          const top = stack.pop();
          if (top === 'object') cleaned += '}';
          else if (top === 'array') cleaned += ']';
        }

        try {
          parsedResult = JSON.parse(cleaned);
          console.log("Gemini JSON successfully healed.");
        } catch {
          console.error("State-machine healing failed. Original error:", e);
          throw e;
        }
      }

      // Ensure interactiveCard actions is always an array to prevent UI crashes
      if (parsedResult.interactiveCard && !Array.isArray(parsedResult.interactiveCard.actions)) {
        parsedResult.interactiveCard.actions = [];
      }

      return {
        updatedFiles: parsedResult.updatedFiles || [],
        explanation: parsedResult.explanation || "Co-created components.",
        interactiveCard: parsedResult.interactiveCard
      };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK/parse errors are untyped; .message is read uniformly below
    } catch (err: any) {
      console.error("Gemini multi-stage exception:", err);
      throw new Error(`AI generation failed: ${err.message || err}`);
    }
  }

  /**
   * Tool-use completion (Epic #96).
   *
   * Uses @google/genai SDK function declarations with `mode: 'AUTO'` so Gemini
   * decides when to call a tool vs. respond with text.  When the response
   * contains function calls we return them as `toolCalls` with
   * `finishReason: 'tool_calls'`.
   */
  async generateCompletionWithTools(
    userPrompt: string,
    context: AIPromptContext,
    tools: ToolDefinition[],
    onToolCallStatus?: (status: string) => void
  ): Promise<AIProviderResponse> {
    const apiKey = context.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('Gemini API key is not configured.');
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'LiveFolio-oss-client' } },
    });

    // Convert our ToolDefinitions to Gemini function declarations
    const functionDeclarations = tools.map((t) => ({
      name: t.name,
      description: t.description,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Gemini function declarations want JSON Schema; our inputSchema is close but structurally different
      parameters: t.inputSchema as any,
    }));

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

    try {
      onToolCallStatus?.('Gemini is analyzing your request...');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- @google/genai's typed .generateContent surface mismatches the installed SDK version; keep the cast
      const result = await (ai as any).models.generateContent({
        model: this.selectedModel,
        contents: [{ role: 'user', parts: [{ text: promptText }] }],
        config: {
          systemInstruction: context.systemInstruction,
          temperature: 0.2,
          tools: [{ functionDeclarations }],
          toolConfig: {
            functionCallingConfig: { mode: 'AUTO' },
          },
        },
      });

      // Check for function calls in the response
      const functionCalls = result.functionCalls;
      if (functionCalls?.length) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- functionCalls derives from the untyped SDK result (any); annotation required under noImplicitAny
        const toolCalls: ToolCall[] = functionCalls.map((fc: any) => ({
          id: fc.id || crypto.randomUUID(),
          name: fc.name,
          arguments: JSON.stringify(fc.args),
        }));
        return {
          updatedFiles: [],
          explanation: result.text || '',
          toolCalls,
          finishReason: 'tool_calls',
        };
      }

      // No tool calls — standard text response
      const rawText: string = result.text || '';
      return {
        updatedFiles: [],
        explanation: rawText || 'I processed your request.',
      };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK/API errors are untyped; .message is read uniformly below
    } catch (err: any) {
      console.error('Gemini tool-use exception:', err);
      throw new Error(`Gemini tool-use generation failed: ${err.message || err}`);
    }
  }
}
