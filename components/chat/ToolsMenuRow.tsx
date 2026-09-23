'use client';

import { useRef, useState, type ComponentType } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Tools-menu pieces shared by both chat surfaces.
 *
 * `ToolsMenuRow` and `useToolsMenu` were copy-pasted between `ChatHero` and
 * `FolioChatPanel`. Both were character-identical (verified by an
 * indentation-insensitive diff of the two regions, not by eye) — the row was
 * 37 lines each, and the anchor math matched exactly. They live together here
 * because they are one widget: the ➕ button, its popup position, and the rows
 * inside the popup.
 */

/** Labeled row for the composer's tools menu (Apple-style, borderless).
 *  Same component as FolioChatPanel / folio ChatPanel — one menu everywhere. */
export function ToolsMenuRow({
  icon: Icon,
  label,
  onClick,
  active,
  disabled,
  hasIndicator,
}: {
  icon: ComponentType<{ size?: number | string; className?: string }>;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  hasIndicator?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full flex items-center gap-2.5 px-2.5 py-2 text-[13px] font-medium rounded-lg transition-colors cursor-pointer text-left disabled:opacity-40 disabled:cursor-not-allowed',
        active
          ? 'bg-[var(--app-accent)]/10 text-[var(--app-accent)]'
          : 'text-[#0F0F0D]/75 dark:text-[#F4F4F0]/75 hover:bg-[#0F0F0D]/5 dark:hover:bg-[#F4F4F0]/10 hover:text-[#0F0F0D] dark:hover:text-[#F4F4F0]',
      )}
    >
      <Icon size={14} className="shrink-0 text-[#0F0F0D]/45 dark:text-[#F4F4F0]/45" />
      <span className="truncate">{label}</span>
      {active ? (
        <Check size={12} className="ml-auto shrink-0 text-[var(--app-accent)]" />
      ) : hasIndicator ? (
        <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--app-accent)]" />
      ) : null}
    </button>
  );
}

/**
 * Tools-menu open state plus the ➕ button anchor.
 *
 * ⚠️ `toggleToolsMenu` measures the button's viewport rect on open and places
 * the popup at `bottom: innerHeight - rect.bottom + 8`, `left: rect.left`. That
 * is load-bearing: the popup is `fixed` inside a `fixed` backdrop, so absolute
 * coordinates would collapse it against the viewport edge. Do not "simplify"
 * this into a CSS-only anchor.
 */
export function useToolsMenu() {
  const [isToolsMenuOpen, setIsToolsMenuOpen] = useState(false);
  const toolsBtnRef = useRef<HTMLButtonElement>(null);
  const [toolsMenuPos, setToolsMenuPos] = useState({ bottom: 0, left: 0 });

  // Anchor the tools menu to the ➕ button (fixed positioning needs real
  // coordinates — absolute inside a fixed backdrop would hit the viewport edge).
  const toggleToolsMenu = () => {
    if (!isToolsMenuOpen && toolsBtnRef.current) {
      const rect = toolsBtnRef.current.getBoundingClientRect();
      setToolsMenuPos({ bottom: window.innerHeight - rect.bottom + 8, left: rect.left });
    }
    setIsToolsMenuOpen(!isToolsMenuOpen);
  };

  return { isToolsMenuOpen, setIsToolsMenuOpen, toolsBtnRef, toolsMenuPos, toggleToolsMenu };
}
