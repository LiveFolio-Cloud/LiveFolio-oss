/**
 * Search placeholder for the docs hub.
 *
 * This is a UI placeholder — actual search implementation is deferred to
 * Phase 1. The placeholder shows the intent and design, and provides a
 * natural location for the search input.
 *
 * See spikes/docs-ia-findings.md for the search approach recommendation.
 */
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export default function SearchPlaceholder() {
  return (
    <div className="relative w-full max-w-sm">
      <div
        className={cn(
          "pointer-events-none flex items-center gap-2 px-3 py-2",
          "rounded-xl bg-white dark:bg-[#171714] ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50"
        )}
      >
        <Search size={14} className="shrink-0" />
        <span className="text-[12px] font-medium">Search docs (coming soon)</span>
        <kbd
          className={cn(
            "ml-auto hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px]",
            "rounded-md bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50"
          )}
        >
          ⌘K
        </kbd>
      </div>
    </div>
  );
}
