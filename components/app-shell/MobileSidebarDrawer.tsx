'use client';

/**
 * Mobile sidebar drawer (phone tier) — full-screen off-canvas panel for the
 * WorkspaceSidebar, mounted as the last child of AppShellFrame so it stacks
 * above the frame's overlay layer (z-50 vs z-40).
 *
 * - The sidebar mounts ONCE inside this always-mounted container and stays
 *   alive across open/close (CSS translate only), so its self-fetched data
 *   and search/accordion state survive.
 * - Full screen per product decision: phones get the whole viewport for the
 *   sidebar, not a partial-width drawer.
 * - No body scroll lock needed: the shell is a fixed h-dvh overflow-hidden
 *   frame; the only scrollable region is the sidebar's own list.
 * - Dismiss paths: scrim tap, Escape, an X in the sidebar header
 *   (WorkspaceSidebar's onCloseDrawer prop), and route navigation.
 */
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export function MobileSidebarDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Close on route navigation (e.g. picking a folio from the drawer).
  useEffect(() => {
    onClose();
  }, [pathname, onClose]);

  // Escape dismisses — same lifetime pattern as the settings modal.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  // Baseline focus management: landing in the drawer focuses the panel.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  return (
    <div className={cn('absolute inset-0 z-50', !open && 'pointer-events-none')}>
      {/* Scrim */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={cn(
          'absolute inset-0 bg-black/30 transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      />
      {/* Panel — full screen; translated off-frame and inert while closed */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Workspace sidebar"
        tabIndex={-1}
        inert={!open}
        className={cn(
          'absolute inset-y-0 left-0 w-full bg-bone-deep outline-none transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Safe-area clearance for the home indicator (html already pads the
            top inset; only the bottom needs explicit space here). */}
        <div className="flex h-full flex-col pb-[env(safe-area-inset-bottom)]">
          {children}
        </div>
      </div>
    </div>
  );
}
