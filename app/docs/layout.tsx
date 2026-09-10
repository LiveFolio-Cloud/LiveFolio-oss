/**
 * Docs route group layout.
 *
 * Public-facing layout with a minimal header (landing-page style), sidebar,
 * and content area. No dashboard Navbar — docs are public pages.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import Sidebar from "@/components/docs/Sidebar";
import Search from "@/components/docs/Search";
import { DocsMobileToggle } from "@/components/docs/MobileToggle";
import { cn } from "@/lib/utils";
import "./docs-content.css";

const DISPLAY_FONT = '"Cabinet Grotesk", "Space Grotesk", sans-serif';

export const metadata: Metadata = {
  title: {
    default: "Documentation",
    template: "%s — LiveFolio Docs",
  },
  description:
    "LiveFolio documentation — user guides, MCP agent setup, API reference, and self-hosting guides.",
};

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#F4F4F0] dark:bg-[#0F0F0D] text-[#0F0F0D] dark:text-[#F4F4F0]">
      {/* Public docs header — landing-page style, no auth/quotas */}
      <header className={cn(
        "sticky top-0 z-50 border-b backdrop-blur-md",
        "border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10 bg-[#F4F4F0]/85 dark:bg-[#0F0F0D]/85"
      )}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          {/* Logo + docs badge */}
          <Link href="/" className="flex items-center gap-2.5 group shrink-0">
            <span className="inline-block h-3 w-3 bg-[#FF3B00]" />
            <span
              className="text-base font-black tracking-tighter text-[#0F0F0D] dark:text-[#F4F4F0]"
              style={{ fontFamily: DISPLAY_FONT }}
            >
              LiveFolio
            </span>
            <span className={cn(
              "px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em]",
              "rounded-md bg-[#FF3B00]/10 text-[#FF3B00]"
            )}>
              docs
            </span>
          </Link>

          {/* Right side — back link + search */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:block w-48">
              <Search />
            </div>
            <Link
              href="/"
              className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:text-[#FF3B00] transition-colors"
            >
              <ArrowLeft size={14} />
              Back to LiveFolio
            </Link>
          </div>
        </div>
      </header>

      {/* Mobile search + hamburger */}
      <div className="sticky top-14 z-40 border-b border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10 bg-[#F4F4F0]/85 dark:bg-[#0F0F0D]/85 backdrop-blur-md lg:hidden">
        <div className="flex items-center gap-3 px-4 py-2">
          <DocsMobileToggle />
          <div className="flex-1 sm:hidden">
            <Search />
          </div>
          <Link
            href="/"
            className="sm:hidden inline-flex items-center gap-1 text-[11px] font-medium text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:text-[#FF3B00] transition-colors shrink-0"
          >
            <ArrowLeft size={13} />
            Back
          </Link>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex gap-8 lg:gap-12">
          {/* Desktop sidebar */}
          <div className="hidden lg:block pt-12 pb-16">
            <div className="sticky top-20">
              <div className="mb-4 hidden sm:block lg:hidden">
                <Search />
              </div>
              <Sidebar />
            </div>
          </div>

          {/* Mobile sidebar — fixed overlay, toggled by DocsMobileToggle */}
          <div id="docs-mobile-sidebar" className="hidden fixed inset-0 top-14 z-40 bg-[#F4F4F0] dark:bg-[#0F0F0D] overflow-y-auto lg:hidden">
            <div className="px-4 pt-6 pb-16">
              <Sidebar />
            </div>
          </div>

          {/* Main content area */}
          <main className="flex-1 min-w-0 pt-8 lg:pt-12 pb-16">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
