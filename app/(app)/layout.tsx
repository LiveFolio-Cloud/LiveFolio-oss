'use client';

/**
 * Route-group layout for `/app` and `/app/[folioId]` — the resident app shell.
 *
 * Structure: the `(app)` group is organizational only; the `/app` URL segment
 * comes from the inner `app/` folder (`app/(app)/app/page.tsx` → `/app`,
 * `app/(app)/app/[folioId]/page.tsx` → `/app/[folioId]`). Pages directly
 * inside the group would resolve to `/` and `/[folioId]` — colliding with the
 * root landing and swallowing top-level paths respectively (verified in the
 * routes-manifest; hence the inner segment).
 *
 * This layout renders the three-column AppShellFrame and NEVER remounts on
 * navigation between /app routes (route-group layout persistence is the
 * whole point: the shell survives, only the center page swaps). The frame's
 * slots follow the phase-1 shared contract: `sidebar` is a render-prop that
 * receives `{ collapsed, width }`, `center` is the page content (the tab bar
 * consumer), `overlay` hosts the settings popup.
 *
 * The layout is a client component because the sidebar slot is a render-prop
 * (not serializable across the RSC boundary); the pages underneath stay
 * server components.
 */
import { Suspense, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppShellFrame } from '@/components/app-shell/AppShellFrame';
import { WorkspaceSidebar } from '@/app/(app)/_components/workspace-sidebar';
import OnboardingTour from '@/components/app-shell/OnboardingTour';
import { HandleClaimOverlay } from '@/components/app-shell/HandleClaimOverlay';
import { useSettingsPopup } from '@/app/(app)/_components/settings-popup';
import { useLayoutStore } from '@/lib/app-shell/layout-store';
import { isCloud } from '@/lib/env';

/**
 * Seller payout onboarding return path: `/app?payout_connect=refresh|return`
 * (the refresh/return URLs configured on the account link). Landing here
 * opens the Earnings section so the creator can check their new status.
 * useSearchParams needs a Suspense boundary during prerender.
 */
function PayoutConnectEarningsRedirect() {
  const params = useSearchParams();
  const { openSection } = useSettingsPopup();
  useEffect(() => {
    const v = params.get('payout_connect');
    if (v === 'refresh' || v === 'return') openSection('earnings');
  }, [params, openSection]);
  return null;
}

/**
 * Billing return path: `/app?billing=success|return|cancelled`.
 *
 * The checkout success/cancel URLs and the portal return_url used to
 * point at `/settings`, which has never been a route — settings is this popup
 * (the settings-context docstring already flagged `/settings` as a future
 * deep-link). Every billing flow therefore ended on a 404 even when the
 * payment succeeded.
 *
 * `return` is the portal hand-back: the customer may have changed or cancelled
 * their subscription, so the usage is re-read to reflect the new state.
 */
function BillingRedirect() {
  const params = useSearchParams();
  const router = useRouter();
  const { openSection } = useSettingsPopup();
  const handled = useRef(false);

  useEffect(() => {
    const v = params.get('billing');
    // The webhook that writes the new plan may still be in flight when the
    // browser lands here, so a server refresh re-reads it rather than showing
    // the pre-checkout plan.
    if (v === 'success' || v === 'return') router.refresh();
    if (v === 'success' || v === 'return' || v === 'cancelled') openSection('billing');
    if (!v || handled.current) return;
    handled.current = true;

    // Drop the one-shot billing params so a reload (or a shared URL) does not
    // re-open the popup. session_id has served its purpose by now.
    const next = new URLSearchParams(params.toString());
    next.delete('billing');
    next.delete('session_id');
    next.delete('checkout_cancelled');
    const qs = next.toString();
    window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, [params, openSection, router]);

  return null;
}

/**
 * The frame itself lives INSIDE the settings provider so both slots can reach
 * the popup context: the sidebar's gear (the `onOpenSettings` contract)
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
        <PayoutConnectEarningsRedirect />
        <BillingRedirect />
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
