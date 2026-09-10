'use client';

/**
 * Settings popup — Purchases section (Cloud). The signed-in user's purchase
 * history from /api/billing/purchases: active and expired grants with the
 * target title, price, purchase/expiry dates, an Open link back to the
 * viewer, and a "buy again" path for expired ones.
 */
import { useEffect, useState } from 'react';
import { AlertCircle, ExternalLink, Loader2, Receipt, RefreshCw } from 'lucide-react';
import { SectionShell } from './section-shell';
import { cn } from '@/lib/utils';

const CURRENCY_SYMBOL: Record<string, string> = { usd: '$', eur: '€', gbp: '£' };

function money(cents: number, currency = 'usd'): string {
  const sym = CURRENCY_SYMBOL[currency] ?? '$';
  return `${sym}${(cents / 100).toFixed(2)}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const GRANT_LABEL: Record<string, string> = {
  one_time: 'One-time',
  rental: 'Rental',
  subscription: 'Subscription',
};

interface Purchase {
  id: string;
  targetType: string;
  targetId: string;
  title: string | null;
  shareSlug: string | null;
  workspacePage: string | null;
  grantSource: string;
  amountCents: number;
  currency: string;
  status: string;
  grantedAt: string;
  expiresAt: string | null;
}

export function PurchasesSection() {
  const [purchases, setPurchases] = useState<Purchase[] | null>(null);
  const [error, setError] = useState('');

  const fetchPurchases = async () => {
    setError('');
    setPurchases(null);
    try {
      const res = await fetch('/api/billing/purchases');
      if (res.ok) {
        const data = await res.json();
        setPurchases(data.purchases || []);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to load purchases.');
        setPurchases([]);
      }
    } catch {
      setError('Network error.');
      setPurchases([]);
    }
  };

  useEffect(() => {
    fetchPurchases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const now = Date.now();

  return (
    <SectionShell icon={Receipt} title="Purchases">
      {!purchases ? (
        <div className="flex items-center gap-2 text-sm text-ink/60">
          <Loader2 size={13} className="animate-spin" />
          Loading purchases…
        </div>
      ) : error ? (
        <div className="space-y-2">
          <p className="flex items-start gap-1.5 text-xs font-medium text-red-600">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            {error}
          </p>
          <button
            type="button"
            onClick={fetchPurchases}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-ink/5 px-3 text-xs font-semibold text-ink/80 transition-colors hover:bg-ink/10"
          >
            <RefreshCw size={12} />
            Retry
          </button>
        </div>
      ) : purchases.length === 0 ? (
        <p className="text-xs leading-relaxed text-ink/60">
          No purchases yet. Folios you buy will show up here, with links back to them.
        </p>
      ) : (
        <div className="space-y-2">
          {purchases.map((p) => {
            const expired =
              p.status === 'expired' ||
              p.status === 'cancelled' ||
              p.status === 'refunded' ||
              (p.expiresAt !== null && new Date(p.expiresAt).getTime() < now);
            // Folios link to their share page; workspaces to their page.
            const shareUrl = p.shareSlug ? `/share/${p.shareSlug}` : p.workspacePage ?? null;
            return (
              <div
                key={p.id}
                className="rounded-lg border border-[#0F0F0D]/10 p-2.5 dark:border-[#F4F4F0]/10"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">
                      {p.title ?? 'Deleted target'}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink/50">
                      {GRANT_LABEL[p.grantSource] ?? p.grantSource} · {money(p.amountCents, p.currency)}
                      {p.grantSource === 'rental' && p.expiresAt ? ` · ${fmtDate(p.expiresAt)}` : ''}
                    </span>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                      expired
                        ? 'bg-black/5 text-ink/40 dark:bg-white/10'
                        : 'bg-emerald-500/10 text-emerald-600'
                    )}
                  >
                    {p.status === 'refunded' ? 'Refunded' : expired ? 'Expired' : 'Active'}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-ink/40">
                  <span>
                    Purchased {fmtDate(p.grantedAt)}
                    {p.expiresAt ? ` · ends ${fmtDate(p.expiresAt)}` : ''}
                  </span>
                  {shareUrl &&
                    (expired ? (
                      <a
                        href={shareUrl}
                        className="font-semibold text-[var(--app-accent)] hover:underline"
                      >
                        Expired — buy again
                      </a>
                    ) : (
                      <a
                        href={shareUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 font-semibold text-[var(--app-accent)] hover:underline"
                      >
                        <ExternalLink size={10} />
                        Open
                      </a>
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SectionShell>
  );
}
