'use client';

import React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { FilePlus2, MessageCircle, Lock, Archive } from 'lucide-react';
import { PreviewIframe } from './PreviewIframe';
import { formatRelativeTime as relativeTime } from '@/lib/inbox';

/** How many recent folios the landing shows before it stops being "recent". */
export const RECENTS_LIMIT = 12;

/**
 * The subset of a `/api/files` row this grid renders.
 *
 * Structural rather than imported from `lib/folio-row.ts` on purpose: that
 * module's `FolioData` carries the whole card surface (marketplace listing,
 * paid access, author), none of which the owner's own recents grid shows — and
 * its `'listing'` variant encodes a comment COUNT in a field typed as an array.
 * Declaring exactly what is read here keeps that lie out of this file.
 */
export interface RecentFolio {
  id: string;
  title?: string;
  status?: string;
  updatedAt?: string;
  thumbnailUrl?: string | null;
  versions?: { versionId?: string; files?: Record<string, string> }[];
  comments?: unknown;
  archivedAt?: string | null;
}

/** Newest first by updatedAt, archived excluded, capped. */
export function selectRecents(folios: RecentFolio[], limit = RECENTS_LIMIT): RecentFolio[] {
  return folios
    .filter((f) => !f.archivedAt)
    .slice()
    .sort((a, b) => (Date.parse(b.updatedAt ?? '') || 0) - (Date.parse(a.updatedAt ?? '') || 0))
    .slice(0, limit);
}

function commentCount(folio: RecentFolio): number {
  return Array.isArray(folio.comments) ? folio.comments.length : 0;
}

/** First HTML file of the newest version — the thing a preview should show. */
function previewSource(folio: RecentFolio): string | null {
  const versions = folio.versions ?? [];
  const latest = versions[versions.length - 1];
  const files = latest?.files ?? {};
  const keys = Object.keys(files);
  if (keys.length === 0) return null;
  const first = files['index.html'] ? 'index.html' : keys.find((k) => k.endsWith('.html')) ?? keys[0];
  return `/api/raw/${folio.id}/${first}?v=${latest?.versionId ?? ''}`;
}

function RecentsCard({ folio }: { folio: RecentFolio }) {
  const isDraft = folio.status === 'draft';
  const src = previewSource(folio);
  const thumbnail = folio.thumbnailUrl || null;
  const count = commentCount(folio);
  // Hash-gradient stand-in for a folio with neither thumbnail nor files — same
  // idea as the profile grid's, so an empty card still reads as "a folio".
  const hue = (folio.title ?? '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;

  return (
    <Link
      href={`/app/${folio.id}`}
      className={cn(
        'group flex flex-col overflow-hidden rounded-2xl bg-white',
        'ring-1 ring-[#0F0F0D]/5 dark:bg-[#171714] dark:ring-white/10',
        'transition-all duration-200 hover:ring-[var(--app-accent)]/40 hover:shadow-md',
      )}
    >
      <div className="relative aspect-video overflow-hidden bg-[#0F0F0D]/5">
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnail}
            alt={folio.title || 'Untitled'}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : src ? (
          <PreviewIframe src={src} title={folio.title || 'Untitled'} />
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: `linear-gradient(135deg, hsl(${hue},40%,90%), hsl(${hue + 25},35%,82%))` }}
          >
            <span className="text-3xl font-black text-white/40">{folio.title?.[0] || '?'}</span>
          </div>
        )}

        {/* Unpublished work must be obvious before the click — the same
            filled/hollow convention the sidebar rows use. */}
        {isDraft && (
          <span
            className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-[#0F0F0D]/70 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm"
            title="Draft — only you can see it"
          >
            <Lock size={9} /> Draft
          </span>
        )}
      </div>

      <div className="flex items-start gap-2 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold leading-tight text-ink">
            {folio.title || 'Untitled'}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink/45">
            <span>{relativeTime(folio.updatedAt)}</span>
            {count > 0 && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-0.5">
                  <MessageCircle size={9} />
                  {count}
                </span>
              </>
            )}
          </p>
        </div>
        {!isDraft && (
          <span
            className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500 dark:bg-emerald-400"
            title="Published — live on the web"
            aria-label="Published"
          />
        )}
      </div>
    </Link>
  );
}

/**
 * The recents grid — what `/app` shows a returning user.
 *
 * Cards link into the editor (`/app/<id>`), not the public share page: the
 * question this grid answers is "where did I leave off", and for the owner that
 * is the work surface.
 */
export default function RecentsGrid({
  folios,
  onNewFolio,
}: {
  folios: RecentFolio[];
  onNewFolio: () => void;
}) {
  const recents = selectRecents(folios);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-ink">Recent</h1>
          <p className="text-[12px] text-ink/45">
            {recents.length === 1 ? '1 folio' : `${recents.length} folios`} · newest first
          </p>
        </div>
        <button
          type="button"
          onClick={onNewFolio}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--app-accent)] px-3 py-1.5 text-[12px] font-semibold text-bone transition-colors hover:bg-ink cursor-pointer"
        >
          <FilePlus2 size={13} /> New folio
        </button>
      </div>

      {recents.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[#0F0F0D]/10 py-16 text-center dark:border-[#F4F4F0]/10">
          <Archive size={20} className="text-ink/25" />
          <p className="text-[13px] font-medium text-ink/60">Everything here is archived</p>
          <p className="text-[11px] text-ink/40">Restore a folio from the sidebar, or start a new one.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {recents.map((folio) => (
            <RecentsCard key={folio.id} folio={folio} />
          ))}
        </div>
      )}
    </div>
  );
}
