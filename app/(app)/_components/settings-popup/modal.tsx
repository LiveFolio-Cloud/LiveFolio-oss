'use client';

/**
 * Settings popup modal layer (P2-T02) — harness `SettingsRoot.SettingsPanel`
 * pattern, ported to the repo's brutalist internal-screen language.
 *
 * Mounted in the ROOT layout (`app/layout.tsx`) inside SettingsPopupProvider —
 * it survives navigation on every route, which is why SignOutButton must
 * close it explicitly before pushing to /login. This component owns the mask
 * + centered dialog. Dismiss paths: the header close button, a mask click,
 * and a document-level Escape listener mounted ONLY while open (its lifetime
 * is the panel's). Focus lands on the close button when the dialog opens.
 * The active section falls back to the first registered row when the
 * requested id is gone (mode gates can drop sections between renders).
 */
import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsPhone } from '@/lib/app-shell/use-phone';
import { useSettingsPopup } from './settings-context';
import { settingsSections } from './settings-registry';
import { SignOutButton } from './SignOutButton';

export function SettingsPopupModal() {
  const { open, activeSectionId, closePopup, setActiveSection } = useSettingsPopup();
  const titleId = useId();
  // Window-level (not store): the modal mounts in the ROOT layout on every
  // route, where the shell frame — and its store mirror — doesn't exist.
  const phone = useIsPhone();

  // Document-level Escape dismissal — mounted only while open.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePopup();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, closePopup]);

  // Baseline focus management: entering the dialog lands on the close button.
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (open) closeButtonRef.current?.focus();
  }, [open]);

  if (!open) return null;

  // Entries can unmount underneath the requested id (mode gates), so the
  // render-time projection falls back to the first row when the id is gone.
  const activeId = settingsSections.some((s) => s.id === activeSectionId)
    ? activeSectionId
    : settingsSections[0]?.id;
  const ActiveSection = settingsSections.find((s) => s.id === activeId)?.component;

  // Phones: full-screen sheet — brand header, horizontally scrollable section
  // chips (Sign out as the last chip), content scrolling below.
  // NOTE: the token utilities (bg-bone, text-ink) are scoped to lf-tokens
  // DESCENDANTS — they must sit on a child, not on the lf-tokens root.
  if (phone) {
    return (
      <div className="lf-tokens fixed inset-0 z-[300]">
        <div className="flex h-full flex-col bg-bone text-ink">
          {/* Header */}
          <div className="flex h-12 shrink-0 items-center justify-between gap-2 px-4">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 bg-[#FF3B00]" />
              <span id={titleId} className="text-sm font-semibold tracking-tight text-ink">
                LiveFolio
              </span>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={closePopup}
              aria-label="Close settings"
              title="Close (Esc)"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink/50 transition-colors hover:bg-black/5 hover:text-[var(--app-accent)]"
            >
              <X size={14} strokeWidth={2.5} />
            </button>
          </div>

          {/* Section chips — scrollable row */}
          <nav
            aria-label="Settings sections"
            className="flex shrink-0 items-center gap-1.5 overflow-x-auto px-3 pb-2"
          >
            {settingsSections.map((section) => (
              <button
                key={section.id}
                type="button"
                aria-current={section.id === activeId ? 'true' : undefined}
                onClick={() => setActiveSection(section.id)}
                className={cn(
                  'shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium tracking-tight transition-colors',
                  section.id === activeId
                    ? 'bg-[var(--app-accent)]/10 text-[var(--app-accent)]'
                    : 'text-ink/60 hover:bg-black/5 hover:text-ink'
                )}
              >
                {section.label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {ActiveSection !== undefined ? <ActiveSection /> : null}
          </div>

          {/* Sign out — its own footer bar, never squashed inside the chips */}
          <div className="shrink-0 border-t border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <SignOutButton />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="lf-tokens fixed inset-0 z-[300] flex items-center justify-center bg-black/40 p-4 sm:p-6 backdrop-blur-sm">
      {/* Mask — click to dismiss. */}
      <div className="absolute inset-0" aria-hidden="true" onClick={closePopup} />

      {/* Centered dialog: nav rail left, content right. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-[min(620px,calc(100dvh-2.5rem))] w-[min(840px,calc(100vw-2rem))] overflow-hidden rounded-2xl bg-bone text-ink shadow-lg"
      >
        {/* Nav rail — the bone-deep tint separates it from the content,
            exactly like the app-shell sidebar (no border lines). */}
        <nav className="flex w-44 shrink-0 flex-col bg-bone-deep" aria-label="Settings sections">
          <div className="flex h-12 items-center gap-2 px-4">
            <span className="inline-block h-2.5 w-2.5 bg-[#FF3B00]" />
            <span id={titleId} className="text-sm font-semibold tracking-tight text-ink">
              LiveFolio
            </span>
          </div>
          <div className="flex flex-col p-2">
            {settingsSections.map((section) => (
              <button
                key={section.id}
                type="button"
                aria-current={section.id === activeId ? 'true' : undefined}
                onClick={() => setActiveSection(section.id)}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium tracking-tight transition-colors',
                  section.id === activeId
                    ? 'bg-[var(--app-accent)]/10 text-[var(--app-accent)]'
                    : 'text-ink/60 hover:bg-black/5 hover:text-ink'
                )}
              >
                <section.icon size={15} strokeWidth={2.5} className="shrink-0" />
                <span className="leading-tight">{section.label}</span>
              </button>
            ))}
          </div>
          {/* Sign out — pinned to the rail bottom, above the fold */}
          <div className="mt-auto p-2">
            <SignOutButton />
          </div>
        </nav>

        {/* Content column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 items-center justify-end gap-2 px-4">
            <button
              ref={closeButtonRef}
              type="button"
              onClick={closePopup}
              aria-label="Close settings"
              title="Close (Esc)"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink/50 transition-colors hover:bg-black/5 hover:text-[var(--app-accent)]"
            >
              <X size={14} strokeWidth={2.5} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {ActiveSection !== undefined ? <ActiveSection /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
