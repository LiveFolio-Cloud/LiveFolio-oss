"use client";

/**
 * Docs sidebar navigation.
 *
 * Renders the section tree from lib/docs/sections.ts, highlights the active
 * page using usePathname(), and supports collapsible sections.
 */
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronRight, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { SECTIONS, resolvePath } from "@/lib/docs/sections";

export default function Sidebar() {
  const pathname = usePathname();
  const resolved = resolvePath(pathname);

  // Track which sections are expanded (default: the section containing the active page)
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    if (resolved) return new Set([resolved.section.slug]);
    return new Set([SECTIONS[0].slug]);
  });

  // Keep the active section expanded when navigating
  useEffect(() => {
    if (resolved) {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.add(resolved.section.slug);
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resolved is derived from pathname (and SECTIONS is static); pathname is the intended trigger
  }, [pathname]);

  function toggleSection(slug: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  }

  return (
    <aside className="w-full lg:w-64 shrink-0 border-r border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10 pr-6">
      <nav
        className="sticky top-20 space-y-1"
        aria-label="Documentation sections"
      >
        {/* Section header */}
        <div className="flex items-center gap-2 px-3 py-2 mb-3">
          <BookOpen size={16} className="shrink-0 text-[#FF3B00]" />
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">
            Documentation
          </span>
        </div>

        {SECTIONS.map((section) => {
          const isExpanded = expanded.has(section.slug);
          const isActiveSection =
            resolved?.section.slug === section.slug;

          return (
            <div key={section.slug} className="space-y-0.5">
              {/* Section header — collapsible toggle */}
              <button
                onClick={() => toggleSection(section.slug)}
                className={cn(
                  "w-full flex items-center gap-1.5 px-3 py-1.5 text-left transition-colors group focus-visible:ring-2 focus-visible:outline-none",
                  "rounded-lg focus-visible:ring-[#FF3B00]",
                  isActiveSection
                    ? "text-[#FF3B00]"
                    : "text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:text-[#FF3B00]"
                )}
                aria-expanded={isExpanded}
              >
                <span className="flex-1 text-[10px] font-bold uppercase tracking-[0.14em]">
                  {section.label}
                </span>
                {isExpanded ? (
                  <ChevronDown size={14} className="shrink-0 opacity-60" />
                ) : (
                  <ChevronRight size={14} className="shrink-0 opacity-60" />
                )}
              </button>

              {/* Page links (collapsible with animation) */}
              <div className={cn(
                "ml-3 pl-3 space-y-0.5 overflow-hidden transition-all duration-200 ease-out",
                "border-l border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10",
                isExpanded ? "max-h-96 opacity-100" : "max-h-0 opacity-0 border-l-0"
              )}>
                {section.pages.map((page) => {
                  const href = `/docs/${section.slug}${page.slug === "index" ? "" : `/${page.slug}`}`;
                  const isActive =
                    resolved?.section.slug === section.slug &&
                    resolved?.page.slug === page.slug;

                  return (
                    <Link
                      key={page.slug}
                      href={href}
                      className={cn(
                        "block px-3 py-1.5 text-[12px] font-medium transition-colors",
                        "rounded-lg",
                        isActive
                          ? "bg-[#FF3B00]/10 text-[#FF3B00] font-bold"
                          : "text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:text-[#FF3B00] hover:bg-[#FF3B00]/5"
                      )}
                    >
                      {page.title}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
