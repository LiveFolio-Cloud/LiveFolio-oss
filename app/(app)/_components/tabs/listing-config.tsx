'use client';

/**
 * Marketplace listing block (Discover/Explore) — mounted in the Share menu
 * next to the "Access" paid-gate block, cloud only.
 *
 * Single-consent flow: flipping "List in Explore" ON shows ONE panel that
 * bundles the per-folio rights affirmation with the Seller-Terms acceptance
 * (recorded once per account). One button does everything:
 *
 *   1. POST /api/profile/attest  — idempotent; skipped when this profile has
 *      already accepted the current Seller Terms version (checked on mount).
 *   2. PUT /api/files/[id] with the full listing (listed + rightsAttestedAt).
 *
 * If the save still 403s after a successful attestation, the acting user is
 * not the workspace Owner — the panel switches to "only the Owner can list".
 *
 * Client-safe imports only (lib/listing/types): this component must never
 * pull the server Supabase client into the browser bundle.
 */
import { useEffect, useState } from 'react';
import { Loader2, ShieldAlert, ShieldCheck, Store, X } from 'lucide-react';
import type { ListingMetadata, ListingCategory, CreationMethod } from '@/lib/listing/types';
import {
  CATEGORY_LABELS,
  CREATION_LABELS,
  LICENSE_KIND_LABELS,
  defaultListing,
} from '@/lib/listing/types';
import { Dropdown } from '@/components/ui/dropdown';
import { Toggle } from '../settings-popup/toggle';

type ErrorCode =
  | 'LISTING_NEEDS_SELLER_AGREEMENT'
  | 'LISTING_SELLER_SUSPENDED'
  | 'LISTING_NEEDS_RIGHTS_ATTESTATION'
  | 'NETWORK'
  | null;

const CATEGORY_OPTIONS = [
  { value: '', label: 'Not categorized' },
  ...Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label })),
];

const CREATION_OPTIONS = [
  { value: '', label: 'Not specified' },
  ...Object.entries(CREATION_LABELS).map(([value, label]) => ({ value, label })),
];

const LICENSE_OPTIONS = [
  { value: '', label: 'No license set' },
  ...Object.entries(LICENSE_KIND_LABELS).map(([value, label]) => ({ value, label })),
];

const ERROR_COPY: Record<Exclude<ErrorCode, null>, string> = {
  LISTING_NEEDS_SELLER_AGREEMENT:
    'Listings require the workspace owner to accept the LiveFolio Seller Terms first.',
  LISTING_SELLER_SUSPENDED:
    'This seller account is suspended — listings are blocked. Contact legal@livefolio.cloud.',
  LISTING_NEEDS_RIGHTS_ATTESTATION:
    'First listings need your rights affirmation — confirm you own this content below.',
  NETWORK: 'Could not save the listing. Try again.',
};

export function ListingConfig({
  folioId,
  listing,
  disabled,
  onPersist,
}: {
  folioId: string;
  listing: ListingMetadata | null | undefined;
  disabled?: boolean;
  /** Called with the saved metadata after a successful save (owner syncs). */
  onPersist: (next: ListingMetadata) => void;
}) {
  const config: ListingMetadata = listing ?? defaultListing();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode>(null);
  const [tagText, setTagText] = useState('');
  const [projectsText, setProjectsText] = useState('');
  /** Consent panel visible — rights affirmation + (if needed) Seller Terms. */
  const [askingConsent, setAskingConsent] = useState(false);
  /** True once THIS profile has accepted the current Seller Terms version. */
  const [termsAccepted, setTermsAccepted] = useState<boolean | null>(null);
  /** True when an attestation succeeded here but listing still 403s (not the Owner). */
  const [attestOkButBlocked, setAttestOkButBlocked] = useState(false);

  // Does this (signed-in) profile already hold current Seller-Terms
  // acceptance? Avoids a pointless attest call on the common re-list path.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/profile');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const profile = data?.profile;
        if (profile?.seller_terms_accepted_at) setTermsAccepted(true);
      } catch {
        // unknown → the consent button will attempt the attest call anyway
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // New listing value from the server clears stale errors/panels.
  useEffect(() => {
    setError(null);
    setAttestOkButBlocked(false);
    if (listing?.listed) setAskingConsent(false);
  }, [listing]);

  const save = async (next: ListingMetadata): Promise<{ ok: boolean; code: ErrorCode }> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/files/${folioId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing: next }),
      });
      if (res.ok) {
        const data = await res.json();
        const saved = (data?.project ?? data)?.listing;
        if (saved) onPersist(saved as ListingMetadata);
        setAskingConsent(false);
        setAttestOkButBlocked(false);
        return { ok: true, code: null };
      }
      let code: ErrorCode = 'NETWORK';
      try {
        const payload = await res.json();
        if (payload?.error) code = payload.error as ErrorCode;
      } catch { /* keep NETWORK */ }
      setError(code);
      return { ok: false, code };
    } catch {
      setError('NETWORK');
      return { ok: false, code: 'NETWORK' };
    } finally {
      setBusy(false);
    }
  };

  const emit = (patch: Partial<ListingMetadata>) => save({ ...config, ...patch });

  const toggleListed = (on: boolean) => {
    setError(null);
    if (on) {
      if (!config.rightsAttestedAt) {
        // First listing of this folio — the rights affirmation is per folio
        // and can never be assumed. Ask (bundle with terms acceptance).
        setAttestOkButBlocked(false);
        setAskingConsent(true);
        return;
      }
      void emit({ listed: true });
    } else {
      setAskingConsent(false);
      void emit({ listed: false });
    }
  };

  /** ONE consent action: affirm rights + accept terms (once) + list. */
  const confirmAndList = async () => {
    setBusy(true);
    setError(null);
    try {
      // 1. Seller Terms — only when this profile hasn't accepted the current
      //    version yet (server keeps the original acceptance on re-accepts).
      if (!termsAccepted) {
        const res = await fetch('/api/profile/attest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accept: true }),
        });
        if (!res.ok) {
          setError('LISTING_NEEDS_SELLER_AGREEMENT');
          setBusy(false);
          return;
        }
        setTermsAccepted(true);
      }
      // 2. The full listing save (listed + the per-folio rights affirmation).
      const out = await save({
        ...config,
        listed: true,
        rightsAttestedAt: config.rightsAttestedAt ?? new Date().toISOString(),
      });
      if (!out.ok && out.code === 'LISTING_NEEDS_SELLER_AGREEMENT') {
        // Terms recorded on THIS profile, yet the owner check still fails →
        // the acting user is not the workspace Owner.
        setAttestOkButBlocked(true);
      }
    } catch {
      setError('NETWORK');
      setBusy(false);
    }
  };

  const addTag = (raw: string) => {
    const tag = raw.trim().toLowerCase().replace(/^#/, '');
    if (!tag || config.tags.includes(tag) || config.tags.length >= 8) return;
    setTagText('');
    void emit({ tags: [...config.tags, tag] });
  };

  const license = config.license;
  const showConsentPanel = askingConsent && !config.listed;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink">List in Explore</p>
          <p className="mt-0.5 text-[11px] leading-snug text-ink/50">
            Shows this folio in the public Discover index. Published folios stay link-only until
            listed.
          </p>
        </div>
        <Toggle checked={config.listed} onChange={() => toggleListed(!config.listed)} disabled={disabled || busy} />
      </div>

      {showConsentPanel && (
        <div className="rounded-xl bg-[var(--app-accent)]/[0.06] p-3 ring-1 ring-[var(--app-accent)]/20">
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink/80">
            <Store size={13} className="mt-0.5 shrink-0 text-[var(--app-accent)]" />
            <span>
              Listing makes this folio public in Explore. To proceed, confirm:{' '}
              <strong>I own this content or have the necessary rights/licenses to sell and
              distribute it</strong> (including every asset inside it — it does not copy or
              impersonate third-party brands or works), and{' '}
              {termsAccepted === true ? 'accept the' : 'accept the LiveFolio'}{' '}
              <a href="/tos" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:no-underline">
                Seller Terms
              </a>
              {termsAccepted === true ? ' (already accepted on this account).' : '. Sales are yours — LiveFolio only hosts and relays.'}
            </span>
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={confirmAndList}
              disabled={busy}
              className="flex h-7 items-center gap-1.5 rounded-lg bg-[var(--app-accent)] px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
              {termsAccepted === true ? 'Confirm & list in Explore' : 'Accept & list in Explore'}
            </button>
            <button
              type="button"
              onClick={() => setAskingConsent(false)}
              disabled={busy}
              className="text-[11px] text-ink/50 underline-offset-2 hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {attestOkButBlocked && (
        <div className="rounded-xl bg-[#FF3B00]/[0.05] p-3 ring-1 ring-[#FF3B00]/20">
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink/80">
            <ShieldAlert size={13} className="mt-0.5 shrink-0 text-[#FF3B00]" />
            <span>
              The Seller Terms are accepted on <strong>your account</strong> — but this
              workspace&apos;s listing is still blocked. Only the workspace <strong>Owner</strong>{' '}
              can list (payouts land on their account). If you&apos;re not the Owner, ask them to
              open this folio&apos;s Share menu → Marketplace listing.
            </span>
          </p>
        </div>
      )}

      {error && error !== 'LISTING_NEEDS_SELLER_AGREEMENT' && (
        <p className="flex items-start gap-1.5 text-[11px] leading-snug text-rose-600 dark:text-rose-400">
          <ShieldAlert size={12} className="mt-0.5 shrink-0" />
          {ERROR_COPY[error]}
        </p>
      )}

      {config.listed && !showConsentPanel && (
        <div className="space-y-2.5 border-t border-[#0F0F0D]/5 pt-2.5 dark:border-[#F4F4F0]/10">
          <div className="flex items-center gap-3">
            <label className="w-24 shrink-0 text-xs font-medium text-ink/60">Category</label>
            <div className="min-w-0 flex-1">
              <Dropdown
                value={config.category ?? ''}
                onChange={(v) => void emit({ category: (v || null) as ListingCategory | null })}
                options={CATEGORY_OPTIONS}
                disabled={disabled || busy}
                className="h-8 w-full rounded-lg bg-black/5 px-2.5 text-[13px] text-ink dark:bg-white/5"
                ariaLabel="Explore category"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="w-24 shrink-0 text-xs font-medium text-ink/60">Made with</label>
            <div className="min-w-0 flex-1">
              <Dropdown
                value={config.creation ?? ''}
                onChange={(v) => void emit({ creation: (v || null) as CreationMethod | null })}
                options={CREATION_OPTIONS}
                disabled={disabled || busy}
                className="h-8 w-full rounded-lg bg-black/5 px-2.5 text-[13px] text-ink dark:bg-white/5"
                ariaLabel="Creation method"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="w-24 shrink-0 text-xs font-medium text-ink/60">Tags</label>
            <div className="min-w-0 flex-1">
              <input
                value={tagText}
                onChange={(e) => setTagText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addTag(tagText);
                  }
                }}
                onBlur={() => tagText.trim() && addTag(tagText)}
                disabled={disabled || busy}
                placeholder={config.tags.length >= 8 ? 'Max 8 tags' : 'dashboard, kpi…'}
                className="h-8 w-full border-0 border-b border-[#0F0F0D]/10 bg-transparent px-0.5 text-[13px] text-ink placeholder:text-ink/40 focus:border-b-2 focus:border-[var(--app-accent)] focus:outline-none dark:border-[#F4F4F0]/10"
              />
              {config.tags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {config.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-medium text-ink/70 dark:bg-white/10"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => void emit({ tags: config.tags.filter((t) => t !== tag) })}
                        disabled={busy}
                        aria-label={`Remove tag ${tag}`}
                        className="cursor-pointer text-ink/40 hover:text-rose-600"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-[#0F0F0D]/5 pt-2.5 dark:border-[#F4F4F0]/10">
            <div className="flex items-center gap-3">
              <label className="w-24 shrink-0 text-xs font-medium text-ink/60">License</label>
              <div className="min-w-0 flex-1">
                <Dropdown
                  value={license?.kind ?? ''}
                  onChange={(v) => {
                    const kind = v as 'personal' | 'commercial' | '';
                    void emit({
                      license: kind
                        ? { kind, allowModify: false, allowResale: false, requireAttribution: false, maxProjects: null }
                        : null,
                    });
                  }}
                  options={LICENSE_OPTIONS}
                  disabled={disabled || busy}
                  className="h-8 w-full rounded-lg bg-black/5 px-2.5 text-[13px] text-ink dark:bg-white/5"
                  ariaLabel="License kind"
                />
              </div>
            </div>
            {license && (
              <div className="mt-2 space-y-2 pl-0">
                {(
                  [
                    ['allowModify', 'Buyer may modify'],
                    ['allowResale', 'Buyer may resell'],
                    ['requireAttribution', 'Attribution required'],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between gap-3 pl-2">
                    <span className="text-xs text-ink/60">{label}</span>
                    <Toggle
                      checked={Boolean(license[key])}
                      onChange={() => void emit({ license: { ...license, [key]: !license[key] } })}
                      disabled={disabled || busy}
                    />
                  </div>
                ))}
                <div className="flex items-center justify-between gap-3 pl-2">
                  <span className="text-xs text-ink/60">Max projects</span>
                  <input
                    value={projectsText}
                    onChange={(e) => {
                      const v = e.target.value;
                      setProjectsText(v);
                      if (v === '') void emit({ license: { ...license, maxProjects: null } });
                      else {
                        const n = parseInt(v, 10);
                        if (!Number.isNaN(n) && n >= 1) void emit({ license: { ...license, maxProjects: n } });
                      }
                    }}
                    disabled={disabled || busy}
                    placeholder={license.maxProjects ? String(license.maxProjects) : 'Unlimited'}
                    inputMode="numeric"
                    className="h-7 w-20 rounded-lg border border-[#0F0F0D]/10 bg-transparent px-2 text-right text-xs text-ink placeholder:text-ink/40 focus:border-[var(--app-accent)] focus:outline-none dark:border-[#F4F4F0]/15"
                  />
                </div>
              </div>
            )}
          </div>

          <p className="pt-1 text-[10px] leading-relaxed text-ink/40">
            The license shown is what buyers receive. You keep ownership — the buyer&apos;s rights
            come from this license. You&apos;re responsible for what you sell.
          </p>
        </div>
      )}
    </div>
  );
}
