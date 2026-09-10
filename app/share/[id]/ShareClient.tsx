'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import LoadingScreen from '@/components/LoadingScreen';
import {
  MessageSquare,
  CheckCircle,
  ChevronRight,
  Maximize,
  Play,
  Lock,
  AlertCircle,
  HardDrive,
  X,
  MapPin,
  FileText,
  MessageCircle,
  PencilRuler,
  Smile,
  BookOpen,
  ArrowLeft,
  Flag,
  LogIn
} from 'lucide-react';
import CommentsPanel from '@/components/share/CommentsPanel';
import PaywallScreen from '@/components/share/PaywallScreen';
import PreviewCountdown from '@/components/share/PreviewCountdown';
import PurchasedActions from '@/components/share/PurchasedActions';
import UnlockOverlay from '@/components/share/UnlockOverlay';
import ReportPanel from '@/components/share/ReportPanel';
import type { GatePaidAccess, ViewerAccess } from '@/components/share/types';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { LICENSE_KIND_LABELS } from '@/lib/listing/types';
import { HTMLComment } from '@/lib/db';
import { isCloud } from '@/lib/env';
import { priceLabel } from '@/lib/gating/paywall-html';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { RadialDial } from '@/components/ui/RadialDial';
import type { RadialDialItem } from '@/components/ui/RadialDial';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { createBrowserClient, isSupabaseConfigured } from '@/lib/supabase';

interface InitialShareData {
  id: string;
  title: string;
  description: string;
  isPrivate: boolean;
  allowComments: boolean;
  presentationModeOnly: boolean;
  hasAccessKey: boolean;
  latestVersionId: string;
  activeFileList: string[];
  comments: HTMLComment[];
  reactions: { [emoji: string]: number };
  /** Paid-gate fields — cloud only, absent in OSS (FEATURES.paidGating=false). */
  paidAccess?: GatePaidAccess | null;
  viewerAccess?: ViewerAccess;
  accentColor?: string | null;
  thumbnailUrl?: string | null;
}

export default function GuestPresentationPage({ initialProject }: { initialProject?: InitialShareData | null }) {
  const params = useParams();
  // The guest viewer is mounted on /share/[id] (params.id) AND on the
  // @username/folio-slug route, which has no `id` param — fall back to the
  // id the SSR payload always carries.
  const id = (params.id as string) || initialProject?.id || '';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- `project` mixes the SSR row with client-merged gate fields; a full union type is impractical
  const [project, setProject] = useState<any | null>(initialProject ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activePreviewVersion, setActivePreviewVersion] = useState<string>(
    initialProject?.latestVersionId || ''
  );
  const [activeFilename, setActiveFilename] = useState<string>('index.html');

  const [isAnnotationMode, setIsAnnotationMode] = useState(false);
  const [tempPin, setTempPin] = useState<{
    x: number; y: number;
    selector?: string; elementHtml?: string; slideIndex?: number; sectionLabel?: string;
  } | null>(null);
  const [commentUserName, setCommentUserName] = useState('');
  const [commentText, setCommentText] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [isCommentSuccess, setIsCommentSuccess] = useState(false);
  const [syncTrigger, setSyncTrigger] = useState(0);
  // Transient toast for interaction-level notices (e.g. pinning not ready).
  const [pinNotice, setPinNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNotice = (msg: string) => {
    setPinNotice(msg);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setPinNotice(null), 3200);
  };
  // Pin bridge: when true, pins are captured + rendered INSIDE the folio
  // iframe by public/livefolio-pin-bridge.js; the parent-side overlay below
  // stays as a graceful fallback (e.g. folios whose own CSP blocks the
  // bridge script).
  const [bridgeReady, setBridgeReady] = useState(false);
  // Review identity — Cloud gates pins + reactions behind a session (mirrors
  // the Discussion panel's /api/auth/me flow); OSS keeps the legacy
  // free-text-name flow and treats every viewer as authed.
  const [viewerUser, setViewerUser] = useState<{ email: string; name?: string } | null>(null);
  const [viewerAuthLoading, setViewerAuthLoading] = useState(false);
  const [showLoginCta, setShowLoginCta] = useState(false);
  const [pinSubmitError, setPinSubmitError] = useState<string | null>(null);
  // Radial controls dial — the fan starts OPEN once as a discovery hint, then
  // auto-closes (see the syncTrigger effect below). `dialLevel` swaps the fan
  // between the main actions and the reaction picker.
  const [isFabOpen, setIsFabOpen] = useState(true);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [dialLevel, setDialLevel] = useState<'main' | 'emoji'>('main');

  // Paid gate — viewer-facing state (cloud only; inert in OSS where
  // `paidAccess` never exists).
  const [previewExpired, setPreviewExpired] = useState(false); // timed preview ran out
  const [showPaywall, setShowPaywall] = useState(false); // user tapped Unlock on first_page
  const [viewerSignedIn, setViewerSignedIn] = useState(false);

  // Comments panel (general discussion, separate from spatial pins)
  const [showComments, setShowComments] = useState(false);
  // Community moderation — report-content panel
  const [showReport, setShowReport] = useState(false);

  // Auto-close the FAB menu 2s after the folio finishes loading —
  // it's a discovery hint, not a permanent overlay. Starting the timer
  // at mount would close it before the iframe content is even visible.
  // Uses a ref for the once-guard (not state) so the effect's own
  // re-run doesn't clear the timer via cleanup.
  const autoClosedFabRef = useRef(false);
  useEffect(() => {
    if (autoClosedFabRef.current || syncTrigger === 0) return;
    autoClosedFabRef.current = true;
    const timer = setTimeout(() => setIsFabOpen(false), 2000);
    return () => clearTimeout(timer);
  }, [syncTrigger]);

  // Pick the first HTML file from the project (preferring index.html)
  useEffect(() => {
    if (!project?.activeFileList) return;
    const htmlFiles = project.activeFileList.filter((f: string) => f.endsWith('.html'));
    if (htmlFiles.length === 0) return;
    const best = htmlFiles.includes('index.html') ? 'index.html'
      : htmlFiles.sort()[0];
    if (activeFilename === 'index.html' && !htmlFiles.includes('index.html')) {
      setActiveFilename(best);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are intentionally project-identity only; the filename guard above prevents redundant set-state
  }, [project?.id]);

  // Filter to HTML pages only for the dropdown
  const htmlPages = (project?.activeFileList || []).filter((f: string) => f.endsWith('.html'));

  const [reactions, setReactions] = useState<{ [emoji: string]: number }>({});
  useEffect(() => {
    if (project?.reactions) setReactions(project.reactions);
  }, [project?.reactions]);

  const [accessKey, setAccessKey] = useState<string>('');
  const [accessKeyInput, setAccessKeyInput] = useState<string>('');
  const [authError, setAuthError] = useState<string>('');
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [hasStartedPresentation, setHasStartedPresentation] = useState<boolean>(false);

  // Auto-hide header: visible on mount, hides after 3s idle, shows on mouse near top
  const [headerVisible, setHeaderVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetHeaderTimer = () => {
    setHeaderVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setHeaderVisible(false), 3000);
  };

  // Use window mousemove — fires when the pointer leaves the iframe (e.g. heading to browser chrome)
  useEffect(() => {
    resetHeaderTimer();
    const handleMouseMove = (e: MouseEvent) => {
      if (e.clientY <= 64) resetHeaderTimer();
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Listen for messages from the guest iframe. The sandboxed iframe has an
  // OPAQUE origin ('null'), so the old origin check matched nothing — the
  // sender is authenticated by window identity (e.source) instead. Handles:
  //   PINS_READY  — the in-iframe pin bridge is up (re-sync below)
  //   PIN_DROP    — capture happened inside the folio; carries DOM context
  //   MOUSE_EDGE  — legacy edge-hover (kept for older in-iframe bridges)
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      const guestWindow = iframeRef.current?.contentWindow;
      if (!guestWindow || e.source !== guestWindow) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- bridge payloads are window-shaped; fields are typeof-guarded below
      const d = e.data as any;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'LIVEFOLIO_PINS_READY') {
        setBridgeReady(true);
      } else if (d.type === 'LIVEFOLIO_PIN_DROP') {
        if (typeof d.x !== 'number' || typeof d.y !== 'number') return;
        setTempPin({
          x: d.x,
          y: d.y,
          selector: typeof d.selector === 'string' ? d.selector : undefined,
          elementHtml: typeof d.elementHtml === 'string' ? d.elementHtml : undefined,
          slideIndex: typeof d.slideIndex === 'number' ? d.slideIndex : undefined,
          sectionLabel: typeof d.sectionLabel === 'string' ? d.sectionLabel : undefined,
        });
      } else if (d.type === 'LIVEFOLIO_MOUSE_EDGE') {
        // Show header when mouse is near top 64px or bottom 64px inside the iframe
        if (d.clientY <= 64 || d.clientY >= d.viewportHeight - 64) {
          resetHeaderTimer();
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- iframeRef is a ref, read at event time
  }, []);

  // Pull-based bridge handshake. The bridge sends PINS_READY at script parse
  // time, which can fire BEFORE this component's message listener is mounted
  // (the folio + bridge load from cache in milliseconds, while React is still
  // hydrating the shell) — a one-shot READY would then be lost and pinning
  // would report "still loading" forever. Ping until the bridge answers.
  useEffect(() => {
    if (bridgeReady) return;
    let tries = 0;
    const timer = setInterval(() => {
      const guestWindow = iframeRef.current?.contentWindow;
      if (guestWindow) guestWindow.postMessage({ type: 'LIVEFOLIO_PINS_PING' }, '*');
      tries += 1;
      if (tries >= 10) clearInterval(timer); // ~4s budget; READY flips state and this effect cleans up
    }, 400);
    return () => clearInterval(timer);
  }, [bridgeReady]);

  // The folio iframe uses sandbox="allow-scripts" (no allow-same-origin), so
  // the parent can never reach into its document — folio HTML runs in an
  // isolated origin and cannot touch the app's cookies/localStorage. Pins are
  // captured + rendered INSIDE that document by the injected bridge
  // (public/livefolio-pin-bridge.js) so they carry a real DOM selector and
  // stay anchored to their element as the page scrolls.
  //
  // Sandbox tokens (folio-link support, see 373d457): the FULL set
  // (incl. allow-top-navigation-by-user-activation) froze touch scrolling of
  // the iframe on mobile — verified against the deployed allow-scripts form.
  // allow-top-navigation is dropped permanently: the pin bridge converts
  // target="_top"/"_parent" link clicks into real-tab opens (allow-popups +
  // user activation). The two popups tokens stay for target="_blank" /
  // window.open links.
  // allow-same-origin stays OFF deliberately — that is the isolation this
  // sandbox exists to provide.
  const allComments = (project?.comments || []) as HTMLComment[];
  const activePins = allComments.filter(
    (c) => c.filename === activeFilename && (!c.type || c.type === 'pin')
  );

  // ── Pin bridge sync ───────────────────────────────────────────────────
  // Push pins + accent into the folio once the in-iframe bridge reports
  // ready (and again whenever comments/page change). Numbers use the stable
  // index in the FULL comments array, matching the Studio.
  useEffect(() => {
    if (!bridgeReady) return;
    const guestWindow = iframeRef.current?.contentWindow;
    if (!guestWindow) return;
    guestWindow.postMessage({
      type: 'LIVEFOLIO_PINS_SYNC',
      pins: activePins.map((pin) => {
        const stableIdx = allComments.findIndex((c) => c.id === pin.id);
        return {
          id: pin.id,
          x: pin.x,
          y: pin.y,
          selector: pin.selector,
          text: pin.text,
          author: pin.author,
          index: stableIdx >= 0 ? stableIdx + 1 : 0,
        };
      }),
      accent: project?.accentColor || '#FF3B00',
    }, '*');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- derived arrays are recomputed every render; the underlying sources are the deps
  }, [bridgeReady, project?.comments, activeFilename]);

  // Flip the in-folio capture overlay on/off with pin mode.
  useEffect(() => {
    if (!bridgeReady) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'LIVEFOLIO_PIN_MODE', active: isAnnotationMode },
      '*'
    );
  }, [bridgeReady, isAnnotationMode]);

  // A new iframe document is loading (page switch / version jump) — its
  // bridge isn't up yet; the old document's messages must not count.
  useEffect(() => {
    setBridgeReady(false);
  }, [activeFilename, activePreviewVersion]);

  // Top hover strip — reveals the auto-hiding header when the pointer is in
  // the top 64px of the folio (replaces the old same-origin edge script).
  const handleTopStripEnter = () => resetHeaderTimer();

  // Analytics Telemetry
  useEffect(() => {
    if (!id || !project) return;
    
    let startTime = Date.now();

    const recordSession = async (seconds: number, isInitial: boolean = false) => {
      try {
        const isMobile = window.innerWidth < 768;
        await fetch(`/api/files/${id}/analytics`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            sessionSeconds: seconds, 
            isInitial,
            device: isMobile ? 'mobile' : 'desktop'
          })
        });
      } catch {}
    };

    // 1. Initial Ping (View)
    recordSession(0, true);

    // 2. Track time spent
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        if (elapsed > 0) {
          recordSession(elapsed);
          startTime = Date.now(); // reset
        }
      } else {
        startTime = Date.now();
      }
    };

    window.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      const finalElapsed = Math.round((Date.now() - startTime) / 1000);
      if (finalElapsed > 0) {
        // Use sendBeacon with Blob for more reliable cleanup and correct Content-Type
        const data = JSON.stringify({ sessionSeconds: finalElapsed });
        if (navigator.sendBeacon) {
          const blob = new Blob([data], { type: 'application/json' });
          navigator.sendBeacon(`/api/files/${id}/analytics`, blob);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the boolean toggle (not the whole project object) intentionally gates this analytics effect
  }, [id, !!project]);

  const handleUnlockPrivateLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project || isUnlocking) return;
    const input = accessKeyInput.trim();
    if (!input) return;

    setIsUnlocking(true);
    try {
      const res = await fetch(`/api/files/${id}/public`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessKey: input })
      });
      const data = await res.json();

      if (data.success) {
        setAccessKey(input); // store actual key for iframe URL
        setAuthError('');
        // Now that we hold the key, load the full (private) content.
        await fetchProject();
      } else {
        setAuthError('Invalid access key.');
      }
    } catch {
      setAuthError('Validation failed. Please try again.');
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleEnterFullscreen = () => {
    if (iframeRef.current?.requestFullscreen) iframeRef.current.requestFullscreen();
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchProject is redefined each render below; only id/initialProject should trigger a fetch
  useEffect(() => { if (id && !initialProject) fetchProject(); }, [id, initialProject]);

  const fetchProject = async () => {
    try {
      const res = await fetch(`/api/files/${id}/public${accessKey ? `?access_key=${encodeURIComponent(accessKey)}` : ''}`);
      if (res.ok) {
        const data = await res.json();
        setProject(data);
        setActivePreviewVersion(data.latestVersionId);
        setLoadError(null);
      } else {
        setLoadError('Unable to load this folio. It may have been removed or is temporarily unavailable.');
      }
    } catch {
      setLoadError('Unable to load this folio. Check your connection and try again.');
    }
  };

  // ── Paid gate: reconcile the SSR initialData with the authoritative public
  // route. Server pages only compute minimal gate state (owner check + gate
  // config); grants, exact preview standing, and post-purchase unlocks all
  // resolve here. No-op for OSS and non-gated folios (`paidAccess` absent).
  useEffect(() => {
    if (initialProject?.paidAccess) fetchProject();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ── Paid gate: is the viewer signed in? Drives the paywall's Buy vs
  // "Sign in to purchase" branch. Guarded by isSupabaseConfigured so OSS
  // stays byte-equivalent (stub returns false).
  useEffect(() => {
    if (!initialProject?.paidAccess && !project?.paidAccess) return;
    let cancelled = false;
    (async () => {
      try {
        if (!isSupabaseConfigured()) return;
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
        const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
        const client = createBrowserClient(url, key);
        const { data } = await client.auth.getSession();
        if (!cancelled) setViewerSignedIn(!!data.session);
      } catch { /* anonymous / misconfigured — treated as signed out */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProject?.paidAccess, project?.paidAccess]);

  // ── Paid gate: `?purchase=success&session_id=` → poll the webhook-lag
  // verifier, then re-read viewerAccess once the grant lands. The query is
  // stripped immediately so a refresh doesn't re-trigger the poll.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('purchase') !== 'success') return;
    const sessionId = url.searchParams.get('session_id');
    url.searchParams.delete('purchase');
    url.searchParams.delete('session_id');
    window.history.replaceState({}, '', url.toString());
    if (!sessionId) return;

    let attempts = 0;
    const timer = setInterval(async () => {
      attempts += 1;
      try {
        const res = await fetch(`/api/billing/gate/verify?session_id=${encodeURIComponent(sessionId)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.granted) {
            clearInterval(timer);
            await fetchProject();
            return;
          }
        }
      } catch { /* transient — keep polling */ }
      if (attempts >= 8) clearInterval(timer); // 1.5s × 8 ≈ 12s budget
    }, 1500);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Cloud review interactions (pins, reactions) require a signed-in user —
  // same /api/auth/me check the Discussion panel does. OSS is always authed
  // (no central auth; legacy free-text-name flow stays).
  const ensureViewerAuth = async (): Promise<boolean> => {
    if (!isCloud) return true;
    if (viewerUser) return true;
    setViewerAuthLoading(true);
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        if (data?.user) {
          setViewerUser({ email: data.user.email, name: data.user.name });
          return true;
        }
      }
      setViewerUser(null);
      return false;
    } catch {
      setViewerUser(null);
      return false;
    } finally {
      setViewerAuthLoading(false);
    }
  };

  const handlePostGuestComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project || !tempPin || !commentText.trim()) return;
    if (isCloud && !viewerUser?.email) {
      setPinSubmitError('Sign in required to leave a note.');
      setShowLoginCta(true);
      return;
    }
    try {
      setPinSubmitError(null);
      setIsSubmittingComment(true);
      const res = await fetch(`/api/files/${project.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          author: isCloud ? viewerUser!.email : commentUserName.trim() || 'Guest',
          type: 'pin',
          text: commentText.trim(),
          versionId: activePreviewVersion,
          filename: activeFilename,
          x: tempPin.x,
          y: tempPin.y,
          ...(tempPin.selector ? { selector: tempPin.selector } : {}),
          ...(tempPin.elementHtml ? { elementHtml: tempPin.elementHtml } : {}),
          ...(tempPin.slideIndex !== undefined ? { slideIndex: tempPin.slideIndex } : {}),
          ...(tempPin.sectionLabel ? { sectionLabel: tempPin.sectionLabel } : {}),
          accessKey: accessKey || undefined,
        })
      });
      if (res.ok) {
        setCommentText('');
        setTempPin(null);
        setPinSubmitError(null);
        setIsAnnotationMode(false);
        setIsCommentSuccess(true);
        setTimeout(() => setIsCommentSuccess(false), 3000);
        await fetchProject();
      } else if (res.status === 401) {
        // Session expired mid-flow — drop back to the in-modal login CTA.
        setViewerUser(null);
        setPinSubmitError('Sign in required to leave a note.');
      } else {
        const data = await res.json().catch(() => null);
        setPinSubmitError(data?.error || 'Could not save this note. Please try again.');
      }
    } catch {} finally { setIsSubmittingComment(false); }
  };

  const handleTriggerEmoji = async (emoji: string) => {
    if (!project) return;
    // Reactions are account-gated on Cloud — anonymous taps get the login CTA.
    if (!(await ensureViewerAuth())) {
      setShowLoginCta(true);
      return;
    }
    const nextReactions = { ...reactions, [emoji]: (reactions[emoji] || 0) + 1 };
    setReactions(nextReactions);
    try {
      const res = await fetch(`/api/files/${project.id}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reactions: nextReactions })
      });
      if (!res.ok) {
        // Server disagreed (expired session etc.) — roll the optimistic bump back.
        setReactions((prev) => ({ ...prev, [emoji]: Math.max(0, (prev[emoji] || 0) - 1) }));
        if (res.status === 401) setViewerUser(null);
      }
    } catch {}
  };

  if (loadError && !project) {
    return (
      <div className="lf-tokens public-light min-h-screen flex items-center justify-center p-6 antialiased bg-[#F4F4F0] text-[#0F0F0D]">
        <Card className="p-8 w-full max-w-md space-y-5 text-center animate-fade rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
          <div className="w-12 h-12 flex items-center justify-center mx-auto rounded-xl bg-[var(--lf-accent)]/10 text-[var(--lf-accent)]">
            <AlertCircle size={20} />
          </div>
          <h2 className="text-lg font-bold tracking-tight">Couldn&apos;t load this folio</h2>
          <p className="text-sm leading-relaxed text-[#0F0F0D]/70">{loadError}</p>
          <Button onClick={() => { setLoadError(null); fetchProject(); }} className="w-full h-11 rounded-xl bg-[var(--lf-accent)] text-white text-sm font-semibold hover:bg-[#0F0F0D]:bg-[#F4F4F0]:text-[#0F0F0D] transition-colors cursor-pointer">
            Retry
          </Button>
        </Card>
      </div>
    );
  }

  if (!project) {
    return <LoadingScreen />;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the SSR row may carry either a legacy `draft` flag or a `status` string; both are read defensively
  if ((project as any).draft || (project as any).status === 'draft') {
    return (
      <div className="lf-tokens public-light min-h-screen flex items-center justify-center p-6 antialiased bg-[#F4F4F0] text-[#0F0F0D]">
        <Card className="p-8 w-full max-w-md space-y-6 text-center animate-fade rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
          <div className="w-12 h-12 flex items-center justify-center mx-auto rounded-xl bg-[var(--lf-accent)]/10 text-[var(--lf-accent)]">
            <PencilRuler size={20} />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-bold tracking-tight">Not Published</h2>
            <p className="text-sm leading-relaxed text-[#0F0F0D]/70">This folio is still a <strong className="text-[var(--lf-accent)] font-semibold">draft</strong>. The owner needs to publish it before it can be shared publicly.</p>
          </div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/50 pt-2">LiveFolio</div>
        </Card>
      </div>
    );
  }

  if (project.isPrivate && !accessKey) {
    return (
      <div className="lf-tokens public-light min-h-screen flex items-center justify-center p-6 antialiased bg-[#F4F4F0] text-[#0F0F0D]">
        <Card className="p-8 w-full max-w-md space-y-6 text-center animate-fade rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
          <div className="w-12 h-12 flex items-center justify-center mx-auto rounded-xl bg-[var(--lf-accent)]/10 text-[var(--lf-accent)]">
            <Lock size={20} />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-bold tracking-tight">Private Workspace</h2>
            <p className="text-sm leading-relaxed text-[#0F0F0D]/70">Please enter your authorized access key to view this folio.</p>
          </div>
          <form onSubmit={handleUnlockPrivateLink} className="space-y-4">
            <div className="space-y-2 text-left">
              <label className="text-[10px] font-bold uppercase tracking-[0.14em] ml-1 text-[#0F0F0D]/50">Access Key</label>
              <Input type="password" required placeholder="Enter access key…" value={accessKeyInput} onChange={(e) => setAccessKeyInput(e.target.value)} className="h-12 rounded-xl bg-[#0F0F0D]/5 border-0 px-4 text-sm placeholder:text-[#0F0F0D]/40:text-[#F4F4F0]/40 focus:outline-none focus:ring-2 focus:ring-[var(--lf-accent)]/40" />
            </div>
            {authError && (
              <div className="text-sm p-3.5 text-left flex items-start gap-2.5 font-medium rounded-xl bg-[var(--lf-accent)]/10 text-[var(--lf-accent)]">
                <AlertCircle size={14} className="shrink-0 mt-0.5 text-[var(--lf-accent)]" />
                <span>{authError}</span>
              </div>
            )}
            <Button type="submit" disabled={isUnlocking} className="w-full h-12 rounded-xl bg-[var(--lf-accent)] text-white text-sm font-semibold hover:bg-[#0F0F0D]:bg-[#F4F4F0]:text-[#0F0F0D] transition-colors cursor-pointer">
              {isUnlocking ? (
                <><LoadingSpinner size="sm" className="mr-2" /> Verifying…</>
              ) : (
                'Unlock'
              )}
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  // ── Paid gate: effective surface for this viewer (cloud only — OSS folios
  // never carry `paidAccess`, so every gate branch below is inert there).
  const paidAccess: GatePaidAccess | null = project?.paidAccess || null;
  const viewerAccess: ViewerAccess = project?.viewerAccess || 'owner';
  const accentColor = project?.accentColor || null;
  const isFirstPagePreview = viewerAccess === 'preview' && paidAccess?.previewMode === 'first_page';
  const isTimedPreview = viewerAccess === 'preview' && paidAccess?.previewMode === 'timed';
  // Locked surfaces: no access at all, a user-initiated unlock (first_page
  // CTA), or a timed preview that ran out. Owners/grantees never lock.
  // Locked ONLY when a paid config actually exists — a folio with no gate
  // (free, or private-key access which reports owner standing) must never
  // show the paywall, even if viewer standing is momentarily 'none'.
  const gateLocked =
    !!paidAccess &&
    (viewerAccess === 'none' || showPaywall || (isTimedPreview && previewExpired));
  const previewPriceLabel = paidAccess
    ? priceLabel({ enabled: true, ...paidAccess })
    : '';
  // Buyer-facing license — the /public payload carries `license`; the SSR
  // initialData may still carry the nested `listing` shape. Null when the
  // seller set none (or the folio isn't a listing).
  const licenseKind = project?.license?.kind ?? project?.listing?.license?.kind ?? null;
  const licenseLabel = licenseKind && LICENSE_KIND_LABELS[licenseKind]
    ? LICENSE_KIND_LABELS[licenseKind]
    : null;

  // ── Radial controls dial (share) — the SAME element on /share/[id] and
  //    /@username/<slug> (this component serves both). Unlike the Studio
  //    dial it is visible on desktop AND mobile — guest pages have no other
  //    chrome of their own. Fan (thumb-closest first → far): React · Pages ·
  //    Discuss · Pin. Reactions collapse into ONE wedge that drills into the
  //    4-emoji picker (Back chip returns); Pages opens a scrollable list in
  //    the sheet — page browsing stays one tap away even for big folios.
  //    No "More" dump: every surface is a first-class action.
  const REACTION_EMOJIS = ['👍', '❤️', '💡', '🔥'] as const;
  const openDiscussionCount = (project?.comments || []).filter(
    (c: HTMLComment) => c.type === 'comment' && !c.resolved
  ).length;
  const allowCommentsHere = project?.allowComments !== false;
  const totalReactions = REACTION_EMOJIS.reduce((sum, e) => sum + (reactions[e] || 0), 0);

  const mainFanItems: RadialDialItem[] = [];
  if (allowCommentsHere) {
    mainFanItems.push(
      { id: 'react', label: 'React', title: 'React to this folio', icon: Smile, badge: totalReactions || undefined, slot: 0 },
      { id: 'discuss', label: 'Discuss', title: 'Open the discussion', icon: MessageCircle, badge: openDiscussionCount || undefined, slot: 2 }
    );
    mainFanItems.push(
      // Labeled "Comment" (same as the Studio tool): one toggle drops an
      // anchored note — the folio marker + optional text. Pure spatial pins
      // vs. the free-form Discussion thread stay clearly separated.
      { id: 'pin', label: 'Comment', title: 'Comment — click anywhere in the folio to leave a note', icon: MapPin, active: isAnnotationMode, slot: 3 }
    );
  }
  if (!isFirstPagePreview && htmlPages.length > 0) {
    mainFanItems.push(
      { id: 'pages', label: 'Pages', title: 'Browse pages', icon: BookOpen, badge: htmlPages.length > 1 ? htmlPages.length : undefined, slot: allowCommentsHere ? 1 : 0 }
    );
  }
  // Reaction picker level — replaces the fan after tapping React; Back chip
  // (slot 4) returns to the main fan.
  const emojiFanItems: RadialDialItem[] = REACTION_EMOJIS.map((emoji, i) => ({
    id: `react:${emoji}`,
    title: `React ${emoji}${reactions[emoji] ? ` (${reactions[emoji]})` : ''}`,
    glyph: emoji,
    badge: reactions[emoji] || undefined,
    slot: i,
  }));
  emojiFanItems.push({
    id: 'back',
    title: 'Back to main actions',
    icon: ArrowLeft,
    label: 'Back',
    slot: 4,
  });

  const showDial = !gateLocked && mainFanItems.length > 0;

  const closeDial = () => {
    setDialLevel('main');
    setIsFabOpen(false);
    setIsMoreOpen(false);
  };
  const handleDialTrigger = () => {
    // One tap while pinning (fan closed) stops pin mode.
    if (isAnnotationMode && !isFabOpen && !isMoreOpen) {
      setIsAnnotationMode(false);
      return;
    }
    if (isFabOpen || isMoreOpen) {
      closeDial();
      return;
    }
    // Open the fan at its main level (never straight into the picker).
    setDialLevel('main');
    setIsFabOpen(true);
  };
  const handleDialSelect = (id: string) => {
    // Reaction picker level
    if (dialLevel === 'emoji') {
      if (id === 'back') {
        setDialLevel('main');
        return;
      }
      if (id.startsWith('react:')) {
        // Stay on the picker so a reader can fire several reactions at once.
        void handleTriggerEmoji(id.slice('react:'.length));
      }
      return;
    }
    if (id === 'react') {
      setDialLevel('emoji');
      return;
    }
    if (id === 'pages') {
      setIsFabOpen(false);
      setIsMoreOpen(true);
      return;
    }
    if (id === 'pin') {
      // Tapping again while pinning stops pin mode (no auth round-trip).
      if (isAnnotationMode) {
        setIsAnnotationMode(false);
        setTempPin(null);
        setPinSubmitError(null);
        closeDial();
        return;
      }
      setTempPin(null);
      setPinSubmitError(null);
      closeDial();
      // Pins are captured inside the folio by the injected bridge
      // (?lf_pins=1). Until it reports ready there is no way to anchor a pin
      // to real DOM — the old viewport-relative parent overlay produced pins
      // that pointed at the wrong element on any other screen, so it is
      // never offered.
      if (!bridgeReady) {
        showNotice('Review notes are still loading — try again in a second.');
        return;
      }
      if (isCloud) {
        // Cloud: pinning requires an account — resolve the session before
        // arming pin mode so anonymous guests get the login CTA instead of
        // a dead click inside the folio.
        void (async () => {
          if (await ensureViewerAuth()) setIsAnnotationMode(true);
          else setShowLoginCta(true);
        })();
      } else {
        setIsAnnotationMode(true);
      }
      return;
    }
    if (id === 'discuss') {
      setShowComments(true);
      closeDial();
    }
  };

  return (
    <div
      className="h-dvh relative px-0 select-none overflow-hidden antialiased bg-[#F4F4F0] text-[#0F0F0D]"
      style={{ '--lf-accent': accentColor || '#FF3B00' } as React.CSSProperties}
    >
      <header
        className={cn(
          'absolute top-0 left-0 right-0 z-30 transition-transform duration-500 ease-out',
          headerVisible ? 'translate-y-0' : '-translate-y-full'
        )}
      >
        {/* Floating pill bar — v2 chrome */}
        <div className="mx-4 mt-3 flex h-12 items-center justify-between gap-2 rounded-xl bg-white/85 px-3 shadow-sm ring-1 ring-black/5 backdrop-blur-md">
          <div className="flex items-center gap-1.5 min-w-0">
            {/* Only show Studio link if user is authenticated (owner/editor), not for guests */}
            {accessKey && (
              <Button variant="ghost" size="sm" asChild className="h-8 shrink-0 px-3 rounded-lg text-xs font-medium text-[#0F0F0D]/60 hover:text-[#0F0F0D]:text-[#F4F4F0] hover:bg-black/5:bg-white/10 transition-colors cursor-pointer">
                <Link href={`/studio/${project.id}`}>Studio</Link>
              </Button>
            )}
            <Button onClick={handleEnterFullscreen} className="h-8 shrink-0 px-3.5 rounded-full bg-[var(--lf-accent)] text-white text-xs font-semibold cursor-pointer flex items-center gap-1.5 hover:bg-[#0F0F0D]:bg-[#F4F4F0]:text-[#0F0F0D] transition-colors">
              <Maximize size={11} />
              <span>Present</span>
            </Button>
            <div className="h-5 w-px bg-[#0F0F0D]/10 mx-1 shrink-0" />
            <nav aria-label="Breadcrumb" className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-[#0F0F0D]/50 shrink-0">
              <Link href="/app" className="transition-colors hover:text-[var(--lf-accent)]">Workspace</Link>
              <ChevronRight size={12} className="shrink-0" />
            </nav>
            <span className="font-semibold text-sm tracking-tight truncate">{project.title}</span>
            {/* OSS local indicator only — Cloud hides the tag for a cleaner guest experience */}
            {!isCloud && (
              <div className="flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-full bg-[#0F0F0D]/5 text-[#0F0F0D]/50 shrink-0">
                <HardDrive size={8} />
                <span>OSS</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0 ml-2">
            {isCloud && (
              <button
                type="button"
                onClick={() => setShowReport(true)}
                aria-label="Report this content"
                title="Report this content"
                className="flex h-8 w-8 items-center justify-center rounded-full text-[#0F0F0D]/35 transition-colors hover:bg-black/5 hover:text-[#0F0F0D] cursor-pointer"
              >
                <Flag size={12} />
              </button>
            )}
            <Link href="/" className="flex items-center gap-2 opacity-70 hover:opacity-100 transition-opacity">
            <span className="font-black text-sm tracking-tighter" style={{ fontFamily: '"Cabinet Grotesk", "Space Grotesk", sans-serif' }}>LiveFolio</span>
            <span className="inline-flex h-4 w-4 items-center justify-center">
              <span className="inline-block h-2.5 w-2.5 bg-[var(--lf-accent)]" />
            </span>
            </Link>
          </div>
        </div>
      </header>

      {/* Post-purchase actions — buyer with an active grant, seller-enabled
          copy/download only (server re-verifies both). */}
      {viewerAccess === 'granted' &&
        paidAccess &&
        (paidAccess.allowCopy || paidAccess.allowDownload) && (
          <PurchasedActions
            folioId={project.id}
            allowCopy={!!paidAccess.allowCopy}
            allowDownload={!!paidAccess.allowDownload}
          />
        )}

      {/* Community moderation — report this folio (signed-in in-app; guests
          get the one-click email channel per the ToS). */}
      {showReport && project?.id && (
        <ReportPanel folioId={project.id} title={project.title} onClose={() => setShowReport(false)} />
      )}

      {/* touch-pan-y: explicitly allow vertical panning so touch browsers route
          the scroll gesture into the folio iframe instead of treating the
          shell (overflow-hidden, unscrollable) as the gesture target. */}
      <div className="absolute inset-0 z-10 overflow-hidden touch-pan-y">
        {gateLocked ? (
          <PaywallScreen
            title={project.title}
            folioId={project.id}
            paidAccess={paidAccess}
            viewerSignedIn={viewerSignedIn}
            accent={accentColor}
            licenseLabel={licenseLabel}
          />
        ) : project.presentationModeOnly && !hasStartedPresentation ? (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center p-8 space-y-6 text-center animate-fade bg-[#F4F4F0]">
            <div className="w-16 h-16 flex items-center justify-center mx-auto rounded-2xl bg-[var(--lf-accent)]/10 text-[var(--lf-accent)]">
              <Play size={24} className="fill-current ml-1" />
            </div>
            <div className="space-y-2 max-w-md">
               <h1 className="text-xl font-bold tracking-tight">{project.title}</h1>
               <p className="text-sm leading-relaxed text-[#0F0F0D]/70">This folio is in Presentation-Only mode.</p>
            </div>
            <Button size="lg" onClick={() => { handleEnterFullscreen(); setHasStartedPresentation(true); }} className="font-semibold px-8 h-11 rounded-xl bg-[var(--lf-accent)] text-white text-sm hover:bg-[#0F0F0D]:bg-[#F4F4F0]:text-[#0F0F0D] transition-colors cursor-pointer">
              Launch View
            </Button>
          </div>
        ) : (
          <>
          <iframe
            ref={iframeRef}
            src={`/api/raw/${project.id}/${activeFilename}?v=${activePreviewVersion}&lf_pins=1${accessKey ? `&access_key=${encodeURIComponent(accessKey)}` : ''}`}
            className="w-full h-full border-none bg-white"
            id="presentation-guest-iframe"
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            onLoad={() => setSyncTrigger(prev => prev + 1)}
          />

          {/* Top hover strip — reveals the auto-hiding header when the
              pointer is in the top 64px of the folio. Pins themselves are
              captured + rendered inside the iframe by the bridge; no parent
              overlay sits above the folio anymore (an overlay can never see
              the element under the click, so it cannot anchor pins). */}
          <div
            className="absolute top-0 left-0 right-0 z-20"
            style={{ height: 64, pointerEvents: isAnnotationMode ? 'none' : 'auto' }}
            onMouseEnter={handleTopStripEnter}
          />

          {/* Paid gate — preview overlays (marketing-grade; the raw route's
              signed cookie / clip injection is the real enforcement) */}
          {isTimedPreview && (
            <PreviewCountdown
              seconds={paidAccess?.previewSeconds || 30}
              accent={accentColor}
              onExpire={() => setPreviewExpired(true)}
            />
          )}
          {isFirstPagePreview && (
            <UnlockOverlay
              priceLabel={previewPriceLabel}
              accent={accentColor}
              onUnlock={() => setShowPaywall(true)}
            />
          )}
          </>
        )}

        {/* Centered Pin Submission Modal — fixed (not absolute) so it stays
            reachable above the keyboard/dial on phones; backdrop tap closes
            it; select-text undoes the shell's select-none, which blocks iOS
            caret/focus inside inputs. Cloud shows either the composer (signed
            in) or the sign-in CTA (anonymous) — the free-text name input only
            exists in OSS where there is no account to detect. */}
        {tempPin && (
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center animate-in fade-in duration-200 bg-[#0F0F0D]/40 backdrop-blur-sm"
            onClick={() => { setTempPin(null); setPinSubmitError(null); }}
          >
            <div
              className="p-6 w-80 max-h-[85vh] overflow-y-auto select-text animate-in zoom-in-95 duration-200 text-left relative rounded-2xl bg-white shadow-xl ring-1 ring-black/5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-4">
                 <span className="text-sm font-bold tracking-tight flex items-center gap-1.5 text-[#0F0F0D]">
                   <MessageSquare size={14} className="text-[var(--lf-accent)]" />
                   <span>Add Review Note</span>
                 </span>
                 <button onClick={() => { setTempPin(null); setPinSubmitError(null); }} aria-label="Close review note" className="transition-colors p-1 rounded-lg cursor-pointer text-[#0F0F0D]/60 hover:bg-black/5:bg-white/10 hover:text-[#0F0F0D]:text-[#F4F4F0]">
                   <X size={14}/>
                 </button>
              </div>
              {isCloud && viewerAuthLoading ? (
                <div className="flex items-center justify-center py-10">
                  <LoadingSpinner size="sm" />
                </div>
              ) : isCloud && !viewerUser ? (
                <div className="space-y-3">
                  <p className="text-[13px] font-medium text-[#0F0F0D]/55 text-center leading-relaxed">
                    Sign in to leave a review note
                  </p>
                  <a
                    href={`/login?redirect=${encodeURIComponent(typeof window !== 'undefined' ? window.location.href : '/')}`}
                    className="w-full h-9 flex items-center justify-center gap-2 cursor-pointer rounded-xl bg-[var(--lf-accent)] text-white text-xs font-semibold hover:bg-[#0F0F0D]:bg-[#F4F4F0]:text-[#0F0F0D] transition-colors"
                  >
                    <LogIn size={11} />
                    Sign in to comment
                  </a>
                  <p className="text-[11px] text-center text-[#0F0F0D]/40 leading-relaxed">
                    You&apos;ll return to this folio after signing in.
                  </p>
                </div>
              ) : (
                <form onSubmit={handlePostGuestComment} className="space-y-4">
                  {isCloud ? (
                    <p className="text-[11px] font-medium text-[#0F0F0D]/45">
                      Commenting as <span className="text-[var(--lf-accent)] font-semibold">{viewerUser?.name || viewerUser?.email}</span>
                    </p>
                  ) : (
                    <Input required placeholder="Your Name" value={commentUserName} onChange={(e) => setCommentUserName(e.target.value)} className="h-10 text-sm rounded-xl bg-[#0F0F0D]/5 border-0 px-3.5 placeholder:text-[#0F0F0D]/40:text-[#F4F4F0]/40 focus:outline-none focus:ring-2 focus:ring-[var(--lf-accent)]/40" />
                  )}
                  <textarea
                     required
                     value={commentText}
                     onChange={(e) => setCommentText(e.target.value)}
                     placeholder="Describe the change or issue…"
                     className="w-full text-sm p-3.5 focus:outline-none resize-none h-24 transition-colors leading-relaxed rounded-xl bg-[#0F0F0D]/5 border-0 text-[#0F0F0D] focus:ring-2 focus:ring-[var(--lf-accent)]/40 placeholder:text-[#0F0F0D]/40:text-[#F4F4F0]/40"
                  />
                  {pinSubmitError && (
                    <p className="text-xs font-medium text-[#0F0F0D]/60 flex items-start gap-1.5">
                      <AlertCircle size={13} className="shrink-0 mt-0.5 text-[var(--lf-accent)]" />
                      {pinSubmitError}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button type="button" variant="ghost" className="flex-1 h-9 rounded-lg bg-[#0F0F0D]/5 text-[#0F0F0D]/70 text-xs font-semibold hover:bg-[#0F0F0D]/10:bg-[#F4F4F0]/15 cursor-pointer" onClick={() => { setTempPin(null); setPinSubmitError(null); }}>Cancel</Button>
                    <Button type="submit" disabled={isSubmittingComment} className="flex-1 h-9 rounded-lg bg-[var(--lf-accent)] text-white text-xs font-semibold hover:bg-[#0F0F0D]:bg-[#F4F4F0]:text-[#0F0F0D] transition-colors cursor-pointer">
                      {isSubmittingComment ? 'Saving…' : 'Post Pin'}
                    </Button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}

        {/* Login CTA modal — reactions (and any other interaction that needs
            an account) point anonymous Cloud viewers here. */}
        {showLoginCta && !tempPin && (
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center animate-in fade-in duration-200 bg-[#0F0F0D]/40 backdrop-blur-sm"
            onClick={() => setShowLoginCta(false)}
          >
            <div
              className="p-6 w-80 select-text animate-in zoom-in-95 duration-200 text-left relative rounded-2xl bg-white shadow-xl ring-1 ring-black/5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-3">
                <span className="text-sm font-bold tracking-tight flex items-center gap-1.5 text-[#0F0F0D]">
                  <MessageSquare size={14} className="text-[var(--lf-accent)]" />
                  <span>Sign in to interact</span>
                </span>
                <button onClick={() => setShowLoginCta(false)} aria-label="Close" className="transition-colors p-1 rounded-lg cursor-pointer text-[#0F0F0D]/60 hover:bg-black/5:bg-white/10 hover:text-[#0F0F0D]:text-[#F4F4F0]">
                  <X size={14} />
                </button>
              </div>
              <p className="text-[13px] font-medium text-[#0F0F0D]/55 text-center leading-relaxed mb-4">
                Sign in to leave review notes and react to this folio.
              </p>
              <a
                href={`/login?redirect=${encodeURIComponent(typeof window !== 'undefined' ? window.location.href : '/')}`}
                className="w-full h-9 flex items-center justify-center gap-2 cursor-pointer rounded-xl bg-[var(--lf-accent)] text-white text-xs font-semibold hover:bg-[#0F0F0D]:bg-[#F4F4F0]:text-[#0F0F0D] transition-colors"
              >
                <LogIn size={11} />
                Sign in
              </a>
            </div>
          </div>
        )}
      </div>

        {/* Radial controls dial — share + @user views (one shared element).
            Main fan: React (drills into the 4-emoji picker) · Pages (opens
            the list) · Discuss · Pin — no "More" dump. Hidden entirely while
            the paywall is up; pages are hidden for first_page previews (the
            server prunes the list — this guards against a stale list leaking
            pages client-side). Visible on desktop AND mobile: guest pages
            have no other chrome. */}
        {showDial && (
          <RadialDial
            items={dialLevel === 'emoji' ? emojiFanItems : mainFanItems}
            fanOpen={isFabOpen}
            moreOpen={isMoreOpen}
            activeWedgeId={dialLevel === 'emoji' ? null : isAnnotationMode ? 'pin' : null}
            onTrigger={handleDialTrigger}
            onSelect={handleDialSelect}
            onCloseAll={closeDial}
            triggerAriaLabel="Share controls"
            panel={
              <div className="flex flex-col">
                <div className="px-3 pt-3 pb-1">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] px-1 text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">
                    Pages — {htmlPages.length}
                  </span>
                </div>
                <div className="px-2 pb-2">
                  {htmlPages.map((filename: string) => (
                    <button
                      key={filename}
                      type="button"
                      onClick={() => { setActiveFilename(filename); setTempPin(null); closeDial(); }}
                      className={cn(
                        'w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium transition-colors cursor-pointer rounded-lg',
                        activeFilename === filename
                          ? 'bg-[var(--lf-accent)]/10 text-[var(--lf-accent)]'
                          : 'text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70 hover:bg-[#0F0F0D]/5 dark:hover:bg-[#F4F4F0]/10 hover:text-[#0F0F0D] dark:hover:text-[#F4F4F0]'
                      )}
                    >
                      <FileText size={13} className="shrink-0 opacity-60" />
                      <span className="truncate">{filename.replace('.html', '')}</span>
                      {activeFilename === filename && (
                        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="ml-auto shrink-0"><path d="M20 6 9 17l-5-5"/></svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            }
          />
        )}

        {isCommentSuccess && (
          <div className="absolute top-16 right-6 z-30 text-xs font-semibold px-4 py-3 flex items-center gap-2.5 animate-in fade-in slide-in-from-top-2 duration-200 rounded-xl bg-white text-[#0F0F0D] shadow-lg ring-1 ring-black/5">
            <CheckCircle size={14} className="text-[var(--lf-accent)]" />
            <span>Annotation Saved</span>
          </div>
        )}

        {pinNotice && (
          <div className="absolute top-16 right-6 z-30 text-xs font-semibold px-4 py-3 flex items-center gap-2.5 animate-in fade-in slide-in-from-top-2 duration-200 rounded-xl bg-white text-[#0F0F0D] shadow-lg ring-1 ring-black/5">
            <AlertCircle size={14} className="shrink-0 text-[var(--lf-accent)]" />
            <span>{pinNotice}</span>
          </div>
        )}

        {/* Discussion Panel — general comments (not spatial pins) */}
        <CommentsPanel
          projectId={project.id}
          comments={project.comments || []}
          currentVersionId={activePreviewVersion}
          activeFilename={activeFilename}
          onCommentsChange={fetchProject}
          isOpen={showComments}
          onClose={() => setShowComments(false)}
        />
    </div>
  );
}
