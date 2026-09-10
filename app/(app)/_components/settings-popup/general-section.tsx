'use client';

/**
 * Settings popup — General section (both modes). FLAT by design: one
 * surface, compact rows, no cards, no containers, no big buttons, nothing
 * that forces scrolling. The cloud profile form is forked here as plain
 * rows (same /api/profile endpoints as the legacy form); preferences are
 * the theme toggle only — no links back to the old pages, /app replaces
 * them.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { isValidHandle, HANDLE_MAX } from '@/lib/handles';
import { BookOpen, ExternalLink, ImagePlus, Loader2, Trash2, User } from 'lucide-react';
import { isCloud } from '@/lib/env';
import { createBrowserClient } from '@/lib/supabase';
import ThemeToggle from '@/components/ui/theme-toggle';
import { PROFILE_BANNERS, isPresetBanner } from '@/lib/profile-banners';
import { cn } from '@/lib/utils';
import { SectionShell } from './section-shell';
import { Toggle } from './toggle';
import FollowCounts from '@/components/profile/FollowCounts';
import { LocalModelKeys } from '@/components/chat/LocalModelKeys';

function LabeledRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-24 shrink-0 text-xs font-medium text-ink/60">{label}</label>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

const inputCls =
  'h-8 w-full border-0 border-b border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 bg-transparent px-0.5 text-[13px] text-ink placeholder:text-ink/50 focus:outline-none focus:border-b-2 focus:border-[var(--app-accent)] transition-colors';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** HSL → hex — used by the spectrum strip picker. */
function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) => Math.round(255 * x).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`.toUpperCase();
}

/** Hue (0–360) of a valid hex color — the spectrum strip's aria-valuenow. */
function hexHue(hex: string): number {
  if (!HEX_RE.test(hex)) return 0;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return Math.round(h);
}

/** Shift the hue of a valid hex color by ±degrees (spectrum arrow keys). */
function shiftHue(hex: string, delta: number): string {
  if (!HEX_RE.test(hex)) return hex;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return hex;
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  return hslToHex((hexHue(hex) + delta + 360) % 360, s * 100, l * 100);
}

function ProfileRows() {
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [bio, setBio] = useState('');
  const [website, setWebsite] = useState('');
  const [backgroundUrl, setBackgroundUrl] = useState('');
  const [profileId, setProfileId] = useState('');
  const [accent, setAccent] = useState('#FF3B00');
  const [isPublic, setIsPublic] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingBanner, setIsUploadingBanner] = useState(false);
  const [bannerError, setBannerError] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/profile');
        if (res.ok && !cancelled) {
          const data = await res.json();
          if (data.profile) {
            setUsername(data.profile.username || '');
            setFullName(data.profile.full_name || '');
            setBio(data.profile.bio || '');
            setWebsite(data.profile.website || '');
            setBackgroundUrl(data.profile.background_url || '');
            setProfileId(data.profile.id || '');
            setAccent(data.profile.accent_color || '');
            setIsPublic(data.profile.is_public !== false);
          }
        }
      } catch {
        // profile unavailable — fields stay empty
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Upload the banner to Supabase Storage (public bucket), then stash the
  // public URL in state — the form's Save persists it with the other fields.
  const uploadBanner = async (file: File) => {
    if (!file || isUploadingBanner) return;
    if (!file.type.startsWith('image/')) {
      setBannerError('Please choose an image file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setBannerError('Image is larger than 5MB.');
      return;
    }
    setBannerError('');
    setIsUploadingBanner(true);
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
      const supabase = createBrowserClient(url, key);
      const safeName = file.name.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
      const path = `banners/${profileId}/${Date.now()}-${safeName}`;
      const { error: uploadErr } = await supabase.storage
        .from('profile-banners')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadErr) throw uploadErr;
      const { data: pub } = supabase.storage.from('profile-banners').getPublicUrl(path);
      setBackgroundUrl(pub.publicUrl);
    } catch (e) {
      console.error('Banner upload failed:', e);
      setBannerError('Upload failed — please try again.');
    } finally {
      setIsUploadingBanner(false);
    }
  };

  // Click anywhere on the spectrum strip → pick that hue at full saturation.
  const pickFromSpectrum = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
    const hue = Math.round((x / rect.width) * 360);
    setAccent(hslToHex(hue, 100, 50));
    setError('');
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setError('');
    // Validate the accent before hitting the API — mirror the server regex.
    // Empty means "default LiveFolio page" (the API clears the color).
    if (accent && !HEX_RE.test(accent)) {
      setError('Accent must be a 6-digit hex color, e.g. #FF3B00.');
      return;
    }
    setIsSaving(true);
    setSaved(false);
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim() || null,
          full_name: fullName.trim() || null,
          bio: bio.trim() || null,
          website: website.trim() || null,
          background_url: backgroundUrl.trim() || null,
          accent_color: accent || null,
          is_public: isPublic,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        setError(data.error || 'Failed to update profile.');
      }
    } catch {
      setError('Network error.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-ink/60">
        <Loader2 size={13} className="animate-spin" />
        Loading profile…
      </div>
    );
  }

  return (
    <form onSubmit={save} className="space-y-2.5">
      <LabeledRow label="Username">
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-ink/60">@</span>
          <input
            value={username}
            onChange={(e) => {
              setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''));
              setError('');
            }}
            placeholder="your-handle"
            maxLength={30}
            className={inputCls}
          />
        </div>
        {username && (
          <a
            href={`/@${username}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-[var(--app-accent)] hover:underline"
          >
            <ExternalLink size={10} />
            livefolio.cloud/@{username}
          </a>
        )}
        <UsernameAvailability username={username} />
      </LabeledRow>
      {isCloud && username.trim() && (
        <LabeledRow label="Network">
          <FollowCounts username={username.trim()} isOwner />
        </LabeledRow>
      )}
      <LabeledRow label="Display name">
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your name" className={inputCls} />
      </LabeledRow>
      <LabeledRow label="Website">
        <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://your-site.com" className={inputCls} />
      </LabeledRow>
      <div className="flex items-start gap-3">
        <label className="w-24 shrink-0 pt-1.5 text-xs font-medium text-ink/60">Banner</label>
        <div className="min-w-0 flex-1 space-y-2">
          {/* Curated library — pick one of the presets */}
          <div className="grid grid-cols-5 gap-1.5">
            {PROFILE_BANNERS.map((b) => {
              const selected = backgroundUrl === b.path;
              return (
                <button
                  key={b.id}
                  type="button"
                  title={b.label}
                  onClick={() => setBackgroundUrl(b.path)}
                  className={cn(
                    'relative h-12 overflow-hidden rounded-lg transition-all cursor-pointer',
                    selected
                      ? 'ring-2 ring-[var(--app-accent)] ring-offset-2 ring-offset-bone'
                      : 'opacity-70 hover:opacity-100 ring-1 ring-ink/10',
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={b.path} alt={b.label} className="h-full w-full object-cover" />
                </button>
              );
            })}
          </div>

          {/* Custom upload — replaces the preset when set */}
          <div className="flex items-center gap-2.5">
            {backgroundUrl && !isPresetBanner(backgroundUrl) ? (
              <div className="flex items-center gap-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={backgroundUrl}
                  alt="Profile banner"
                  className="h-12 w-24 shrink-0 rounded-lg object-cover ring-1 ring-ink/10"
                />
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => bannerInputRef.current?.click()}
                    disabled={isUploadingBanner}
                    className="h-7 rounded-lg bg-ink/5 px-2.5 text-xs font-medium text-ink/70 transition-colors hover:bg-ink/10 disabled:opacity-50"
                  >
                    {isUploadingBanner ? 'Uploading…' : 'Replace'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBackgroundUrl('')}
                    className="flex h-7 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-ink/50 transition-colors hover:text-red-600"
                  >
                    <Trash2 size={11} />
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => bannerInputRef.current?.click()}
                disabled={isUploadingBanner}
                className="flex h-7 items-center gap-1.5 rounded-lg bg-ink/5 px-2.5 text-xs font-medium text-ink/70 transition-colors hover:bg-ink/10 disabled:opacity-50"
              >
                <ImagePlus size={12} />
                {isUploadingBanner ? 'Uploading…' : 'Upload your own'}
              </button>
            )}
          </div>
          <input
            ref={bannerInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadBanner(f);
              e.target.value = '';
            }}
          />
          {bannerError && <p className="text-xs font-medium text-red-600">{bannerError}</p>}
          <p className="text-xs text-ink/40">Pick a library image or upload your own — up to 5MB.</p>
        </div>
      </div>
      <div className="flex items-start gap-3">
        <label className="w-24 shrink-0 pt-1.5 text-xs font-medium text-ink/60">Page color</label>
        <div className="min-w-0 flex-1 space-y-2">
          {/* Line 1 — preview square + the whole color spectrum on one strip */}
          <div className="flex items-center gap-2.5">
            <span
              className="h-6 w-6 shrink-0 rounded-md ring-1 ring-inset ring-ink/15"
              style={{ backgroundColor: HEX_RE.test(accent) ? accent : 'transparent' }}
              aria-hidden="true"
            />
            <div
              role="slider"
              aria-label="Page color spectrum"
              aria-valuenow={hexHue(accent)}
              aria-valuemin={0}
              aria-valuemax={360}
              aria-valuetext={accent}
              tabIndex={0}
              onClick={pickFromSpectrum}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') setAccent(shiftHue(accent, 15));
                if (e.key === 'ArrowLeft') setAccent(shiftHue(accent, -15));
              }}
              className="h-5 min-w-0 flex-1 cursor-crosshair rounded-md ring-1 ring-inset ring-ink/15"
              style={{
                background:
                  'linear-gradient(to right, #FF0000, #FFFF00, #00FF00, #00FFFF, #0000FF, #FF00FF, #FF0000)',
              }}
            />
          </div>

          {/* Line 2 — manual hex + reset to the brand default */}
          <div className="flex items-center gap-2">
            <input
              value={accent}
              onChange={(e) => {
                setAccent(e.target.value);
                setError('');
              }}
              placeholder="#FF3B00"
              maxLength={7}
              className={cn(inputCls, 'w-28 font-mono')}
            />
            <button
              type="button"
              onClick={() => {
                // Empty = the default LiveFolio page (clears the saved color).
                setAccent('');
                setError('');
              }}
              className="shrink-0 rounded-lg border border-[#0F0F0D]/10 px-2 py-1 text-xs font-medium text-ink/60 transition-colors hover:border-[var(--app-accent)] hover:text-[var(--app-accent)] dark:border-[#F4F4F0]/10"
            >
              Default
            </button>
            <span className="truncate text-xs text-ink/40">or type a hex, e.g. #6366F1</span>
          </div>
          <p className="text-xs text-ink/40">The background color of your public profile page.</p>
        </div>
      </div>
      <div className="flex items-start gap-3">
        <label className="w-24 shrink-0 pt-1.5 text-xs font-medium text-ink/60">Bio</label>
        <div className="min-w-0 flex-1">
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="A short description for your profile…"
            maxLength={500}
            rows={2}
            className="w-full resize-none border-0 border-b border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 bg-transparent px-0.5 py-1.5 text-[13px] text-ink placeholder:text-ink/50 focus:outline-none focus:border-b-2 focus:border-[var(--app-accent)] transition-colors"
          />
          <p className="mt-0.5 text-right text-xs text-ink/60">{bio.length}/500</p>
        </div>
      </div>
      <div className="flex items-center justify-between pt-1">
        <div>
          <span className="block text-sm font-medium text-ink">Public profile</span>
          <span className="text-xs text-ink/60">Show your profile and folios to everyone</span>
        </div>
        <Toggle checked={isPublic} onChange={() => setIsPublic(!isPublic)} />
      </div>

      {error && <p className="text-xs font-medium text-red-600">{error}</p>}

      <div className="flex items-center justify-end gap-2 pt-1">
        {saved && <span className="text-xs font-medium text-emerald-600">Saved</span>}
        <button
          type="submit"
          disabled={isSaving}
          className="h-8 rounded-lg bg-[var(--app-accent)] px-4 text-xs font-semibold text-white transition-colors hover:bg-[var(--app-accent)]/90 disabled:opacity-50"
        >
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

function OssEngineRows() {
  // Single source of truth for local keys — shared with the chat surfaces
  // (components/chat/LocalModelKeys). Keys live in this browser under the
  // LiveFolio_* localStorage keys the chat reads.
  return <LocalModelKeys />;
}

export function GeneralSection() {
  return (
    <>
      <SectionShell icon={User} title={isCloud ? 'Profile' : 'General'}>
        {isCloud ? <ProfileRows /> : <OssEngineRows />}
      </SectionShell>

      <SectionShell icon={User} title="Preferences">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-ink">Theme</span>
          <div className="w-fit">
            <ThemeToggle />
          </div>
        </div>
        <Link
          href="/docs"
          className="flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-[13px] font-medium text-ink/70 transition-colors hover:text-ink"
        >
          <BookOpen size={13} className="text-ink/40" />
          Documentation
          <ExternalLink size={11} className="text-ink/30" />
        </Link>
      </SectionShell>
    </>
  );
}


/** Live availability note under the Username field (debounced). */
function UsernameAvailability({ username }: { username: string }) {
  const [state, setState] = useState<'idle' | 'checking' | 'available' | 'taken' | 'reserved' | 'invalid'>('idle');
  useEffect(() => {
    let cancelled = false;
    const value = username.trim();
    if (value.length === 0) {
      setState('idle');
      return;
    }
    if (!isValidHandle(value)) {
      setState('invalid');
      return;
    }
    setState('checking');
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/handles/available?username=${encodeURIComponent(value)}`);
        const data = res.ok ? await res.json() : null;
        if (cancelled) return;
        if (data?.available) setState('available');
        else if (data?.reason === 'reserved') setState('reserved');
        else setState('taken');
      } catch {
        if (!cancelled) setState('idle');
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [username]);

  if (state === 'idle') return null;
  return (
    <p className="mt-1 text-[11px] font-medium">
      {state === 'checking' && <span className="text-ink/40">Checking availability…</span>}
      {state === 'available' && <span className="text-emerald-600">Available</span>}
      {state === 'taken' && <span className="text-rose-500">Already taken</span>}
      {state === 'reserved' && <span className="text-rose-500">Reserved</span>}
      {state === 'invalid' && (
        <span className="text-rose-500">
          3–{HANDLE_MAX} chars, letters/numbers/-/_, no special at the ends
        </span>
      )}
    </p>
  );
}
