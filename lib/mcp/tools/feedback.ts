/**
 * MCP tool handlers — human feedback and design context: curated brief,
 * active design system, comments/pins, moderation and reactions.
 */
import { readDB, runTransaction, HTMLFile, HTMLComment } from '@/lib/db';
import { isOSS } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase';
import { projectMemoryCache } from '@/lib/project-cache';
import crypto from 'crypto';
import { requireSupabaseAdmin, resolveFolioForOrg, resolveOrgIdFromHeaders, sanitizeAuthor, sanitizeBriefText } from '@/lib/mcp/shared';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
export async function handleGetCuratedBrief(args: any) {
  const { project_id } = args || {};
  if (!project_id) throw new Error("Argument 'project_id' is required.");

  let project: HTMLFile;
  if (!isOSS) {
    const orgId = await resolveOrgIdFromHeaders();
    requireSupabaseAdmin();

    project = await resolveFolioForOrg(project_id, orgId);
  } else {
    const db = await readDB();
    const found = db.find(p => p.id === project_id);
    if (!found) throw new Error(`Project with ID '${project_id}' not found.`);
    project = found;
  }

  const comments = project.comments || [];
  // Only include spatial pins in the design brief (not general discussion comments)
  const openPins = comments.filter(c => !c.resolved && (!c.type || c.type === 'pin'));

  // Synthesize a structured design brief in markdown format
  let brief = `# LiveFolio Design Brief: ${project.title}\n\n`;
  brief += `**Description**: ${project.description}\n`;
  brief += `**Project ID**: \`${project.id}\`\n`;
  brief += `**Project Intent Mode**: \`${project.projectMode || 'document'}\`\n\n`;

  brief += `## 🎨 Current Open Feedback & Visual Annotations\n`;
  if (openPins.length === 0) {
    brief += `No unresolved pinpoint comments at the moment. General layout improvements can still be done.\n`;
  } else {
    brief += `Please resolve the following visual design annotations left by reviewers on the live canvas:\n\n`;

    // Sort pins by slide index and then by position
    const sortedPins = [...openPins].sort((a, b) => {
      if ((a.slideIndex ?? -1) !== (b.slideIndex ?? -1)) {
        return (a.slideIndex ?? -1) - (b.slideIndex ?? -1);
      }
      return (a.y ?? 0) - (b.y ?? 0);
    });

    sortedPins.forEach((c, index) => {
      const slideInfo = c.slideIndex !== undefined
        ? `Slide Index: **${c.slideIndex}**${c.sectionLabel ? ` — ${sanitizeBriefText(c.sectionLabel)}` : ''}`
        : 'Whole Page / Global';
      brief += `### Pin #${index + 1}: ${c.text}\n`;
      brief += `- **Author**: *${sanitizeAuthor(c.author)}*\n`;
      brief += `- **File Target**: \`${c.filename}\`\n`;
      brief += `- **Context/Slide**: ${slideInfo}\n`;
      brief += `- **Canvas Position**: X: \`${c.x ? c.x.toFixed(1) + '%' : '0%'}\`, Y: \`${c.y ? c.y.toFixed(1) + '%' : '0%'}\`\n`;
      if (c.selector) {
        brief += `- **Target DOM Selector**: \`${c.selector}\`\n`;
      }
      if (c.elementHtml) {
        brief += `- **Target Element Snippet**:\n\`\`\`html\n${c.elementHtml}\n\`\`\`\n`;
      }
      brief += `\n`;
    });
  }

  const lastVersion = project.versions[project.versions.length - 1];
  brief += `## 📂 Existing Sandbox Files\n`;
  brief += `The project has the following active files:\n`;
  Object.keys(lastVersion.files).forEach(f => {
    brief += `- \`${f}\` (${lastVersion.files[f].length} characters)\n`;
  });

  return {
    title: project.title,
    description: project.description,
    brief,
    openComments: openPins
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
export async function handleGetActiveDesignSystem(args: any) {
  const { project_id } = args || {};
  if (!project_id) throw new Error("Argument 'project_id' is required.");

  let project: HTMLFile;
  if (!isOSS) {
    const orgId = await resolveOrgIdFromHeaders();
    requireSupabaseAdmin();

    project = await resolveFolioForOrg(project_id, orgId);
  } else {
    const db = await readDB();
    const found = db.find(p => p.id === project_id);
    if (!found) throw new Error(`Project with ID '${project_id}' not found.`);
    project = found;
  }

  const lastVersion = project.versions[project.versions.length - 1];
  const indexHtml = lastVersion?.files["index.html"] || "";

  // Extract from index.html if database has no records
  const fontMatches = indexHtml.match(/family=([^&"'>]+)/g) || [];
  const htmlFonts = fontMatches.map(f => f.replace("family=", "").replace(/\+/g, " "));
  const usesTailwind = indexHtml.includes("cdn.tailwindcss.com");

  // Read preferences
  const prefs: Partial<NonNullable<HTMLFile['designPreferences']>> = project.designPreferences || {};
  const theme = prefs.theme || (usesTailwind ? 'Premium SaaS Deck' : 'Editorial');
  // Fallbacks mirror `EDITOR_DESIGN_DEFAULTS` in lib/design-options.ts — every
  // creation surface now seeds the same theme/typography/palette, so a folio's
  // starting look no longer depends on where it was created.
  const typography = prefs.typography || 'Space Grotesk & Inter';
  const palette = prefs.palette || 'Cobalt Ocean';
  const customColors: { primary?: string; secondary?: string; accent?: string } = prefs.customColors || {};
  const libraries = prefs.libraries || (usesTailwind ? ['Tailwind CSS Core'] : []);
  const customGuidelines = prefs.customGuidelines || '';
  const projectMode = project.projectMode || 'document';

  // 9-section DESIGN.md synthesis
  let themeAnalysis = `# 🎨 LiveFolio Unified Design System: ${project.title}\n\n`;
  themeAnalysis += `This document serves as the single source of truth for all co-creation and agentic modifications. Ensure all surgical updates conform strictly to these design guidelines.\n\n`;

  themeAnalysis += `--- \n\n`;

  // SECTION 1
  themeAnalysis += `### 1. Visual Theme Style & Brand Identity\n`;
  themeAnalysis += `- **Active Theme Preset**: \`${theme}\`\n`;
  const themeDesc = ({
    // 'Editorial' is the default theme for every creation surface (see
    // lib/design-options.ts). Without this entry the fallback string
    // ("Custom custom-made brand styling layout.") was emitted for it.
    'Editorial': 'Magazine-inspired editorial layout with refined serif typography, structured grids, and elegant reading experiences.',
    'Warm Editorial': 'Elegant paper ivory feel focusing on literary prestige, soft sepia margins, and classical borders.',
    'Premium SaaS Deck': 'Modern SaaS pitch aesthetic featuring sharp structural grids, clean high-contrast dividers, and tech-driven visual badges.',
    'Glassmorphic Quartz': 'Dark high-end frosted interface with rich background gradients, glass backdrops, and glowing borders.',
    'Retro Console': 'Dark terminal glowing vintage prompt style with neon amber monospace accents and solid terminal panels.',
    // The five names offered by the new-folio modal (components/dashboard/
    // CreateFolioModal.tsx); without these the generated document fell back to
    // "Custom custom-made brand styling layout." for each of them.
    'Cosmic': 'Futuristic sci-fi atmosphere with a dark backdrop, vibrant neon accents, and immersive spatial depth.',
    'Minimal': 'Stripped-back layout emphasising whitespace, restrained colour, and clean typographic hierarchy.',
    'Brutalism': 'Raw anti-design drawn from concrete architecture — unadorned elements, jarring structure, heavy borders, functional minimalism.',
    'Bento': 'Modular grid of card-like blocks with clear hierarchy, soft spacing, and subtle contrast.',
    'Glassmorphism': 'Frosted-glass surfaces with translucent layers, subtle blur, and luminous borders.'
  } as Record<string, string>)[theme] || 'Custom custom-made brand styling layout.';
  themeAnalysis += `- **Identity Description**: ${themeDesc}\n\n`;

  // SECTION 2
  themeAnalysis += `### 2. Harmonious Palette & Custom Brand Hex Colors\n`;
  themeAnalysis += `- **Color Palette Preset**: \`${palette}\`\n`;
  const paletteColors = ({
    'Honey Amber': 'Warm Ivory Background (\`#FAF8F5\`), Accent Honey Amber (\`#D97706\`), and Dark Charcoal Text (\`#1C1917\`)',
    'Cobalt Ocean': 'Slate Tint Background (\`#F8FAFC\`), Accent Deep Cobalt (\`#1D4ED8\`), and Navy Slate Text (\`#0F172A\`)',
    'Quartz Rose': 'Rose Blush Background (\`#FFFDFB\`), Accent Rose Crimson (\`#BE185D\`), and Dark Charcoal Text (\`#2D1C22\`)',
    'Sage Forest': 'Pale Sage Background (\`#F4F6F2\`), Accent Forest Green (\`#15803D\`), and Deep Bark Text (\`#1E251E\`)',
    'Clay Canyon': 'Sand Cream Background (\`#FCFAF7\`), Accent Terracotta Clay (\`#C2410C\`), and Charcoal Stone Text (\`#292524\`)',
    'Night Emerald': 'Deep Obsidian Background (\`#090D16\`), Accent Glowing Emerald (\`#10B981\`), and Crisp White Text (\`#F1F5F9\`)'
  } as Record<string, string>)[palette] || 'Standard neutral colors.';
  themeAnalysis += `- **Standard Palettes**: ${paletteColors}\n`;
  if (customColors.primary || customColors.secondary || customColors.accent) {
    themeAnalysis += `- **Enforced Custom Colors**:\n`;
    if (customColors.primary) themeAnalysis += `  - Primary Hex: \`${customColors.primary}\`\n`;
    if (customColors.secondary) themeAnalysis += `  - Secondary Hex: \`${customColors.secondary}\`\n`;
    if (customColors.accent) themeAnalysis += `  - Accent Hex: \`${customColors.accent}\`\n`;
  }
  themeAnalysis += `\n`;

  // SECTION 3
  themeAnalysis += `### 3. Typography Scaling & Font Selection\n`;
  themeAnalysis += `- **Typography Pair**: \`${typography}\`\n`;
  const fontSpec = ({
    'Lora & Inter': 'Lora (Classic Serif) for headers to emphasize prestige, Inter (Clean Sans-Serif) for high-readability body copy.',
    'Outfit & Roboto Mono': 'Outfit (Bold Geometric Sans) for modern punchy headers, Roboto Mono for high-tech numbers and labels.',
    'Space Grotesk & Plus Jakarta Sans': 'Space Grotesk (Tech/Editorial) for high-impact metric headers, Plus Jakarta Sans (Elegantly Curved) for active body controls.',
    'Playfair Display & Georgia': 'Playfair Display (High-Contrast Serif) for luxurious headlines, Georgia (Standard Editorial) for longform paragraphs.',
    // The six pairings offered in the UI (DesignDrawer TYPOGRAPHY_PAIRINGS and
    // the new-folio modal). Previously only 'Lora & Inter' matched, so the rest
    // fell back to the generic "Standard typography pairs." string.
    'Playfair & Source': 'Playfair Display (High-Contrast Serif) for headlines, Source Sans 3 for readable longform body copy.',
    'Space Grotesk & DM Sans': 'Space Grotesk (Tech/Editorial) for metric headings, DM Sans (Clean Geometric) for responsive body text.',
    'JetBrains Mono & Inter': 'JetBrains Mono (Monospace) for technical headings and labels, Inter (Clean Sans-Serif) for body copy.',
    'Crimson Text & Nunito': 'Crimson Text (Old-Style Serif) for warm editorial headings, Nunito (Rounded Sans) for friendly body text.',
    // Legacy key: kept so folios saved before this pairing was retired still
    // get a description. Cabinet Grotesk cannot render in this environment
    // (no font file; its CDN is not in the CSP), so point at the real fallback.
    'Cabinet Grotesk & Inter': 'Bold Display headings with Clean Sans-Serif body copy. IMPORTANT: Cabinet Grotesk is unavailable — use Space Grotesk for headings.',
    'Space Grotesk & Inter': 'Space Grotesk (Tech/Editorial) for punchy headings, Inter (Clean Sans-Serif) for high-readability body copy.'
  } as Record<string, string>)[typography] || 'Standard typography pairs.';
  themeAnalysis += `- **Font Specifications**: ${fontSpec}\n`;
  if (htmlFonts.length > 0) {
    themeAnalysis += `- **Discovered HTML Import Fonts**: ${Array.from(new Set(htmlFonts)).map(f => `\`${f}\``).join(', ')}\n`;
  }
  themeAnalysis += `\n`;

  // SECTION 4
  themeAnalysis += `### 4. Elevation, Shadow, & Border Radii Guidelines\n`;
  themeAnalysis += `- **SaaS/Deck Radii**: Use premium rounded shapes (\`rounded-2xl\` or \`rounded-3xl\`) for main interactive wrappers.\n`;
  themeAnalysis += `- **Glassmorphism Spec**: For frosted layouts, use: \`bg-white/5 border border-white/10 backdrop-blur-md shadow-lg\` on dark modes, or \`bg-white/60 border border-black/5 backdrop-blur-md\` on light modes.\n`;
  themeAnalysis += `- **Borders**: Prefer extremely thin borders (\`border border-zinc-200/60\` or \`border-stone-200/50\`) over heavy grids.\n\n`;

  // SECTION 5
  themeAnalysis += `### 5. Responsive Grid & Workspace Container Specifications\n`;
  themeAnalysis += `- **Width Alignment**: Always constrain contents within clear editorial margins (\`max-w-6xl mx-auto px-6\` or \`max-w-4xl\` depending on section density).\n`;
  themeAnalysis += `- **Grid Structure**: Use mobile-first grids (\`grid grid-cols-1 md:grid-cols-3 gap-6\`) to adapt perfectly to tablet and mobile screens.\n\n`;

  // SECTION 6
  themeAnalysis += `### 6. Interaction Micro-animations & Interactive Elements\n`;
  themeAnalysis += `- **Hover Scaling**: All clickable buttons and triggers must scale slightly and smoothly on hover: \`transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]\`.\n`;
  themeAnalysis += `- **Input Interactions**: Focus outlines on form fields and sliders must use theme accent highlights (\`focus:outline-indigo-500\` or custom colors) to look active and alive.\n\n`;

  // SECTION 7
  themeAnalysis += `### 7. Intent Mode Layout Best Practices\n`;
  themeAnalysis += `- **Target Project Intent**: \`${projectMode.toUpperCase()}\`\n`;
  const modeGuidelineText = ({
    'deck': `- **Slides Presentation Model**: Replaces PowerPoint slides. Output distinct horizontal slide panels (\`.slide-node\`). Active slide must have \`.active\` with a smooth transition. Provide keyboard listener navigation scripts and clean arrow button footer controllers.`,
    'document': `- **Longform Editorial Model**: Replaces PDFs/Word. Deliver high-contrast readable vertical texts with sticky side outline summaries on the left column linking to section anchors. Include collapsible disclosures for methodology context.`,
    'spreadsheet': `- **Recalculator Sheet Model**: Replaces Excel grids. Build fully responsive table structures with cells wrapping metric number fields. Configure synchronous Javascript triggers to recalculate totals, margins, and summaries live as the user changes inputs.`,
    'dashboard': `- **Metrics Visualizer Model**: Replaces PowerBI views. Focus on structured card decks, clear status percentages, and active SVG/Chart.js graphs.`,
    'infography': `- **Visual Data Story Model**: Replaces static infographics and visual reports. Design a continuous-scroll canvas with large statistical hero numbers, annotated charts, timeline strips, and before/after comparison panels. Use oversized numerals, subtle divider accents, and a restrained editorial palette. Information density is high but the visual rhythm keeps it scannable — alternate between data-heavy sections and breathing room.`
  } as Record<string, string>)[projectMode] || '';
  themeAnalysis += `${modeGuidelineText}\n\n`;

  // SECTION 8
  themeAnalysis += `### 8. Approved Script & External Library Injections\n`;
  if (libraries.length === 0) {
    themeAnalysis += `- No third-party integrations required. Keep pages light and static.\n`;
  } else {
    themeAnalysis += `The project has approved the following external scripts and widgets:\n`;
    libraries.forEach((lib) => {
      themeAnalysis += `- **${lib}**:\n`;
      if (lib === 'Tailwind CSS Core') themeAnalysis += `  - CDN: \`https://cdn.tailwindcss.com\`\n`;
      if (lib === 'Chart.js Summary Visuals') themeAnalysis += `  - CDN: \`https://cdn.jsdelivr.net/npm/chart.js\` (Use to display elegant responsive charts inside metric blocks)\n`;
      if (lib === 'Canvas Confetti Effects') themeAnalysis += `  - CDN: \`https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js\`\n`;
      if (lib === 'Animate.css Reveals') themeAnalysis += `  - CDN: \`https://cdnjs.cloudflare.com/ajax/libs/animate.css/4.1.1/animate.min.css\`\n`;
      if (lib === 'Lucide Icons') themeAnalysis += `  - CDN: \`https://cdn.jsdelivr.net/npm/lucide/dist/umd/lucide.min.js\`\n`;
    });
  }
  themeAnalysis += `\n`;

  // SECTION 9
  themeAnalysis += `### 9. Visual Anti-AI-Slop & Editorial "Do's and Don'ts" Checklists\n`;
  themeAnalysis += `#### ✅ DO:\n`;
  themeAnalysis += `- Write complete, working scripts for interactive inputs and transition selectors.\n`;
  themeAnalysis += `- Apply gorgeous color contrasts using HSL customized themes over default raw secondary colors.\n`;
  themeAnalysis += `- Implement print-ready styles and responsive page breaks.\n`;
  themeAnalysis += `#### ❌ DON'T:\n`;
  themeAnalysis += `- Do not write comments like \`// rest of your code goes here\` or leave empty containers.\n`;
  themeAnalysis += `- Do not load massive multi-megabyte frameworks. Rely on clean native JS logic for calculators and navigations.\n`;
  if (customGuidelines && customGuidelines.trim()) {
    themeAnalysis += `\n#### 📌 Project Specific Custom Enforcements:\n`;
    themeAnalysis += `> "${customGuidelines.trim()}"\n`;
  }

  return {
    usesTailwind,
    fonts: Array.from(new Set(htmlFonts)),
    themeAnalysis,
    projectMode,
    theme,
    palette,
    typography
  };
}

/** Add a review comment or canvas pin (dual-mode). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
export async function handleAddComment(args: any) {
  const { project_id, text, type, x, y, selector, elementHtml, slide_index, section_label, version_id, filename } = args || {};
  if (!project_id) throw new Error("Argument 'project_id' is required.");
  if (!text || typeof text !== 'string') throw new Error("Argument 'text' is required.");

  const commentType = type === 'comment' || type === 'pin' ? type : 'pin';
  const newComment: HTMLComment = {
    id: crypto.randomUUID(),
    author: 'AI Agent (MCP)',
    text: text.trim(),
    createdAt: new Date().toISOString(),
    versionId: version_id || 'latest',
    filename: filename || 'index.html',
    resolved: false,
    type: commentType,
    x: typeof x === 'number' ? x : undefined,
    y: typeof y === 'number' ? y : undefined,
    selector: typeof selector === 'string' ? selector : undefined,
    elementHtml: typeof elementHtml === 'string' ? elementHtml : undefined,
    slideIndex: typeof slide_index === 'number' ? slide_index : undefined,
    sectionLabel: typeof section_label === 'string' ? section_label : undefined,
  };

  if (!isOSS) {
    const orgId = await resolveOrgIdFromHeaders();
    requireSupabaseAdmin();

    const { data: current, error: fetchError } = await supabaseAdmin
      .from('folios')
      .select('id, organization_id, comments, allow_comments')
      .eq('id', project_id)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (fetchError || !current) throw new Error(`Project with ID '${project_id}' not found.`);
    if (current.allow_comments === false) {
      throw new Error('Comments are disabled for this folio.');
    }
    // Note: the REST guest path also requires an access key on private folios;
    // the MCP caller is an authenticated workspace member (org-scoped select),
    // so no key round-trip is needed.

    const { error: updateError } = await supabaseAdmin
      .rpc('append_folio_comment', {
        p_folio_id: current.id,
        p_comment: newComment,
      });
    if (updateError) throw updateError;
    projectMemoryCache.invalidate(current.id);
    return { success: true, comment: newComment };
  }

  const result = await runTransaction(async (db) => {
    const idx = db.findIndex((p) => p.id === project_id);
    if (idx === -1) throw new Error(`Project with ID '${project_id}' not found.`);
    const project = db[idx];
    if (!project.comments) project.comments = [];
    project.comments.push(newComment);
    project.updatedAt = new Date().toISOString();
    db[idx] = project;
    return newComment;
  });
  return { success: true, comment: result };
}

/** Resolve / reopen / delete a comment or pin (dual-mode). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
export async function handleModerateComment(args: any) {
  const { action, project_id, comment_id } = args || {};
  if (!project_id) throw new Error("Argument 'project_id' is required.");
  if (!comment_id) throw new Error("Argument 'comment_id' is required.");
  if (!['resolve', 'reopen', 'delete'].includes(action)) {
    throw new Error("Argument 'action' must be one of: resolve, reopen, delete.");
  }

  if (!isOSS) {
    const orgId = await resolveOrgIdFromHeaders();
    requireSupabaseAdmin();

    const { data: current, error: fetchError } = await supabaseAdmin
      .from('folios')
      .select('id, comments')
      .eq('id', project_id)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (fetchError || !current) throw new Error(`Project with ID '${project_id}' not found.`);
    const comments: HTMLComment[] = current.comments || [];
    const comment = comments.find((c: HTMLComment) => c.id === comment_id);
    if (!comment) throw new Error('Comment not found.');

    if (action === 'delete') {
      const kept = comments.filter((c: HTMLComment) => c.id !== comment_id);
      const { error: updateError } = await supabaseAdmin
        .from('folios')
        .update({ comments: kept, updated_at: new Date().toISOString() })
        .eq('id', current.id)
        .eq('organization_id', orgId);
      if (updateError) throw updateError;
    } else {
      comment.resolved = action === 'resolve';
      const { error: updateError } = await supabaseAdmin
        .from('folios')
        .update({ comments, updated_at: new Date().toISOString() })
        .eq('id', current.id)
        .eq('organization_id', orgId);
      if (updateError) throw updateError;
    }
    projectMemoryCache.invalidate(current.id);
    return { success: true, action, comment_id };
  }

  await runTransaction(async (db) => {
    const idx = db.findIndex((p) => p.id === project_id);
    if (idx === -1) throw new Error(`Project with ID '${project_id}' not found.`);
    const project = db[idx];
    const comments = project.comments || [];
    const comment = comments.find((c) => c.id === comment_id);
    if (!comment) throw new Error('Comment not found.');
    if (action === 'delete') {
      project.comments = comments.filter((c) => c.id !== comment_id);
    } else {
      comment.resolved = action === 'resolve';
    }
    project.updatedAt = new Date().toISOString();
    db[idx] = project;
  });
  return { success: true, action, comment_id };
}

export const VALID_REACTION_EMOJIS = ['👍', '❤️', '💡', '🔥'];

export const MAX_REACTION_COUNT = 1_000_000;

/** Increment an aggregate emoji reaction count (dual-mode). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are unvalidated JSON-RPC params whose shape is dynamic by design
export async function handleAddReaction(args: any) {
  const { project_id, emoji } = args || {};
  if (!project_id) throw new Error("Argument 'project_id' is required.");
  if (!VALID_REACTION_EMOJIS.includes(emoji)) {
    throw new Error(`Argument 'emoji' must be one of: ${VALID_REACTION_EMOJIS.join(' ')}.`);
  }

  if (!isOSS) {
    const orgId = await resolveOrgIdFromHeaders();
    requireSupabaseAdmin();

    const { data: current, error: fetchError } = await supabaseAdmin
      .from('folios')
      .select('id, reactions')
      .eq('id', project_id)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (fetchError || !current) throw new Error(`Project with ID '${project_id}' not found.`);
    const reactions: Record<string, number> = { ...(current.reactions || {}) };
    reactions[emoji] = Math.min(MAX_REACTION_COUNT, (reactions[emoji] || 0) + 1);

    const { error: updateError } = await supabaseAdmin
      .from('folios')
      .update({ reactions, updated_at: new Date().toISOString() })
      .eq('id', current.id)
      .eq('organization_id', orgId);
    if (updateError) throw updateError;
    return { success: true, reactions };
  }

  const result = await runTransaction(async (db) => {
    const idx = db.findIndex((p) => p.id === project_id);
    if (idx === -1) throw new Error(`Project with ID '${project_id}' not found.`);
    const project = db[idx];
    const reactions: Record<string, number> = { ...(project.reactions || {}) };
    reactions[emoji] = Math.min(MAX_REACTION_COUNT, (reactions[emoji] || 0) + 1);
    project.reactions = reactions;
    project.updatedAt = new Date().toISOString();
    db[idx] = project;
    return reactions;
  });
  return { success: true, reactions: result };
}
