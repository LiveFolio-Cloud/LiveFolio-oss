/**
 * Transient layout store for the AppShellFrame: panel geometry as plain width
 * preferences in px (0 = closed). NOT persisted — the shell's transient
 * chrome state, following the deepseek-harness `createLayoutStore` semantics:
 *
 * - The preference IS the width: closing a panel forgets its drag width;
 *   reopening restores the contract default.
 * - Drag writes clamp into the panel's contract range and never cross the
 *   open/closed line; open/close transitions write 0 / the default explicitly.
 * - Below the auto-collapse breakpoint (AppShellFrame feeds setNarrow) the
 *   sidebar toggle flips the `narrowExpanded` override instead of the width
 *   preference, so re-widening restores the pre-squeeze layout untouched.
 *
 * Deliberate: the sidebar ALWAYS starts expanded on a fresh load (desktop).
 * A collapsed preference is never read back from localStorage — reading it
 * at store init would make SSR (which renders the open sidebar — the server
 * cannot see localStorage) flash closed after hydration.
 */
import { create } from 'zustand';
import {
  clampWidth,
  DETAILS_DEFAULT,
  DETAILS_MAX,
  DETAILS_MIN,
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
} from './columns';

/** Legacy key written by the old v1 UI (studio side) — kept for compat. */
const SIDEBAR_COLLAPSED_KEY = 'LiveFolio_sidebar_collapsed';

function writeCollapsedPref(collapsed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? 'true' : 'false');
  } catch {
    // storage unavailable (private mode etc.) — the shell still works, just
    // without the carry-over flag.
  }
}

export interface LayoutState {
  /** Sidebar width preference in px; 0 = collapsed (rail). */
  sidebar: number;
  /** Details width preference in px; 0 = closed (kept mounted at width 0). */
  details: number;
  /** Mirror of the frame's breakpoint reading (viewport < SIDEBAR_AUTO_COLLAPSE). */
  narrow: boolean;
  /** Manual re-expand override while narrow; dropped on breakpoint crossing. */
  narrowExpanded: boolean;
  /** Mirror of the frame's phone reading (viewport < PHONE_BREAKPOINT). */
  phone: boolean;
  /** Mobile drawer open state (phones only); dropped on breakpoint crossing. */
  drawerOpen: boolean;
  setSidebar: (px: number) => void;
  setDetails: (px: number) => void;
  toggleSidebar: () => void;
  setNarrow: (narrow: boolean) => void;
  setPhone: (phone: boolean) => void;
  openDrawer: () => void;
  closeDrawer: () => void;
  openDetails: () => void;
  closeDetails: () => void;
}

export const useLayoutStore = create<LayoutState>()((set) => ({
  sidebar: SIDEBAR_DEFAULT,
  details: 0,
  narrow: false,
  narrowExpanded: false,
  phone: false,
  drawerOpen: false,
  setSidebar: (px) => set({ sidebar: clampWidth(px, SIDEBAR_MIN, SIDEBAR_MAX) }),
  setDetails: (px) => set({ details: clampWidth(px, DETAILS_MIN, DETAILS_MAX) }),
  // Phone toggles flip the drawer; narrow toggles flip only the override:
  // the width preference survives untouched, so re-widening restores the
  // pre-squeeze layout.
  toggleSidebar: () =>
    set((s) => {
      if (s.phone) return { drawerOpen: !s.drawerOpen };
      if (s.narrow) return { narrowExpanded: !s.narrowExpanded };
      const collapsed = s.sidebar === 0;
      writeCollapsedPref(!collapsed);
      return { sidebar: collapsed ? SIDEBAR_DEFAULT : 0 };
    }),
  // Crossing the breakpoint in either direction drops the override: the
  // narrow default is auto-collapsed, the wide state is the preference.
  setNarrow: (narrow) =>
    set((s) => (s.narrow === narrow ? s : { narrow, narrowExpanded: false })),
  // Crossing the phone breakpoint drops the drawer so no leftover scrim
  // survives a resize (mirrors setNarrow dropping narrowExpanded).
  setPhone: (phone) =>
    set((s) => (s.phone === phone ? s : { phone, drawerOpen: false })),
  openDrawer: () => set({ drawerOpen: true }),
  closeDrawer: () => set({ drawerOpen: false }),
  openDetails: () => set((s) => (s.details === 0 ? { details: DETAILS_DEFAULT } : s)),
  closeDetails: () => set({ details: 0 }),
}));
