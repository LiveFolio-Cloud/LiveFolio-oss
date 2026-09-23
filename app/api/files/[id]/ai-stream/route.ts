import { NextResponse } from 'next/server';
import { readDB, runTransaction, HTMLVersion, ChatMessage } from '@/lib/db';
import { getAuthContext } from '@/lib/auth';
import { incrementUserUsage } from '@/ee/middleware/usageCapping';
import { GoogleGenAI, Type } from '@google/genai';
import { isCloud } from '@/lib/env';
import { resolveManagedModel } from '@/lib/ai/resolve-managed-model';
import {
  resolvePersona,
  buildCleanFiles,
  buildPinsContext,
  buildModeGuideline,
  buildAssetsCatalogContext,
  buildTargetedInstructionBlock,
  buildSystemInstruction,
  buildAttachmentsText,
  buildDesignSystemContextText,
  buildPlannerPrompt,
  buildGeneratorPrompt,
  GEMINI_JSON_SYSTEM_SUFFIX,
} from '@/lib/ai/prompt-builder';
import { assertAiQuotaGates } from '@/lib/ai/quota-gate';
import { nextVersionId as nextFolioVersionId, applyVersionRetention } from '@/lib/version-retention';
import { err } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  
  try {
    const { orgId, userId } = await getAuthContext();
    const body = await request.json();

    // Usage Capping & Prompts Quotas Gate
    const quotaGate = await assertAiQuotaGates({ userId, orgId });
    if (!quotaGate.ok) {
      return NextResponse.json(quotaGate.body, { status: quotaGate.status });
    }

    const db = await readDB();
    const project = db.find((p) => p.id === id);

    if (!project) {
      return err('Project not found', { status: 404 });
    }

    // Direct, dynamic persona configuration
    const { name: personaName, role: personaRole, instruction: personaInstruction } = resolvePersona(project);

    const {
      userPrompt,
      targetVersionId,
      reviewerCommentIds,
      simulatedAuthor,
      pageContext = 'Whole Project',
      attachedFiles = [],
      executeImmediately = false,
      designSystem,
      selectedModel,
      apiKey: clientApiKey,
      targetedElement
    } = body;

    // Cloud auto-selection: the client no longer forces a model. This streaming
    // route is Gemini-only, so resolve to a managed Gemini model when possible.
    let effectiveModel = selectedModel;
    if (!effectiveModel && isCloud) {
      const resolved = resolveManagedModel();
      effectiveModel = resolved?.provider === 'gemini'
        ? resolved.model
        : (process.env.GEMINI_API_KEY ? 'gemini-2.5-flash' : '');
    }

    if (!effectiveModel) {
      return err('No model selected. Please select a model to generate.', { status: 400 });
    }

    const resolvedModel = effectiveModel.toLowerCase().trim() === 'gemini-1.5-flash' ? 'gemini-2.5-flash' : effectiveModel;

    const apiKey = clientApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return err('Gemini API key is not configured. Please define it in your settings or environment.', { status: 400 });
    }

    let baseVersion = project.versions[project.versions.length - 1];
    if (targetVersionId) {
      const match = project.versions.find(v => v.versionId === targetVersionId);
      if (match) baseVersion = match;
    }

    const currentFiles = baseVersion.files;

    // Filter out visual binary assets (base64) content from LLM prompt context to keep tokens small
    const cleanCurrentFiles = buildCleanFiles(currentFiles);

    // Automatically package unresolved pins as reviewer context
    const pinsContext = buildPinsContext(project.comments);

    // Elegant, luxurious literary system identity
    const modeGuideline = buildModeGuideline(project.projectMode);

    // Compile Virtual Binary Assets catalog context
    const assetsCatalogContext = buildAssetsCatalogContext(currentFiles);

    const targetedInstructionBlock = buildTargetedInstructionBlock(targetedElement, userPrompt);

    const systemInstruction = buildSystemInstruction({
      personaName,
      personaRole,
      personaInstruction,
      projectTitle: project.title,
      pageContext,
      targetedInstructionBlock,
      modeGuideline,
      pinsContext,
      assetsCatalogContext,
    });

    // Package attached reference files (transient uploads + persistent project
    // references), exactly as `app/api/files/[id]/ai/route.ts` does with the
    // same helper. There the text rides on `AIPromptContext.attachmentsText` and
    // the Gemini provider splices it in as `${chatHistoryText}${attachmentsText}`
    // immediately ahead of "Website Context:" (lib/ai/providers/gemini.ts). This
    // route consumes no chat history, so attachments lead the prompt — same slot.
    const attachmentsText = buildAttachmentsText(attachedFiles, project.referenceFiles);

    const designSystemContextText = buildDesignSystemContextText(designSystem, project.designPreferences);

    const ai = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'LiveFolio-oss-client'
        }
      }
    });

    // Attachments are prepended, not passed through the helper: `buildPlannerPrompt`
    // starts at "\nWebsite Context:", so this puts them in the identical position
    // the non-streaming route sends them (`gemini.ts` splices them just before
    // "Website Context:") and keeps prompt-builder free of route-specific params.
    const plannerPrompt = attachmentsText + buildPlannerPrompt({
      projectTitle: project.title,
      projectDescription: project.description,
      activeFilename: body.activeFilename,
      pageContext,
      designSystemText: designSystemContextText,
      files: cleanCurrentFiles,
      userPrompt,
    });

    // Create stream and encoder
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();

    const response = new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      },
    });

    // Start background streaming processing
    (async () => {
      try {
        // Send initial planning status
        await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'status', message: 'Synthesizing design strategy...' })}\n\n`));

        // Step 1: Run Stage 1 Planner
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK typing does not cover this streaming call shape
        const planResponse = await (ai as any).models.generateContent({
          model: resolvedModel,
          contents: [{ role: 'user', parts: [{ text: plannerPrompt }] }],
          config: { systemInstruction: systemInstruction, temperature: 0.2 }
        });
        const planText = planResponse.text || '';

        await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'status', message: 'Generating code modifications...' })}\n\n`));

        // Step 2: Stream Stage 2 Generator with JSON Schema
        const generatorPrompt = buildGeneratorPrompt(planText);

        // NOTE: replaying `plannerPrompt` here re-sends the whole file
        // map (and the attachments) that Stage 1 already received, and the system
        // instruction goes out on both calls. That is deliberate, not an oversight.
        // These are two stateless calls: the generator must emit 100%-complete
        // file code, and rule 3 of `buildGeneratorPrompt` points it at the "Active
        // Project Files Map" — drop the replay and the generator has neither the
        // current files nor the user request, so it would regenerate the folio
        // from a 4-bullet plan. Stripping the map from this occurrence removes the
        // same information as deleting the turn. Assessed and rejected: a token
        // saving is not worth changing generated folio output.
        //
        // NOTE: the one avenue left open above — provider-side prefix
        // caching — is closed. Gemini matches cache prefixes from token 0 and the
        // system instruction is part of that prefix, but this call's instruction is
        // `systemInstruction + GEMINI_JSON_SYSTEM_SUFFIX` while Stage 1's is bare,
        // so the two share only the instruction itself and the duplicated map falls
        // entirely outside any cacheable prefix. Explicit caching is unavailable
        // outright: the API rejects `cachedContent` sent with a per-request
        // `systemInstruction`, and a CachedContent's instruction is immutable. The
        // duplication is structural; the only remaining lever is the destructive
        // one ruled out above.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK typing does not cover this streaming call shape
        const responseStream = await (ai as any).models.generateContentStream({
          model: resolvedModel,
          contents: [
            { role: 'user', parts: [{ text: plannerPrompt }] },
            { role: 'model', parts: [{ text: planText }] },
            { role: 'user', parts: [{ text: generatorPrompt }] }
          ],
          config: { 
            systemInstruction: systemInstruction + GEMINI_JSON_SYSTEM_SUFFIX,
            temperature: 0.2,
            maxOutputTokens: 16384,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                explanation: { type: Type.STRING },
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
              required: ["explanation", "updatedFiles"]
            }
          }
        });

        let accumulatedText = "";
        let sentExplanationLength = 0;
        let lastProgressSentTime = 0;

        for await (const chunk of responseStream) {
          const chunkText = chunk.text;
          if (!chunkText) continue;
          accumulatedText += chunkText;

          // Scanning explanation on the fly
          const matchIndex = accumulatedText.indexOf('"explanation": "');
          if (matchIndex !== -1) {
            const startIdx = matchIndex + 16;
            let endIdx = -1;
            let escape = false;
            for (let i = startIdx; i < accumulatedText.length; i++) {
              if (escape) {
                escape = false;
                continue;
              }
              if (accumulatedText[i] === '\\') {
                escape = true;
                continue;
              }
              if (accumulatedText[i] === '"') {
                endIdx = i;
                break;
              }
            }

            let currentExplanation = "";
            let explanationFinished = false;
            if (endIdx !== -1) {
              currentExplanation = accumulatedText.slice(startIdx, endIdx);
              explanationFinished = true;
            } else {
              currentExplanation = accumulatedText.slice(startIdx);
            }

            const cleanExplanation = currentExplanation
              .replace(/\\n/g, '\n')
              .replace(/\\"/g, '"')
              .replace(/\\t/g, '\t')
              .replace(/\\\\/g, '\\');

            if (cleanExplanation.length > sentExplanationLength) {
              const newTokens = cleanExplanation.slice(sentExplanationLength);
              sentExplanationLength = cleanExplanation.length;
              
              await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'chunk', text: newTokens })}\n\n`));
            }

            // Once the explanation string is completed, track active file drafting progress
            if (explanationFinished) {
              const now = Date.now();
              if (now - lastProgressSentTime > 400) {
                lastProgressSentTime = now;
                const remainingLength = accumulatedText.length - endIdx;
                if (remainingLength > 0) {
                  const kb = (remainingLength / 1024).toFixed(1);
                  await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'status', message: `drafting code components (${kb} KB generated)...` })}\n\n`));
                }
              }
            }
          }
        }

        // Now heal and parse the complete JSON response
        let cleanJson = accumulatedText.trim();
        if (cleanJson.startsWith('```json')) {
          cleanJson = cleanJson.replace(/^```json/, '').replace(/```$/, '').trim();
        } else if (cleanJson.startsWith('```')) {
          cleanJson = cleanJson.replace(/^```/, '').replace(/```$/, '').trim();
        }

        let parsedResult;
        try {
          parsedResult = JSON.parse(cleanJson);
        } catch {
          // Fallback state-machine healer (same as in gemini.ts)
          let healed = "";
          let inString = false;
          let escapeNext = false;
          const stack: ('object' | 'array')[] = [];
          let started = false;

          for (let i = 0; i < cleanJson.length; i++) {
            const char = cleanJson[i];
            if (!started) {
              if (char === '{') { stack.push('object'); started = true; healed += char; }
              else if (char === '[') { stack.push('array'); started = true; healed += char; }
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
              if (inString) escapeNext = true;
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
            else if (char === '}') { if (stack[stack.length - 1] === 'object') stack.pop(); }
            else if (char === '[') stack.push('array');
            else if (char === ']') { if (stack[stack.length - 1] === 'array') stack.pop(); }
            if (stack.length === 0) break;
          }

          if (inString) {
            let backslashCount = 0;
            let idx = healed.length - 1;
            while (idx >= 0 && healed[idx] === '\\') { backslashCount++; idx--; }
            if (backslashCount % 2 !== 0) healed = healed.slice(0, -1);
            healed += '"';
          }

          let cleaned = healed.trim();
          let changed = true;
          while (changed) {
            changed = false;
            const before = cleaned;
            while (cleaned.endsWith(',') || cleaned.endsWith(':')) cleaned = cleaned.slice(0, -1).trim();
            if (cleaned.endsWith('"')) {
              let idx = cleaned.length - 2;
              while (idx >= 0) {
                if (cleaned[idx] === '"') {
                  let bsCount = 0;
                  let k = idx - 1;
                  while (k >= 0 && cleaned[k] === '\\') { bsCount++; k--; }
                  if (bsCount % 2 === 0) break;
                }
                idx--;
              }
              if (idx > 0) {
                let prevIdx = idx - 1;
                while (prevIdx >= 0 && /\s/.test(cleaned[prevIdx])) prevIdx--;
                if (prevIdx >= 0 && (cleaned[prevIdx] === ',' || cleaned[prevIdx] === '{')) {
                  if (cleaned[prevIdx] === '{') stack.pop();
                  cleaned = cleaned.slice(0, prevIdx).trim();
                }
              }
            }
            if (cleaned !== before) changed = true;
          }

          while (stack.length > 0) {
            const top = stack.pop();
            if (top === 'object') cleaned += '}';
            else if (top === 'array') cleaned += ']';
          }

          parsedResult = JSON.parse(cleaned);
        }

        if (parsedResult.interactiveCard && !Array.isArray(parsedResult.interactiveCard.actions)) {
          parsedResult.interactiveCard.actions = [];
        }

        const filesArray = parsedResult.updatedFiles || [];
        const explanationText = parsedResult.explanation || "Co-created components.";

        // Increment count on successful completion
        if (userId) {
          await incrementUserUsage(userId);
        }

        // Database commit & save logic
        let finalProject = project;
        const isProposal = filesArray.length > 0;
        let proposedFilesMap: { [filename: string]: string } | undefined = undefined;

        if (isProposal) {
          proposedFilesMap = {};
          filesArray.forEach((f: { filename: string; code: string }) => {
            if (f.filename && f.code) {
              proposedFilesMap![f.filename] = f.code;
            }
          });
        }

        if (executeImmediately && isProposal) {
          const nextFilesMap = { ...currentFiles, ...proposedFilesMap };
          const userMsg: ChatMessage = {
            id: `u_${Date.now()}`,
            sender: 'user',
            text: userPrompt,
            createdAt: new Date().toISOString(),
            contextScope: pageContext
          };
          const assistantMsg: ChatMessage = {
            id: `a_${Date.now()}`,
            sender: 'assistant',
            text: explanationText,
            createdAt: new Date().toISOString(),
            contextScope: pageContext
          };

          const dbResult = await runTransaction(async (db) => {
            const pIndex = db.findIndex((p) => p.id === id);
            if (pIndex === -1) throw new Error('Project not found');
            const proj = db[pIndex];

            const newVersionId = nextFolioVersionId(proj.versions);

            const newAiVersion: HTMLVersion = {
              versionId: newVersionId,
              commitMessage: `${personaName} AI Auto-Commit: ${explanationText.slice(0, 50)}...`,
              createdAt: new Date().toISOString(),
              author: simulatedAuthor || `${personaName} AI`,
              files: nextFilesMap
            };

            const updatedVersions = [...proj.versions, newAiVersion];
            // Free plan: retain only the last 25 versions / 30 days
            const retainedVersions = await applyVersionRetention(updatedVersions, orgId);
            proj.versions = retainedVersions;

            if (reviewerCommentIds && Array.isArray(reviewerCommentIds)) {
              proj.comments = (proj.comments || []).map(c => {
                if (reviewerCommentIds.includes(c.id)) return { ...c, resolved: true };
                return c;
              });
            }

            proj.chats = [...(proj.chats || []), userMsg, assistantMsg];
            proj.updatedAt = new Date().toISOString();
            db[pIndex] = proj;
            return proj;
          });

          finalProject = dbResult;
        } else {
          // Planning or general conversation chat mode
          const userMsg: ChatMessage = {
            id: `u_${Date.now()}`,
            sender: 'user',
            text: userPrompt,
            createdAt: new Date().toISOString(),
            contextScope: pageContext
          };

          const assistantMsg: ChatMessage = {
            id: `a_${Date.now()}`,
            sender: 'assistant',
            text: explanationText,
            isProposal: isProposal,
            isApplied: executeImmediately && isProposal,
            proposedExplanation: isProposal ? explanationText : undefined,
            proposedFiles: isProposal ? filesArray.map((f: { filename: string; code: string }) => ({ filename: f.filename, code: f.code })) : undefined,
            interactiveCard: parsedResult.interactiveCard,
            createdAt: new Date().toISOString(),
            contextScope: pageContext
          };

          const dbResult = await runTransaction(async (db) => {
            const pIndex = db.findIndex((p) => p.id === id);
            if (pIndex === -1) throw new Error('Project not found');
            const proj = db[pIndex];
            proj.chats = [...(proj.chats || []), userMsg, assistantMsg];
            proj.updatedAt = new Date().toISOString();
            db[pIndex] = proj;
            return proj;
          });

          finalProject = dbResult;
        }

        // Stream completion with done event containing all parsed results
        await writer.write(encoder.encode(`data: ${JSON.stringify({
          type: 'done',
          success: true,
          explanation: explanationText,
          isProposal: isProposal,
          proposedFiles: proposedFilesMap,
          interactiveCard: parsedResult.interactiveCard,
          project: finalProject
        })}\n\n`));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: err may be any thrown value; err.message is read
      } catch (err: any) {
        console.error("Background stream exception:", err);
        try {
          await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: err.message || "Failed to process co-creation stream." })}\n\n`));
        } catch {}
      } finally {
        try {
          await writer.close();
        } catch {}
      }
    })();

    return response;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: error may be any thrown value; error.message is read
  } catch (error: any) {
    console.error("Stream initiation error:", error);
    return err(error.message || "Failed to initiate co-creation stream.", { status: 500 });
  }
}
