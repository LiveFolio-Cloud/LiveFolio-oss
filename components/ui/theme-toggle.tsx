'use client';

import { useState, useEffect, useCallback } from 'react';
import { Sun, Moon } from 'lucide-react';
import { cn } from '@/lib/utils';

type Theme = 'light' | 'dark';

function getStoredTheme(): Theme | null {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem('livefolio-theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return null;
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<Theme>('light');
  const [mounted, setMounted] = useState(false);

  // Reflect the theme that the layout's bootstrap script already applied.
  // We READ the current state (the <html> class / stored value) rather than
  // re-deriving from the OS here — deriving on mount is what caused the theme
  // to flip on first avatar-click, since this component only mounts when the
  // profile dropdown opens.
  useEffect(() => {
    const isDark = document.documentElement.classList.contains('dark');
    setTheme(isDark ? 'dark' : 'light');
    setMounted(true);

    // Keep following system changes only while the user hasn't chosen explicitly.
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      if (!getStoredTheme()) {
        const next: Theme = e.matches ? 'dark' : 'light';
        setTheme(next);
        applyTheme(next);
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('livefolio-theme', next);
      applyTheme(next);
      return next;
    });
  }, []);

  // Avoid hydration mismatch by rendering a placeholder until mounted
  if (!mounted) {
    return compact ? (
      <button
        type="button"
        className="flex h-7 w-7 items-center justify-center rounded-lg text-ink/60"
        aria-label="Theme"
        title="Theme"
      >
        <Sun size={14} />
      </button>
    ) : (
      <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-bold text-zinc-600 dark:text-zinc-300">
        <Sun size={14} className="text-zinc-400 dark:text-zinc-500" />
        <span>Theme</span>
      </div>
    );
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggle}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-ink/60 transition-colors hover:bg-black/5 hover:text-[var(--app-accent)] dark:hover:bg-white/10"
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      >
        {theme === 'dark' ? (
          <Sun size={14} className="text-[var(--app-accent)]" />
        ) : (
          <Moon size={14} className="text-[var(--app-accent)]" />
        )}
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      className={cn(
        "w-full flex items-center gap-2.5 px-3 py-2 text-sm font-bold transition-colors",
        "rounded-lg tracking-tight text-[#0F0F0D] dark:text-[#F4F4F0] hover:text-[var(--app-accent)]"
      )}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? (
        <Sun size={14} className={cn("shrink-0", "text-[var(--app-accent)]")} />
      ) : (
        <Moon size={14} className={cn("shrink-0", "text-[var(--app-accent)]")} />
      )}
      <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
    </button>
  );
}
