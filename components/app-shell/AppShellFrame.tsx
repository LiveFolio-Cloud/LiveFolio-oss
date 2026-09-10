'use client';

/**
 * Three-column shell frame for the `/app` route group: sidebar | center |
 * details, with an overlay layer on top. Ported from the deepseek-harness
 * `AppFrame.tsx`:
 *
 * - Owns the grid tracks (inline gridTemplateColumns from the concession
 *   solve), the drag handles (pointer capture + rAF), and the narrow-viewport
 *   decision (viewport < SIDEBAR_AUTO_COLLAPSE → auto-collapse to the rail).
 * - The frame box (not the window) is tracked with a rAF-throttled
 *   ResizeObserver so embedded/resized contexts stay correct.
 * - The sidebar slot renders HERE with live parameters from the concession
 *   solve (render-prop contract from phase-1: sidebar receives
 *   `{ collapsed, width }`). `center`, `details` and `overlay` are plain
 *   ReactNode slots. The details column stays mounted at zero width when
 *   closed (never unmounts); the collapsed sidebar keeps its compact rail.
 * - Styling follows the repo's internal-screen convention: `lf-tokens`
 *   scope + bone/ink tokens + vermillion accents (see app/globals.css).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  computeColumns,
  MOBILE_DRAWER_MAX,
  PHONE_BREAKPOINT,
  SIDEBAR_AUTO_COLLAPSE,
  SIDEBAR_DEFAULT,
} from '@/lib/app-shell/columns';
import { useLayoutStore } from '@/lib/app-shell/layout-store';
import { DragHandle } from './DragHandle';
import { MobileSidebarDrawer } from './MobileSidebarDrawer';

/** Params the frame resolves and hands to the sidebar slot render-prop. */
export interface SidebarSlotProps {
  collapsed: boolean;
  width: number;
}

export interface AppShellFrameProps {
  /** Rendered inside the left column; receives live collapse/width params. */
  sidebar: (props: SidebarSlotProps) => ReactNode;
  /** Center column content (the page; tab bar consumer arrives in P1-T02). */
  center: ReactNode;
  /** Overlay layer for the settings popup (P2-T02) and dialogs. */
  overlay?: ReactNode;
  /** Optional details column occupant (300–520px, closes to 0 without unmounting). */
  details?: ReactNode;
}

/**
 * SSR-safe initial viewport: constant on both server and client (no hydration
 * mismatch); the ResizeObserver corrects it on the first client frame.
 */
const SSR_VIEWPORT_FALLBACK = 1440;

export function AppShellFrame({ sidebar, center, overlay, details }: AppShellFrameProps) {
  const panels = useLayoutStore();
  const setNarrow = useLayoutStore((s) => s.setNarrow);
  const setPhone = useLayoutStore((s) => s.setPhone);
  const setSidebar = useLayoutStore((s) => s.setSidebar);
  const setDetails = useLayoutStore((s) => s.setDetails);
  const drawerOpen = useLayoutStore((s) => s.drawerOpen);
  const openDrawer = useLayoutStore((s) => s.openDrawer);
  const closeDrawer = useLayoutStore((s) => s.closeDrawer);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState(SSR_VIEWPORT_FALLBACK);

  // Track the frame's own box (not the window): rAF-throttled ResizeObserver.
  useEffect(() => {
    const el = frameRef.current;
    if (el === null) return;
    let raf: number | null = null;
    const observer = new ResizeObserver(() => {
      raf ??= requestAnimationFrame(() => {
        raf = null;
        const width = el.getBoundingClientRect().width;
        if (width > 0) setViewport(width);
      });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, []);

  // Narrow viewports auto-collapse the sidebar; the store mirror keeps
  // toggleSidebar's semantics right (narrow toggles flip the manual
  // re-expand override). Collapsed is decided here, so the solver stays
  // breakpoint-free: a narrow re-expand passes the preference (or the
  // default when the wide preference is closed) and center absorbs the squeeze.
  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE;
  useEffect(() => {
    setNarrow(narrow);
  }, [setNarrow, narrow]);

  // Phone tier: below PHONE_BREAKPOINT the sidebar is hidden entirely (no
  // rail) and only reachable through the full-screen drawer. Mirrored into
  // the store the same way `narrow` is; setPhone drops the drawer on any
  // breakpoint crossing.
  const phone = viewport < PHONE_BREAKPOINT;
  useEffect(() => {
    setPhone(phone);
  }, [setPhone, phone]);

  const sidebarCollapsed = narrow ? !panels.narrowExpanded : panels.sidebar === 0;
  const sidebarPreference = sidebarCollapsed
    ? 0
    : panels.sidebar === 0
      ? SIDEBAR_DEFAULT
      : panels.sidebar;
  // Phones bypass the solver entirely: the 56px rail must not exist below
  // 768, so the center takes the whole frame.
  const cols = phone
    ? { sidebar: 0, center: viewport, details: 0 }
    : computeColumns(viewport, sidebarPreference, panels.details);
  const colsRef = useRef(cols);
  colsRef.current = cols;

  // The drag base is the rendered width captured at drag start (grabbing a
  // concession-clamped panel must not jump back to the stored preference);
  // it stays frozen for the whole gesture so dx deltas do not compound.
  const sidebarBase = useRef(0);
  const detailsBase = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [detailsHovered, setDetailsHovered] = useState(false);

  const onDragEnd = useCallback(() => {
    setDragging(false);
  }, []);
  const onSidebarStart = useCallback(() => {
    sidebarBase.current = colsRef.current.sidebar;
    setDragging(true);
  }, []);
  const onDetailsStart = useCallback(() => {
    detailsBase.current = colsRef.current.details;
    setDragging(true);
  }, []);
  const onSidebarDrag = useCallback(
    (dx: number) => {
      setSidebar(sidebarBase.current + dx);
    },
    [setSidebar]
  );
  const onDetailsDrag = useCallback(
    (dx: number) => {
      setDetails(detailsBase.current - dx);
    },
    [setDetails]
  );

  return (
    <div
      ref={frameRef}
      className={cn(
        'app-shell lf-tokens relative grid h-dvh w-full select-none overflow-hidden bg-bone text-ink'
      )}
      style={{ gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr) ${cols.details}px` }}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-details-collapsed={cols.details === 0 || undefined}
      data-dragging={dragging || undefined}
    >
      {/* Sidebar column: fixed preference width or the compact rail when
          collapsed; the slot stays mounted in both states. The bone-deep
          tint (not a border) is what separates the rail from the center.
          On phones the column is 0px and empty — the only sidebar mount
          lives in the full-screen drawer below. */}
      <div className="min-w-0 overflow-hidden bg-bone-deep">
        {!phone && sidebar({ collapsed: sidebarCollapsed, width: cols.sidebar })}
      </div>
      {/* Center column: absorbs the resize deficit (the solver's last resort). */}
      <div className="flex min-w-0 flex-col overflow-hidden bg-bone">{center}</div>
      {/* Details column: closes to width 0 WITHOUT unmounting; its border
          must not paint a 1px seam while visually closed. Same tint as the
          sidebar rail. */}
      <div
        className="min-w-0 overflow-hidden bg-bone-deep data-[details-collapsed]:bg-transparent"
        onPointerEnter={() => setDetailsHovered(true)}
        onPointerLeave={() => setDetailsHovered(false)}
      >
        {details}
      </div>
      {/* Overlay layer: shell.overlay — settings popup (P2-T02) and dialogs.
          Pointer-events are off on the mask so the shell stays interactive
          until an overlay child opts in. */}
      <div className="pointer-events-none absolute inset-0 z-40 [&>*]:pointer-events-auto">
        {overlay}
      </div>
      {/* Floating hamburger (phones): the only entry into the sidebar. The
          frame already starts below the notch (html carries the top safe-area
          inset), so no extra top offset is needed. Covered by the drawer's
          scrim when open. */}
      {phone && (
        <button
          type="button"
          onClick={openDrawer}
          aria-label="Open sidebar"
          aria-expanded={drawerOpen}
          className="absolute left-3 top-3 z-30 flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl bg-bone text-ink/70 shadow-lg ring-1 ring-black/10 transition-colors hover:text-[var(--app-accent)]"
        >
          <Menu className="h-4 w-4" />
        </button>
      )}
      {/* Mobile drawer (phones): always mounted, translated off-canvas; the
          sidebar mounts here exactly once (no double data-fetching) with the
          expanded variant so all tour targets and actions exist. */}
      {phone && (
        <MobileSidebarDrawer open={drawerOpen} onClose={closeDrawer}>
          {sidebar({ collapsed: false, width: Math.min(MOBILE_DRAWER_MAX, viewport) })}
        </MobileSidebarDrawer>
      )}
      {/* The collapsed rail is fixed-width: no resize handle while closed. */}
      {!phone && !sidebarCollapsed && (
        <DragHandle
          side="sidebar"
          left={cols.sidebar}
          onStart={onSidebarStart}
          onDrag={onSidebarDrag}
          onEnd={onDragEnd}
        />
      )}
      {cols.details > 0 && (
        <DragHandle
          side="details"
          left={viewport - cols.details}
          visible={detailsHovered}
          onStart={onDetailsStart}
          onDrag={onDetailsDrag}
          onEnd={onDragEnd}
        />
      )}
    </div>
  );
}
