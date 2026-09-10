/**
 * Docs catch-all route — handles both /docs landing page and all sub-pages.
 *
 *   /docs                  → landing page with section cards
 *   /docs/user-guide       → renders user-guide/index.md
 *   /docs/user-guide/sharing → renders user-guide/sharing.md
 */
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

export const revalidate = 3600; // ISR: regenerate at most once per hour
import { ChevronLeft, ChevronRight, BookOpen, Bot, Code, Server } from "lucide-react";
import { loadDocFromPath, DocNotFoundError } from "@/lib/docs/loadDoc";
import { getPrevNext, SECTIONS } from "@/lib/docs/sections";
import TableOfContents from "@/components/docs/TableOfContents";
import { cn } from "@/lib/utils";

const DISPLAY_FONT = '"Cabinet Grotesk", "Space Grotesk", sans-serif';

// ── Types ────────────────────────────────────────────────────────────────────

interface PageParams {
  slug?: string[];
}

// ── Landing page constants ───────────────────────────────────────────────────

const SECTION_ICONS: Record<string, React.ReactNode> = {
  "user-guide": <BookOpen size={22} />,
  "mcp-agent": <Bot size={22} />,
  "api-reference": <Code size={22} />,
  "self-hosting": <Server size={22} />,
};

const SECTION_DESCRIPTIONS: Record<string, string> = {
  "user-guide":
    "Learn how to create, version, share, and embed interactive folios. Covers the dashboard, studio editor, comments, and reactions.",
  "mcp-agent":
    "Connect AI coding agents (Claude, Cursor, Copilot) to LiveFolio via the Model Context Protocol. Publish folios programmatically.",
  "api-reference":
    "Complete REST API reference — endpoints, authentication, rate limits, request/response schemas for every LiveFolio API route.",
  "self-hosting":
    "Run LiveFolio on your own infrastructure. Covers environment variables, flat-file DB configuration, and production deployment.",
};

// ── Metadata ─────────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { slug } = await params;

  if (!slug || slug.length === 0) {
    return {
      title: "Documentation — LiveFolio",
      description:
        "LiveFolio documentation — user guides, MCP agent setup, API reference, and self-hosting guides.",
    };
  }

  const pathname = `/docs/${slug.join("/")}`;

  try {
    const doc = await loadDocFromPath(pathname);
    return {
      title: doc.frontmatter.title,
      description: doc.frontmatter.description,
    };
  } catch {
    return { title: "Page Not Found — LiveFolio Docs" };
  }
}

// ── Landing page component ───────────────────────────────────────────────────

function DocsLanding() {
  return (
    <div>
      <header className="mb-10">
        <h1
          className="text-3xl sm:text-4xl font-black tracking-tighter leading-[1.05] text-[#0F0F0D] dark:text-[#F4F4F0]"
          style={{ fontFamily: DISPLAY_FONT }}
        >
          Documentation
        </h1>
        <p className="mt-3 text-sm max-w-xl leading-relaxed text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60">
          Everything you need to publish, share, and automate interactive HTML
          documents with LiveFolio — for end users, AI agents, and self-hosters.
          LiveFolio is <strong>auth.md ready</strong>, MCP-native, and fully open source.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {SECTIONS.map((section) => (
          <Link
            key={section.slug}
            href={`/docs/${section.slug}`}
            className={cn(
              "group block p-5 transition-all",
              "rounded-2xl bg-white dark:bg-[#171714] ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 hover:ring-[#FF3B00]/30"
            )}
          >
            <div className="flex items-start gap-3">
              <div className={cn(
                "w-10 h-10 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform",
                "rounded-lg bg-[#FF3B00]/10 text-[#FF3B00]"
              )}>
                {SECTION_ICONS[section.slug] || <BookOpen size={22} />}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className={cn(
                  "text-[13px] font-bold tracking-tight transition-colors",
                  "text-[#0F0F0D] dark:text-[#F4F4F0] group-hover:text-[#FF3B00]"
                )} style={{ fontFamily: DISPLAY_FONT }}>
                  {section.label}
                </h3>
                <p className="text-[12px] mt-1 leading-relaxed text-[#0F0F0D]/55 dark:text-[#F4F4F0]/55">
                  {SECTION_DESCRIPTIONS[section.slug] ||
                    "Documentation for this section is coming soon."}
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <span className={cn(
                    "text-[10px] font-bold uppercase tracking-[0.14em]",
                    "text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40"
                  )}>
                    {section.pages.length} page{section.pages.length !== 1 ? "s" : ""}
                  </span>
                  <span className={cn(
                    "text-[10px] font-bold opacity-0 group-hover:opacity-100 transition-opacity",
                    "text-[#FF3B00]"
                  )}>
                    Browse →
                  </span>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className={cn(
        "mt-10 p-6",
        "rounded-2xl bg-[#FF3B00]/[0.08] border-l-2 border-[#FF3B00]"
      )}>
        <h3 className="text-sm font-bold mb-2 text-[#0F0F0D] dark:text-[#F4F4F0]">
          New to LiveFolio?
        </h3>
        <p className="text-[12px] leading-relaxed mb-4 text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60">
          Start with the User Guide to create your first folio, or jump straight
          to the MCP Guide if you&apos;re an AI agent developer.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/docs/user-guide"
            className={cn(
              "inline-flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-semibold transition-colors",
              "rounded-lg bg-[#FF3B00] text-white hover:bg-[#0F0F0D] dark:hover:bg-[#F4F4F0] dark:hover:text-[#0F0F0D]"
            )}
          >
            <BookOpen size={14} />
            User Guide
          </Link>
          <Link
            href="/docs/mcp-agent"
            className={cn(
              "inline-flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-medium transition-colors",
              "rounded-lg bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 text-[#0F0F0D]/80 dark:text-[#F4F4F0]/80 hover:bg-[#0F0F0D]/10 dark:hover:bg-[#F4F4F0]/15"
            )}
          >
            <Bot size={14} />
            MCP Guide
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function DocsPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { slug } = await params;

  // Landing page for /docs
  if (!slug || slug.length === 0) {
    return <DocsLanding />;
  }

  const pathname = `/docs/${slug.join("/")}`;

  let doc;
  try {
    doc = await loadDocFromPath(pathname);
  } catch (e) {
    if (e instanceof DocNotFoundError) {
      notFound();
    }
    throw e;
  }

  const { prev, next } = getPrevNext(pathname);

  return (
    <div className="flex gap-8 lg:gap-12">
      {/* Doc content */}
      <article className="flex-1 min-w-0 max-w-none lg:max-w-3xl">
        {/* Breadcrumb */}
        <nav className={cn(
          "flex items-center gap-2 text-[11px] font-medium mb-4",
          "text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40"
        )}>
          <Link
            href="/docs"
            className="transition-colors hover:text-[#FF3B00]"
          >
            Docs
          </Link>
          <span>/</span>
          <Link
            href={`/docs/${doc.section.slug}`}
            className="transition-colors hover:text-[#FF3B00]"
          >
            {doc.section.label}
          </Link>
          {doc.meta.slug !== "index" && (
            <>
              <span>/</span>
              <span className="text-[#0F0F0D] dark:text-[#F4F4F0]">
                {doc.frontmatter.title}
              </span>
            </>
          )}
        </nav>

        {/* Page header */}
        <header className={cn(
          "mb-8 pb-6 border-b",
          "border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10"
        )}>
          <h1
            className="text-3xl sm:text-4xl font-black tracking-tighter leading-[1.05] text-[#0F0F0D] dark:text-[#F4F4F0]"
            style={{ fontFamily: DISPLAY_FONT }}
          >
            {doc.frontmatter.title}
          </h1>
          {doc.frontmatter.description && (
            <p className="mt-3 text-sm leading-relaxed text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60">
              {doc.frontmatter.description}
            </p>
          )}
        </header>

        {/* MDX-rendered content */}
        <div className="docs-content">{doc.content}</div>

        {/* Prev / Next navigation */}
        <nav
          className={cn(
            "mt-12 pt-6 border-t grid grid-cols-2 gap-4",
            "border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10"
          )}
          aria-label="Previous and next page"
        >
          {prev ? (
            <Link
              href={prev.href}
              className={cn(
                "group flex items-start gap-2 p-3 transition-all col-start-1",
                "rounded-xl bg-white dark:bg-[#171714] ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 hover:ring-[#FF3B00]/40"
              )}
            >
              <ChevronLeft
                size={16}
                className={cn(
                  "shrink-0 mt-0.5 transition-colors",
                  "text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40 group-hover:text-[#FF3B00]"
                )}
              />
              <div className="min-w-0">
                <span className={cn(
                  "block text-[10px] font-bold uppercase tracking-[0.14em]",
                  "text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40"
                )}>
                  Previous
                </span>
                <span className={cn(
                  "text-[12px] font-medium transition-colors",
                  "text-[#0F0F0D] dark:text-[#F4F4F0] group-hover:text-[#FF3B00]"
                )}>
                  {prev.title}
                </span>
              </div>
            </Link>
          ) : (
            <div />
          )}

          {next && (
            <Link
              href={next.href}
              className={cn(
                "group flex items-start justify-end gap-2 p-3 transition-all col-start-2 text-right",
                "rounded-xl bg-white dark:bg-[#171714] ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 hover:ring-[#FF3B00]/40"
              )}
            >
              <div className="min-w-0">
                <span className={cn(
                  "block text-[10px] font-bold uppercase tracking-[0.14em]",
                  "text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40"
                )}>
                  Next
                </span>
                <span className={cn(
                  "text-[12px] font-medium transition-colors",
                  "text-[#0F0F0D] dark:text-[#F4F4F0] group-hover:text-[#FF3B00]"
                )}>
                  {next.title}
                </span>
              </div>
              <ChevronRight
                size={16}
                className={cn(
                  "shrink-0 mt-0.5 transition-colors",
                  "text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40 group-hover:text-[#FF3B00]"
                )}
              />
            </Link>
          )}
        </nav>
      </article>

      {/* Right-rail Table of Contents */}
      <div className="hidden xl:block">
        <TableOfContents headings={doc.headings} />
      </div>
    </div>
  );
}
