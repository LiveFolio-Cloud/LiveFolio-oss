import { NextResponse } from 'next/server';
import { readDB, runTransaction, HTMLVersion, HTMLComment, ChatMessage } from '@/lib/db';
import { AIFactory } from '@/lib/ai/factory';
import { AIPromptContext } from '@/lib/ai/provider.interface';
import { getAuthContext } from '@/lib/auth';
import {
  resolvePersona,
  buildCleanFiles,
  buildPinsContext,
  buildModeGuideline,
  buildAssetsCatalogContext,
  buildTargetedInstructionBlock,
  buildSystemInstruction,
  buildChatHistoryText,
  buildAttachmentsText,
  buildDesignSystemContextText,
} from '@/lib/ai/prompt-builder';
import { assertAiQuotaGates, assertWebToolPlan } from '@/lib/ai/quota-gate';
import { incrementUserUsage } from '@/ee/middleware/usageCapping';
import { isOSS, isCloud } from '@/lib/env';
import { resolveManagedModel } from '@/lib/ai/resolve-managed-model';
import { supabaseAdmin, transformFolioRecord, FolioRecord } from '@/lib/supabase';
import { projectMemoryCache } from '@/lib/project-cache';
import { EDITOR_TOOLS } from '@/lib/ai/tools/folio-tools';
import { generateWithToolFallback } from '@/lib/ai/tool-fallback';
import { compressChatHistory, pruneFileContext, estimateTokens } from '@/lib/ai/context-compressor';
import { nextVersionId as nextFolioVersionId, applyVersionRetention } from '@/lib/version-retention';
import { err } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { orgId, userId } = await getAuthContext();
    const body = await request.json();

    // ACTION 2: Clear Conversational Chat Thread (Short-circuit to bypass quota check and DB load/write bottleneck)
    if (body.action === 'clear-chat') {
      if (isOSS) {
        const result = await runTransaction(async (db) => {
          const pIndex = db.findIndex((p) => p.id === id);
          if (pIndex === -1) throw new Error('Project not found');
          const proj = db[pIndex];
          proj.chats = [];
          proj.updatedAt = new Date().toISOString();
          db[pIndex] = proj;
          return proj;
        });
        return NextResponse.json({ success: true, project: result });
      } else {
        if (!orgId) return err('Unauthorized', { status: 401 });
        const { data: updated, error: updateError } = await supabaseAdmin
          .from('folios')
          .update({ chats: [], updated_at: new Date().toISOString() })
          .eq('id', id)
          .eq('organization_id', orgId)
          .select('id, chats, updated_at')
          .single();

        if (updateError) {
          console.error("Clear chat update error:", updateError);
          return err(updateError.message, { status: 500 });
        }
        projectMemoryCache.invalidate(id);

        return NextResponse.json({
          success: true,
          project: {
            id: updated.id,
            chats: updated.chats,
            updatedAt: updated.updated_at
          }
        });
      }
    }

    // Usage Capping & Prompts Quotas Gate
    // Skipped for `commit-proposal`: applying an already-generated proposal must
    // not be blocked by the assistant's message/storage quota.
    const quotaGate = await assertAiQuotaGates({
      userId,
      orgId,
      enabled: body.action !== 'commit-proposal',
    });
    if (!quotaGate.ok) {
      return NextResponse.json(quotaGate.body, { status: quotaGate.status });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project spans OSS rows and cloud transforms; many dynamic fields are read and written downstream
    let project: any = null;

    if (isOSS) {
      const db = await readDB();
      project = db.find((p) => p.id === id);
    } else {
      if (!orgId) return err('Unauthorized', { status: 401 });
      const { data, error } = await supabaseAdmin
        .from('folios')
        .select('*')
        .eq('id', id)
        .eq('organization_id', orgId)
        .single();
      if (error || !data) return err('Project not found', { status: 404 });
      project = transformFolioRecord(data as FolioRecord);
    }

    if (!project) {
      return err('Project not found', { status: 404 });
    }

    // Direct, dynamic persona configuration
    const { name: personaName, role: personaRole, instruction: personaInstruction } = resolvePersona(project);

    // ACTION 1: Direct Apply/Commit Proposal
    if (body.action === 'commit-proposal') {
      const { proposedFiles, proposedExplanation, reviewerCommentIds, simulatedAuthor, messageId } = body;
      if (!proposedFiles || typeof proposedFiles !== 'object') {
        return err('Invalid proposed files map provided', { status: 400 });
      }

      if (isOSS) {
        const result = await runTransaction(async (db) => {
          const pIndex = db.findIndex((p) => p.id === id);
          if (pIndex === -1) throw new Error('Project not found');
          const proj = db[pIndex];

          const nextVersionId = nextFolioVersionId(proj.versions);

          const newVersion: HTMLVersion = {
            versionId: nextVersionId,
            commitMessage: `Apply AI Proposal: ${proposedExplanation ? proposedExplanation.slice(0, 50) : 'Commit Layout'}...`,
            createdAt: new Date().toISOString(),
            author: simulatedAuthor || `${personaName} AI`,
            files: proposedFiles
          };

          proj.versions.push(newVersion);

          // Mark corresponding chat proposal message as applied
          if (messageId) {
            proj.chats = (proj.chats || []).map(c => {
              if (c.id === messageId) {
                return { ...c, isApplied: true };
              }
              return c;
            });
          }

          // Auto-resolve reviewer comments if matching
          if (reviewerCommentIds && Array.isArray(reviewerCommentIds)) {
            proj.comments = (proj.comments || []).map(c => {
              if (reviewerCommentIds.includes(c.id)) {
                return { ...c, resolved: true };
              }
              return c;
            });
          }

          proj.updatedAt = new Date().toISOString();
          db[pIndex] = proj;
          return { nextVersionId, project: proj };
        });

        return NextResponse.json({
          success: true,
          newVersionId: result.nextVersionId,
          project: result.project
        });
      } else {
        // Cloud Mode
        const nextVersionId = nextFolioVersionId(project.versions);

        const newVersion: HTMLVersion = {
          versionId: nextVersionId,
          commitMessage: `Apply AI Proposal: ${proposedExplanation ? proposedExplanation.slice(0, 50) : 'Commit Layout'}...`,
          createdAt: new Date().toISOString(),
          author: simulatedAuthor || `${personaName} AI`,
          files: proposedFiles
        };

        const updatedVersions = [...project.versions, newVersion];
        // Free plan: retain only the last 25 versions / 30 days
        const retainedVersions = await applyVersionRetention(updatedVersions, orgId);
        let updatedChats = project.chats || [];
        if (messageId) {
          updatedChats = updatedChats.map((c: ChatMessage) => {
            if (c.id === messageId) return { ...c, isApplied: true };
            return c;
          });
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- update payload is built incrementally with client-supplied fields
        const updateData: any = {
          versions: retainedVersions,
          chats: updatedChats,
          updated_at: new Date().toISOString()
        };

        if (reviewerCommentIds && Array.isArray(reviewerCommentIds)) {
          updateData.comments = (project.comments || []).map((c: HTMLComment) => {
            if (reviewerCommentIds.includes(c.id)) return { ...c, resolved: true };
            return c;
          });
        }

        const { data: updated, error: updateError } = await supabaseAdmin
          .from('folios')
          .update(updateData)
          .eq('id', id)
          .eq('organization_id', orgId!)
          .select('id, versions, chats, comments, updated_at')
          .single();

        if (updateError) throw updateError;
        projectMemoryCache.invalidate(id);

        const updatedProject = {
          ...project,
          versions: updated.versions,
          chats: updated.chats,
          comments: updated.comments || project.comments,
          updatedAt: updated.updated_at
        };

        return NextResponse.json({
          success: true,
          newVersionId: nextVersionId,
          project: updatedProject
        });
      }
    }

    // ACTION 3: Tool-Use Response Loop
    // After tool calls are executed, the client sends results back so the AI
    // can generate a conversational summary.  This is handled inline — it does
    // NOT fall through to the main generation path (which would persist the
    // internal instruction as a user-visible chat message).
    if (body.action === 'tool-response') {
      const { toolResults } = body;
      if (!toolResults || !Array.isArray(toolResults)) {
        return err('Invalid tool results provided', { status: 400 });
      }

      // Resolve model and API key (needed here since we don't fall through)
      let followUpModel = body.selectedModel;
      if (!followUpModel && isCloud) {
        followUpModel = resolveManagedModel()?.model || '';
      }
      if (!followUpModel) {
        return err('No model available for follow-up', { status: 400 });
      }
      const followUpApiKey = body.apiKey; // passed by client

      // Persist tool call statuses in the project chats so they survive reload
      const updatedChats = (project.chats || []).map((msg: ChatMessage) => {
        if (!msg.toolCalls) return msg;
        const updatedToolCalls = msg.toolCalls.map((tc) => {
          const match = toolResults.find((tr) => tr.toolCallId === tc.id);
          if (!match) return tc;
          return {
            ...tc,
            status: match.result?.type === 'text' || match.result?.type === 'files' ? 'done' : 'error',
            result: match.result,
          };
        });
        return { ...msg, toolCalls: updatedToolCalls };
      });

      // Build the internal system instruction with tool results (NOT a user message)
      const toolResultsText = toolResults.map((tr) =>
        `Tool "${tr.name}" result: ${JSON.stringify(tr.result)}`
      ).join('\n');

      const systemFollowUp = `You are "${personaName}", a proactive, interactive, and high-fidelity "${personaRole}".
${personaInstruction}

TOOL EXECUTION RESULTS:
${toolResultsText}

The user's original request has been handled by the tools above. Write a brief, natural 2-3 sentence summary of what was done. Do NOT include technical details like "the tool executed" — speak like a design partner: "I searched for X and found Y. I also updated the hero section with the new color."`;

      // Call the provider inline — never falls through to main path
      try {
        const followUpContext: AIPromptContext = {
          projectTitle: project.title,
          projectDescription: project.description || '',
          pageContext: 'Whole Project',
          currentFiles: {},
          systemInstruction: systemFollowUp,
          chatHistoryText: '',
          attachmentsText: '',
          apiKey: followUpApiKey,
        };

        const followUpProvider = AIFactory.getProvider(followUpModel);
        const followUpResult = await followUpProvider.generateCompletion(
          'Summarize the tool results for the user.',
          followUpContext
        );

        const summaryText = followUpResult.explanation || 'Done!';

        // Save the assistant summary as a new chat message
        const summaryMsg: ChatMessage = {
          id: `a_${Date.now()}`,
          sender: 'assistant',
          text: summaryText,
          createdAt: new Date().toISOString(),
        };

        if (isOSS) {
          await runTransaction(async (db) => {
            const pIndex = db.findIndex((p) => p.id === id);
            if (pIndex === -1) throw new Error('Project not found');
            db[pIndex].chats = [...updatedChats, summaryMsg];
            db[pIndex].updatedAt = new Date().toISOString();
          });
        } else {
          await supabaseAdmin
            .from('folios')
            .update({
              chats: [...updatedChats, summaryMsg],
              updated_at: new Date().toISOString(),
            })
            .eq('id', id)
            .eq('organization_id', orgId!);
          projectMemoryCache.invalidate(id);
        }

        return NextResponse.json({
          success: true,
          explanation: summaryText,
          project: { ...project, chats: [...updatedChats, summaryMsg] },
        });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: followUpErr may be any thrown value; only logged
      } catch (followUpErr: any) {
        console.error('Tool follow-up generation failed:', followUpErr);
        // Still persist the tool statuses even if summary generation fails
        if (isOSS) {
          await runTransaction(async (db) => {
            const pIndex = db.findIndex((p) => p.id === id);
            if (pIndex === -1) throw new Error('Project not found');
            db[pIndex].chats = updatedChats;
            db[pIndex].updatedAt = new Date().toISOString();
          });
        } else {
          await supabaseAdmin
            .from('folios')
            .update({ chats: updatedChats, updated_at: new Date().toISOString() })
            .eq('id', id)
            .eq('organization_id', orgId!);
          projectMemoryCache.invalidate(id);
        }

        return NextResponse.json({
          success: true,
          explanation: 'Tools executed.',
          project: { ...project, chats: updatedChats },
        });
      }
    }

    // ACTION 4: Conversational AI Generation or Planning Mode
    const {
      userPrompt,
      targetVersionId,
      reviewerCommentIds,
      simulatedAuthor,
      chatHistory = [],
      pageContext = 'Whole Project',
      attachedFiles = [],
      executeImmediately = false,
      designSystem,
      selectedModel,
      apiKey: clientApiKey,
      ollamaHost,
      targetedElement
    } = body;

    // Cloud auto-selection: if the client didn't specify a model, resolve one
    // server-side from the configured managed providers (DeepSeek → Gemini →
    // Claude → OpenAI). OSS still requires an explicit model selection.
    let effectiveModel = selectedModel;
    if (!effectiveModel && isCloud) {
      effectiveModel = resolveManagedModel()?.model || '';
    }

    if (!effectiveModel) {
      return err('No model selected. Please select a model to generate.', { status: 400 });
    }

    let baseVersion = project.versions[project.versions.length - 1];
    if (targetVersionId) {
      const match = project.versions.find((v: HTMLVersion) => v.versionId === targetVersionId);
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

    // Package chat history
    const formattedHistory = buildChatHistoryText(chatHistory);

    // Package attached reference files (transient and persistent project files)
    const formattedAttachments = buildAttachmentsText(attachedFiles, project.referenceFiles);

    // ── Context compression: keep prompts within model context windows ──
    // Chat history grows unbounded; folio files can be huge.  Without
    // compression, long sessions or large folios blow past every provider's
    // context limit (see the 6M-token DeepSeek error).
    const activeFile = body.activeFilename || 'index.html';
    const MAX_CHAT_TOKENS = 300_000;  // 300K for chat history
    const MAX_FILE_TOKENS = 300_000;  // 300K for file contents

    const compressedChat = compressChatHistory(chatHistory, MAX_CHAT_TOKENS);
    if (compressedChat.truncated) {
      console.log(
        `[context-compressor] Chat history truncated: ${compressedChat.truncatedCount} older messages summarized ` +
        `(${estimateTokens(formattedHistory).toLocaleString()} → ~${estimateTokens(compressedChat.text).toLocaleString()} tokens)`
      );
    }
    const effectiveHistory = compressedChat.text;

    const prunedFiles = pruneFileContext(cleanCurrentFiles, activeFile, MAX_FILE_TOKENS);
    if (prunedFiles.truncated.length > 0) {
      console.log(
        `[context-compressor] Files pruned: ${prunedFiles.truncated.join(', ')} ` +
        `(${Object.keys(cleanCurrentFiles).length} files → kept ${Object.keys(prunedFiles.files).length} full, stubbed ${prunedFiles.truncated.length})`
      );
    }
    const effectiveFiles = prunedFiles.files;

    const designSystemContextText = buildDesignSystemContextText(designSystem, project.designPreferences);

    // Build unified context object for AIPromptContext
    const contextObj: AIPromptContext = {
      projectTitle: project.title,
      projectDescription: project.description || '',
      pageContext: pageContext === 'Current Screen' ? `Current Screen: ${body.activeFilename || 'active file'}` : 'Whole Project',
      currentFiles: effectiveFiles,
      systemInstruction: systemInstruction,
      chatHistoryText: effectiveHistory,
      attachmentsText: formattedAttachments,
      designSystemText: designSystemContextText || undefined,
      apiKey: clientApiKey
    };

    // Instantiate AI Provider dynamically from factory
    const provider = AIFactory.getProvider(effectiveModel);

    // If local Ollama and custom host specified.
    // SSRF guard: only loopback hosts are allowed (Ollama runs on the same
    // machine) — a client-supplied internal IP must not be reachable.
    if (effectiveModel.startsWith('ollama/') && ollamaHost) {
      try {
        const parsed = new URL(ollamaHost);
        const hostname = parsed.hostname.toLowerCase();
        const isLoopback =
          hostname === 'localhost' ||
          hostname === '127.0.0.1' ||
          hostname === '[::1]' ||
          hostname === '::1';
        if (!isLoopback || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
          return err('Ollama host must be a localhost URL.', { status: 400 });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AIProvider has no host member; Ollama override is set dynamically
        (provider as any).host = parsed.toString().replace(/\/$/, '');
      } catch {
        return err('Invalid Ollama host URL.', { status: 400 });
      }
    }

    // Trigger AI Co-Authoring completion — with tools when available
    let parsedResult;
    const useTools = isCloud && AIFactory.supportsTools(effectiveModel) && !AIFactory.isReasoner(effectiveModel);

    if (useTools) {
      // Use the tool-enabled path with server-side fallback chain
      parsedResult = await generateWithToolFallback(
        userPrompt,
        contextObj,
        EDITOR_TOOLS,
        effectiveModel,
        undefined
      );
    } else {
      parsedResult = await provider.generateCompletion(userPrompt, contextObj);
    }

    // ── Server-side tool execution loop ───────────────────────────
    // Execute all tool calls server-side in a single request cycle.
    // Web tools (search/fetch) run first, then results feed back to the AI
    // so it can use them to fulfill the user's request (e.g. update HTML).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool results have heterogeneous shapes across providers
    const toolCallResults: any[] = [];
    if (isCloud && parsedResult.toolCalls?.length && parsedResult.finishReason === 'tool_calls') {
      const {
        executeWebSearch, executeWebFetch,
        executeEditElement, executeAddPage, executeApplyDesignSystem,
      } = await import('@/lib/ai/tools/tool-executor');

      console.log(`[Epic#96] AI requested ${parsedResult.toolCalls.length} tool(s):`,
        parsedResult.toolCalls.map((tc) => tc.name).join(', '));

      const toolCtx = {
        project,
        currentFiles,
        personaName,
      };

      for (const tc of parsedResult.toolCalls) {
        try {
          const args = JSON.parse(tc.arguments);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool executors return heterogeneous untyped results
          let result: any;

          console.log(`[Epic#96] Executing tool: ${tc.name}`, JSON.stringify(args).slice(0, 200));

          // Plan gating: web_search / web_fetch require Team or higher — the
          // same shared gate as /api/chat/tools/execute and the Slack/Discord
          // tool loop. Throwing here is refused-and-reported: the catch below
          // records it as a tool error for the AI, the tool never runs.
          const webGate = await assertWebToolPlan({ toolName: tc.name, orgId });
          if (!webGate.ok) throw new Error(webGate.body.message);

          switch (tc.name) {
            case 'web_search':
              result = await executeWebSearch(toolCtx, args);
              break;
            case 'web_fetch':
              result = await executeWebFetch(toolCtx, args);
              break;
            case 'edit_element':
              result = executeEditElement(toolCtx, args);
              break;
            case 'add_page':
              result = executeAddPage(toolCtx, args);
              break;
            case 'apply_design_system':
              // Update project design prefs in-memory
              result = executeApplyDesignSystem(toolCtx, args);
              if (args.theme) project.designPreferences = { ...project.designPreferences, theme: args.theme };
              if (args.typography) project.designPreferences = { ...project.designPreferences, typography: args.typography };
              if (args.palette) project.designPreferences = { ...project.designPreferences, palette: args.palette };
              if (args.libraries) project.designPreferences = { ...project.designPreferences, libraries: args.libraries };
              break;
            case 'delete_page':
              // Requires client-side confirmation — skip server execution
              console.log(`[Epic#96] Skipping delete_page (needs client confirmation)`);
              continue;
            case 'export_folio':
              // PDF export stubbed — skip
              console.log(`[Epic#96] Skipping export_folio (stubbed)`);
              continue;
            default:
              console.log(`[Epic#96] Unknown tool: ${tc.name} — skipping`);
              continue;
          }

          console.log(`[Epic#96] Tool ${tc.name} result:`, JSON.stringify(result).slice(0, 300));
          toolCallResults.push({ toolCallId: tc.id, name: tc.name, result });

          // If tool produced file changes, apply them immediately
          if (result.files) {
            Object.assign(currentFiles, result.files);
            console.log(`[Epic#96] Applied file changes from ${tc.name}`);
          }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: err may be any thrown value; err.message is read
        } catch (err: any) {
          console.error(`[Epic#96] Tool ${tc.name} failed:`, err.message);
          toolCallResults.push({ toolCallId: tc.id, name: tc.name, result: { type: 'text', message: `Error: ${err.message}` } });
        }
      }

      // If any tools executed (web or mutation), feed results back to AI
      if (toolCallResults.length > 0) {
        const resultsText = toolCallResults.map((tr) =>
          `Tool "${tr.name}" result: ${JSON.stringify(tr.result)}`
        ).join('\n');

        // Build the follow-up context — include any file changes from tools
        const followUpInstruction = `${contextObj.systemInstruction}

TOOL EXECUTION RESULTS (use this data, don't summarize the process):
${resultsText}
${Object.keys(currentFiles).some(k => !(baseVersion?.files || {})[k]) ? `\nNOTE: New files were added: ${Object.keys(currentFiles).filter(k => !(baseVersion?.files || {})[k]).join(', ')}` : ''}

CRITICAL: The user's original request was: "${userPrompt}"
Use the tool results to FULFILL the request. If the user asked to update/create HTML, return the COMPLETE files in your JSON response. If the user asked for information, answer naturally based on the research data. Never describe the tool execution process.`;

        const followUpContext: AIPromptContext = {
          ...contextObj,
          currentFiles: currentFiles, // updated with tool changes
          systemInstruction: followUpInstruction,
          chatHistoryText: '',
          attachmentsText: '',
        };

        console.log(`[Epic#96] Feeding ${toolCallResults.length} tool result(s) back to AI for follow-up`);

        const summaryResult = await provider.generateCompletion(
          userPrompt,
          followUpContext
        );

        console.log(`[Epic#96] AI follow-up: updatedFiles=${summaryResult.updatedFiles?.length || 0}, explanation="${(summaryResult.explanation || '').slice(0, 100)}"`);

        // Merge: prefer AI's updatedFiles, but if tools changed files and AI
        // didn't return them, commit the tool changes directly
        const toolChangedFiles: { filename: string; code: string }[] = [];
        for (const tr of toolCallResults) {
          if (tr.result?.files) {
            for (const [filename, code] of Object.entries(tr.result.files as Record<string, string>)) {
              if (!(baseVersion?.files || {})[filename] || (baseVersion?.files || {})[filename] !== code) {
                toolChangedFiles.push({ filename, code });
              }
            }
          }
        }

        const finalFiles = summaryResult.updatedFiles?.length
          ? summaryResult.updatedFiles
          : toolChangedFiles.length
            ? toolChangedFiles
            : parsedResult.updatedFiles;

        console.log(`[Epic#96] Final files to commit: ${finalFiles.length}, explanation: "${(summaryResult.explanation || parsedResult.explanation || '').slice(0, 100)}"`);

        parsedResult = {
          ...parsedResult,
          explanation: summaryResult.explanation || parsedResult.explanation,
          updatedFiles: finalFiles,
          toolCalls: parsedResult.toolCalls.map((tc) => {
            const match = toolCallResults.find((r) => r.toolCallId === tc.id);
            return match ? { ...tc, result: match.result } : tc;
          }),
          finishReason: 'stop',
        };
      }
    }

    // Increment count on successful completion
    if (userId) {
      await incrementUserUsage(userId);
    }

    const filesArray = parsedResult.updatedFiles || [];
    const explanationText = parsedResult.explanation || "Co-created refined visual components.";

    // If immediate execution is chosen and AI returned changes
    if (executeImmediately && filesArray.length > 0) {
      const nextFilesMap: { [filename: string]: string } = { ...currentFiles };
      filesArray.forEach((f) => {
        if (f.filename && f.code) {
          nextFilesMap[f.filename] = f.code;
        }
      });

      // Record in chat log as well
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

      if (isOSS) {
        const result = await runTransaction(async (db) => {
          const pIndex = db.findIndex((p) => p.id === id);
          if (pIndex === -1) throw new Error('Project not found');
          const proj = db[pIndex];

          const nextVersionId = nextFolioVersionId(proj.versions);

          const newAiVersion: HTMLVersion = {
            versionId: nextVersionId,
            commitMessage: `${personaName} AI Auto-Commit: ${explanationText.slice(0, 50)}...`,
            createdAt: new Date().toISOString(),
            author: simulatedAuthor || `${personaName} AI`,
            files: nextFilesMap
          };

          proj.versions.push(newAiVersion);

          if (reviewerCommentIds && Array.isArray(reviewerCommentIds)) {
            proj.comments = (proj.comments || []).map(c => {
              if (reviewerCommentIds.includes(c.id)) {
                return { ...c, resolved: true };
              }
              return c;
            });
          }

          proj.chats = [...(proj.chats || []), userMsg, assistantMsg];
          proj.updatedAt = new Date().toISOString();
          db[pIndex] = proj;
          return { nextVersionId, project: proj };
        });

        return NextResponse.json({
          success: true,
          newVersionId: result.nextVersionId,
          explanation: explanationText,
          project: result.project
        });
      } else {
        // Cloud Mode
        const nextVersionId = nextFolioVersionId(project.versions);

        const newAiVersion: HTMLVersion = {
          versionId: nextVersionId,
          commitMessage: `${personaName} AI Auto-Commit: ${explanationText.slice(0, 50)}...`,
          createdAt: new Date().toISOString(),
          author: simulatedAuthor || `${personaName} AI`,
          files: nextFilesMap
        };

        const updatedVersions = [...project.versions, newAiVersion];
        // Free plan: retain only the last 25 versions / 30 days
        const retainedVersions = await applyVersionRetention(updatedVersions, orgId);
        const updatedChats = [...(project.chats || []), userMsg, assistantMsg];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- update payload is built incrementally with client-supplied fields
        const updateData: any = {
          versions: retainedVersions,
          chats: updatedChats,
          updated_at: new Date().toISOString()
        };

        if (reviewerCommentIds && Array.isArray(reviewerCommentIds)) {
          updateData.comments = (project.comments || []).map((c: HTMLComment) => {
            if (reviewerCommentIds.includes(c.id)) return { ...c, resolved: true };
            return c;
          });
        }

        const { data: updated, error: updateError } = await supabaseAdmin
          .from('folios')
          .update(updateData)
          .eq('id', id)
          .eq('organization_id', orgId!)
          .select('id, versions, chats, comments, updated_at')
          .single();

        if (updateError) throw updateError;
        projectMemoryCache.invalidate(id);

        const updatedProject = {
          ...project,
          versions: updated.versions,
          chats: updated.chats,
          comments: updated.comments || project.comments,
          updatedAt: updated.updated_at
        };

        return NextResponse.json({
          success: true,
          newVersionId: nextVersionId,
          explanation: explanationText,
          project: updatedProject
        });
      }
    } else {
      // Planning or general conversation chat mode (Persist chat thread)
      const userMsg: ChatMessage = {
        id: `u_${Date.now()}`,
        sender: 'user',
        text: userPrompt,
        createdAt: new Date().toISOString(),
        contextScope: pageContext
      };

      const hasProposals = filesArray.length > 0;
      let proposedFilesMap: { [filename: string]: string } | undefined = undefined;

      if (hasProposals) {
        proposedFilesMap = { ...currentFiles };
        filesArray.forEach((f) => {
          if (f.filename && f.code) {
            proposedFilesMap![f.filename] = f.code;
          }
        });
      }

      const assistantMsg: ChatMessage = {
        id: `a_${Date.now()}`,
        sender: 'assistant',
        text: explanationText,
        isProposal: hasProposals,
        isApplied: executeImmediately && hasProposals,
        proposedExplanation: hasProposals ? explanationText : undefined,
        proposedFiles: hasProposals ? filesArray.map((f) => ({ filename: f.filename, code: f.code })) : undefined,
        interactiveCard: parsedResult.interactiveCard,
        createdAt: new Date().toISOString(),
        contextScope: pageContext,
        // Include tool calls with server-side results
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tc carries a provider-specific `result` field not present on the typed ToolCall
        toolCalls: parsedResult.toolCalls?.map((tc: any) => {
          const existingResult = tc.result;
          return {
            id: tc.id,
            name: tc.name,
            arguments: typeof tc.arguments === 'string' ? JSON.parse(tc.arguments) : tc.arguments,
            status: existingResult ? ('done' as const) : ('pending' as const),
            result: existingResult || undefined,
          };
        }),
      };

      if (isOSS) {
        const result = await runTransaction(async (db) => {
          const pIndex = db.findIndex((p) => p.id === id);
          if (pIndex === -1) throw new Error('Project not found');
          const proj = db[pIndex];
          proj.chats = [...(proj.chats || []), userMsg, assistantMsg];
          proj.updatedAt = new Date().toISOString();
          db[pIndex] = proj;
          return proj;
        });

        return NextResponse.json({
          success: true,
          explanation: explanationText,
          isProposal: hasProposals,
          proposedFiles: proposedFilesMap,
          finishReason: parsedResult.finishReason,
          toolCalls: parsedResult.toolCalls,
          project: result
        });
      } else {
        // Cloud Mode - Optimize write by only updating chats and updatedAt columns
        const { data: updated, error: updateError } = await supabaseAdmin
          .from('folios')
          .update({
            chats: [...(project.chats || []), userMsg, assistantMsg],
            updated_at: new Date().toISOString()
          })
          .eq('id', id)
          .eq('organization_id', orgId!)
          .select('id, chats, updated_at')
          .single();

        if (updateError) throw updateError;
        projectMemoryCache.invalidate(id);

        const updatedProject = {
          ...project,
          chats: updated.chats,
          updatedAt: updated.updated_at
        };

        return NextResponse.json({
          success: true,
          explanation: explanationText,
          isProposal: hasProposals,
          proposedFiles: proposedFilesMap,
          finishReason: parsedResult.finishReason,
          toolCalls: parsedResult.toolCalls,
          project: updatedProject
        });
      }
    }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: error may be any thrown value; error.message is read
  } catch (error: any) {
    console.error("AI co-creation route exception:", error);
    return err(error.message || "Failed to trigger co-creation pipeline.", { status: 500 });
  }
}

