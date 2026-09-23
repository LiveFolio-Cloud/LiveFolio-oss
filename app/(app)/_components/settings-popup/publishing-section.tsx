'use client';

/**
 * Settings popup — Publishing section (both modes).
 *
 * This was "Analytics", and it mixed two different things: a READING surface
 * (views, time on page, earnings, follower counts) and a GOVERNANCE surface
 * (publish/unpublish, private, allow-comments). The reading half is
 * dashboard-shaped — something you check repeatedly — and lives behind a
 * settings modal where nobody finds it; it now has its own destination at
 * /app/analytics. What remains is the half that is genuinely settings: the
 * switches you set once per folio.
 *
 * The per-folio share/access menus still carry the same toggles, which is
 * correct — this is the "manage several folios in one place" view of them.
 *
 * The comment/reaction READOUTS that used to sit here are gone too: feedback
 * has a real home now (the Inbox), and a truncated list of five comments in a
 * modal was a worse version of it.
 */
import { useEffect, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { SectionShell } from './section-shell';
import { Toggle } from './toggle';
import { Dropdown } from '@/components/ui/dropdown';

interface Folio {
  id: string;
  title: string;
  status?: string;
  isPrivate?: boolean;
  allowComments?: boolean;
}

/** Empty scope = nothing selected yet; the section defaults to the first folio. */
const NO_SCOPE = '';

export function PublishingSection() {
  const [folios, setFolios] = useState<Folio[]>([]);
  const [selectedId, setSelectedId] = useState<string>(NO_SCOPE);
  const [isLoading, setIsLoading] = useState(true);
  const [savingField, setSavingField] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/files');
        if (!res.ok) return;
        const data = (await res.json()) as Folio[];
        if (cancelled) return;
        setFolios(data);
        if (data.length > 0) setSelectedId((current) => current || data[0].id);
      } catch {
        // Best-effort — the section just renders empty.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const scopeFolio = folios.find((f) => f.id === selectedId) || null;

  const put = async (field: 'status' | 'isPrivate' | 'allowComments', value: unknown) => {
    if (!scopeFolio || savingField) return;
    setSavingField(true);
    // Optimistic — the toggle flips immediately and reverts on failure.
    setFolios((prev) =>
      prev.map((f) => (f.id === scopeFolio.id ? { ...f, [field]: value } : f)),
    );
    try {
      const res = await fetch(`/api/files/${scopeFolio.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) throw new Error('save failed');
    } catch {
      setFolios((prev) =>
        prev.map((f) => (f.id === scopeFolio.id ? { ...f, [field]: undefined } : f)),
      );
    } finally {
      setSavingField(false);
    }
  };

  return (
    <SectionShell icon={ShieldCheck} title="Publishing">
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={14} className="animate-spin text-ink/20" />
        </div>
      ) : folios.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-ink/50">
          No folios yet — publish one first.
        </p>
      ) : (
        <div className="space-y-4">
          <Dropdown
            value={selectedId}
            onChange={setSelectedId}
            options={folios.map((f) => ({ value: f.id, label: f.title || 'Untitled' }))}
          />

          {scopeFolio && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-ink">Status</span>
                <div className="flex items-center gap-2">
                  {scopeFolio.status === 'published' ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink/70">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      Published
                    </span>
                  ) : scopeFolio.isPrivate ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink/70">
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--app-accent)]" />
                      Private
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink/70">
                      <span className="h-1.5 w-1.5 rounded-full bg-ink/30" />
                      Draft
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      put('status', scopeFolio.status === 'published' ? 'draft' : 'published')
                    }
                    disabled={savingField}
                    className="h-7 cursor-pointer rounded-lg bg-[var(--app-accent)] px-3 text-xs font-semibold text-white transition-colors hover:bg-[var(--app-accent)]/90 disabled:opacity-50"
                  >
                    {scopeFolio.status === 'published' ? 'Unpublish' : 'Publish'}
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-ink">Private folio</span>
                <Toggle
                  checked={Boolean(scopeFolio.isPrivate)}
                  onChange={() => put('isPrivate', !scopeFolio.isPrivate)}
                  disabled={savingField}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-ink">Allow comments</span>
                <Toggle
                  checked={Boolean(scopeFolio.allowComments)}
                  onChange={() => put('allowComments', !scopeFolio.allowComments)}
                  disabled={savingField}
                />
              </div>
              <p className="flex items-center gap-1.5 pt-1 text-[11px] text-ink/40">
                <ShieldCheck size={11} />
                Changes apply immediately to the live folio.
              </p>
            </div>
          )}
        </div>
      )}
    </SectionShell>
  );
}
