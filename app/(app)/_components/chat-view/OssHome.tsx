'use client';

/**
 * OSS home (`/app` in oss mode). There is no cloud AI composer locally —
 * creation happens via the sidebar's + New folio or an MCP agent, and chat
 * lives inside each folio. This page is the honest local start:
 *
 *  1. no model configured  → asks for a key right here (the same editor the
 *     chat uses — no Settings detour);
 *  2. configured           → your folios, one click to open and chat.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, FileText, MessageSquareText } from 'lucide-react';
import type { HTMLFile } from '@/lib/db';
import { LocalModelKeys } from '@/components/chat/LocalModelKeys';
import { useSettingsPopup } from '../settings-popup';

function timeAgo(iso: string | undefined): string {
  if (!iso) return '';
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function OssHome() {
  const { openSection } = useSettingsPopup();
  const [configured, setConfigured] = useState(false);
  const [folios, setFolios] = useState<HTMLFile[]>([]);
  const [loading, setLoading] = useState(true);

  const loadFolios = useCallback(async () => {
    try {
      const res = await fetch('/api/files');
      if (res.ok) setFolios((await res.json()) as HTMLFile[]);
    } catch {
      // leave the list empty — the empty state explains how to create
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFolios();
  }, [loadFolios]);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[#F4F4F0] dark:bg-[#0F0F0D]">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-5 py-6">
        {/* Top row — back to landing + mode chip */}
        <div className="mb-6 flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-ink/45 transition-colors hover:text-ink cursor-pointer"
          >
            <ArrowLeft size={11} />
            Back to landing
          </Link>
          <span className="rounded-full border border-[#0F0F0D]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-ink/45 dark:border-[#F4F4F0]/10">
            Local
          </span>
        </div>

        {!configured ? (
          /* ── Step 1: the key ask — same editor the chat uses ── */
          <div className="flex flex-1 flex-col justify-center">
            <span className="mb-4 inline-block h-8 w-8 bg-[#FF3B00]" />
            <h1 className="text-2xl font-black tracking-tighter text-ink">
              Connect a model to chat
            </h1>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-ink/55">
              Chat lives inside each folio and runs on your own keys or a local
              Ollama — nothing ever leaves this machine. Add one below and the
              model menu in any folio will offer it.
            </p>
            <div className="mt-5 rounded-2xl border border-[#0F0F0D]/10 bg-bone p-4 dark:border-[#F4F4F0]/10 dark:bg-[#191917]">
              <LocalModelKeys onChanged={setConfigured} />
            </div>
            <button
              type="button"
              onClick={() => openSection('integrations')}
              className="mt-5 inline-flex items-center gap-1 text-xs font-medium text-ink/45 transition-colors hover:text-[var(--app-accent)] cursor-pointer"
            >
              Prefer an agent? Connect it via MCP instead
              <ArrowUpRight size={11} />
            </button>
          </div>
        ) : (
          /* ── Step 2: your folios ── */
          <div className="flex flex-1 flex-col">
            <span className="mb-4 inline-block h-8 w-8 bg-[#FF3B00]" />
            <h1 className="text-2xl font-black tracking-tighter text-ink">Your folios</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink/55">
              Open one and pick the Chat tab — the model menu there is ready.
            </p>

            <div className="mt-5 flex-1 space-y-1.5">
              {loading ? (
                <p className="py-8 text-center text-sm text-ink/40">Loading…</p>
              ) : folios.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[#0F0F0D]/15 py-10 text-center dark:border-[#F4F4F0]/15">
                  <p className="text-sm font-medium text-ink/60">No folios yet</p>
                  <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-ink/45">
                    Create one with the <strong className="font-semibold">+ New folio</strong>{' '}
                    button in the sidebar, or let your agent publish via MCP.
                  </p>
                </div>
              ) : (
                folios.map((f) => (
                  <Link
                    key={f.id}
                    href={`/app/${f.id}`}
                    className="group flex items-center justify-between gap-3 rounded-xl border border-[#0F0F0D]/10 bg-bone px-3.5 py-2.5 transition-colors hover:border-[var(--app-accent)]/40 dark:border-[#F4F4F0]/10 dark:bg-[#191917]"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <FileText size={14} className="shrink-0 text-ink/40" />
                      <span className="truncate text-[13px] font-medium text-ink">
                        {f.title || 'Untitled'}
                      </span>
                    </div>
                    <span className="flex shrink-0 items-center gap-2 text-[11px] text-ink/40">
                      {timeAgo(f.updatedAt)}
                      <MessageSquareText
                        size={12}
                        className="transition-colors group-hover:text-[var(--app-accent)]"
                      />
                    </span>
                  </Link>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
