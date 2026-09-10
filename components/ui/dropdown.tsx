'use client';

/**
 * Dropdown — custom select, replaces native <select> everywhere so no
 * picker shows the browser's system dropdown. Matches the app's popover
 * language exactly: white/#171714 surface, rounded-xl, ring, shadow-xl,
 * fade-in zoom-in animation, 13px menu items with accent active state.
 *
 * Positioning mirrors the tools-menu pattern: fixed layer + fixed menu
 * measured from the trigger (immune to overflow/transform clipping), click
 * away + Escape to close.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DropdownOption {
  value: string;
  label: string;
  /** Optional provider/category grouping — rendered as a small header. */
  group?: string;
}

interface DropdownProps {
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[] | string[];
  /** Left-aligned under the trigger (default) or right-aligned. */
  align?: 'left' | 'right';
  /** Trigger button classes — size/color are caller's choice. */
  className?: string;
  /** Extra classes for the menu panel (e.g. width). */
  menuClassName?: string;
  ariaLabel?: string;
  title?: string;
  disabled?: boolean;
}

export function Dropdown({
  value,
  onChange,
  options,
  align = 'left',
  className,
  menuClassName,
  ariaLabel,
  title,
  disabled,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, right: 0, width: 0 });
  const btnRef = useRef<HTMLButtonElement | null>(null);

  const normalized: DropdownOption[] = options.map((o) =>
    typeof o === 'string' ? { value: o, label: o } : o
  );
  const current = normalized.find((o) => o.value === value);

  const toggle = () => {
    if (disabled) return;
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({
        top: r.bottom + 6,
        left: r.left,
        right: window.innerWidth - r.right,
        // The menu is at least as wide as the trigger (full-width triggers
        // in forms/settings get matching menus).
        width: r.width,
      });
    }
    setOpen((v) => !v);
  };

  // Escape closes while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={title}
        className={cn(
          'flex items-center gap-1.5 text-left transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
          className
        )}
      >
        <span className="truncate">{current?.label ?? value}</span>
        <ChevronDown
          size={12}
          className={cn('shrink-0 opacity-60 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <>
          {/* Click-away layer */}
          <div className="fixed inset-0 z-[250]" onClick={() => setOpen(false)} />
          {/* Menu — canonical popover surface */}
          <div
            role="listbox"
            className={cn(
              'fixed z-[260] min-w-[10rem] p-1 rounded-xl bg-white dark:bg-[#171714] shadow-xl ring-1 ring-black/5 dark:ring-white/10 animate-in fade-in zoom-in-95 duration-100',
              menuClassName
            )}
            style={{
              top: pos.top,
              ...(align === 'left' ? { left: pos.left } : { right: pos.right }),
              minWidth: Math.max(160, pos.width),
            }}
          >
            {normalized.map((o, i) => {
              const prevGroup = i > 0 ? normalized[i - 1].group : undefined;
              return (
                <div key={o.value}>
                  {o.group && o.group !== prevGroup && (
                    <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-ink/40">
                      {o.group}
                    </p>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={o.value === value}
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-2.5 py-2 text-[13px] font-medium rounded-lg transition-colors cursor-pointer text-left',
                      o.value === value
                        ? 'bg-[var(--app-accent)]/10 text-[var(--app-accent)]'
                        : 'text-[#0F0F0D]/75 dark:text-[#F4F4F0]/75 hover:bg-[#0F0F0D]/5 dark:hover:bg-[#F4F4F0]/10 hover:text-[#0F0F0D] dark:hover:text-[#F4F4F0]'
                    )}
                  >
                    <span className="truncate">{o.label}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
