"use client";

/**
 * Docs search dialog.
 *
 * Client-side fuzzy search over the pre-built search index.
 * Opens with ⌘K / Ctrl+K. Uses Fuse.js for ranking.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Fuse from "fuse.js";
import { Search as SearchIcon, X, CornerDownLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchEntry {
  title: string;
  description: string;
  section: string;
  sectionLabel: string;
  slug: string;
  href: string;
  content: string;
}

export default function Search() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [, setIndex] = useState<SearchEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const fuseRef = useRef<Fuse<SearchEntry> | null>(null);

  // Load search index
  useEffect(() => {
    fetch("/search-index.json")
      .then((res) => res.json())
      .then((data: SearchEntry[]) => {
        setIndex(data);
        fuseRef.current = new Fuse(data, {
          keys: [
            { name: "title", weight: 2 },
            { name: "description", weight: 1.5 },
            { name: "content", weight: 1 },
            { name: "sectionLabel", weight: 0.5 },
          ],
          threshold: 0.35,
          includeScore: true,
          ignoreLocation: true,
          useExtendedSearch: true,
          minMatchCharLength: 2,
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Search on query change
  useEffect(() => {
    if (!query.trim() || !fuseRef.current) {
      setResults([]);
      setSelectedIndex(0);
      return;
    }
    const fuse = fuseRef.current;
    const found = fuse.search(query.trim()).map((r) => r.item);
    setResults(found);
    setSelectedIndex(0);
  }, [query]);

  // Keyboard: open dialog
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
    }
  }, [open]);

  // Navigate on Enter
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (results[selectedIndex]) {
          router.push(results[selectedIndex].href);
          setOpen(false);
        }
      }
    },
    [results, selectedIndex, router]
  );

  const hasValue = query.trim().length > 0;

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "flex items-center gap-2 w-full max-w-sm px-3 py-2 transition-colors text-left",
          "rounded-xl bg-white dark:bg-[#171714] ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50 hover:text-[#0F0F0D] dark:hover:text-[#F4F4F0] hover:ring-[#FF3B00]/30"
        )}
      >
        <SearchIcon size={14} className="shrink-0" />
        <span className="text-[12px] font-medium flex-1">Search docs…</span>
        <kbd className={cn(
          "hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px]",
          "rounded-md bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40"
        )}>
          ⌘K
        </kbd>
      </button>

      {/* Search dialog overlay */}
      {open && (
        <div className="fixed inset-0 z-[100]">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-zinc-950/60 dark:bg-black/80 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          {/* Dialog */}
          <div className="absolute top-[15%] left-1/2 -translate-x-1/2 w-full max-w-lg mx-4">
            <div className={cn(
              "overflow-hidden shadow-2xl",
              "rounded-2xl bg-white dark:bg-[#171714] ring-1 ring-[#0F0F0D]/10 dark:ring-[#F4F4F0]/10"
            )}>
              {/* Input */}
              <div className={cn(
                "flex items-center gap-2 px-4 py-3 border-b",
                "border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10"
              )}>
                <SearchIcon
                  size={16}
                  className={cn(
                    "shrink-0 transition-colors",
                    hasValue || open
                      ? "text-[#FF3B00]"
                      : "text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40"
                  )}
                />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Search documentation…"
                  className={cn(
                    "flex-1 bg-transparent border-none outline-none text-sm focus:outline-none",
                    "text-[#0F0F0D] dark:text-[#F4F4F0] placeholder:text-[#0F0F0D]/40 dark:placeholder:text-[#F4F4F0]/40 focus:ring-0"
                  )}
                />
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close search"
                  className={cn(
                    "p-1 rounded-md text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40 focus-visible:outline-none",
                    "hover:bg-[#0F0F0D]/5 dark:hover:bg-[#F4F4F0]/10 focus-visible:ring-2 focus-visible:ring-[#FF3B00]"
                  )}
                >
                  <X size={14} />
                </button>
              </div>

              {/* Results */}
              <div className="max-h-80 overflow-y-auto">
                {loading && (
                  <div className="px-4 py-8 text-center text-xs text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">
                    Loading index…
                  </div>
                )}

                {!loading && query.trim() === "" && (
                  <div className="px-4 py-8 text-center text-xs text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">
                    Type to search across all documentation pages
                  </div>
                )}

                {!loading && query.trim() !== "" && results.length === 0 && (
                  <div className="px-4 py-8 text-center text-xs text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">
                    No results found for &quot;{query}&quot;
                  </div>
                )}

                {results.map((entry, i) => (
                  <button
                    key={entry.href}
                    onClick={() => {
                      router.push(entry.href);
                      setOpen(false);
                    }}
                    onMouseEnter={() => setSelectedIndex(i)}
                    className={cn(
                      "w-full text-left px-4 py-3 flex items-start gap-3 transition-colors border-b last:border-b-0",
                      "border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10",
                      i === selectedIndex
                        ? "bg-[#FF3B00] text-[#F4F4F0]"
                        : "hover:bg-[#0F0F0D]/5 dark:hover:bg-[#F4F4F0]/5"
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "text-[12px] font-semibold truncate",
                          i === selectedIndex
                            ? "text-[#F4F4F0]"
                            : "text-[#0F0F0D] dark:text-[#F4F4F0]"
                        )}>
                          {entry.title}
                        </span>
                        <span className={cn(
                          "text-[9px] font-bold uppercase tracking-[0.14em] shrink-0",
                          i === selectedIndex
                            ? "text-[#F4F4F0]/60"
                            : "text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40"
                        )}>
                          {entry.sectionLabel}
                        </span>
                      </div>
                      {entry.description && (
                        <p className={cn(
                          "text-[11px] mt-0.5 truncate",
                          i === selectedIndex
                            ? "text-[#F4F4F0]/70"
                            : "text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50"
                        )}>
                          {entry.description}
                        </p>
                      )}
                    </div>
                    {i === selectedIndex && (
                      <CornerDownLeft
                        size={14}
                        className="shrink-0 mt-0.5 text-[#F4F4F0]/50"
                      />
                    )}
                  </button>
                ))}
              </div>

              {/* Footer */}
              <div className={cn(
                "flex items-center gap-4 px-4 py-2 border-t text-[10px]",
                "border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10 text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40"
              )}>
                <span>↑↓ navigate</span>
                <span>↵ open</span>
                <span>esc close</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
