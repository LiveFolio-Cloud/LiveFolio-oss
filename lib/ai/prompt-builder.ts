/**
 * Single home for every prompt string the AI co-authoring routes emit.
 *
 * Extracted from `app/api/files/[id]/ai/route.ts` and
 * `app/api/files/[id]/ai-stream/route.ts`.
 *
 * ⚠️ BEHAVIOUR-PRESERVING MODULE — the text produced here must stay
 * byte-identical to what the two routes produced inline. A changed prompt
 * changes model output. Several template literals below contain load-bearing
 * trailing whitespace (`INSPIRATION: `, `2. STRICT STYLING & COLOR
 * PRESERVATION: `, `...addressing this. `) — do not let an editor trim it.
 *
 * Everything here is pure string construction except `buildDesignSystemContextText`,
 * which reads the `design-systems/<slug>/DESIGN.md` spec off disk.
 */

import fs from 'fs';
import path from 'path';

// ────────────────────────────────────────────────────────────────────────────
// Input types
// ────────────────────────────────────────────────────────────────────────────

export interface AiPersona {
  name?: string;
  role?: string;
  systemInstruction?: string;
}

export interface PersonaIdentity {
  name: string;
  role: string;
  instruction: string;
}

/** A reviewer annotation pinned to an element in the folio. */
export interface ReviewerPin {
  filename: string;
  text: string;
  selector?: string;
  resolved?: boolean;
}

/** The element a "point & polish" surgical edit was requested on. */
export interface TargetedElementContext {
  selector: string;
  tagName?: string;
  outerHTML: string;
}

export interface DesignSystemSelection {
  theme?: string;
  typography?: string;
  palette?: string;
  libraries?: string[];
  customColors?: {
    primary?: string;
    secondary?: string;
    accent?: string;
  };
  customGuidelines?: string;
  slideBlock?: string;
}

export interface ReferenceFile {
  filename: string;
  content?: string;
}

export interface ChatTurn {
  sender: string;
  text: string;
}

export interface SystemInstructionInput {
  personaName: string;
  personaRole: string;
  personaInstruction: string;
  projectTitle: string;
  pageContext: string;
  targetedInstructionBlock: string;
  modeGuideline: string;
  pinsContext: string;
  assetsCatalogContext: string;
}

export interface PlannerPromptInput {
  projectTitle: string;
  projectDescription?: string;
  activeFilename?: string;
  pageContext: string;
  designSystemText?: string;
  files: Record<string, string>;
  userPrompt: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Persona
// ────────────────────────────────────────────────────────────────────────────

export const DEFAULT_PERSONA_INSTRUCTION =
  "You are a friendly, down-to-earth presentation and layout assistant. Your user is not technical and is used to working with PowerPoint, PDFs, Excel, and Word. Keep your responses extremely simple, warm, and brief (maximum 2-3 sentences). Never use technical jargon, HTML/CSS terms, or complex code details. Explain changes in simple business/office terms (like 'updated the slide design', 'rearranged the grid', or 'polished the table style').";

/**
 * Direct, dynamic persona configuration: derive a co-pilot identity from the
 * folio title when the project has no explicit `aiPersona`.
 */
export function resolvePersona(project: {
  title?: string;
  aiPersona?: AiPersona;
}): PersonaIdentity {
  const cleanProjTitle = (project.title || 'Project')
    .replace(/(?:landing\s+page|website|app|concept|page|ui|mobile|portal|system|folio|presentation)/gi, '')
    .trim();
  const defaultPersonaName = cleanProjTitle ? `${cleanProjTitle} Co-pilot` : 'LiveFolio Co-pilot';
  const defaultPersonaRole = cleanProjTitle ? `${cleanProjTitle} Design Partner` : 'Design & Logic Partner';

  return {
    name: project.aiPersona?.name || defaultPersonaName,
    role: project.aiPersona?.role || defaultPersonaRole,
    instruction: project.aiPersona?.systemInstruction || DEFAULT_PERSONA_INSTRUCTION,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// File map / reviewer pins
// ────────────────────────────────────────────────────────────────────────────

/**
 * Filter out visual binary asset (base64) content from LLM prompt context to
 * keep tokens small. Keys are preserved; only asset values are replaced.
 */
export function buildCleanFiles(files: Record<string, string>): Record<string, string> {
  const cleanCurrentFiles = { ...files };
  Object.keys(cleanCurrentFiles).forEach(key => {
    if (key.startsWith('assets/')) {
      cleanCurrentFiles[key] = `[Binary branding asset file or base64 image data - path: "${key}". References this file path in your HTML tags as relative source.]`;
    }
  });
  return cleanCurrentFiles;
}

/** Automatically package unresolved pins as reviewer context. */
export function buildPinsContext(comments?: ReviewerPin[] | null): string {
  const unresolvedPins = (comments || []).filter(c => !c.resolved);
  let pinsContext = '';
  if (unresolvedPins.length > 0) {
    pinsContext = '\nUNRESOLVED REVIEWER PINS (Mandatory feedback to address):\n' +
      unresolvedPins.map((p, i) => `${i+1}. [File: ${p.filename}]: "${p.text}" (Element: ${p.selector})`).join('\n') + '\n';
  }
  return pinsContext;
}

// ────────────────────────────────────────────────────────────────────────────
// Project-mode intent block
// ────────────────────────────────────────────────────────────────────────────

/**
 * Elegant, luxurious literary system identity — the per-`projectMode` intent
 * guidance. Unknown modes (including `infography`) intentionally yield ''.
 */
export function buildModeGuideline(projectMode?: string): string {
  const mode = projectMode || 'document';
  let modeGuideline = '';
  if (mode === 'deck') {
    modeGuideline = `
IMPORTANT INTENT MODE - LANDING / SLIDE DECK (pptx replacement):
- You are constructing a slide deck presentation.
- Use horizontal slide elements where only one slide is active at any time (e.g. using CSS class '.slide-node.active' to display and others hidden).
- Provide elegant slide controls (Next/Prev buttons) and keyboard arrow event listeners in a <script> block to transition slides smoothly.
- Maintain a clear slide tracker indicator (e.g., 'Slide X of Y').
- Keep layout visually punchy, high-impact, with immersive dark or clean brand backdrops, bold card panels, and large readable typography.
`;
  } else if (mode === 'document') {
    modeGuideline = `
IMPORTANT INTENT MODE - VERTICAL DOCUMENT / REPORT (pdf & docx replacement):
- You are constructing an editorial layout for reading and deep-dive documentation.
- Use standard vertical scrolling with comfortable reading margins (e.g. max-w-4xl mx-auto px-6).
- Create a sticky side or top outline navigation block that links to section anchors (#summary, #findings, etc.) to replace flat PDFs.
- Ensure gorgeous heading hierarchy and classic long-form readability (generous line-heights, soft neutral borders).
- Add collapsible accessory containers (e.g., footnotes, expandable methodology panels) to isolate dense reference text.
`;
  } else if (mode === 'spreadsheet') {
    modeGuideline = `
IMPORTANT INTENT MODE - SPREADSHEET / SHEET GRID (xlsx replacement):
- You are constructing a structured metric calculator or active input table.
- Use a high-quality tabular layout with responsive column alignments, clear rows, and elegant hover outlines.
- Include interactive cell inputs (<input type="number">) or slider ranges (<input type="range">) for key variables.
- Write a synchronous <script> recalculation loop that updates sum calculations and profitability cards live as the user edits numbers.
- Provide key metrics summaries at the top (e.g., Grand Totals, Calculated Net Profit margins, Operating Expenses) in beautiful styled grids.
`;
  } else if (mode === 'dashboard') {
    modeGuideline = `
IMPORTANT INTENT MODE - ANALYTICAL METRICS DASHBOARD (PowerBI replacement):
- You are constructing an executive analytics overview dashboard.
- Focus on grid-based layouts with key performance cards and high-visibility status badges (e.g. '+12.4% vs last period').
- Inject rich visualizers (e.g., interactive SVG sparklines or a responsive Chart.js line/bar chart block using script CDN tags).
- Group information cleanly into functional visual modules with interactive filtering tabs or buttons.
`;
  }
  return modeGuideline;
}

// ────────────────────────────────────────────────────────────────────────────
// Asset catalog
// ────────────────────────────────────────────────────────────────────────────

/** Compile the Virtual Binary Assets catalog context. */
export function buildAssetsCatalogContext(files: Record<string, string>): string {
  const assetKeys = Object.keys(files).filter(k => k.startsWith('assets/'));
  let assetsCatalogContext = '';
  if (assetKeys.length > 0) {
    assetsCatalogContext = '\nAVAILABLE BRANDING & GRAPHIC ASSETS (Local version-controlled files):\n' +
      'You can render the following custom uploaded assets directly in your HTML using relative img tags:\n' +
      assetKeys.map(k => `- ${k}`).join('\n') + '\n' +
      'When the user asks for images, logos, or backgrounds, proactively reference these exact relative paths in your img src tags. Do not invent or use external unverified image URLs if local assets are available!\n';
  }
  return assetsCatalogContext;
}

// ────────────────────────────────────────────────────────────────────────────
// Surgical targeted edit block
// ────────────────────────────────────────────────────────────────────────────

/** Point & polish: guidance for editing one visually-selected element. */
export function buildTargetedInstructionBlock(
  targetedElement: TargetedElementContext | undefined | null,
  userPrompt: string
): string {
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
  return targetedInstructionBlock;
}

// ────────────────────────────────────────────────────────────────────────────
// Main system instruction
// ────────────────────────────────────────────────────────────────────────────

/**
 * Assemble the full co-authoring system instruction.
 *
 * Note: the two `new Date()` calls are deliberately separate — the original
 * code called the constructor twice, and callers may still expect the date and
 * time to be sampled independently.
 */
export function buildSystemInstruction(input: SystemInstructionInput): string {
  const {
    personaName,
    personaRole,
    personaInstruction,
    projectTitle,
    pageContext,
    targetedInstructionBlock,
    modeGuideline,
    pinsContext,
    assetsCatalogContext,
  } = input;

  return `You are "${personaName}", a proactive, interactive, and high-fidelity "${personaRole}".
${personaInstruction}

Today's date is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}. The current time is ${new Date().toLocaleTimeString('en-US', { timeZoneName: 'short' })}. Use this for any time-sensitive questions.

Your workspace holds an interactive HTML document titled "${projectTitle}".
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
}

// ────────────────────────────────────────────────────────────────────────────
// History / attachments
// ────────────────────────────────────────────────────────────────────────────

/** Package chat history for the prompt. */
export function buildChatHistoryText(chatHistory?: ChatTurn[] | null): string {
  let formattedHistory = '';
  if (Array.isArray(chatHistory) && chatHistory.length > 0) {
    formattedHistory = 'Preceding Conversation History:\n' + chatHistory.map((c) =>
      `[${c.sender === 'user' ? 'User' : 'Assistant'}]: ${c.text}`
    ).join('\n') + '\n\n';
  }
  return formattedHistory;
}

/**
 * Package attached reference files (transient and persistent project files),
 * automatically appending persistent project references that were not already
 * attached by name.
 */
export function buildAttachmentsText(
  attachedFiles?: ReferenceFile[] | null,
  referenceFiles?: ReferenceFile[] | null
): string {
  let formattedAttachments = '';
  if (Array.isArray(attachedFiles) && attachedFiles.length > 0) {
    formattedAttachments = 'Attached Reference Files:\n' + attachedFiles.map((f) =>
      `File name: ${f.filename}\nContent:\n${f.content}\n---`
    ).join('\n') + '\n\n';
  }

  const transientNames = new Set((attachedFiles || []).map((f) => f.filename));
  const permanentRefs = referenceFiles || [];
  const missingRefs = permanentRefs.filter(r => !transientNames.has(r.filename));
  if (missingRefs.length > 0) {
    if (!formattedAttachments) {
      formattedAttachments = 'Attached Reference Files:\n';
    }
    formattedAttachments += missingRefs.map((f) =>
      `File name: ${f.filename} (Persistent Project Context Reference)\nContent:\n${f.content}\n---`
    ).join('\n') + '\n\n';
  }

  return formattedAttachments;
}

// ────────────────────────────────────────────────────────────────────────────
// Design system
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the design-system steering block.
 *
 * `designSystem` holds the per-request selection from the client; anything it
 * does not set falls back to the folio's saved `designPreferences`.
 *
 * Note the deliberate asymmetry: `slideBlock` is read from the request only,
 * never from saved preferences.
 */
export function buildDesignSystemContextText(
  designSystem: DesignSystemSelection | undefined | null,
  designPreferences: DesignSystemSelection | undefined | null
): string {
  let designSystemContextText = '';
  const activePrefs = designPreferences || {};
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
    // A few theme display names do not slugify to their folder under
    // design-systems/ — notably the three themes in `themePrompt` below whose
    // names carry a descriptive suffix. Without this alias they resolved to no
    // DESIGN.md at all, so the model received the name and nothing else.
    const THEME_FOLDER_ALIASES: Record<string, string> = {
      'Premium SaaS Deck': 'premium',
      'Glassmorphic Quartz': 'glassmorphic',
      'Retro Console': 'retro',
    };
    let strictDesignSpec = '';
    if (resolvedTheme) {
      try {
        const themeSlug = resolvedTheme.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
        const folder = THEME_FOLDER_ALIASES[resolvedTheme as string] || themeSlug;
        const specPath = path.join(process.cwd(), 'design-systems', folder, 'DESIGN.md');
        if (fs.existsSync(specPath)) {
          strictDesignSpec = `STRICT DESIGN SYSTEM SPECIFICATION (MANDATORY):\n${fs.readFileSync(specPath, 'utf-8')}\n`;
        }
      } catch {}
    }

    const themePrompt = resolvedTheme ? ({
      // 'Editorial' is the default theme for every creation surface (see
      // lib/design-options.ts). It had no entry here, so folios created with
      // the default received only the DESIGN.md spec and no one-line style
      // hint — added so the default resolves as fully as 'Warm Editorial'.
      'Editorial': 'magazine-inspired editorial layout, refined serif headings (Gelasio), a stark near-black on white palette (#111111 / #FFFFFF), structured grids, and generous reading margins',
      'Warm Editorial': 'lovely paper ivory background (#FAF8F5), serif headings in Lora, elegant clay borders (#E7E5E4), and generous reading margins',
      'Premium SaaS Deck': 'crisp card grid layout, cool minimalist background, metric summary blocks, teal highlights (#0D9488), and Space Grotesk fonts',
      'Glassmorphic Quartz': 'dark slate backdrop (#0B0F19), frosted-glass containers with backdrop-blur, violet-indigo borders, and modern Outfit sans typography',
      'Minimal Zinc': 'clean zinc-50 background, zinc-900 accents, professional shadcn-like geometry, and high readability',
      // The five names offered by the new-folio modal (components/dashboard/
      // CreateFolioModal.tsx). Without entries here each one reached the model
      // as the DESIGN.md spec plus no hint at all.
      'Cosmic': 'futuristic sci-fi atmosphere with a dark backdrop, vibrant neon accents, and immersive spatial depth',
      'Minimal': 'stripped-back layout emphasising whitespace, restrained colour, and clean typographic hierarchy for maximum clarity',
      'Brutalism': 'raw anti-design drawn from concrete architecture — unadorned elements, jarring structural layouts, heavy borders, and functional minimalism',
      'Bento': 'modular grid of card-like blocks with clear hierarchy, soft spacing, and subtle contrast for a scannable, organised surface',
      'Glassmorphism': 'frosted-glass surfaces with translucent layers, subtle blur, and luminous borders for depth and modern elegance'
    }[resolvedTheme as string] || '') : '';

    const typographyPrompt = resolvedTypography ? ({
      'Lora & Inter': 'Lora for serif headers and Inter for readable, clean body text',
      'Outfit & Roboto Mono': 'Outfit for bold clean headers and Roboto Mono for tech-focused monospace body text',
      'Space Grotesk & Plus Jakarta Sans': 'Space Grotesk for metrics/headings and Plus Jakarta Sans for the responsive body elements',
      'Playfair Display & Georgia': 'Playfair Display for classic serif headings and Georgia for highly-readable longform body text',
      // The six pairings offered by components/folio/DesignDrawer.tsx
      // (TYPOGRAPHY_PAIRINGS) and components/dashboard/CreateFolioModal.tsx.
      // Only 'Lora & Inter' was a key here, so the other five reached the model
      // as the bare name with no description. Heading/body splits are taken
      // verbatim from DesignDrawer's own `heading`/`body` fields.
      'Playfair & Source': 'Playfair Display (high-contrast serif) for headlines, Source Sans 3 for readable longform body text',
      'Space Grotesk & DM Sans': 'Space Grotesk (tech/editorial) for metric headings, DM Sans for clean responsive body text',
      'JetBrains Mono & Inter': 'JetBrains Mono (monospace) for technical headings and code-adjacent labels, Inter for clean body copy',
      'Crimson Text & Nunito': 'Crimson Text (old-style serif) for warm editorial headings, Nunito (rounded sans) for friendly body text',
      // Legacy key: kept only so folios saved before this pairing was retired
      // still receive a description instead of falling through to ''. Cabinet
      // Grotesk itself cannot render here (no font file; CDN not in the CSP),
      // so the hint explicitly redirects the model to the real fallback.
      'Cabinet Grotesk & Inter': 'Bold display headings with clean sans-serif body copy. IMPORTANT: Cabinet Grotesk is not available in this environment — use Space Grotesk for headings instead.',
      'Space Grotesk & Inter': 'Space Grotesk (tech/editorial) for punchy headings, Inter (clean sans-serif) for high-readability body copy'
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

  return designSystemContextText;
}

// ────────────────────────────────────────────────────────────────────────────
// Two-stage (planner → generator) prompts — stream route
// ────────────────────────────────────────────────────────────────────────────

/** Stage 1 planner prompt used by the streaming route. */
export function buildPlannerPrompt(input: PlannerPromptInput): string {
  const { projectTitle, projectDescription, activeFilename, pageContext, designSystemText, files, userPrompt } = input;
  return `
Website Context:
Title: "${projectTitle}"
Description: "${projectDescription || ''}"
Active File: "${pageContext === 'Current Screen' ? `Current Screen: ${activeFilename || 'active file'}` : 'Whole Project'}"
${designSystemText || ''}

Active Project Files Map:
${JSON.stringify(files, null, 2)}

User Request:
"${userPrompt}"

Please provide a 3-4 bullet point structural plan for addressing this. 
Identify files to change and Tailwind classes to use. Do NOT output code yet.
`;
}

/** Stage 2 generator prompt used by the streaming route. */
export function buildGeneratorPrompt(planText: string): string {
  return `
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
}

/**
 * Appended to the system instruction for the streaming route's JSON-mode
 * generator call.
 */
export const GEMINI_JSON_SYSTEM_SUFFIX =
  "\n\nIMPORTANT: You must return a 100% complete and valid JSON object. Always generate 'explanation' FIRST as the very first key in the JSON object properties.";
