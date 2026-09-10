/**
 * MDX document loader.
 *
 * Reads .md/.mdx files from content/docs/, parses frontmatter with gray-matter,
 * extracts heading anchors for table-of-contents, and compiles MDX into
 * renderable React elements via next-mdx-remote/rsc.
 */
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { compileMDX } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import type { DocSection, DocPageMeta } from "./sections";
import { resolvePath } from "./sections";

// ── Types ────────────────────────────────────────────────────────────────────

export interface Heading {
  level: number; // 2 for ##, 3 for ###, etc.
  text: string;
  anchor: string;
}

export interface DocPage {
  /** The compiled MDX content as a React element (server component). */
  content: React.ReactElement;
  /** Parsed frontmatter fields. */
  frontmatter: {
    title: string;
    description?: string;
    order?: number;
  };
  /** Headings extracted from the raw markdown (for table of contents). */
  headings: Heading[];
  /** The section this page belongs to. */
  section: DocSection;
  /** The page metadata from sections.ts. */
  meta: DocPageMeta;
  /** Raw markdown source (useful for search indexing later). */
  rawSource: string;
}

/** Error thrown when a doc page cannot be found. */
export class DocNotFoundError extends Error {
  constructor(sectionSlug: string, pageSlug: string) {
    super(`Doc page not found: ${sectionSlug}/${pageSlug}`);
    this.name = "DocNotFoundError";
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generate a URL-friendly anchor from heading text.
 * Matches GitHub-flavored markdown conventions: lowercase, alphanumeric + hyphens.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "") // remove non-word chars except spaces/hyphens
    .replace(/\s+/g, "-") // spaces to hyphens
    .replace(/-+/g, "-") // collapse multiple hyphens
    .replace(/^-|-$/g, ""); // trim leading/trailing hyphens
}

/**
 * Extract headings (## and ### level) from raw markdown source.
 * Returns an array of { level, text, anchor }.
 */
function extractHeadings(raw: string): Heading[] {
  const headingRegex = /^(#{2,4})\s+(.+)$/gm;
  const headings: Heading[] = [];
  let match: RegExpExecArray | null;

  while ((match = headingRegex.exec(raw)) !== null) {
    const level = match[1].length;
    const text = match[2].trim();
    // Skip if the text looks like code (starts with backtick)
    if (text.startsWith("`")) continue;
    headings.push({
      level,
      text,
      anchor: slugify(text),
    });
  }

  return headings;
}

/**
 * Resolve the file path for a doc page in content/docs/.
 * Guards against path traversal — URL-derived segments may never contain
 * '..' or path separators.
 */
function resolveFilePath(sectionSlug: string, pageSlug: string): string {
  if (!sectionSlug || !pageSlug ||
      sectionSlug.includes('..') || pageSlug.includes('..') ||
      sectionSlug.includes('/') || sectionSlug.includes('\\') ||
      pageSlug.includes('/') || pageSlug.includes('\\')) {
    throw new DocNotFoundError(sectionSlug, pageSlug);
  }
  // Try .mdx first, then .md
  const base = path.join(process.cwd(), "content", "docs", sectionSlug, pageSlug);
  for (const ext of [".mdx", ".md"]) {
    const p = base + ext;
    if (fs.existsSync(p)) return p;
  }
  throw new DocNotFoundError(sectionSlug, pageSlug);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Load and compile a doc page from content/docs/.
 *
 * @param sectionSlug - The section slug (e.g., "user-guide")
 * @param pageSlug - The page slug within the section (e.g., "sharing")
 * @returns A fully resolved DocPage with compiled MDX content, frontmatter, and headings.
 */
export async function loadDoc(
  sectionSlug: string,
  pageSlug: string
): Promise<DocPage> {
  const filePath = resolveFilePath(sectionSlug, pageSlug);

  // Read and parse frontmatter
  const rawSource = fs.readFileSync(filePath, "utf-8");
  const { data: frontmatter, content: rawContent } = matter(rawSource);

  // Extract headings from the markdown body (after frontmatter stripped)
  const headings = extractHeadings(rawContent);

  // Compile MDX to a React element (server-side, cached by Next.js)
  const { content } = await compileMDX({
    source: rawContent,
    options: {
      parseFrontmatter: false, // already parsed above
      mdxOptions: {
        remarkPlugins: [remarkGfm],
      },
    },
  });

  // Resolve section + page metadata from the config
  const resolved = resolvePath(`/docs/${sectionSlug}/${pageSlug}`);
  if (!resolved) {
    throw new DocNotFoundError(sectionSlug, pageSlug);
  }

  return {
    content,
    frontmatter: {
      title: frontmatter.title || resolved.page.title,
      description: frontmatter.description || resolved.page.description,
      order: frontmatter.order ?? resolved.page.order,
    },
    headings,
    section: resolved.section,
    meta: resolved.page,
    rawSource,
  };
}

/**
 * Given a pathname like "/docs/user-guide/sharing", resolve and load the doc.
 * This is the primary entry point for the docs catch-all route.
 */
export async function loadDocFromPath(pathname: string): Promise<DocPage> {
  const clean = pathname.replace(/^\/docs\/?/, "").replace(/\/$/, "");
  const parts = clean.split("/");
  const sectionSlug = parts[0];
  const pageSlug = parts[1] || "index";

  if (!sectionSlug) {
    throw new DocNotFoundError("", "");
  }

  return loadDoc(sectionSlug, pageSlug);
}
