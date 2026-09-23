'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import { ChatView } from '../chat-view/ChatView';
import RecentsGrid, { type RecentFolio } from './RecentsGrid';

// Lazy: the modal (incl. its zip-unpacking code) loads only when first opened —
// same treatment the sidebar gives it, for the same bundle reason.
const CreateFolioModal = dynamic(
  () => import('@/components/dashboard/CreateFolioModal'),
  { ssr: false },
);

/**
 * `/app` — the returning-user landing.
 *
 * Two faces, one rule: **an empty account gets the creation hero, an account
 * with work gets its work.** The hero is a strong first-run experience and a
 * poor tenth-run one — once there are folios, "where did I leave off" is the
 * question worth answering, and the hero is still one click away via New folio.
 *
 * While the first fetch is in flight it renders a spinner rather than the hero:
 * flashing a full creation UI at someone who has 30 folios, only to replace it,
 * reads as a bug.
 *
 * If the fetch fails, the hero is the fallback — a landing that still lets you
 * create is a better failure mode than an empty grid claiming you have nothing.
 */
export default function RecentsHome() {
  const [folios, setFolios] = useState<RecentFolio[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/files', { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) {
          setFailed(true);
          return;
        }
        const data = await res.json();
        if (!cancelled) setFolios(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const showHero = failed || (folios !== null && folios.length === 0);

  return (
    <main className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {folios === null && !failed ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 size={16} className="animate-spin text-ink/20" />
        </div>
      ) : showHero ? (
        <ChatView mode="hero" />
      ) : (
        <div className="flex-1 overflow-y-auto">
          <RecentsGrid folios={folios ?? []} onNewFolio={() => setCreateOpen(true)} />
        </div>
      )}

      {/* Mounted on demand — the modal is only imported when first opened. */}
      {isCreateOpen && (
        <CreateFolioModal
          isOpen
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </main>
  );
}
