'use client';

/**
 * Paid-gating configuration block (P2-T08) — shared by the Share menu's
 * "Access" block and the workspace Project-settings dialog.
 *
 * A CONTROLLED component: the caller owns the `PaidAccessConfig` value and
 * decides when to persist it (ShareMenu's optimistic `put`, or the dialog's
 * Save button). Every emission is a complete, `sanitizePaidAccess`-valid
 * config — including `{ enabled: false, ... }` for "explicitly free" — never
 * a bare `null` from inside the enabled state.
 *
 * Cloud-only. Both callers mount it only under `isCloud`; the connect-status
 * fetch is best-effort (OSS/401s simply leave the notice hidden).
 */
import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { createBrowserClient } from '@/lib/supabase';
import type { PaidAccessConfig } from '@/lib/gating/types';
import { Dropdown } from '@/components/ui/dropdown';
import { cn } from '@/lib/utils';
import { Toggle } from '../settings-popup/toggle';
import { useSettingsPopup } from '../settings-popup/settings-context';

/** Fresh "sell this" config — matches the `sanitizePaidAccess` shape exactly. */
export const DEFAULT_PAID_ACCESS: PaidAccessConfig = {
  enabled: true,
  priceType: 'one_time',
  amountCents: 1000,
  currency: 'usd',
  previewMode: 'none',
  protection: 'standard',
};

const PRICE_TYPES = [
  { key: 'one_time', label: 'One-time' },
  { key: 'rental', label: 'Rental' },
] as const;

const PREVIEW_OPTIONS = [
  { value: 'none', label: 'Off' },
  { value: 'timed', label: 'Timed' },
  { value: 'first_page', label: 'First page' },
];

const DEFAULT_RENTAL_DAYS = 30;
const DEFAULT_PREVIEW_SECONDS = 30;
const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;

function LabeledRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-24 shrink-0 text-xs font-medium text-ink/60">{label}</label>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export interface GateConfigProps {
  /** Current config; `null` = no gate set (inherits workspace default). */
  value: PaidAccessConfig | null | undefined;
  /** Emits a complete, sanitize-valid config (or `null` only if the caller
   *  explicitly wants to clear to inherit — the UI never does this itself). */
  onChange: (next: PaidAccessConfig | null) => void;
  disabled?: boolean;
  /** Toggle row label — "Sell this folio" vs "Sell this workspace". */
  sellLabel?: string;
  /** Custom thumbnail row (folios only — omit for workspaces). */
  thumbnailValue?: string | null;
  /** Called with the new public URL after upload, or `null` on remove. */
  onThumbnailChange?: (url: string | null) => void;
  /** Folio id — storage subfolder under `<organizationId>/<folioId>/`. */
  scopeId?: string | null;
  organizationId?: string | null;
}

export function GateConfig({
  value,
  onChange,
  disabled,
  sellLabel = 'Sell this folio',
  thumbnailValue,
  onThumbnailChange,
  scopeId,
  organizationId,
}: GateConfigProps) {
  const { openSection } = useSettingsPopup();
  const [connect, setConnect] = useState<{ connected: boolean; status: string } | null>(null);
  // Local text drafts so typing "12." never fights the controlled value.
  const [amountText, setAmountText] = useState(() =>
    value?.amountCents != null ? String(value.amountCents / 100) : ''
  );
  const [daysText, setDaysText] = useState(() =>
    value?.rentalDays != null ? String(value.rentalDays) : ''
  );
  const [secondsText, setSecondsText] = useState(() =>
    value?.previewSeconds != null ? String(value.previewSeconds) : ''
  );
  const [uploading, setUploading] = useState(false);
  const [thumbnailError, setThumbnailError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  // Fields the user is actively editing — a server echo must not clobber them.
  const focusedRef = useRef<Set<string>>(new Set());
  const lastValueRef = useRef<PaidAccessConfig | null | undefined>(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const config: PaidAccessConfig | null = value ?? null;
  const enabled = Boolean(config?.enabled);

  // Connect status — best effort; saving stays allowed while disconnected.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/billing/connect/status');
        if (res.ok && !cancelled) setConnect(await res.json());
      } catch {
        // notice stays hidden
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-seed drafts when the incoming value changes externally (workspace
  // switch in the dialog, folio swap in the header) — but never while the
  // user is mid-edit on that field.
  useEffect(() => {
    if (value === lastValueRef.current) return;
    lastValueRef.current = value;
    const mark = (field: string, next: string) => {
      if (!focusedRef.current.has(field)) {
        if (field === 'amount') setAmountText(next);
        else if (field === 'days') setDaysText(next);
        else setSecondsText(next);
      }
    };
    mark('amount', value?.amountCents != null ? String(value.amountCents / 100) : '');
    mark('days', value?.rentalDays != null ? String(value.rentalDays) : '');
    mark('seconds', value?.previewSeconds != null ? String(value.previewSeconds) : '');
  }, [value]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const setFocus = (field: string, focused: boolean) => {
    if (focused) focusedRef.current.add(field);
    else focusedRef.current.delete(field);
  };

  /** Compose a complete, sanitize-valid config from the current drafts. */
  const compose = (patch: Partial<PaidAccessConfig> = {}): PaidAccessConfig => {
    const base = (value && typeof value === 'object' ? value : DEFAULT_PAID_ACCESS) as PaidAccessConfig;
    const priceType = (patch.priceType ?? base.priceType ?? 'one_time') as PaidAccessConfig['priceType'];
    const previewMode = (patch.previewMode ?? base.previewMode ?? 'none') as PaidAccessConfig['previewMode'];
    const parsedAmount = parseFloat(amountText);
    const parsedDays = parseInt(daysText, 10);
    const parsedSeconds = parseInt(secondsText, 10);

    const next: PaidAccessConfig = {
      enabled: patch.enabled ?? base.enabled ?? true,
      priceType,
      amountCents:
        !Number.isNaN(parsedAmount) && parsedAmount >= 1
          ? Math.round(parsedAmount * 100)
          : base.amountCents ?? DEFAULT_PAID_ACCESS.amountCents,
      currency: base.currency ?? DEFAULT_PAID_ACCESS.currency,
      previewMode,
      allowCopy: patch.allowCopy ?? base.allowCopy ?? false,
      allowDownload: patch.allowDownload ?? base.allowDownload ?? false,
      protection: patch.protection ?? base.protection ?? 'standard',
    };
    if (priceType === 'rental') {
      next.rentalDays =
        !Number.isNaN(parsedDays) && parsedDays >= 1 && parsedDays <= 3650
          ? parsedDays
          : base.rentalDays ?? DEFAULT_RENTAL_DAYS;
    }
    if (previewMode === 'timed') {
      next.previewSeconds =
        !Number.isNaN(parsedSeconds) && parsedSeconds >= 5 && parsedSeconds <= 600
          ? parsedSeconds
          : base.previewSeconds ?? DEFAULT_PREVIEW_SECONDS;
    }
    return next;
  };

  const emit = (patch?: Partial<PaidAccessConfig>) => {
    if (disabled) return;
    onChange(compose(patch));
  };

  const emitDebounced = (patch?: Partial<PaidAccessConfig>) => {
    if (disabled) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onChange(compose(patch)), 400);
  };

  const toggleSell = () => {
    if (enabled) emit({ enabled: false });
    else emit({ enabled: true });
  };

  const setPriceType = (key: string) => {
    if (key === 'subscription') return; // disabled until Phase 2
    emit({ priceType: key as 'one_time' | 'rental' });
  };

  const normalizeAmount = () => {
    const d = parseFloat(amountText);
    if (Number.isNaN(d) || d < 1) {
      const base = value?.amountCents ?? DEFAULT_PAID_ACCESS.amountCents;
      setAmountText(String(base / 100));
      return;
    }
    const rounded = Math.round(d * 100) / 100;
    setAmountText(String(rounded));
    emit({ amountCents: Math.round(rounded * 100) });
  };

  const normalizeDays = () => {
    const n = parseInt(daysText, 10);
    if (Number.isNaN(n) || n < 1 || n > 3650) {
      setDaysText(String(value?.rentalDays ?? DEFAULT_RENTAL_DAYS));
      return;
    }
    emit({ rentalDays: n });
  };

  const normalizeSeconds = () => {
    const n = parseInt(secondsText, 10);
    if (Number.isNaN(n) || n < 5 || n > 600) {
      setSecondsText(String(value?.previewSeconds ?? DEFAULT_PREVIEW_SECONDS));
      return;
    }
    emit({ previewSeconds: n });
  };

  // ── Custom thumbnail (folios only) ─────────────────────────────────────
  const uploadThumbnail = async (file: File) => {
    if (!file || uploading || !onThumbnailChange) return;
    if (!file.type.startsWith('image/')) {
      setThumbnailError('Please choose an image file.');
      return;
    }
    if (file.size > MAX_THUMBNAIL_BYTES) {
      setThumbnailError('Image is larger than 5MB.');
      return;
    }
    setThumbnailError('');
    setUploading(true);
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
      const supabase = createBrowserClient(url, key);
      const safeName = file.name.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
      const path = `${organizationId || 'org'}/${scopeId || 'folio'}/${Date.now()}-${safeName}`;
      const { error: uploadErr } = await supabase.storage
        .from('folio-thumbnails')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadErr) throw uploadErr;
      const { data: pub } = supabase.storage.from('folio-thumbnails').getPublicUrl(path);
      onThumbnailChange(pub.publicUrl);
    } catch (e) {
      console.error('Thumbnail upload failed:', e);
      setThumbnailError('Upload failed — please try again.');
    } finally {
      setUploading(false);
    }
  };

  const showThumbnail = Boolean(onThumbnailChange && scopeId);

  return (
    <div className="space-y-3">
      {/* Sell toggle */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-semibold text-ink">{sellLabel}</span>
        <Toggle checked={enabled} onChange={toggleSell} disabled={disabled} />
      </div>

      {connect?.connected === false && (
        <button
          type="button"
          onClick={() => openSection('earnings')}
          className="cursor-pointer text-[11px] font-semibold text-[var(--app-accent)] hover:underline"
        >
          Connect Stripe to sell
        </button>
      )}

      {enabled && (
        <>
          {/* Price type — segmented control */}
          <div>
            <span className="mb-1 block text-[11px] font-bold text-ink/50">Price type</span>
            <div className="flex gap-0.5 rounded-lg bg-black/5 p-0.5 dark:bg-white/5">
              {PRICE_TYPES.map(({ key, label }) => {
                const selected = config?.priceType === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPriceType(key)}
                    disabled={disabled}
                    className={cn(
                      'flex h-7 flex-1 items-center justify-center rounded-md text-xs font-semibold transition-colors cursor-pointer',
                      selected
                        ? 'bg-white text-ink shadow-sm dark:bg-[#2A2A26]'
                        : 'text-ink/50 hover:text-ink'
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Price */}
          <LabeledRow label="Price">
            <div className="flex h-8 items-center gap-1 rounded-lg border border-[#0F0F0D]/10 px-2 dark:border-[#F4F4F0]/10">
              <span className="text-[13px] text-ink/50">$</span>
              <input
                type="number"
                min={1}
                step="0.01"
                value={amountText}
                disabled={disabled}
                onFocus={() => setFocus('amount', true)}
                onBlur={() => {
                  setFocus('amount', false);
                  normalizeAmount();
                }}
                onChange={(e) => {
                  setAmountText(e.target.value);
                  const d = parseFloat(e.target.value);
                  if (!Number.isNaN(d) && d >= 1) {
                    emitDebounced({ amountCents: Math.round(d * 100) });
                  }
                }}
                placeholder="10"
                className="h-full w-full bg-transparent text-[13px] text-ink placeholder:text-ink/50 focus:outline-none"
              />
            </div>
          </LabeledRow>

          {/* Rental duration */}
          {config?.priceType === 'rental' && (
            <LabeledRow label="Duration">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={3650}
                  value={daysText}
                  disabled={disabled}
                  onFocus={() => setFocus('days', true)}
                  onBlur={() => {
                    setFocus('days', false);
                    normalizeDays();
                  }}
                  onChange={(e) => {
                    setDaysText(e.target.value);
                    const n = parseInt(e.target.value, 10);
                    if (!Number.isNaN(n) && n >= 1 && n <= 3650) {
                      emitDebounced({ rentalDays: n });
                    }
                  }}
                  className="h-8 w-20 rounded-lg border border-[#0F0F0D]/10 px-2 text-[13px] text-ink focus:outline-none focus:border-[var(--app-accent)] dark:border-[#F4F4F0]/10"
                />
                <span className="text-xs text-ink/45">days of access</span>
              </div>
            </LabeledRow>
          )}

          {/* Preview mode */}
          <LabeledRow label="Preview">
            <Dropdown
              value={config?.previewMode ?? 'none'}
              onChange={(mode) => emit({ previewMode: mode as PaidAccessConfig['previewMode'] })}
              options={PREVIEW_OPTIONS}
              disabled={disabled}
              ariaLabel="Preview mode"
              className="h-8 w-full rounded-lg border border-[#0F0F0D]/10 px-2 text-[13px] font-medium text-ink dark:border-[#F4F4F0]/10"
            />
          </LabeledRow>

          {/* Timed preview seconds */}
          {config?.previewMode === 'timed' && (
            <LabeledRow label="Seconds">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={5}
                  max={600}
                  value={secondsText}
                  disabled={disabled}
                  onFocus={() => setFocus('seconds', true)}
                  onBlur={() => {
                    setFocus('seconds', false);
                    normalizeSeconds();
                  }}
                  onChange={(e) => {
                    setSecondsText(e.target.value);
                    const n = parseInt(e.target.value, 10);
                    if (!Number.isNaN(n) && n >= 5 && n <= 600) {
                      emitDebounced({ previewSeconds: n });
                    }
                  }}
                  className="h-8 w-20 rounded-lg border border-[#0F0F0D]/10 px-2 text-[13px] text-ink focus:outline-none focus:border-[var(--app-accent)] dark:border-[#F4F4F0]/10"
                />
                <span className="text-xs text-ink/45">seconds before the paywall</span>
              </div>
            </LabeledRow>
          )}

          {/* Post-purchase actions — seller-controlled, default off */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] font-medium text-ink/80">Buyers can duplicate</span>
            <Toggle
              checked={Boolean(config?.allowCopy)}
              onChange={() => emit({ allowCopy: !config?.allowCopy })}
              disabled={disabled}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] font-medium text-ink/80">Buyers can download</span>
            <Toggle
              checked={Boolean(config?.allowDownload)}
              onChange={() => emit({ allowDownload: !config?.allowDownload })}
              disabled={disabled}
            />
          </div>

          {/* Source protection — honest framing: deters casual copying, is not DRM */}
          <div className="rounded-lg bg-ink/[0.03] p-2.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-medium text-ink/80">Source protection</span>
              <Toggle
                checked={config?.protection === 'source_locked'}
                onChange={() =>
                  emit({
                    protection: config?.protection === 'source_locked' ? 'standard' : 'source_locked',
                  })
                }
                disabled={disabled}
              />
            </div>
            <p className="mt-1 text-[11px] leading-snug text-ink/50">
              Blocks Ctrl&#8209;S, view-source and copying of the live page — it deters casual
              copiers, it is not encryption: a determined thief can still extract rendered
              content. Studio previews and your team always get full source.
            </p>
          </div>
        </>
      )}

      {/* Custom thumbnail */}
      {showThumbnail && (
        <div className="space-y-1.5 border-t border-[#0F0F0D]/5 pt-2.5 dark:border-[#F4F4F0]/10">
          <span className="block text-xs font-semibold text-ink/60">Custom thumbnail</span>
          <div className="flex items-center gap-2.5">
            {thumbnailValue ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumbnailValue}
                  alt="Folio thumbnail"
                  className="h-12 w-24 shrink-0 rounded-lg object-cover ring-1 ring-ink/10"
                />
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading || disabled}
                    className="h-7 rounded-lg bg-ink/5 px-2.5 text-xs font-medium text-ink/70 transition-colors hover:bg-ink/10 disabled:opacity-50"
                  >
                    {uploading ? 'Uploading…' : 'Replace'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onThumbnailChange?.(null)}
                    disabled={disabled}
                    className="flex h-7 cursor-pointer items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-ink/50 transition-colors hover:text-red-600"
                  >
                    <Trash2 size={11} />
                    Remove
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading || disabled}
                className="flex h-7 cursor-pointer items-center gap-1.5 rounded-lg bg-ink/5 px-2.5 text-xs font-medium text-ink/70 transition-colors hover:bg-ink/10 disabled:opacity-50"
              >
                {uploading ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />}
                {uploading ? 'Uploading…' : 'Upload thumbnail'}
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadThumbnail(f);
              e.target.value = '';
            }}
          />
          {thumbnailError && <p className="text-xs font-medium text-red-600">{thumbnailError}</p>}
        </div>
      )}
    </div>
  );
}
