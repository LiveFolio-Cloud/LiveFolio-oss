'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLayoutStore } from '@/lib/app-shell/layout-store';

/**
 * One-time onboarding tour — Apple-style coach marks over the /app shell.
 * A real walkthrough: build with AI → pick a format → create a folio →
 * create a workspace → connect your agent (MCP) → share your work.
 * Shows once (localStorage-gated), skippable, dismissible.
 *
 * The tour MOVES the shell to the target: sidebar steps auto-open the
 * mobile drawer (or expand the rail on desktop) so the spotlight lands on
 * the actual control being explained, then re-measures after the slide.
 *
 * Colors are literal vermillion (#FF3B00) — the tour mounts outside every
 * token scope, so it must not depend on var(--app-accent) resolution.
 *
 * Mobile-friendly by design:
 * - Phones render the coach card as a bottom-sheet (full-width, safe-area
 *   padding) instead of the floating desktop card.
 * - Explicit Back/Next arrow buttons + dots are the ONLY navigation (the old
 *   invisible tap-to-advance catcher is gone), plus keyboard: Escape
 *   dismisses, ArrowLeft/ArrowRight navigate.
 * - A step whose target is still missing shows the SAME step as a centered
 *   no-spotlight card instead of silently ending the tour.
 * - The overlay re-measures on resize/orientation and shortly after the
 *   sidebar drawer opens, so spotlights follow the target.
 */
const TOUR_KEY = 'livefolio_tour_v2';

interface TourStep {
  target: string;
  title: string;
  body: string;
  /** Targets that live in the expanded sidebar — the tour reveals them. */
  sidebarTarget?: boolean;
}

const STEPS: TourStep[] = [
  {
    target: 'hero-composer',
    title: 'Build with AI',
    body: 'Describe what you want to build and LiveFolio creates it — decks, documents, dashboards. Type a prompt and press Send.',
  },
  {
    target: 'hero-templates',
    title: 'Pick a format',
    body: 'Choose a template to steer the result — Presentation, Document, Spreadsheet, Dashboard or Infographic.',
  },
  {
    target: 'sidebar-new-folio',
    sidebarTarget: true,
    title: 'Create a folio',
    body: 'The New folio button opens the creation menu — start from a template, an HTML file, or AI. Folios are versioned and shareable.',
  },
  {
    target: 'sidebar-new-workspace',
    sidebarTarget: true,
    title: 'Create a workspace',
    body: 'Group your folios into workspaces — teams, clients, projects. Add one here and drag folios into it.',
  },
  {
    target: 'sidebar-settings',
    sidebarTarget: true,
    title: 'Connect your agent',
    body: 'Settings → Integrations: point Claude, ChatGPT or any MCP agent at LiveFolio and let it publish folios for you.',
  },
  {
    target: 'sidebar-profile',
    sidebarTarget: true,
    title: 'Share your work',
    body: 'Your public profile collects everything you publish. Pin a favorite and share the link — one page, all your work.',
  },
];

export default function OnboardingTour() {
  const [step, setStep] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [missing, setMissing] = useState(false);
  const [cardSide, setCardSide] = useState<'top' | 'bottom'>('bottom');
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Shell state: phone flips the card presentation; drawer/narrow flips move
  // the spotlight targets (sidebar steps live in the expanded sidebar).
  const phone = useLayoutStore((s) => s.phone);
  const drawerOpen = useLayoutStore((s) => s.drawerOpen);
  const narrowExpanded = useLayoutStore((s) => s.narrowExpanded);
  const sidebarWidth = useLayoutStore((s) => s.sidebar);

  // Move the shell to the target: sidebar steps open the mobile drawer (or
  // expand the rail on desktop) so the spotlight lands on the real control;
  // chat steps close the drawer again.
  useEffect(() => {
    if (step === null) return;
    const s = useLayoutStore.getState();
    const target = STEPS[step];
    if (target.sidebarTarget) {
      if (s.phone && !s.drawerOpen) s.openDrawer();
      else if (!s.phone && ((s.narrow && !s.narrowExpanded) || (!s.narrow && s.sidebar === 0))) {
        s.toggleSidebar();
      }
    } else if (s.phone && s.drawerOpen) {
      s.closeDrawer();
    }
  }, [step]);

  // Show once, after the shell settles (so targets have laid out).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem(TOUR_KEY)) return;
    const timer = setTimeout(() => setStep(0), 900);
    return () => clearTimeout(timer);
  }, []);

  const done = useCallback(() => {
    try { localStorage.setItem(TOUR_KEY, '1'); } catch { /* fine */ }
    setStep(null);
  }, []);

  const goNext = useCallback(() => {
    setStep((s) => {
      if (s === null) return s;
      if (s >= STEPS.length - 1) {
        // Completion: mark seen before hiding so the tour never re-shows.
        try { localStorage.setItem(TOUR_KEY, '1'); } catch { /* fine */ }
        return null;
      }
      return s + 1;
    });
  }, []);

  const goBack = useCallback(() => {
    setStep((s) => (s === null || s <= 0 ? s : s - 1));
  }, []);

  // Measure the current target. Missing covers both "not mounted" (hero
  // composer on a folio page) and "off-screen" (a drawer translated away or a
  // target under the collapsed rail) — either way the step keeps its copy and
  // falls back to the centered presentation instead of skipping.
  const measure = useCallback(() => {
    if (step === null) return;
    const el = document.getElementById(STEPS[step].target);
    if (el === null) {
      setMissing(true);
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const offViewport =
      r.width === 0 ||
      r.height === 0 ||
      r.right <= 0 ||
      r.left >= window.innerWidth ||
      r.bottom <= 0 ||
      r.top >= window.innerHeight;
    if (offViewport) {
      setMissing(true);
      setRect(null);
      return;
    }
    setMissing(false);
    setRect(r);
    setCardSide(window.innerHeight - r.bottom < 260 ? 'top' : 'bottom');
  }, [step]);

  // Measure on step change; re-measure on resize/orientation.
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  // Follow the sidebar: when the drawer, narrow-expand or sidebar-width
  // state flips, wait for the panel slide (200ms) before re-measuring so the
  // spotlight lands on the now-visible target.
  useEffect(() => {
    if (step === null) return;
    const t = setTimeout(measure, 250);
    return () => clearTimeout(t);
  }, [step, phone, drawerOpen, narrowExpanded, sidebarWidth, measure]);

  // Keyboard navigation while the tour is up. The settings modal's Escape
  // listener (root layout) is a harmless no-op when its modal is closed.
  useEffect(() => {
    if (step === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') done();
      else if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goBack();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [step, done, goNext, goBack]);

  // Focus the card so arrow keys land without an extra click.
  useEffect(() => {
    if (step !== null) cardRef.current?.focus();
  }, [step]);

  if (step === null || (rect === null && !missing)) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const cardContent = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#FF3B00]">
          {step + 1} / {STEPS.length}
        </span>
        <button
          type="button"
          onClick={done}
          className="text-xs font-medium text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40 hover:text-[#0F0F0D] dark:hover:text-[#F4F4F0] transition-colors cursor-pointer"
        >
          Skip
        </button>
      </div>
      <h3 className="mt-2 text-base font-bold tracking-tight text-[#0F0F0D] dark:text-[#F4F4F0]">{current.title}</h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60">{current.body}</p>
      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-1.5 rounded-full transition-all duration-200',
                i === step ? 'w-5 bg-[#FF3B00]' : 'w-1.5 bg-[#0F0F0D]/15 dark:bg-[#F4F4F0]/20',
              )}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 0}
            aria-label="Previous step"
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-lg border border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 text-ink/70 transition-colors cursor-pointer',
              step === 0
                ? 'opacity-30 pointer-events-none'
                : 'hover:bg-black/5 hover:text-[#FF3B00]'
            )}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={goNext}
            className="flex h-8 items-center gap-1.5 px-4 rounded-lg bg-[#FF3B00] text-white text-xs font-semibold hover:bg-[#0F0F0D] dark:hover:bg-[#F4F4F0] dark:hover:text-[#0F0F0D] transition-colors cursor-pointer"
          >
            {isLast ? 'Done' : 'Next'}
            {!isLast && <ArrowRight className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </>
  );

  // Phone: bottom-sheet card, no spotlight.
  if (phone) {
    return (
      <div className="fixed inset-0 z-[400] pointer-events-none">
        <div className="absolute inset-x-0 bottom-0 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pointer-events-auto">
          <div
            ref={cardRef}
            role="dialog"
            aria-modal="true"
            aria-label={current.title}
            tabIndex={-1}
            className="w-full rounded-2xl bg-white dark:bg-[#171714] p-4 shadow-xl ring-1 ring-black/5 dark:ring-white/10 outline-none animate-in slide-in-from-bottom duration-200"
          >
            {cardContent}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[400] pointer-events-none">
      {/* Spotlight hole: dims everything except the target. The overlay stays
          pointer-transparent so the app underneath stays interactive — the
          explicit card buttons are the only navigation. */}
      {!missing && rect && (
        <div
          className="pointer-events-none absolute rounded-xl"
          style={{
            left: rect.left - 8,
            top: rect.top - 8,
            width: rect.width + 16,
            height: rect.height + 16,
            boxShadow: '0 0 0 100vmax rgba(15,15,13,0.45)',
            borderRadius: 14,
          }}
        />
      )}

      {/* Coach card — floating beside the target, centered when the target
          is missing, always clamped to the viewport. */}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={current.title}
        tabIndex={-1}
        className={cn(
          'absolute w-80 max-w-[calc(100vw-2rem)] rounded-2xl bg-white dark:bg-[#171714] p-4 shadow-xl ring-1 ring-black/5 dark:ring-white/10 outline-none animate-in fade-in zoom-in-95 duration-200 pointer-events-auto',
          !missing && rect
            ? 'left-1/2 -translate-x-1/2'
            : 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2'
        )}
        style={
          !missing && rect
            ? cardSide === 'bottom'
              ? { top: rect.bottom + 16 }
              : { bottom: window.innerHeight - rect.top + 16 }
            : undefined
        }
      >
        {cardContent}
      </div>
    </div>
  );
}
