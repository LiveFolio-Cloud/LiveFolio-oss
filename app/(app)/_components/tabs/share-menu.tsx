'use client';

/**
 * Share menu — SHARE-only controls: the share link (copy/open), publish/
 * unpublish, privacy toggles (private + access key, comments, presentation
 * mode) and collaborators. Paid gating lives under the Access ($) header
 * menu; marketplace listing under the Marketplace (storefront) menu — this
 * panel stays focused on who can see the folio and how it's shared.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, RefreshCw, X } from 'lucide-react';
import type { HTMLFile } from '@/lib/db';
import { isCloud } from '@/lib/env';
import { Toggle } from '../settings-popup/toggle';
import { HeaderMenuSurface } from './header-menu';

/** The folio slice the share menu reads/writes. HTMLFile covers every field
 *  the menu toggles; `ownerUsername` is an extra echoed by the GET /api/files
 *  responses (the canonical @username/slug link needs it). */
type ShareFolio = HTMLFile & { ownerUsername?: string };

/** 8-char access key — same generator shape as the v1 header. */
/** One link row: label + copy/open actions. */
function LinkRow({
  label,
  url,
  copied,
  onCopy,
  muted,
}: {
  label: string;
  url: string;
  copied: boolean;
  onCopy: () => void;
  muted?: boolean;
}) {
  return (
    <div className={muted ? 'opacity-70' : ''}>
      <label className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink/40">
        {label}
      </label>
      <div className="mt-0.5 flex items-center gap-1.5">
        <input
          readOnly
          value={url}
          className="h-8 w-full border-0 border-b border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 bg-transparent px-0.5 text-[13px] text-ink placeholder:text-ink/50 focus:border-b-2 focus:border-[var(--app-accent)] focus:outline-none transition-colors"
        />
        <button
          type="button"
          onClick={onCopy}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink/60 hover:bg-black/5 hover:text-ink"
          aria-label={`Copy ${label.toLowerCase()} link`}
          title="Copy link"
        >
          {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
        </button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink/60 transition-colors hover:bg-black/5 hover:text-ink"
          aria-label={`Open ${label.toLowerCase()} link`}
          title="Open link"
        >
          <ExternalLink size={13} />
        </a>
      </div>
    </div>
  );
}

function randomAccessKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 8);
}

export function ShareMenu({
  project,
  onSaved,
  onClose,
  open,
}: {
  project: ShareFolio;
  onSaved?: () => void;
  /** Mobile mask dismissal + Escape — the header's outside-click handles desktop. */
  onClose?: () => void;
  open: boolean;
}) {
  const [folio, setFolio] = useState<ShareFolio>(project);
  const [saving, setSaving] = useState(false);
  const [collabEmail, setCollabEmail] = useState('');
  const accessKeyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setFolio(project);
  }, [project]);

  // Optimistic update: reflect immediately, reconcile with the server echo.
  const put = async (field: string, value: string | boolean | string[]) => {
    if (!folio) return;
    const folioId = folio.id;
    setSaving(true);
    setFolio((prev) => ({ ...prev, [field]: value } as ShareFolio));
    try {
      const res = await fetch(`/api/files/${folioId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (res.ok) {
        const data = await res.json();
        setFolio((prev) => ({ ...prev, ...(data?.project ?? data ?? {}) } as ShareFolio));
        onSaved?.();
      } else {
        const fresh = await fetch(`/api/files/${folioId}`, { cache: 'no-store' });
        if (fresh.ok) setFolio(await fresh.json());
      }
    } catch (err) {
      console.error('Failed to update folio setting:', err);
    } finally {
      setSaving(false);
    }
  };

  const saveAccessKey = (key: string) => {
    if (!folio) return;
    if (accessKeyTimer.current) clearTimeout(accessKeyTimer.current);
    accessKeyTimer.current = setTimeout(() => {
      fetch(`/api/files/${folio.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessKey: key }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data) setFolio((prev) => ({ ...prev, ...(data?.project ?? data ?? {}) } as ShareFolio));
          onSaved?.();
        })
        .catch(() => {});
    }, 600);
  };

  const isPublished = folio.status === 'published';

  // Canonical links, derived INSTANTLY from the folio the studio already
  // holds (ownerUsername rides on GET /api/files/[id]; slug on the folio).
  // The pretty @username/slug link is preferred — /share/ redirects to it
  // when one exists — with the legacy direct link shown alongside.
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const directUrl = `${origin}/share/${folio?.id ?? ''}`;
  const ownerUsername = folio.ownerUsername;
  const slug = folio.slug ?? undefined;
  const canonical = Boolean(ownerUsername && slug && folio?.id);
  const publicUrl = canonical ? `${origin}/@${ownerUsername}/${slug}` : directUrl;

  const copyUrl = (key: string, url: string) => {
    navigator.clipboard.writeText(url).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  // Privacy/sharing toggles — keys are literal HTMLFile field names so the
  // optimistic reads/writes below stay type-safe.
  const shareToggles: { key: 'isPrivate' | 'allowComments' | 'presentationModeOnly'; label: string }[] = [
    { key: 'isPrivate', label: 'Private folio' },
    { key: 'allowComments', label: 'Allow comments' },
    { key: 'presentationModeOnly', label: 'Presentation mode' },
  ];

  return (
    <HeaderMenuSurface
      open={open}
      onClose={() => onClose?.()}
      title="Share"
    >
      <div className="space-y-2">
        {/* Public (canonical) link — @username/slug when available */}
        <LinkRow
          label={canonical ? 'Public link' : 'Share link'}
          url={publicUrl}
          copied={copiedKey === 'public'}
          onCopy={() => copyUrl('public', publicUrl)}
        />
        {canonical && directUrl !== publicUrl && (
          <div>
            <LinkRow
              label="Direct link"
              muted
              url={directUrl}
              copied={copiedKey === 'direct'}
              onCopy={() => copyUrl('direct', directUrl)}
            />
            <p className="mt-1 text-[10px] text-ink/40">
              Both reach this folio — Public is the clean @username link; Direct is the
              legacy /share link (redirects to Public).
            </p>
          </div>
        )}
      </div>

      <div className="my-3 h-px bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10" />

      <div className="space-y-3">
        {/* Published state — the toggle replaces the old header pill; the
            Share icon itself carries the visual state (orange square). */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-ink">Published</p>
            <p className="mt-0.5 text-[11px] leading-snug text-ink/50">
              {isPublished
                ? 'Live on the web — anyone with the link can view.'
                : 'Hidden — publishing makes the link live.'}
            </p>
          </div>
          <Toggle
            checked={isPublished}
            onChange={() => put('status', isPublished ? 'draft' : 'published')}
            disabled={saving}
          />
        </div>

        {shareToggles.map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between gap-3">
            <span className="text-[13px] font-medium text-ink">{label}</span>
            <Toggle checked={Boolean(folio?.[key])} onChange={() => put(key, !folio?.[key])} disabled={saving} />
          </div>
        ))}

        {folio?.isPrivate && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-ink/50">Access key</label>
              <button
                type="button"
                onClick={() => saveAccessKey(randomAccessKey())}
                className="flex items-center gap-1 text-[11px] font-semibold text-[var(--app-accent)] hover:underline"
              >
                <RefreshCw size={10} />
                Regenerate
              </button>
            </div>
            <input
              value={folio?.accessKey || ''}
              onChange={(e) => {
                const val = e.target.value;
                setFolio({ ...folio, accessKey: val });
                saveAccessKey(val);
              }}
              className="h-8 w-full border-0 border-b border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 bg-transparent px-0.5 text-[13px] text-ink placeholder:text-ink/50 focus:border-b-2 focus:border-[var(--app-accent)] focus:outline-none transition-colors"
              placeholder="No access key set"
            />
          </div>
        )}

        {isCloud && (
          <div className="space-y-1.5 border-t border-[#0F0F0D]/5 pt-3 dark:border-[#F4F4F0]/10">
            <label className="text-[11px] font-bold text-ink/50">Collaborators</label>
            <div className="flex flex-wrap gap-1.5">
              {(folio?.collaborators || []).map((email: string, i: number) => (
                <span
                  key={`${email}-${i}`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-black/5 px-2.5 py-1 text-xs font-medium text-ink/70"
                >
                  {email}
                  <button
                    type="button"
                    onClick={() =>
                      put('collaborators', (folio.collaborators || []).filter((_: string, j: number) => j !== i))
                    }
                    className="cursor-pointer text-ink/40 hover:text-rose-600"
                    aria-label={`Remove ${email}`}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <input
                value={collabEmail}
                onChange={(e) => setCollabEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const email = collabEmail.trim().toLowerCase();
                    if (email && !(folio.collaborators || []).includes(email)) {
                      put('collaborators', [...(folio.collaborators || []), email]);
                      setCollabEmail('');
                    }
                  }
                }}
                placeholder="collaborator@example.com"
                className="h-8 w-full border-0 border-b border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 bg-transparent px-0.5 text-[13px] text-ink placeholder:text-ink/50 focus:border-b-2 focus:border-[var(--app-accent)] focus:outline-none transition-colors"
              />
              <button
                type="button"
                onClick={() => {
                  const email = collabEmail.trim().toLowerCase();
                  if (email && !(folio.collaborators || []).includes(email)) {
                    put('collaborators', [...(folio.collaborators || []), email]);
                    setCollabEmail('');
                  }
                }}
                className="h-8 shrink-0 rounded-lg bg-black/5 px-3 text-xs font-semibold text-ink hover:bg-black/10"
              >
                Add
              </button>
            </div>
          </div>
        )}
      </div>
    </HeaderMenuSurface>
  );
}
