'use client';

/**
 * Content of the three folio-header menus that used to live inside the
 * Share popover — each now has its own icon trigger with the SAME surface
 * chrome (HeaderMenuSurface). Sections keep their original behavior:
 *
 *  Access ($)       — paid gating (GateConfig + thumbnail) + Stripe connect.
 *  Marketplace      — Explore listing (ListingConfig) + seller terms.
 *  Featured (star)  — profile-hero pin + link to the public page.
 */
import { useState } from 'react';
import { Check, Copy, Download, ExternalLink, Globe, Loader2, Star } from 'lucide-react';
import type { HTMLFile } from '@/lib/db';
import type { PaidAccessConfig } from '@/lib/gating/types';
import { Toggle } from '../settings-popup/toggle';
import { GateConfig } from './gate-config';
import { ListingConfig } from './listing-config';
import { useTunnel } from '@/lib/app-shell/use-tunnel';

/* ── Tunnel (Go Live) — OSS-only menu content ──────────────────────── */

export function TunnelMenuContent({ tunnel }: { tunnel: ReturnType<typeof useTunnel> }) {
  const { tunnelActive, tunnelUrl, toggling, toggle } = tunnel;
  const [copied, setCopied] = useState(false);

  const copyUrl = async () => {
    if (!tunnelUrl) return;
    try {
      await navigator.clipboard.writeText(tunnelUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard unavailable — the URL stays visible to copy by hand.
    }
  };

  return (
    <div className="w-72 space-y-2.5">
      {/* No heading — the menu surface already titles this "Tunnel". */}
      <div className="flex items-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 rounded-full ${tunnelActive ? 'bg-emerald-500' : 'bg-ink/30'}`}
        />
        <span
          className={
            tunnelActive
              ? 'text-[11px] font-semibold text-emerald-600'
              : 'text-[11px] font-medium text-ink/50'
          }
        >
          {tunnelActive ? 'Live' : 'Offline'}
        </span>
      </div>

      <p className="text-[11px] leading-snug text-ink/50">
        {tunnelActive
          ? 'Your folios are reachable through a temporary public link while the tunnel is on.'
          : 'Start a temporary public tunnel so share links work from other devices.'}
      </p>

      {tunnelActive && tunnelUrl && (
        <button
          type="button"
          onClick={() => void copyUrl()}
          className="flex w-full items-center justify-between gap-2 rounded-lg bg-black/[0.04] px-2.5 py-2 text-left transition-colors hover:bg-black/[0.07] dark:bg-white/[0.06] dark:hover:bg-white/[0.09] cursor-pointer"
          title="Copy link"
        >
          <span className="truncate font-mono text-[11px] text-ink/80">{tunnelUrl}</span>
          {copied ? <Check size={12} className="shrink-0 text-emerald-600" /> : <Copy size={12} className="shrink-0 text-ink/40" />}
        </button>
      )}

      <div className="flex items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={toggling}
          className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer ${
            tunnelActive
              ? 'bg-black/5 text-ink hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15'
              : 'bg-[var(--app-accent)] text-white hover:opacity-90'
          }`}
        >
          {toggling ? <Loader2 size={12} className="animate-spin" /> : <Globe size={12} />}
          {tunnelActive ? 'Stop tunnel' : 'Go live'}
        </button>
      </div>
    </div>
  );
}

/* ── Access & payments ($) ─────────────────────────────────────────── */

export function AccessMenuContent({
  project,
  onSaved,
}: {
  project: HTMLFile;
  /** Called after every successful save — the header refetches the folio. */
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);

  const put = async (field: string, value: PaidAccessConfig | string | null) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/files/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (res.ok) onSaved();
    } catch (err) {
      console.error('Failed to update access settings:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <GateConfig
        value={project?.paidAccess}
        onChange={(next) => put('paidAccess', next)}
        disabled={saving}
        thumbnailValue={project?.thumbnailUrl}
        onThumbnailChange={(url) => put('thumbnailUrl', url)}
        scopeId={project?.id}
        organizationId={project?.organization_id}
      />
    </div>
  );
}

/* ── Marketplace listing (storefront) ──────────────────────────────── */

export function ListingMenuContent({
  project,
  onSaved,
}: {
  project: HTMLFile;
  onSaved: () => void;
}) {
  return (
    <ListingConfig
      folioId={project?.id}
      listing={project?.listing}
      onPersist={() => onSaved()}
    />
  );
}

/* ── Featured pin (star) ───────────────────────────────────────────── */

export function FeaturedMenuContent({
  projectId,
  pinned,
  username,
  onPinnedChange,
}: {
  projectId: string;
  /** Pin state owned by the header (the trigger icon needs it). */
  pinned: boolean;
  username?: string;
  onPinnedChange: (pinned: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ featured_folio_id: pinned ? null : projectId }),
      });
      if (res.ok) onPinnedChange(!pinned);
    } catch {
      // transient — star stays put
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink">Featured on profile</p>
          <p className="mt-0.5 text-[11px] leading-snug text-ink/50">
            {pinned
              ? 'Shown as the hero card at the top of your public page.'
              : 'Pins this folio as the hero card of your public page.'}
          </p>
        </div>
        <Toggle checked={pinned} onChange={toggle} disabled={busy} />
      </div>

      {username && (
        <a
          href={`/@${username}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-8 items-center gap-1.5 rounded-lg bg-black/5 px-2.5 text-xs font-semibold text-ink/70 transition-colors hover:bg-black/10 hover:text-ink"
        >
          <Star size={11} className={pinned ? 'fill-current text-[var(--app-accent)]' : ''} />
          View public page — @{username}
          <ExternalLink size={10} className="ml-auto opacity-50" />
        </a>
      )}

      {busy && (
        <p className="flex items-center gap-1.5 text-[11px] text-ink/50">
          <Loader2 size={11} className="animate-spin" /> Saving…
        </p>
      )}
    </div>
  );
}

/* ── Export ZIP confirmation ───────────────────────────────────────── */

export function ExportMenuContent({
  title,
  onExport,
  onCancel,
}: {
  title: string;
  onExport: () => void;
  onCancel: () => void;
}) {
  const [exporting, setExporting] = useState(false);

  return (
    <div className="space-y-2.5">
      <p className="text-[13px] leading-relaxed text-ink/80">
        Download <strong className="font-semibold">{title || 'this folio'}</strong> as a ZIP of
        its HTML files (the latest saved version).
      </p>
      <p className="text-[11px] leading-snug text-ink/50">
        Exporting is for your own archive and reuse — any paid-access or
        marketplace settings stay on the folio, not in the files.
      </p>
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => {
            setExporting(true);
            try {
              onExport();
              onCancel();
            } finally {
              setExporting(false);
            }
          }}
          disabled={exporting}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-[var(--app-accent)] px-3.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
          Export ZIP
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={exporting}
          className="h-8 rounded-lg px-3 text-xs font-semibold text-ink/60 transition-colors hover:bg-black/5 hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
