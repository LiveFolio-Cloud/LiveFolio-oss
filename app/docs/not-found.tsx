/**
 * Docs 404 page.
 * Shown when a doc page is not found within the docs layout.
 */
import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { SECTIONS } from "@/lib/docs/sections";
import { cn } from "@/lib/utils";

const DISPLAY_FONT = '"Cabinet Grotesk", "Space Grotesk", sans-serif';

export default function DocsNotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div
        className={cn(
          "w-16 h-16 flex items-center justify-center mb-6",
          "rounded-2xl bg-white dark:bg-[#171714] ring-1 ring-[#0F0F0D]/10 dark:ring-[#F4F4F0]/10"
        )}
      >
        <FileQuestion
          size={28}
          className="text-[#FF3B00]"
        />
      </div>
      <h2
        className="text-2xl font-black tracking-tighter leading-[1.05] mb-3 text-[#0F0F0D] dark:text-[#F4F4F0]"
        style={{ fontFamily: DISPLAY_FONT }}
      >
        Page not found
      </h2>
      <p
        className="text-sm max-w-sm mb-8 text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60"
      >
        This documentation page doesn&apos;t exist yet. It may be added in a future update.
      </p>
      <div className="flex flex-wrap gap-3 justify-center">
        {SECTIONS.map((section) => (
          <Link
            key={section.slug}
            href={`/docs/${section.slug}`}
            className={cn(
              "px-4 py-2 text-xs font-medium transition-colors",
              "rounded-lg bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 text-[#0F0F0D]/80 dark:text-[#F4F4F0]/80 hover:bg-[#0F0F0D]/10 dark:hover:bg-[#F4F4F0]/15"
            )}
          >
            {section.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
