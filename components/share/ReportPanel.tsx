'use client';

/**
 * Report-content panel (share pages) — the community arm of moderation.
 *
 * Signed-in viewers file an in-app report into content_reports (the same
 * queue the admin moderation route reviews; reporting never auto-takedowns).
 * Guests are routed to the DMCA/abuse email channel per the ToS — legal
 * claims keep a mail trail — with a prefilled mailto so it's one click.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';

const REASONS: Array<{ value: string; label: string }> = [
  { value: 'copyright', label: 'Copyright or intellectual property' },
  { value: 'trademark', label: 'Trademark' },
  { value: 'abuse', label: 'Harassment or abuse' },
  { value: 'spam', label: 'Spam' },
  { value: 'illegal', label: 'Illegal content' },
  { value: 'other', label: 'Something else' },
];

export default function ReportPanel({
  folioId,
  title,
  onClose,
}: {
  folioId: string;
  title: string;
  onClose: () => void;
}) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null); // null = resolving
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (!cancelled) setSignedIn(res.ok);
      } catch {
        if (!cancelled) setSignedIn(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async () => {
    if (!reason || state === 'sending') return;
    setState('sending');
    setError('');
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_type: 'folio',
          target_id: folioId,
          reason,
          details,
        }),
      });
      if (res.ok) {
        setState('done');
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || data.message || 'Could not file the report.');
        setState('error');
      }
    } catch {
      setError('Could not file the report. Please try again.');
      setState('error');
    }
  };

  const mailtoHref = () => {
    const subject = encodeURIComponent(`Report: ${title || 'LiveFolio folio'}`);
    const body = encodeURIComponent(
      `URL: ${typeof window !== 'undefined' ? window.location.href : ''}\n\nReason: ${reason || ''}\n\n${details}`
    );
    return `mailto:legal@livefolio.cloud?subject=${subject}&body=${body}`;
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0F0F0D]/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Report content"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-xl ring-1 ring-black/5 animate-fade"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FF3B00]/10 text-[#FF3B00]">
              <AlertTriangle size={15} />
            </span>
            <div>
              <h2 className="text-[15px] font-bold tracking-tight text-[#0F0F0D]">Report content</h2>
              <p className="text-[11px] text-[#0F0F0D]/50">Reviewed by the LiveFolio moderation team</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-[#0F0F0D]/40 transition-colors hover:bg-black/5 hover:text-[#0F0F0D]"
          >
            <X size={14} />
          </button>
        </div>

        {state === 'done' ? (
          <div className="space-y-3 py-4 text-center">
            <CheckCircle2 size={28} className="mx-auto text-emerald-600" />
            <p className="text-sm font-semibold text-[#0F0F0D]">Report filed</p>
            <p className="text-xs leading-relaxed text-[#0F0F0D]/55">
              Reports are reviewed in order. We never notify the creator of a report, and filing
              never takes content down automatically.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="h-9 w-full rounded-full bg-[#0F0F0D] text-xs font-semibold text-white transition-opacity hover:opacity-85 cursor-pointer"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <p className="text-[13px] leading-relaxed text-[#0F0F0D]/70">
              Tell us what&apos;s wrong with this folio — stolen content, abuse, spam or anything
              that violates the Terms of Service.
            </p>

            <div className="space-y-1.5">
              {REASONS.map((r) => (
                <label
                  key={r.value}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
                    reason === r.value
                      ? 'bg-[#FF3B00]/10 text-[#FF3B00]'
                      : 'bg-black/[0.04] text-[#0F0F0D]/75 hover:bg-black/[0.07]'
                  }`}
                >
                  <input
                    type="radio"
                    name="report-reason"
                    value={r.value}
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                    className="accent-[#FF3B00]"
                  />
                  {r.label}
                </label>
              ))}
            </div>

            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Optional details — what happened, where you saw it, anything the team should know."
              rows={3}
              className="w-full resize-none rounded-lg border-0 bg-black/[0.04] px-3 py-2 text-[13px] text-[#0F0F0D] placeholder:text-[#0F0F0D]/40 focus:outline-none focus:ring-2 focus:ring-[#FF3B00]/40"
            />

            {signedIn === false ? (
              <div className="space-y-2">
                <a
                  href={mailtoHref()}
                  className="flex h-9 w-full items-center justify-center rounded-full bg-[#FF3B00] text-xs font-semibold text-white transition-opacity hover:opacity-90 cursor-pointer"
                >
                  Report by email (one click)
                </a>
                <p className="text-center text-[11px] leading-relaxed text-[#0F0F0D]/50">
                  In-app reporting is for signed-in accounts. Guests file copyright and abuse
                  notices via email — it keeps a legal trail. You can also{' '}
                  <a href="/login" className="font-semibold text-[#FF3B00] hover:underline">
                    sign in
                  </a>{' '}
                  and report here.
                </p>
              </div>
            ) : (
              <>
                {state === 'error' && (
                  <p className="rounded-lg bg-[#FF3B00]/10 px-3 py-2 text-xs font-medium text-[#FF3B00]">
                    {error}
                  </p>
                )}
                <button
                  type="button"
                  disabled={!reason || state === 'sending'}
                  onClick={submit}
                  className="flex h-9 w-full items-center justify-center gap-1.5 rounded-full bg-[#FF3B00] text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                >
                  {state === 'sending' && <Loader2 size={12} className="animate-spin" />}
                  {state === 'sending' ? 'Filing…' : 'File report'}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
