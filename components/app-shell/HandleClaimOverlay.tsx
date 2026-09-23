'use client';

/**
 * Claim-your-@handle step for new cloud users. Shows once (per browser
 * session) when the signed-in profile has no username:
 *
 * - live availability as you type (debounced /api/handles/available)
 * - suggestion chips seeded from email/full name (/api/handles/suggest)
 * - "Claim @handle" when valid + available
 * - "Skip — use <first suggestion>" auto-claims the best suggestion so no
 *   account stays handle-less (handle is editable later in Settings)
 *
 * Portaled to <body> so no shell ancestor clips it. Nothing about this is
 * a hard gate: the app remains usable behind it via Skip.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Loader2, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HANDLE_MAX, isValidHandle, normalizeHandle } from '@/lib/handles';

const SKIP_KEY = 'livefolio_handle_skip_v1';

type Availability = 'idle' | 'checking' | 'available' | 'taken' | 'reserved' | 'invalid';

export function HandleClaimOverlay() {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [availability, setAvailability] = useState<Availability>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Should we show? → profile without a username, not skipped this session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [profileRes, suggestRes] = await Promise.all([
          fetch('/api/profile'),
          fetch('/api/handles/suggest'),
        ]);
        const profile = profileRes.ok ? (await profileRes.json())?.profile : null;
        if (cancelled) return;
        if (profile?.username || sessionStorage.getItem(SKIP_KEY) === '1') return;
        setSuggestions(suggestRes.ok ? (await suggestRes.json())?.suggestions ?? [] : []);
        setOpen(true);
      } catch {
        // profile unavailable — stay hidden
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Live availability while typing (debounced).
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const value = username.trim();
    if (value.length === 0) {
      setAvailability('idle');
      return;
    }
    if (!isValidHandle(value)) {
      setAvailability('invalid');
      return;
    }
    setAvailability('checking');
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/handles/available?username=${encodeURIComponent(value)}`);
        const data = res.ok ? await res.json() : null;
        if (data?.available) setAvailability('available');
        else if (data?.reason === 'reserved') setAvailability('reserved');
        else setAvailability('taken');
      } catch {
        setAvailability('idle');
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [username]);

  const claim = useCallback(async (handle: string) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/handles/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: handle }),
      });
      if (res.ok) {
        setOpen(false);
        sessionStorage.setItem(SKIP_KEY, '1');
        return true;
      }
      const data = await res.json().catch(() => ({}));
      setError(data?.message || 'Could not claim that handle. Try another.');
      if (data?.error === 'USERNAME_TAKEN') setAvailability('taken');
      return false;
    } catch {
      setError('Network error — try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const canClaim =
    isValidHandle(username.trim()) &&
    (availability === 'available' || availability === 'idle' || availability === 'checking') &&
    !busy;

  const skipAndAutoClaim = useCallback(async () => {
    // Auto-claim the top suggestion (or whatever is typed when valid).
    const target = isValidHandle(username.trim())
      ? username.trim()
      : suggestions[0];
    if (target && (await claim(target))) return;
    // Claim failed or nothing to claim — dismiss for the session anyway.
    sessionStorage.setItem(SKIP_KEY, '1');
    setOpen(false);
  }, [username, suggestions, claim]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#0F0F0D]/45 animate-in fade-in duration-150" aria-hidden="true" />
      <div className="relative w-full max-w-sm overflow-hidden rounded-2xl bg-white p-6 shadow-2xl shadow-black/10 ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-150 dark:bg-[#1C1C19] dark:ring-white/10">
        <button
          type="button"
          onClick={skipAndAutoClaim}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg text-ink/40 hover:bg-black/5 hover:text-ink dark:hover:bg-white/10"
        >
          <X size={14} />
        </button>

        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--app-accent)] text-white shadow-sm">
          <Sparkles size={18} />
        </div>
        <h2 className="mt-4 text-lg font-bold tracking-tight text-ink">Claim your @handle</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink/60">
          This is your public identity on LiveFolio — profile page, folio links and your
          storefront all live at <span className="font-medium text-ink">livefolio.cloud/@you</span>.
          You can change it anytime in Settings.
        </p>

        <div className="mt-4">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-ink/60">@</span>
            <input
              value={username}
              onChange={(e) => {
                setUsername(normalizeHandle(e.target.value));
                setError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canClaim) void claim(username.trim());
              }}
              placeholder="your-handle"
              maxLength={HANDLE_MAX}
              autoFocus
              className={cn(
                'h-10 w-full rounded-xl border bg-white px-3 text-[15px] text-ink placeholder:text-ink/35 focus:outline-none dark:bg-white/5',
                availability === 'taken' || availability === 'reserved' || availability === 'invalid'
                  ? 'border-rose-400/70'
                  : 'border-[#0F0F0D]/15 dark:border-[#F4F4F0]/15 focus:border-[var(--app-accent)]'
              )}
            />
          </div>
          <p className="mt-1.5 h-4 text-[11px] font-medium">
            {availability === 'checking' && (
              <span className="flex items-center gap-1 text-ink/40">
                <Loader2 size={11} className="animate-spin" /> Checking…
              </span>
            )}
            {availability === 'available' && (
              <span className="flex items-center gap-1 text-emerald-600">
                <Check size={11} /> Available
              </span>
            )}
            {availability === 'taken' && <span className="text-rose-500">Already taken</span>}
            {availability === 'reserved' && <span className="text-rose-500">Reserved</span>}
            {availability === 'invalid' && username.length > 0 && (
              <span className="text-rose-500">
                3–30 chars, letters/numbers/-/_, no special at the ends
              </span>
            )}
          </p>
        </div>

        {suggestions.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setUsername(s)}
                className="inline-flex h-7 items-center rounded-full bg-black/5 px-3 text-xs font-semibold text-ink/70 transition-colors hover:bg-[var(--app-accent)]/10 hover:text-[var(--app-accent)] dark:bg-white/10"
              >
                @{s}
              </button>
            ))}
          </div>
        )}

        {error && <p className="mt-2 text-[11px] font-medium text-rose-500">{error}</p>}

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => canClaim && void claim(username.trim())}
            disabled={!canClaim}
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--app-accent)] px-4 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : null}
            Claim @{username.trim() || 'handle'}
          </button>
          <button
            type="button"
            onClick={skipAndAutoClaim}
            disabled={busy}
            className="h-9 rounded-xl px-3 text-xs font-semibold text-ink/50 transition-colors hover:bg-black/5 hover:text-ink dark:hover:bg-white/10"
          >
            Skip — pick for me
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
