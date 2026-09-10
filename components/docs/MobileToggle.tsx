"use client";

import { useState, useEffect, useCallback } from "react";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function DocsMobileToggle() {
  const [open, setOpen] = useState(false);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      const sidebar = document.getElementById("docs-mobile-sidebar");
      if (sidebar) sidebar.classList.toggle("hidden", !next);
      return next;
    });
  }, []);

  // Lock body scroll when open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // Close on link click inside sidebar
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      const sidebar = document.getElementById("docs-mobile-sidebar");
      if (target.closest("a") && sidebar?.contains(target)) {
        setOpen(false);
        sidebar.classList.add("hidden");
      }
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [open]);

  return (
    <button
      onClick={toggle}
      aria-label={open ? "Close menu" : "Open menu"}
      className={cn(
        "p-2 border transition-colors shrink-0 focus-visible:ring-2 focus-visible:ring-[#FF3B00] focus-visible:outline-none",
        "rounded-lg border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10",
        open
          ? "bg-[#FF3B00] text-[#F4F4F0] border-[#FF3B00]"
          : "text-[#0F0F0D] dark:text-[#F4F4F0] hover:bg-[#0F0F0D]/5 dark:hover:bg-[#F4F4F0]/10"
      )}
    >
      {open ? <X size={16} /> : <Menu size={16} />}
    </button>
  );
}
