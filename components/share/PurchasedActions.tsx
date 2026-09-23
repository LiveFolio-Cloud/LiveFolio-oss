'use client';

/**
 * Post-purchase actions for a BUYER with an active grant — only rendered
 * when the seller enabled them (allowCopy / allowDownload, both default
 * off). The buttons are cosmetic; the routes re-verify grant + flag.
 */
import { useState } from 'react';
import { Copy, Download, Loader2 } from 'lucide-react';

export default function PurchasedActions({
  folioId,
  allowCopy,
  allowDownload,
}: {
  folioId: string;
  allowCopy: boolean;
  allowDownload: boolean;
}) {
  const [busy, setBusy] = useState<'copy' | 'download' | null>(null);
  const [error, setError] = useState('');

  const duplicate = async () => {
    setBusy('copy');
    setError('');
    try {
      const res = await fetch(`/api/files/${folioId}/duplicate`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.projectId) {
        window.location.href = `/app/${data.projectId}`;
        return;
      }
      setError(data.error || 'Could not duplicate the folio.');
    } catch {
      setError('Could not duplicate the folio.');
    } finally {
      setBusy(null);
    }
  };

  const download = () => {
    window.location.href = `/api/files/${folioId}/download`;
  };

  return (
    <div className="absolute right-4 top-16 z-30">
      <div className="flex items-center gap-1.5">
        {allowCopy && (
          <button
            type="button"
            onClick={duplicate}
            disabled={busy !== null}
            className="flex h-7 items-center gap-1.5 rounded-full bg-white/85 px-3 text-[11px] font-semibold text-[#0F0F0D]/70 shadow-sm ring-1 ring-black/5 backdrop-blur-md transition-colors hover:text-[var(--lf-accent)] disabled:opacity-50"
          >
            {busy === 'copy' ? <Loader2 size={11} className="animate-spin" /> : <Copy size={11} />}
            Duplicate to my folios
          </button>
        )}
        {allowDownload && (
          <button
            type="button"
            onClick={download}
            disabled={busy !== null}
            className="flex h-7 items-center gap-1.5 rounded-full bg-white/85 px-3 text-[11px] font-semibold text-[#0F0F0D]/70 shadow-sm ring-1 ring-black/5 backdrop-blur-md transition-colors hover:text-[var(--lf-accent)] disabled:opacity-50"
          >
            <Download size={11} />
            Download ZIP
          </button>
        )}
      </div>
      {error && (
        <p className="mt-1 text-right text-[11px] font-medium text-red-600">{error}</p>
      )}
    </div>
  );
}
