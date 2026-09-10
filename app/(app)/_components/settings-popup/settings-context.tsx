'use client';

/**
 * Settings popup open-state context (P2-T02).
 *
 * The popup's open state is component-local (harness `SettingsRoot.tsx`
 * pattern) — but the "component" here spans the shell: the trigger lives in
 * the sidebar slot (P1-T01 gear, header) while the modal lives in the frame's
 * overlay slot. The provider therefore wraps the whole AppShellFrame in
 * `app/(app)/layout.tsx`, and any slot reads/writes through it:
 *
 * - The modal reads `open` + `activeSectionId`.
 * - A trigger (sidebar gear, header) calls `openPopup(sectionId?)`.
 * - Nav rows call `setActiveSection` while open (no open-state change).
 * - `openSection(id)` is the "gear → specific section" / future `/settings`
 *   deep-link entry point.
 *
 * Closing resets the active section (harness `close` semantics), so the next
 * open starts on the first section unless a section id is passed.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLayoutStore } from '@/lib/app-shell/layout-store';

export interface SettingsPopupApi {
  /** Whether the settings popup is currently open. */
  open: boolean;
  /** The active section id; undefined until a selection or explicit open. */
  activeSectionId: string | undefined;
  /** Open the popup, optionally landing on a given section id. */
  openPopup: (sectionId?: string) => void;
  /** Close the popup and reset the active section. */
  closePopup: () => void;
  /** Open the popup on a specific section (trigger-with-section use case). */
  openSection: (sectionId: string) => void;
  /** Switch the active section without touching the open state (nav rows). */
  setActiveSection: (sectionId: string) => void;
}

const SettingsPopupContext = createContext<SettingsPopupApi | null>(null);

export function SettingsPopupProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<string | undefined>(undefined);
  // Mobile: the settings sheet replaces the sidebar drawer — remember whether
  // the drawer was up so closing settings puts the user back where they were.
  const drawerWasOpen = useRef(false);

  const openPopup = useCallback((sectionId?: string) => {
    const s = useLayoutStore.getState();
    drawerWasOpen.current = s.phone && s.drawerOpen;
    if (drawerWasOpen.current) s.closeDrawer();
    if (sectionId !== undefined) setActiveSectionId(sectionId);
    setOpen(true);
  }, []);

  const closePopup = useCallback(() => {
    if (drawerWasOpen.current) {
      useLayoutStore.getState().openDrawer();
      drawerWasOpen.current = false;
    }
    setOpen(false);
    setActiveSectionId(undefined);
  }, []);

  const openSection = useCallback((sectionId: string) => {
    const s = useLayoutStore.getState();
    drawerWasOpen.current = s.phone && s.drawerOpen;
    if (drawerWasOpen.current) s.closeDrawer();
    setActiveSectionId(sectionId);
    setOpen(true);
  }, []);

  const setActiveSection = useCallback((sectionId: string) => {
    setActiveSectionId(sectionId);
  }, []);

  const value = useMemo(
    () => ({ open, activeSectionId, openPopup, closePopup, openSection, setActiveSection }),
    [open, activeSectionId, openPopup, closePopup, openSection, setActiveSection]
  );

  return (
    <SettingsPopupContext.Provider value={value}>{children}</SettingsPopupContext.Provider>
  );
}

export function useSettingsPopup(): SettingsPopupApi {
  const ctx = useContext(SettingsPopupContext);
  if (ctx === null) {
    throw new Error('useSettingsPopup must be used within <SettingsPopupProvider>');
  }
  return ctx;
}
