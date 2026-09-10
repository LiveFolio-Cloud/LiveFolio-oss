import { ToolDefinition } from '../provider.interface';

/**
 * In-studio tool schemas for AI chat tool-use (Epic #96).
 *
 * These are distinct from the MCP tools at app/api/mcp/route.ts (which serve
 * external AI agents) but intentionally aligned in shape.  The AI selects and
 * invokes these tools based on user prompts in the studio chat panel.
 */
export const STUDIO_TOOLS: ToolDefinition[] = [
  // ── 1. EDIT ELEMENT ──────────────────────────────────────────────
  {
    name: 'edit_element',
    description:
      'Replace a specific HTML element on a page with new content. ' +
      'Use this for targeted surgical edits — changing text, updating a section, ' +
      'fixing styling on one element, etc.  Do NOT use this to rewrite entire pages; ' +
      'use it for scoped changes to a single element identified by CSS selector.',
    inputSchema: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'The HTML file to modify (e.g. "index.html", "slide-2.html")',
        },
        selector: {
          type: 'string',
          description:
            'CSS selector that uniquely targets the element to replace ' +
            '(e.g. "#hero", ".hero-section", "section:nth-child(2)")',
        },
        new_html: {
          type: 'string',
          description: 'The complete replacement HTML for the targeted element including its outer tag',
        },
        explanation: {
          type: 'string',
          description: 'Human-readable summary of what changed and why (shown to the user)',
        },
      },
      required: ['filename', 'selector', 'new_html'],
    },
  },

  // ── 2. APPLY DESIGN SYSTEM ───────────────────────────────────────
  {
    name: 'apply_design_system',
    description:
      'Apply a design system preset (theme, typography, palette, and optional ' +
      'CDN libraries) to the entire folio.  This triggers a server-side re-generation ' +
      'of the folio with the new design parameters applied globally.',
    inputSchema: {
      type: 'object',
      properties: {
        theme: {
          type: 'string',
          description:
            'Theme name, e.g. "Minimal Zinc", "Premium SaaS Deck", "Warm Editorial", "Glassmorphic Quartz"',
        },
        typography: {
          type: 'string',
          description:
            'Font pairing, e.g. "Lora & Inter", "Space Grotesk & Plus Jakarta Sans", "Geist Mono & Switzer"',
        },
        palette: {
          type: 'string',
          description: 'Color palette name, e.g. "Honey Amber", "Cobalt Ocean", "Quartz Rose"',
        },
        libraries: {
          type: 'array',
          items: { type: 'string' },
          description: 'CDN library URLs to inject into the HTML (e.g. Chart.js, GSAP, Lucide)',
        },
      },
      required: ['theme'],
    },
  },

  // ── 3. ADD PAGE ──────────────────────────────────────────────────
  {
    name: 'add_page',
    description:
      'Create a new HTML page file in the folio.  Use this whenever the user asks ' +
      'for a new page, screen, slide, or section that should be its own file.',
    inputSchema: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'Filename ending in .html (e.g. "about.html", "slide-3.html", "contact.html")',
        },
        initial_html: {
          type: 'string',
          description: 'The complete initial HTML content for this page (full <!DOCTYPE html> document)',
        },
        title: {
          type: 'string',
          description: 'Human-readable page title shown in the UI (e.g. "About Us", "Slide 3")',
        },
      },
      required: ['filename', 'initial_html'],
    },
  },

  // ── 4. DELETE PAGE ───────────────────────────────────────────────
  {
    name: 'delete_page',
    description:
      'Remove a page from the folio.  ⚠️ THIS REQUIRES EXPLICIT USER CONFIRMATION — ' +
      'the frontend will show a confirmation dialog before executing.  Never call this ' +
      'without the user explicitly asking to delete a specific page.',
    inputSchema: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'The filename to delete from the folio (e.g. "about.html")',
        },
      },
      required: ['filename'],
    },
  },

  // ── 5. EXPORT FOLIO ──────────────────────────────────────────────
  {
    name: 'export_folio',
    description:
      'Export the folio (or a specific page) to a different format.  Currently supports ' +
      'PDF conversion via server-side HTML-to-PDF rendering.',
    inputSchema: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['pdf'],
          description: 'Target export format. Currently only "pdf" is supported.',
        },
        filename: {
          type: 'string',
          description:
            'Optional specific page to export.  If omitted, exports the primary index.html page.',
        },
      },
      required: ['format'],
    },
  },

  // ── 6. WEB SEARCH ────────────────────────────────────────────────
  {
    name: 'web_search',
    description:
      'Search the web for current information, facts, or references. ' +
      'Use this when the user asks about something that may have changed recently, ' +
      'needs real-world data, or requests information you are unsure about. ' +
      'Returns a list of results with titles, URLs, and snippets.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query (e.g. "latest CSS features 2026", "Tailwind v4 migration guide")',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default 5, max 10)',
        },
      },
      required: ['query'],
    },
  },

  // ── 7. WEB FETCH ─────────────────────────────────────────────────
  {
    name: 'web_fetch',
    description:
      'Fetch and extract the content of a web page as clean markdown text. ' +
      'Use this to read documentation, articles, or any URL the user provides. ' +
      'The page is converted to readable text so you can summarize or reference it.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The full URL to fetch (e.g. "https://docs.example.com/guide")',
        },
      },
      required: ['url'],
    },
  },
];

/** Lookup a tool definition by name */
export function getToolByName(name: string): ToolDefinition | undefined {
  return STUDIO_TOOLS.find((t) => t.name === name);
}

/** Check if a tool name is registered */
export function isKnownTool(name: string): boolean {
  return STUDIO_TOOLS.some((t) => t.name === name);
}
