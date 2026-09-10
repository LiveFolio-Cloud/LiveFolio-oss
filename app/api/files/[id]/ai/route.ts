import { NextResponse } from 'next/server';
import { readDB, runTransaction, HTMLVersion, HTMLComment, ChatMessage } from '@/lib/db';
import { AIFactory } from '@/lib/ai/factory';
import { AIPromptContext } from '@/lib/ai/provider.interface';
import { getAuthContext } from '@/lib/auth';
import fs from 'fs';
import path from 'path';
import { assertMessageQuota, incrementUserUsage, assertStorageQuota } from '@/ee/middleware/usageCapping';
import { isOSS, isCloud } from '@/lib/env';
import { resolveManagedModel } from '@/lib/ai/resolve-managed-model';
import { supabaseAdmin, transformFolioRecord, FolioRecord } from '@/lib/supabase';
import { projectMemoryCache } from '@/lib/project-cache';
import { STUDIO_TOOLS } from '@/lib/ai/tools/folio-tools';
import { generateWithToolFallback } from '@/lib/ai/tool-fallback';
import { compressChatHistory, pruneFileContext, estimateTokens } from '@/lib/ai/context-compressor';
import { nextVersionId as nextFolioVersionId, applyVersionRetention } from '@/lib/version-retention';

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
        if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const { data: updated, error: updateError } = await supabaseAdmin
          .from('folios')
          .update({ chats: [], updated_at: new Date().toISOString() })
          .eq('id', id)
          .eq('organization_id', orgId)
          .select('id, chats, updated_at')
          .single();

        if (updateError) {
          console.error("Clear chat update error:", updateError);
          return NextResponse.json({ error: updateError.message }, { status: 500 });
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
    if (userId && orgId && body.action !== 'commit-proposal') {
      const { allowed, quota } = await assertMessageQuota(userId, orgId);
      if (!allowed) {
        return NextResponse.json(
          {
            error: 'QUOTA_EXCEEDED',
            message: `Your workspace has reached its monthly AI assistant limit of ${quota.monthly_message_limit} messages. Usage resets on your billing cycle — upgrade your plan for a higher limit.`,
            quota
          },
          { status: 402 }
        );
      }
    }

    // Storage Quota Gate — block AI generation if user is over storage limit
    if (userId && orgId && body.action !== 'commit-proposal') {
      const storageCheck = await assertStorageQuota(userId, 0, orgId);
      if (!storageCheck.allowed) {
        const limitGB = (storageCheck.quota.storage_limit_bytes / (1024 * 1024 * 1024)).toFixed(1);
        return NextResponse.json(
          {
            error: 'STORAGE_EXCEEDED',
            message: `You have reached your storage limit of ${limitGB}GB. Please upgrade your plan or free up space by deleting old folios.`,
            quota: storageCheck.quota,
          },
          { status: 402 }
        );
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- project spans OSS rows and cloud transforms; many dynamic fields are read and written downstream
    let project: any = null;

    if (isOSS) {
      const db = await readDB();
      project = db.find((p) => p.id === id);
    } else {
      if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      const { data, error } = await supabaseAdmin
        .from('folios')
        .select('*')
        .eq('id', id)
        .eq('organization_id', orgId)
        .single();
      if (error || !data) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      project = transformFolioRecord(data as FolioRecord);
    }

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Direct, dynamic persona configuration
    const cleanProjTitle = (project.title || "Project")
      .replace(/(?:landing\s+page|website|app|concept|page|ui|mobile|portal|system|folio|presentation)/gi, '')
      .trim();
    const defaultPersonaName = cleanProjTitle ? `${cleanProjTitle} Co-pilot` : "LiveFolio Co-pilot";
    const defaultPersonaRole = cleanProjTitle ? `${cleanProjTitle} Design Partner` : "Design & Logic Partner";

    const personaName = project.aiPersona?.name || defaultPersonaName;
    const personaRole = project.aiPersona?.role || defaultPersonaRole;
    const personaInstruction = project.aiPersona?.systemInstruction || "You are a friendly, down-to-earth presentation and layout assistant. Your user is not technical and is used to working with PowerPoint, PDFs, Excel, and Word. Keep your responses extremely simple, warm, and brief (maximum 2-3 sentences). Never use technical jargon, HTML/CSS terms, or complex code details. Explain changes in simple business/office terms (like 'updated the slide design', 'rearranged the grid', or 'polished the table style').";

    // ACTION 1: Direct Apply/Commit Proposal
    if (body.action === 'commit-proposal') {
      const { proposedFiles, proposedExplanation, reviewerCommentIds, simulatedAuthor, messageId } = body;
      if (!proposedFiles || typeof proposedFiles !== 'object') {
        return NextResponse.json({ error: 'Invalid proposed files map provided' }, { status: 400 });
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

    // ACTION 3: Tool-Use Response Loop (Epic #96)
    // After tool calls are executed, the client sends results back so the AI
    // can generate a conversational summary.  This is handled inline — it does
    // NOT fall through to the main generation path (which would persist the
    // internal instruction as a user-visible chat message).
    if (body.action === 'tool-response') {
      const { toolResults } = body;
      if (!toolResults || !Array.isArray(toolResults)) {
        return NextResponse.json({ error: 'Invalid tool results provided' }, { status: 400 });
      }

      // Resolve model and API key (needed here since we don't fall through)
      let followUpModel = body.selectedModel;
      if (!followUpModel && isCloud) {
        followUpModel = resolveManagedModel()?.model || '';
      }
      if (!followUpModel) {
        return NextResponse.json({ error: 'No model available for follow-up' }, { status: 400 });
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
      return NextResponse.json({ error: 'No model selected. Please select a model to generate.' }, { status: 400 });
    }

    let baseVersion = project.versions[project.versions.length - 1];
    if (targetVersionId) {
      const match = project.versions.find((v: HTMLVersion) => v.versionId === targetVersionId);
      if (match) baseVersion = match;
    }

    const currentFiles = baseVersion.files;

    // Filter out visual binary assets (base64) content from LLM prompt context to keep tokens small
    const cleanCurrentFiles = { ...currentFiles };
    Object.keys(cleanCurrentFiles).forEach(key => {
      if (key.startsWith('assets/')) {
        cleanCurrentFiles[key] = `[Binary branding asset file or base64 image data - path: "${key}". References this file path in your HTML tags as relative source.]`;
      }
    });

    // Automatically package unresolved pins as reviewer context
    const unresolvedPins = (project.comments || []).filter((c: HTMLComment) => !c.resolved);
    let pinsContext = '';
    if (unresolvedPins.length > 0) {
      pinsContext = '\nUNRESOLVED REVIEWER PINS (Mandatory feedback to address):\n' +
        unresolvedPins.map((p: HTMLComment, i: number) => `${i+1}. [File: ${p.filename}]: "${p.text}" (Element: ${p.selector})`).join('\n') + '\n';
    }

    // Elegant, luxurious literary system identity
    const projectMode = project.projectMode || 'document';
    let modeGuideline = '';
    if (projectMode === 'deck') {
      modeGuideline = `
IMPORTANT INTENT MODE - LANDING / SLIDE DECK (pptx replacement):
- You are constructing a slide deck presentation.
- Use horizontal slide elements where only one slide is active at any time (e.g. using CSS class '.slide-node.active' to display and others hidden).
- Provide elegant slide controls (Next/Prev buttons) and keyboard arrow event listeners in a <script> block to transition slides smoothly.
- Maintain a clear slide tracker indicator (e.g., 'Slide X of Y').
- Keep layout visually punchy, high-impact, with immersive dark or clean brand backdrops, bold card panels, and large readable typography.
`;
    } else if (projectMode === 'document') {
      modeGuideline = `
IMPORTANT INTENT MODE - VERTICAL DOCUMENT / REPORT (pdf & docx replacement):
- You are constructing an editorial layout for reading and deep-dive documentation.
- Use standard vertical scrolling with comfortable reading margins (e.g. max-w-4xl mx-auto px-6).
- Create a sticky side or top outline navigation block that links to section anchors (#summary, #findings, etc.) to replace flat PDFs.
- Ensure gorgeous heading hierarchy and classic long-form readability (generous line-heights, soft neutral borders).
- Add collapsible accessory containers (e.g., footnotes, expandable methodology panels) to isolate dense reference text.
`;
    } else if (projectMode === 'spreadsheet') {
      modeGuideline = `
IMPORTANT INTENT MODE - SPREADSHEET / SHEET GRID (xlsx replacement):
- You are constructing a structured metric calculator or active input table.
- Use a high-quality tabular layout with responsive column alignments, clear rows, and elegant hover outlines.
- Include interactive cell inputs (<input type="number">) or slider ranges (<input type="range">) for key variables.
- Write a synchronous <script> recalculation loop that updates sum calculations and profitability cards live as the user edits numbers.
- Provide key metrics summaries at the top (e.g., Grand Totals, Calculated Net Profit margins, Operating Expenses) in beautiful styled grids.
`;
    } else if (projectMode === 'dashboard') {
      modeGuideline = `
IMPORTANT INTENT MODE - ANALYTICAL METRICS DASHBOARD (PowerBI replacement):
- You are constructing an executive analytics overview dashboard.
- Focus on grid-based layouts with key performance cards and high-visibility status badges (e.g. '+12.4% vs last period').
- Inject rich visualizers (e.g., interactive SVG sparklines or a responsive Chart.js line/bar chart block using script CDN tags).
- Group information cleanly into functional visual modules with interactive filtering tabs or buttons.
`;
    }

    // Compile Virtual Binary Assets catalog context
    const assetKeys = Object.keys(currentFiles).filter(k => k.startsWith('assets/'));
    let assetsCatalogContext = '';
    if (assetKeys.length > 0) {
      assetsCatalogContext = '\nAVAILABLE BRANDING & GRAPHIC ASSETS (Local version-controlled files):\n' +
        'You can render the following custom uploaded assets directly in your HTML using relative img tags:\n' +
        assetKeys.map(k => `- ${k}`).join('\n') + '\n' +
        'When the user asks for images, logos, or backgrounds, proactively reference these exact relative paths in your img src tags. Do not invent or use external unverified image URLs if local assets are available!\n';
    }

    let targetedInstructionBlock = '';
    if (targetedElement && targetedElement.selector && targetedElement.outerHTML) {
      targetedInstructionBlock = `
SURGICAL TARGETED EDIT MODE (POINT & POLISH):
The user has visually selected a specific element on the screen they want to edit.
- Targeted Element Selector: "${targetedElement.selector}"
- Targeted Element HTML Tag: "${targetedElement.tagName}"
- Targeted Element Code to Modify:
\`\`\`html
${targetedElement.outerHTML}
\`\`\`

CRITICAL INSTRUCTIONS FOR TARGETED EDITING:
1. ONLY modify/style/re-design the targeted element specified above, or elements nested directly inside it. Do NOT make unintended changes to other sections of the file, structural frameworks, or navigation blocks.
2. STRICT STYLING & COLOR PRESERVATION: 
   - Under no circumstances should you change the color scheme, theme, background colors, text colors, or borders of the selected element, parent section, or the page, UNLESS the user explicitly asked to change colors or styling in their prompt.
   - If the user's prompt is about changing copy/text, adding an icon, adjusting text alignment, or adding a specific simple feature, preserve all existing colors, styles, class names, font-sizes, and design structures EXACTLY as they are in the "Targeted Element Code to Modify". Do NOT re-color, re-theme, or apply random accents.
   - Ensure the outer parent design system, brand colors, and aesthetic remain perfectly harmonious with the rest of the file.
3. Maintain the surrounding layout, outer parent tags, styles, and scripts of the file exactly intact to prevent regressions.
4. Align all changes inside this target element with the user's specific prompt: "${userPrompt}".
`;
    }

    const systemInstruction = `You are "${personaName}", a proactive, interactive, and high-fidelity "${personaRole}".
${personaInstruction}

Today's date is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}. The current time is ${new Date().toLocaleTimeString('en-US', { timeZoneName: 'short' })}. Use this for any time-sensitive questions.

Your workspace holds an interactive HTML document titled "${project.title}".
We are targeting context scope: "${pageContext}".

${targetedInstructionBlock}

${pageContext === 'Current Screen' ? `
CRITICAL SCOPE RULE:
- You are currently focused ONLY on the active screen.
- ONLY return modifications for the file requested in the prompt.
- DO NOT modify other files in the project map.
` : `
CRITICAL SCOPE RULE:
- You have access to the WHOLE PROJECT.
- You can suggest changes across multiple files if it helps achieve the user's vision.
`}

${modeGuideline}
${pinsContext}

CORE CONVERSATIONAL PHILOSOPHY:
- BE PROACTIVE: Don't just wait for commands. If you notice the design is lacking context (e.g., no typography choice, no brand colors), ASK the user and suggest options.
- BE INTERACTIVE: Use the \`interactiveCard\` field to present the user with structured choices (e.g., "Would you like to pick a theme? [Warm Editorial] [SaaS Dark] [Cyberpunk]").
- BE NATURAL: Talk like a helpful design partner at a high-end agency. Keep it warm, simple, and grounded in business value, not code details.
- ASK QUESTIONS: If a request is vague, ask for clarification or propose a specific plan before executing.

INSPIRATION: 
Inspired by 'a2ui.org' and 'open-design', prioritize a natural, interactive dialogue. Every response should move the project forward, either by building or by guiding the user to the next logical step.

RESPONSE MODES:
1. GUIDANCE & PLANNING: If you need context or want to propose a direction, return EMPTY \`updatedFiles\`. Use \`interactiveCard\` to make choices easy.
2. EXECUTION: If you have a clear mandate, generate the 100% complete, fully working HTML files.

CRITICAL CODE RULES:
- Use standard Lucide Icons via CDN (https://cdn.jsdelivr.net/npm/lucide/dist/umd/lucide.min.js).
- Initialize icons with 'lucide.createIcons();' at the end of the body.
- Use Tailwind CSS via CDN.
- Never output truncated code.

IMAGES & MEDIA — when the user asks for images, photos, or visual content:
- Use Unsplash Source for free high-quality photos: https://images.unsplash.com/photo-{ID}?w=800&q=80
  Example: <img src="https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=800&q=80" alt="mountain lake" />
- Use the web_search tool to find relevant Unsplash photo IDs or image URLs for the topic.
- For icons, use Lucide CDN (already available). For custom SVGs, inline them directly.
- For placeholder images, use https://placehold.co/600x400/EEE/999?text=Description
- Do NOT invent fake Unsplash IDs — search for real ones or use placehold.co as fallback.
- Do NOT use images from random websites that might hotlink-protect or expire.
${assetsCatalogContext}
`;

    // Package chat history
    let formattedHistory = '';
    if (Array.isArray(chatHistory) && chatHistory.length > 0) {
      formattedHistory = 'Preceding Conversation History:\n' + chatHistory.map((c) =>
        `[${c.sender === 'user' ? 'User' : 'Assistant'}]: ${c.text}`
      ).join('\n') + '\n\n';
    }

    // Package attached reference files (transient and persistent project files)
    let formattedAttachments = '';
    if (Array.isArray(attachedFiles) && attachedFiles.length > 0) {
      formattedAttachments = 'Attached Reference Files:\n' + attachedFiles.map((f) =>
        `File name: ${f.filename}\nContent:\n${f.content}\n---`
      ).join('\n') + '\n\n';
    }

    // Automatically append persistent project reference files if not already attached
    const transientNames = new Set((attachedFiles || []).map((f: { filename: string }) => f.filename));
    const permanentRefs = project.referenceFiles || [];
    const missingRefs = permanentRefs.filter((r: { filename: string; content?: string }) => !transientNames.has(r.filename));
    if (missingRefs.length > 0) {
      if (!formattedAttachments) {
        formattedAttachments = 'Attached Reference Files:\n';
      }
      formattedAttachments += missingRefs.map((f: { filename: string; content?: string }) =>
        `File name: ${f.filename} (Persistent Project Context Reference)\nContent:\n${f.content}\n---`
      ).join('\n') + '\n\n';
    }

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

    let designSystemContextText = '';
    const activePrefs = (project.designPreferences || {});
    const ds = designSystem;
    const resolvedTheme = ds?.theme || activePrefs.theme;
    const resolvedTypography = ds?.typography || activePrefs.typography;
    const resolvedPalette = ds?.palette || activePrefs.palette;
    const resolvedLibraries = ds?.libraries || activePrefs.libraries || [];
    const resolvedCustomColors = ds?.customColors || activePrefs.customColors;
    const resolvedCustomGuidelines = ds?.customGuidelines || activePrefs.customGuidelines;
    const resolvedSlideBlock = ds?.slideBlock;

    if (resolvedTheme || resolvedTypography || resolvedPalette || resolvedLibraries.length > 0 || resolvedCustomColors || resolvedCustomGuidelines || resolvedSlideBlock) {
      // OpenDesign Pattern: Try to read strict DESIGN.md from filesystem
      let strictDesignSpec = '';
      if (resolvedTheme) {
        try {
          const themeSlug = resolvedTheme.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
          const specPath = path.join(process.cwd(), 'design-systems', themeSlug, 'DESIGN.md');
          if (fs.existsSync(specPath)) {
            strictDesignSpec = `STRICT DESIGN SYSTEM SPECIFICATION (MANDATORY):\n${fs.readFileSync(specPath, 'utf-8')}\n`;
          }
        } catch {}
      }

      const themePrompt = resolvedTheme ? ({
        'Warm Editorial': 'lovely paper ivory background (#FAF8F5), serif headings in Lora, elegant clay borders (#E7E5E4), and generous reading margins',
        'Premium SaaS Deck': 'crisp card grid layout, cool minimalist background, metric summary blocks, teal highlights (#0D9488), and Space Grotesk fonts',
        'Glassmorphic Quartz': 'dark slate backdrop (#0B0F19), frosted-glass containers with backdrop-blur, violet-indigo borders, and modern Outfit sans typography',
        'Minimal Zinc': 'clean zinc-50 background, zinc-900 accents, professional shadcn-like geometry, and high readability'
      }[resolvedTheme as string] || '') : '';

      const typographyPrompt = resolvedTypography ? ({
        'Lora & Inter': 'Lora for serif headers and Inter for readable, clean body text',
        'Outfit & Roboto Mono': 'Outfit for bold clean headers and Roboto Mono for tech-focused monospace body text',
        'Space Grotesk & Plus Jakarta Sans': 'Space Grotesk for metrics/headings and Plus Jakarta Sans for the responsive body elements',
        'Playfair Display & Georgia': 'Playfair Display for classic serif headings and Georgia for highly-readable longform body text'
      }[resolvedTypography as string] || '') : '';

      const palettePrompt = resolvedPalette ? ({
        'Honey Amber': 'Background Warm Ivory (#FAF8F5), Accent Honey Amber (#D97706), and Text Charcoal (#1C1917)',
        'Cobalt Ocean': 'Background Slate Tint (#F8FAFC), Accent Deep Cobalt (#1D4ED8), and Text Navy Slate (#0F172A)',
        'Quartz Rose': 'Background Rose Blush (#FFFDFB), Accent Rose Crimson (#BE185D), and Text Charcoal (#2D1C22)',
        'Sage Forest': 'Background Pale Sage (#F4F6F2), Accent Forest Green (#15803D), and Text Deep Bark (#1E251E)',
        'Clay Canyon': 'Background Sand Cream (#FCFAF7), Accent Terracotta Clay (#C2410C), and Text Charcoal Stone (#292524)',
        'Night Emerald': 'Background Deep Obsidian (#090D16), Accent Glowing Emerald (#10B981), and Text Crisp Grey (#F1F5F9)'
      }[resolvedPalette as string] || '') : '';

      const blockPrompt = resolvedSlideBlock ? ({
        'Interactive Carousel Slideshow': 'Add an elegant interactive slideshow carousel block to my page with "Next" and "Previous" buttons to switch between content slide nodes in place.',
        'Analytical Graphic Dashboard': 'Add an analytical graphic block to my page: a clean dashboard grid containing financial or metrics summary cards with trend lines.',
        'Collapsible Slide Details Accordion': 'Add a collapsible detail accordion panel structured beautifully with soft ivory cards to fold nested presentation text slides.',
        'Multi-Tab Workspace Switcher': 'Add a premium multi-tab switcher component to my page, allowing users to flip between different details boards with micro-animations.'
      }[resolvedSlideBlock as string] || '') : '';

      const libraryInjections = resolvedLibraries.map((lib: string) => {
        if (lib === 'Tailwind CSS Core') return 'Inject the Tailwind CSS script CDN (https://cdn.tailwindcss.com) in my page header to enable premium Utility styles.';
        if (lib === 'Chart.js Summary Visuals') return 'Inject Chart.js CDN (https://cdn.jsdelivr.net/npm/chart.js) inside my HTML header, and add a beautiful analytical canvas dashboard graph block representing performance analytics!';
        if (lib === 'Canvas Confetti Effects') return 'Inject Canvas-Confetti script (https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js) and configure a button that shoots colorful confetti across the screen when clicked!';
        if (lib === 'Animate.css Reveals') return 'Inject Animate.css link tag (https://cdnjs.cloudflare.com/ajax/libs/animate.css/4.1.1/animate.min.css) in my page header to support rich entrance animations.';
        if (lib === 'Lucide Icons') return 'Inject the Lucide Icons script (https://cdn.jsdelivr.net/npm/lucide/dist/umd/lucide.min.js) and initialize it in the body so I can use custom icons!';
        return '';
      }).filter(Boolean).join('\n');

      let customColorsText = '';
      if (resolvedCustomColors?.primary || resolvedCustomColors?.secondary || resolvedCustomColors?.accent) {
        customColorsText = `
- Custom Hex Brand Colors Enforced:
  * Primary Brand Color: ${resolvedCustomColors.primary || 'N/A'}
  * Secondary Brand Color: ${resolvedCustomColors.secondary || 'N/A'}
  * Accent Highlight Color: ${resolvedCustomColors.accent || 'N/A'}
  (Please integrate these specific hex colors in your background gradients, borders, or text accents instead of standard generic color classes!)`;
      }

      let customGuidelinesText = '';
      if (resolvedCustomGuidelines && resolvedCustomGuidelines.trim()) {
        customGuidelinesText = `
- Strict Custom Guidelines (Mandatory Steering):
  ${resolvedCustomGuidelines.trim()}`;
      }

      designSystemContextText = `
INTEGRATE DESIGN SYSTEM SELECTIONS:
${strictDesignSpec}
${resolvedTheme ? `- Theme Style: ${resolvedTheme} (${themePrompt})` : ''}
${resolvedTypography ? `- Typography: Use ${typographyPrompt}` : ''}
${resolvedPalette ? `- Colors: ${palettePrompt}` : ''}
${customColorsText}
${libraryInjections ? `- Web Injections:\n${libraryInjections}` : ''}
${blockPrompt ? `- Slides Layout Block: ${blockPrompt}` : ''}
${customGuidelinesText}
`;
    }

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
          return NextResponse.json(
            { error: 'Ollama host must be a localhost URL.' },
            { status: 400 }
          );
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AIProvider has no host member; Ollama override is set dynamically
        (provider as any).host = parsed.toString().replace(/\/$/, '');
      } catch {
        return NextResponse.json(
          { error: 'Invalid Ollama host URL.' },
          { status: 400 }
        );
      }
    }

    // Trigger AI Co-Authoring completion — with tools when available (Epic #96)
    let parsedResult;
    const useTools = isCloud && AIFactory.supportsTools(effectiveModel) && !AIFactory.isReasoner(effectiveModel);

    if (useTools) {
      // Use the tool-enabled path with server-side fallback chain
      parsedResult = await generateWithToolFallback(
        userPrompt,
        contextObj,
        STUDIO_TOOLS,
        effectiveModel,
        undefined
      );
    } else {
      parsedResult = await provider.generateCompletion(userPrompt, contextObj);
    }

    // ── Server-side tool execution loop (Epic #96) ─────────────────
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
        // Epic #96: include tool calls with server-side results
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: err may be any thrown value; err.message is read
  } catch (err: any) {
    console.error("AI co-creation route exception:", err);
    return NextResponse.json({ error: err.message || "Failed to trigger co-creation pipeline." }, { status: 500 });
  }
}

