"use client";

/**
 * Table of contents for the current doc page.
 *
 * Renders heading anchors extracted from MDX. Highlights the currently
 * visible heading based on scroll position via IntersectionObserver.
 */
import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { Heading } from "@/lib/docs/loadDoc";

interface TableOfContentsProps {
  headings: Heading[];
}

export default function TableOfContents({ headings }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string>("");

  // Setup IntersectionObserver to track which heading is in view
  useEffect(() => {
    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Find the first entry that is intersecting (top-most visible heading)
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        rootMargin: "-80px 0px -70% 0px", // account for sticky header
        threshold: 0,
      }
    );

    // Observe all heading elements
    const elements = headings
      .map((h) => document.getElementById(h.anchor))
      .filter(Boolean) as HTMLElement[];

    elements.forEach((el) => observer.observe(el));

    return () => {
      elements.forEach((el) => observer.unobserve(el));
    };
  }, [headings]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, anchor: string) => {
      e.preventDefault();
      const el = document.getElementById(anchor);
      if (el) {
        el.scrollIntoView({ behavior: "smooth" });
        // Update URL hash without scroll jump
        window.history.replaceState(null, "", `#${anchor}`);
        setActiveId(anchor);
      }
    },
    []
  );

  if (headings.length === 0) return null;

  return (
    <aside className="w-full lg:w-48 shrink-0">
      <nav className="sticky top-20" aria-label="Table of contents">
        <h4 className="text-[10px] font-bold uppercase tracking-[0.14em] mb-3 px-1 text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">
          On this page
        </h4>
        <ul className="space-y-0.5">
          {headings.map((heading) => (
            <li key={heading.anchor}>
              <a
                href={`#${heading.anchor}`}
                onClick={(e) => handleClick(e, heading.anchor)}
                className={cn(
                  "block py-1 text-[12px] leading-snug transition-colors border-l-2 focus-visible:outline-none",
                  heading.level === 3 && "pl-4",
                  heading.level === 4 && "pl-7",
                  heading.level === 2 && "pl-2",
                  "focus-visible:ring-2 focus-visible:ring-[#FF3B00]",
                  activeId === heading.anchor
                    ? "text-[#FF3B00] border-[#FF3B00] font-bold"
                    : "text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50 border-transparent hover:text-[#FF3B00] hover:border-[#FF3B00]"
                )}
              >
                {heading.text}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
