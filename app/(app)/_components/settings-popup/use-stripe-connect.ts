'use client';

/**
 * Stripe Connect state + actions for the Earnings section (P2-T08).
 * Wraps the /api/billing/connect/* routes: status, start (onboarding),
 * refresh (onboarding link for pending/restricted), dashboard (login link),
 * disconnect, and the sales summary.
 */
import { useCallback, useEffect, useState } from 'react';

export interface ConnectStatus {
  connected: boolean;
  accountId: string | null;
  status: 'none' | 'pending' | 'active' | 'restricted' | string;
}

export interface ConnectSaleRow {
  id: string;
  targetType: string;
  targetId: string;
  title: string | null;
  grantSource: string;
  amountCents: number;
  currency: string;
  status: string;
  grantedAt: string;
  expiresAt: string | null;
  /** LiveFolio's cut as actually charged. */
  platformFeeCents: number;
  /** The bps in force at sale time; null on rows predating fee capture. */
  platformFeeBps: number | null;
  /** Stripe's processing cost; null when never captured (not the same as 0). */
  stripeFeeCents: number | null;
  /** What the creator receives: amountCents - platformFeeCents. */
  netCents: number;
}

export interface ConnectSales {
  totalGrossCents: number;
  totalFeesCents: number;
  totalStripeFeesCents: number;
  /** At least one sale has no captured Stripe cost. */
  stripeFeeMissing: boolean;
  totalNetCents: number;
  sales: ConnectSaleRow[];
}

export function useStripeConnect() {
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [sales, setSales] = useState<ConnectSales | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/billing/connect/status');
      if (res.ok) setStatus(await res.json());
    } catch (err) {
      console.error('Connect status failed:', err);
    }
  }, []);

  const fetchSales = useCallback(async () => {
    try {
      const res = await fetch('/api/billing/connect/sales');
      if (res.ok) setSales(await res.json());
    } catch (err) {
      console.error('Connect sales failed:', err);
    }
  }, []);

  const post = useCallback(
    async (path: string): Promise<{ url?: string; error?: string } | null> => {
      setError(null);
      setLoading(true);
      try {
        const res = await fetch(path, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (res.ok) return data;
        // Routes return a machine code in `error` and sometimes a
        // human-readable `message` alongside it. Prefer the explanation —
        // showing a bare code like UNSUPPORTED_COUNTRY tells the creator
        // nothing about what to do.
        setError(data.message || data.error || 'Request failed.');
        return null;
      } catch (err) {
        console.error(`POST ${path} failed:`, err);
        setError('Network error.');
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /** Begin Stripe Express onboarding — redirects to Stripe's hosted flow. */
  const start = useCallback(async () => {
    const data = await post('/api/billing/connect/start');
    if (data?.url) window.location.href = data.url;
  }, [post]);

  /** New onboarding link for pending/restricted accounts. */
  const refresh = useCallback(async () => {
    const data = await post('/api/billing/connect/refresh');
    if (data?.url) window.location.href = data.url;
  }, [post]);

  /** Open the Stripe Express dashboard in a new tab. */
  const openDashboard = useCallback(async () => {
    const data = await post('/api/billing/connect/dashboard');
    if (data?.url) window.open(data.url, '_blank', 'noopener,noreferrer');
  }, [post]);

  /** Clear the connected account; gate configs stay, checkout 400s. */
  const disconnect = useCallback(async () => {
    const data = await post('/api/billing/connect/disconnect');
    if (data) {
      setSales(null);
      await fetchStatus();
    }
  }, [post, fetchStatus]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Pull sales whenever the account flips to connected.
  useEffect(() => {
    if (status?.connected) fetchSales();
  }, [status?.connected, fetchSales]);

  return {
    status,
    sales,
    loading,
    error,
    fetchStatus,
    fetchSales,
    start,
    refresh,
    openDashboard,
    disconnect,
  };
}
