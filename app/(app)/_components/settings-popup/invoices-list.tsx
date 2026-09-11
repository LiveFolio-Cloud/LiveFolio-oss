'use client';

/**
 * Billing → Invoices. Subscription renewals create Stripe invoices
 * automatically, so this is the receipts/history surface; each row links to
 * Stripe's hosted invoice (we never render a PDF ourselves).
 *
 * Free workspaces have no Stripe customer yet — that's an empty state, not an
 * error, so the API returns an empty list and we render "no invoices".
 */
import { useEffect, useState } from 'react';
import { AlertCircle, Receipt } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SectionShell } from './section-shell';

interface Invoice {
  id: string | null;
  number: string | null;
  status: string | null;
  created: number;
  amountDue: number;
  amountPaid: number;
  currency: string;
  tax: number;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  billingReason: string | null;
}

/** Stripe returns minor units; render them in the invoice's own currency. */
function money(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: (currency || 'usd').toUpperCase(),
    }).format((cents || 0) / 100);
  } catch {
    // Unknown currency code — fall back to a plain figure rather than throwing.
    return `${(cents || 0) / 100} ${currency?.toUpperCase() || ''}`.trim();
  }
}

function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const STATUS_STYLES: Record<string, string> = {
  paid: 'text-emerald-600',
  open: 'text-ink/60',
  draft: 'text-ink/40',
  void: 'text-ink/40',
  uncollectible: 'text-red-600',
};

export function InvoicesList() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [hasCustomer, setHasCustomer] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/billing/invoices');
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || 'Could not load invoices.');
        }
        const data = await res.json();
        if (cancelled) return;
        setInvoices(data.invoices || []);
        setHasCustomer(data.hasCustomer !== false);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load invoices.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SectionShell icon={Receipt} title="Invoices">
      {loading ? (
        <p className="text-[13px] text-ink/50">Loading…</p>
      ) : error ? (
        <p className="flex items-start gap-1.5 text-xs font-medium text-red-600">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          {error}
        </p>
      ) : !hasCustomer || invoices.length === 0 ? (
        <p className="text-[13px] leading-relaxed text-ink/50">
          No invoices yet. Your receipts appear here after the first paid
          billing cycle — subscription renewals are billed automatically.
        </p>
      ) : (
        <div className="space-y-0.5">
          {invoices.map((inv) => {
            const isRenewal = inv.billingReason === 'subscription_cycle';
            const amount = inv.amountPaid || inv.amountDue;
            const statusStyle = STATUS_STYLES[inv.status || ''] || 'text-ink/50';
            const row = (
              <>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                  {formatDate(inv.created)}
                  <span className="ml-2 text-[11px] font-normal text-ink/40">
                    {isRenewal ? 'Renewal' : 'Subscription'}
                    {inv.number ? ` · ${inv.number}` : ''}
                  </span>
                </span>
                <span className="shrink-0 text-[13px] font-medium tabular-nums text-ink">
                  {money(amount, inv.currency)}
                </span>
                <span className={cn('w-16 shrink-0 text-right text-[11px] font-semibold capitalize', statusStyle)}>
                  {inv.status || '—'}
                </span>
              </>
            );

            return inv.hostedInvoiceUrl ? (
              <a
                key={inv.id ?? inv.created}
                href={inv.hostedInvoiceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-lg px-1.5 py-2 transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
              >
                {row}
              </a>
            ) : (
              // Draft/void invoices have no hosted page — render as plain rows.
              <div key={inv.id ?? inv.created} className="flex items-center gap-3 px-1.5 py-2">
                {row}
              </div>
            );
          })}
        </div>
      )}
    </SectionShell>
  );
}
