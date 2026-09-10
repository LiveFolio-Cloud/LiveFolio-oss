'use client';

/**
 * Route-group layout for `/app` and `/app/[folioId]` — the resident app shell.
 *
 * Structure: the `(app)` group is organizational only; the `/app` URL segment
 * comes from the inner `app/` folder (`app/(app)/app/page.tsx` → `/app`,
 * `app/(app)/app/[folioId]/page.tsx` → `/app/[folioId]`). Pages directly
 * inside the group would resolve to `/` and `/[folioId]` — colliding with the
 * root landing and swallowing top-level paths respectively (verified in the
 * routes-manifest during P1-T00; hence the inner segment).
 *
 * This layout renders the three-column AppShellFrame and NEVER remounts on
 * navigation between /app routes (route-group layout persistence is the
 * whole point: the shell survives, only the center page swaps). The frame's
 * slots follow the phase-1 shared contract: `sidebar` is a render-prop that
 * receives `{ collapsed, width }`, `center` is the page content (the tab bar
 * consumer arrives in P1-T02), `overlay` hosts the settings popup (P2-T02).
 *
 * The layout is a client component because the sidebar slot is a render-prop
 * (not serializable across the RSC boundary); the pages underneath stay
 * server components.
 */
import { Suspense, useEffect } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShellFrame } from '@/components/app-shell/AppShellFrame';
import { WorkspaceSidebar } from '@/app/(app)/_components/workspace-sidebar';
import OnboardingTour from '@/components/app-shell/OnboardingTour';
import { HandleClaimOverlay } from '@/components/app-shell/HandleClaimOverlay';
import { useSettingsPopup } from '@/app/(app)/_components/settings-popup';
import { useLayoutStore } from '@/lib/app-shell/layout-store';
import { isCloud } from '@/lib/env';

/**
 * Stripe Connect onboarding return path: `/app?stripe_connect=refresh|return`
 * (the refresh/return URLs configured on the account link). Landing here
 * opens the Earnings section so the creator can check their new status.
 * useSearchParams needs a Suspense boundary during prerender.
 */
function StripeConnectEarningsRedirect() {
  const params = useSearchParams();
  const { openSection } = useSettingsPopup();
  useEffect(() => {
    const v = params.get('stripe_connect');
    if (v === 'refresh' || v === 'return') openSection('earnings');
  }, [params, openSection]);
  return null;
}

/**
 * The frame itself lives INSIDE the settings provider so both slots can reach
 * the popup context: the sidebar's gear (P1-T01 `onOpenSettings` contract)
 * and the overlay's modal. The provider must wrap the frame element, so the
 * hook is consumed here rather than in the layout body.
 */
function ShellFrameWithSettings({ children }: { children: ReactNode }) {
  const { openPopup } = useSettingsPopup();
  const phone = useLayoutStore((s) => s.phone);
  const closeDrawer = useLayoutStore((s) => s.closeDrawer);
  return (
    <>
      <Suspense fallback={null}>
        <StripeConnectEarningsRedirect />
      </Suspense>
      <AppShellFrame
      sidebar={(props) => (
        <WorkspaceSidebar
          {...props}
          onOpenSettings={() => openPopup()}
          // Drawer-only affordance: the grid sidebar (desktop) keeps its
          // collapse toggle; the drawer mount (phones) swaps it for an X.
          onCloseDrawer={phone ? closeDrawer : undefined}
        />
      )}
      center={children}
      />
    </>
  );
}

export default function AppShellLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ShellFrameWithSettings>{children}</ShellFrameWithSettings>
      {/* Cloud-only overlays: the coach tour narrates AI-chat creation and the
          public profile; handle claim needs @username + /api/handles — none
          exist in OSS (its landing owns local onboarding copy). */}
      {isCloud && (
        <>
          <OnboardingTour />
          {/* First-login handle claim (shows only while profiles.username is null) */}
          <HandleClaimOverlay />
        </>
      )}
    </>
  );
}
