import { NextResponse } from 'next/server';
import { readDB, runTransaction, HTMLVersion, ChatMessage } from '@/lib/db';
import { getAuthContext } from '@/lib/auth';
import { assertMessageQuota, incrementUserUsage, assertStorageQuota } from '@/ee/middleware/usageCapping';
import { GoogleGenAI, Type } from '@google/genai';
import { isCloud } from '@/lib/env';
import { resolveManagedModel } from '@/lib/ai/resolve-managed-model';
import path from 'path';
import fs from 'fs';

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
    if (userId && orgId) {
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
    if (userId && orgId) {
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

    const db = await readDB();
    const project = db.find((p) => p.id === id);

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const cleanProjTitle = (project.title || "Project")
      .replace(/(?:landing\s+page|website|app|concept|page|ui|mobile|portal|system|folio|presentation)/gi, '')
      .trim();
    const defaultPersonaName = cleanProjTitle ? `${cleanProjTitle} Co-pilot` : "LiveFolio Co-pilot";
    const defaultPersonaRole = cleanProjTitle ? `${cleanProjTitle} Design Partner` : "Design & Logic Partner";

    const personaName = project.aiPersona?.name || defaultPersonaName;
    const personaRole = project.aiPersona?.role || defaultPersonaRole;
    const personaInstruction = project.aiPersona?.systemInstruction || "You are a friendly, down-to-earth presentation and layout assistant. Your user is not technical and is used to working with PowerPoint, PDFs, Excel, and Word. Keep your responses extremely simple, warm, and brief (maximum 2-3 sentences). Never use technical jargon, HTML/CSS terms, or complex code details. Explain changes in simple business/office terms (like 'updated the slide design', 'rearranged the grid', or 'polished the table style').";

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
      return NextResponse.json({ error: 'No model selected. Please select a model to generate.' }, { status: 400 });
    }

    const resolvedModel = effectiveModel.toLowerCase().trim() === 'gemini-1.5-flash' ? 'gemini-2.5-flash' : effectiveModel;

    const apiKey = clientApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Gemini API key is not configured. Please define it in your settings or environment.' }, { status: 400 });
    }

    let baseVersion = project.versions[project.versions.length - 1];
    if (targetVersionId) {
      const match = project.versions.find(v => v.versionId === targetVersionId);
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
    const unresolvedPins = (project.comments || []).filter(c => !c.resolved);
    let pinsContext = '';
    if (unresolvedPins.length > 0) {
      pinsContext = '\nUNRESOLVED REVIEWER PINS (Mandatory feedback to address):\n' + 
        unresolvedPins.map((p, i) => `${i+1}. [File: ${p.filename}]: "${p.text}" (Element: ${p.selector})`).join('\n') + '\n';
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

    // Package attached reference files
    let formattedAttachments = '';
    if (Array.isArray(attachedFiles) && attachedFiles.length > 0) {
      formattedAttachments = 'Attached Reference Files:\n' + attachedFiles.map((f) =>
        `File name: ${f.filename}\nContent:\n${f.content}\n---`
      ).join('\n') + '\n\n';
    }

    // Automatically append persistent project reference files if not already attached
    const transientNames = new Set((attachedFiles || []).map((f: { filename: string }) => f.filename));
    const permanentRefs = project.referenceFiles || [];
    const missingRefs = permanentRefs.filter(r => !transientNames.has(r.filename));
    if (missingRefs.length > 0) {
      if (!formattedAttachments) {
        formattedAttachments = 'Attached Reference Files:\n';
      }
      formattedAttachments += missingRefs.map((f) =>
        `File name: ${f.filename} (Persistent Project Context Reference)\nContent:\n${f.content}\n---`
      ).join('\n') + '\n\n';
    }

    let designSystemContextText = '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- client-supplied design prefs are free-form JSON; only optional prop reads follow
    const activePrefs = (project.designPreferences || {}) as any;
    const ds = designSystem;
    const resolvedTheme = ds?.theme || activePrefs.theme;
    const resolvedTypography = ds?.typography || activePrefs.typography;
    const resolvedPalette = ds?.palette || activePrefs.palette;
    const resolvedLibraries = ds?.libraries || activePrefs.libraries || [];
    const resolvedCustomColors = ds?.customColors || activePrefs.customColors;
    const resolvedCustomGuidelines = ds?.customGuidelines || activePrefs.customGuidelines;
    const resolvedSlideBlock = ds?.slideBlock;

    if (resolvedTheme || resolvedTypography || resolvedPalette || resolvedLibraries.length > 0 || resolvedCustomColors || resolvedCustomGuidelines || resolvedSlideBlock) {
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

    const ai = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'LiveFolio-oss-client'
        }
      }
    });

    const plannerPrompt = `
Website Context:
Title: "${project.title}"
Description: "${project.description || ''}"
Active File: "${pageContext === 'Current Screen' ? `Current Screen: ${body.activeFilename || 'active file'}` : 'Whole Project'}"
${designSystemContextText || ''}

Active Project Files Map:
${JSON.stringify(cleanCurrentFiles, null, 2)}

User Request:
"${userPrompt}"

Please provide a 3-4 bullet point structural plan for addressing this. 
Identify files to change and Tailwind classes to use. Do NOT output code yet.
`;

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
        const generatorPrompt = `
PLAN:
${planText}

Based on the plan, return ONLY the modified files in this JSON format:
{
  "explanation": "Markdown text explaining the modifications cleanly and concisely",
  "updatedFiles": [{ "filename": "string", "code": "string" }],
  "interactiveCard": { ... optional ... }
}

IMPORTANT RULES FOR CODE GENERATION:
1. The "explanation" field must come FIRST in the JSON schema properties, ensuring it generates and streams instantly before large code blocks are produced!
2. The "code" field for each updated file must contain the 100% complete and fully valid code of the file. Do not output placeholders, omissions, or truncated segments.
3. If you are making a surgical modification (e.g., target inspect mode), you MUST preserve all other existing codes, styles, scripts, layouts, and structures in the file exactly as they are in the "Active Project Files Map". Do NOT rewrite, change colors, reformat, or alter other unrelated elements under any circumstances! Keep them 100% identical byte-for-byte.
`;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK typing does not cover this streaming call shape
        const responseStream = await (ai as any).models.generateContentStream({
          model: resolvedModel,
          contents: [
            { role: 'user', parts: [{ text: plannerPrompt }] },
            { role: 'model', parts: [{ text: planText }] },
            { role: 'user', parts: [{ text: generatorPrompt }] }
          ],
          config: { 
            systemInstruction: systemInstruction + "\n\nIMPORTANT: You must return a 100% complete and valid JSON object. Always generate 'explanation' FIRST as the very first key in the JSON object properties.", 
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

            const parentVersionCount = proj.versions.length;
            const nextVersionId = `v${parentVersionCount + 1}`;

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: err may be any thrown value; err.message is read
  } catch (err: any) {
    console.error("Stream initiation error:", err);
    return NextResponse.json({ error: err.message || "Failed to initiate co-creation stream." }, { status: 500 });
  }
}
