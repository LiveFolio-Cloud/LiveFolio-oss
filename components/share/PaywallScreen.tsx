'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Lock, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { priceLabel } from '@/lib/gating/paywall-html';
import type { PaidAccessConfig } from '@/lib/gating/types';
import type { GatePaidAccess } from './types';

/**
 * Guarded analytics global — never import PostHogProvider (OSS-excluded).
 * Cloud's lib/conversion-tracking.ts augments `Window.posthog`; OSS strips
 * that file, so reach through an explicit shape instead of the ambient type.
 */
type PostHogGlobal = {
  posthog?: { capture: (event: string, properties?: Record<string, unknown>) => void };
};

interface PaywallScreenProps {
  /** Folio title shown under the lock. */
  title: string;
  /** Folio UUID — the checkout targetId (and returnFolioId). */
  folioId: string;
  paidAccess: GatePaidAccess | null;
  viewerSignedIn: boolean;
  accent?: string | null;
  /** Seller-declared license on listed folios ("Commercial license"…). */
  licenseLabel?: string | null;
}

/**
 * Full-screen paywall for `viewerAccess === 'none'`.
 *
 * - Signed-in viewers get the real "Buy" button → POST /api/billing/gate/checkout
 *   → Stripe Checkout redirect.
 * - Anonymous viewers get "Sign in to purchase" → /login?next=<current path>
 *   (both app/login and the hash-session callback honor ?next=).
 * - CREATOR_NOT_CONNECTED surfaces as an inline notice (config stays; the
 *   creator must connect Stripe in Settings).
 *
 * Analytics: guarded `window.posthog?.capture('gate_viewed')` only — never
 * import PostHogProvider (OSS-excluded).
 */
export default function PaywallScreen({ title, folioId, paidAccess, viewerSignedIn, accent, licenseLabel }: PaywallScreenProps) {
  const [isStartingCheckout, setIsStartingCheckout] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Analytics — guarded capture only (window.posthog is loaded by the cloud
  // analytics scripts; optional-chained so this is inert everywhere else).
  useEffect(() => {
    if (!paidAccess) return;
    (window as unknown as PostHogGlobal).posthog?.capture?.('gate_viewed', {
      folio_title: title,
      target_type: paidAccess.targetType,
      price_type: paidAccess.priceType,
      amount_cents: paidAccess.amountCents,
      currency: paidAccess.currency,
      preview_mode: paidAccess.previewMode,
    });
  }, [title, paidAccess]);

  const config: PaidAccessConfig | null = paidAccess ? { enabled: true, ...paidAccess } : null;
  // usePathname, NOT window.location — window differs between SSR and the
  // first client render (empty server href), which broke hydration.
  const nextPath = usePathname();

  const handleBuy = async () => {
    if (!paidAccess || isStartingCheckout) return;
    setIsStartingCheckout(true);
    setCheckoutError(null);
    try {
      const res = await fetch('/api/billing/gate/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType: paidAccess.targetType,
          targetId: folioId,
          returnFolioId: folioId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      if (data.error === 'CREATOR_NOT_CONNECTED') {
        setCheckoutError(
          "The creator hasn't connected their payment account yet, so purchases are temporarily unavailable."
        );
      } else if (data.error === 'SUBSCRIPTIONS_NOT_YET_SUPPORTED') {
        setCheckoutError("Subscriptions are coming soon — this folio isn't purchasable yet.");
      } else {
        setCheckoutError(data.error || "Couldn't start checkout. Please try again.");
      }
    } catch {
      setCheckoutError("Couldn't start checkout. Please try again.");
    } finally {
      setIsStartingCheckout(false);
    }
  };

  return (
    <div
      style={{ '--lf-accent': accent || '#FF3B00' } as React.CSSProperties}
      className="h-full w-full flex items-center justify-center p-6 overflow-y-auto antialiased bg-[#F4F4F0] text-[#0F0F0D]"
    >
      <div className="w-full max-w-md space-y-6 text-center animate-fade rounded-3xl bg-white p-8 shadow-xl ring-1 ring-black/5">
        {/* Brand mark — orange square, white lock (the LiveFolio gate mark) */}
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[1.3rem] bg-[var(--lf-accent)] shadow-lg shadow-[var(--lf-accent)]/30 ring-4 ring-white">
          <Lock size={26} strokeWidth={2.5} className="text-white" />
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--lf-accent)]">
            Paid folio
          </p>
          <h1 className="text-2xl font-black tracking-tighter">This folio is paid</h1>
          <p className="text-sm leading-relaxed text-[#0F0F0D]/60 line-clamp-2">{title}</p>
        </div>

        {config && (
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border-[1.5px] border-[var(--lf-accent)] px-4 py-1.5 text-sm font-semibold text-[var(--lf-accent)]">
            {priceLabel(config)}
          </div>
        )}

        {licenseLabel && (
          <p className="text-[11px] font-medium tracking-wide text-[#0F0F0D]/50">
            License · {licenseLabel}
          </p>
        )}

        {viewerSignedIn ? (
          <div className="space-y-3">
            {process.env.NEXT_PUBLIC_MOCK_PAYMENTS === '1' && (
              <p className="mx-auto w-fit rounded-full bg-black/5 px-3 py-1 text-[11px] font-semibold text-[#0F0F0D]/50">
                Demo mode — payments simulated
              </p>
            )}
            <Button
              onClick={handleBuy}
              disabled={isStartingCheckout}
              className="w-full h-12 rounded-full bg-[var(--lf-accent)] text-white text-sm font-semibold shadow-lg shadow-[var(--lf-accent)]/25 hover:opacity-90 transition-opacity cursor-pointer"
            >
              {isStartingCheckout ? 'Redirecting to checkout…' : 'Buy access'}
            </Button>
            {checkoutError && (
              <div className="flex items-start gap-2.5 p-3.5 text-left text-sm font-medium rounded-xl bg-[var(--lf-accent)]/10 text-[var(--lf-accent)]">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{checkoutError}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <Button
              asChild
              className="w-full h-12 rounded-full bg-[var(--lf-accent)] text-white text-sm font-semibold shadow-lg shadow-[var(--lf-accent)]/25 hover:opacity-90 transition-opacity cursor-pointer"
            >
              <Link href={`/login?next=${encodeURIComponent(nextPath)}`}>Sign in to purchase</Link>
            </Button>
            <p className="text-xs text-[#0F0F0D]/50">
              Already purchased?{' '}
              <Link
                href={`/login?next=${encodeURIComponent(nextPath)}`}
                className="font-semibold text-[var(--lf-accent)] hover:underline"
              >
                Sign in
              </Link>{' '}
              and reload.
            </p>
          </div>
        )}

        <div className="pt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/50">
          LiveFolio
        </div>
      </div>
    </div>
  );
}
