/**
 * Documentation section configuration.
 *
 * Defines the four doc sections, their slugs, labels, and page trees.
 * This is the single source of truth for docs navigation.
 *
 * Phase 1 will fill in the placeholder sections (api-reference, self-hosting).
 */

export interface DocPageMeta {
  slug: string;
  title: string;
  description?: string;
  order: number;
}

export interface DocSection {
  slug: string;
  label: string;
  /** Optional icon from lucide-react (component name as string) */
  icon?: string;
  pages: DocPageMeta[];
}

export const SECTIONS: DocSection[] = [
  {
    slug: "user-guide",
    label: "User Guide",
    pages: [
      { slug: "index", title: "User Guide", description: "Everything you need to know about using LiveFolio", order: 1 },
      { slug: "getting-started", title: "Getting Started", description: "Create your first folio and learn the dashboard", order: 2 },
      { slug: "sharing-folios", title: "Sharing a Folio", description: "Publish folios and share them via public URLs", order: 3 },
      { slug: "version-control", title: "Version Control", description: "Browse history, compare versions, and roll back changes", order: 4 },
      { slug: "comments-and-feedback", title: "Comments & Feedback", description: "Canvas annotations, emoji reactions, and review workflows", order: 5 },
      { slug: "analytics", title: "Analytics", description: "View tracking and engagement metrics for shared folios", order: 6 },
      { slug: "integrations", title: "Integrations", description: "Connect AI agents via MCP, Slack, and Discord", order: 7 },
      { slug: "design-systems", title: "Design Systems", description: "Apply and customize design systems for visual consistency", order: 8 },
      { slug: "billing-and-invoices", title: "Billing & Invoices", description: "Plans, upgrading, invoices, and managing your subscription (Cloud only)", order: 9 },
      { slug: "faq", title: "FAQ", description: "Frequently asked questions about LiveFolio", order: 10 },
    ],
  },
  {
    slug: "mcp-agent",
    label: "MCP / Agent Guide",
    pages: [
      { slug: "index", title: "MCP Overview", description: "What MCP is and how AI agents use LiveFolio", order: 1 },
      { slug: "quickstart", title: "Quickstart", description: "5-minute setup to connect your AI agent to LiveFolio", order: 2 },
      { slug: "tools-reference", title: "Tools Reference", description: "Complete reference for all MCP tools and parameters", order: 3 },
      { slug: "authentication", title: "Authentication", description: "Bearer token auth, API keys, and agent registration", order: 4 },
      { slug: "publishing-folios", title: "Publishing Folios", description: "Create and update folios programmatically via MCP", order: 5 },
      { slug: "design-systems-mcp", title: "Design Systems via MCP", description: "List and apply design systems through MCP tools", order: 6 },
      { slug: "troubleshooting", title: "Troubleshooting", description: "Common MCP errors and debugging tips", order: 7 },
    ],
  },
  {
    slug: "api-reference",
    label: "API Reference",
    pages: [
      { slug: "index", title: "API Reference", description: "REST API for CI/CD, custom integrations, and debugging", order: 1 },
      { slug: "authentication", title: "Authentication", description: "API keys, Bearer tokens, OAuth, and rate limits", order: 2 },
      { slug: "files", title: "Files", description: "CRUD operations for folios — list, create, read, update, delete", order: 3 },
      { slug: "uploading", title: "Uploading Files", description: "Single and batch file upload endpoints for folios", order: 4 },
      { slug: "comments", title: "Comments", description: "Canvas-pinned comments for collaborative folio review", order: 5 },
      { slug: "reactions", title: "Reactions", description: "Emoji reactions on shared folios", order: 6 },
      { slug: "analytics", title: "Analytics", description: "View tracking, session time, and device breakdowns", order: 7 },
      { slug: "ai-generation", title: "AI Generation", description: "AI-powered folio creation, co-authoring, and streaming", order: 8 },
      { slug: "sharing", title: "Sharing & Access", description: "Public access control, access keys, and OSS tunnel management", order: 9 },
    ],
  },
  {
    slug: "self-hosting",
    label: "Self-Hosting",
    pages: [
      { slug: "index", title: "OSS Overview", description: "LiveFolio OSS vs Cloud — features and trade-offs", order: 1 },
      { slug: "quickstart", title: "Quickstart", description: "Clone, install, configure, and run LiveFolio OSS", order: 2 },
      { slug: "configuration", title: "Configuration", description: "All environment variables explained", order: 3 },
      { slug: "database", title: "Database", description: "Flat-file JSON mode, backups, and migrating to Cloud", order: 4 },
      { slug: "ai-providers", title: "AI Providers", description: "Configuring Gemini, Claude, OpenAI, DeepSeek, and Ollama", order: 5 },
      { slug: "sharing", title: "Public Sharing", description: "Cloudflare tunnel setup for public folio sharing", order: 6 },
      { slug: "upgrading", title: "Upgrading", description: "Version upgrade guide and migration steps", order: 7 },
    ],
  },
];

/**
 * Find a section by its slug.
 */
export function getSection(slug: string): DocSection | undefined {
  return SECTIONS.find((s) => s.slug === slug);
}

/**
 * Build a flat list of all page paths for navigation.
 * Returns array of { sectionSlug, pageSlug, title } for every page.
 */
export function getAllPages(): { sectionSlug: string; pageSlug: string; title: string; order: number }[] {
  const result: { sectionSlug: string; pageSlug: string; title: string; order: number }[] = [];
  for (const section of SECTIONS) {
    for (const page of section.pages) {
      result.push({
        sectionSlug: section.slug,
        pageSlug: page.slug,
        title: page.title,
        order: page.order,
      });
    }
  }
  return result;
}

/**
 * Resolve a URL pathname like "/docs/user-guide/sharing" to the page metadata.
 * Returns null if no matching page is found.
 */
export function resolvePath(
  pathname: string
): { section: DocSection; page: DocPageMeta } | null {
  // Strip leading /docs/ and trailing slash
  const clean = pathname.replace(/^\/docs\/?/, "").replace(/\/$/, "");
  if (!clean) return null;

  const parts = clean.split("/");
  // First segment is the section slug
  const sectionSlug = parts[0];
  const section = getSection(sectionSlug);
  if (!section) return null;

  // Second segment (or "index") is the page slug
  const pageSlug = parts[1] || "index";
  const page = section.pages.find((p) => p.slug === pageSlug);
  if (!page) return null;

  return { section, page };
}

/**
 * Build an ordered flat list of all pages across all sections.
 * Used for prev/next navigation.
 */
export interface FlatPage {
  sectionSlug: string;
  pageSlug: string;
  title: string;
  href: string;
}

export function getFlatPageList(): FlatPage[] {
  const result: FlatPage[] = [];
  for (const section of SECTIONS) {
    for (const page of section.pages) {
      result.push({
        sectionSlug: section.slug,
        pageSlug: page.slug,
        title: page.title,
        href:
          page.slug === "index"
            ? `/docs/${section.slug}`
            : `/docs/${section.slug}/${page.slug}`,
      });
    }
  }
  return result;
}

/**
 * Get prev/next navigation for a given page.
 */
export function getPrevNext(
  pathname: string
): { prev: FlatPage | null; next: FlatPage | null } {
  const flat = getFlatPageList();
  // Normalize: remove trailing slash
  const normalized = pathname.replace(/\/$/, "");
  const idx = flat.findIndex((p) => p.href === normalized);

  if (idx === -1) return { prev: null, next: null };

  return {
    prev: idx > 0 ? flat[idx - 1] : null,
    next: idx < flat.length - 1 ? flat[idx + 1] : null,
  };
}
