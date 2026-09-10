'use client';

/**
 * StudioView — the app-shell Studio tab (P2-T00).
 *
 * FORK of `app/studio/[id]/StudioClient.tsx` (3873 lines), stripped per
 * `build-hubs/app-shell-v2/spikes/studio-canvas-extraction.md` §1.2. The old
 * file is NEVER modified; this fork is the shell's keep-alive Studio tab.
 *
 * WHAT WAS STRIPPED (vs the source):
 * - The chat/AI lobe (state at 448–455, 550–556, 1249–1258 + `handleSendChatPrompt`,
 *   `executeToolCall`, `updateToolCallStatus`, tool handlers, `handleClearChat`,
 *   `handleCommitProposal`) — moved to the per-folio provider store
 *   (`lib/app-shell/folio-store.ts`, implemented by P2-T01; StudioView calls
 *   `sendPrompt` / `commitProposal` / `clearChat`).
 * - The floating chat modal (3348–3496) — replaced by the keep-alive Chat tab.
 * - The toolbar chat toggle (2793–2809) — now a `setView('chat')` switch.
 * - The body scroll lock (1285–1300) — the shell owns scrolling.
 * - The loading-screen gate (2717) — the provider fetches; StudioView renders a
 *   local loading screen until the provider's `project` is ready.
 * - `StudioHeader`'s back-to-dashboard breadcrumb — forked into
 *   `StudioViewHeader.tsx` with the breadcrumb/back-nav removed (share, tunnel,
 *   export, rename, delete actions kept).
 * - Dead state (leftover from when the sidebar/chat were inline): sidebar
 *   resize state, `isSharingOpen`/`isProfileMenuOpen`/`copiedLocal`/`copiedPublic`
 *   (StudioHeader manages its own), `hoveredCommentId`, `selectedElementSelector`,
 *   `mobilePanel`, `isFloatingChatOpen`, chat scroll refs, `handlePinDrop`,
 *   `getPresetChips`, `relativeTime`.
 *
 * KEPT INTACT: the canvas toolbar, the preview iframe
 * (`id="studio-sandbox-iframe"`, src `/api/raw/{id}/{file}?v={versionId}`), the
 * script-injection effect (619–1042) with pins/visual-edit/inspect bridges, the
 * mode tabs + mode views (imported from `components/studio/`), imports
 * (ZIP/folder/direct), attachments, export, design system, CRUD dialogs.
 *
 * KEEP-ALIVE: mounted by `KeepAliveTabs` (P1-T02) — both tabs stay mounted, the
 * inactive one is CSS-hidden (`display: none`), so the iframe browsing context
 * survives tab switches (verified empirically, see reports/P2-T00.html §4).
 *
 * VERSION-JUMP RE-DERIVATION: v1's `fetchProject(shouldJumpToLatest)` jumped the
 * preview to the newest version after saves/commits. The provider's
 * `fetchProject` has no jump parameter, so StudioView re-derives it: the
 * save/restore/apply paths set a ref flag consumed by the [project] effect, and
 * an AI generation that lands a NEW version (auto-apply) jumps when
 * `isAiResponding` falls (proposal-only runs create no version and must not
 * jump — same discriminator v1 used).
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import LoadingScreen from '@/components/LoadingScreen';

// HTML-escape user-controlled text before it is interpolated into innerHTML
// (comment pins) — prevents stored XSS via comment text.
const escapeHtml = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
import {
  MessageSquare,
  Eye,
  Monitor,
  Tablet,
  Smartphone,
  History,
  Code,
  Sparkles,
  Plus,
  X,
  Trash2,
  Pencil,
  Upload,
  BarChart3,
  Network,
  FileText,
  Pin,
  LayoutGrid,
  MessageCircle
} from 'lucide-react';
import { HTMLComment } from '@/lib/db';
import { isCloud } from '@/lib/env';
import { cn } from '@/lib/utils';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { extractBase64Images } from '@/lib/extract-base64-images';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, AlertDialog } from '@/components/ui/dialog';
import { Dropdown } from '@/components/ui/dropdown';
import { createBrowserClient, isSupabaseConfigured } from '@/lib/supabase';
import CodeView from '@/components/studio/CodeView';
import type { ChatScope } from '@/lib/app-shell/folio-store';
import { useFolioStore } from '../folio-provider/FolioProvider';
import { STUDIO_TOOLS, getStudioTool } from '@/lib/app-shell/studio-tools';
import type { StudioToolDef, StudioToolId } from '@/lib/app-shell/studio-tools';
import { summarizeEdits } from '@/lib/app-shell/edit-summary';
import { RadialDial } from '@/components/ui/RadialDial';
import type { RadialDialItem } from '@/components/ui/RadialDial';

// Lazy-load panels, drawers, and modals — they only mount when the user engages.
// ssr: false avoids React static-flag mismatches since these render conditionally.
const PinsView = dynamic(() => import('@/components/studio/PinsView'), { ssr: false });
const CommentsView = dynamic(() => import('@/components/studio/CommentsView'), { ssr: false });
const HistoryView = dynamic(() => import('@/components/studio/HistoryView'), { ssr: false });
const MapView = dynamic(() => import('@/components/studio/MapView'), { ssr: false });
const AnalyticsView = dynamic(() => import('@/components/studio/AnalyticsView'), { ssr: false });
const DesignDrawer = dynamic(() => import('@/components/studio/DesignDrawer'), { ssr: false });
const CreateScreenModal = dynamic(() => import('@/components/studio/CreateScreenModal'), { ssr: false });
const ImportRepoModal = dynamic(() => import('@/components/studio/ImportRepoModal'), { ssr: false });
const AttachmentPortal = dynamic(() => import('@/components/studio/AttachmentPortal'), { ssr: false });

// Minimal structural types for the CDN-injected JSZip / pdf.js globals —
// only the API surface StudioView touches is declared.
type StudioJsZipLib = {
  loadAsync(file: Blob): Promise<{
    files: Record<string, { dir?: boolean; async(type: string): Promise<string> }>;
  }>;
};

type StudioPdfJsLib = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(params: { data: ArrayBuffer }): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{
        getTextContent(): Promise<{ items: { str: string }[] }>;
      }>;
    }>;
  };
};

export function StudioView() {
  const router = useRouter();

  // ── Per-folio provider: server truth + shared chat/AI state (P1-T02/P2-T01)
  const project = useFolioStore((s) => s.project);
  const status = useFolioStore((s) => s.status);
  const error = useFolioStore((s) => s.error);
  const fetchProject = useFolioStore((s) => s.fetchProject);
  const setActivePreviewVersion = useFolioStore((s) => s.setActivePreviewVersion);
  const isAiResponding = useFolioStore((s) => s.isAiResponding);
  const activeProposal = useFolioStore((s) => s.activeProposal);
  const setActiveProposal = useFolioStore((s) => s.setActiveProposal);
  const sendPrompt = useFolioStore((s) => s.sendPrompt);
  const commitProposal = useFolioStore((s) => s.commitProposal);
  const setActiveFilename = useFolioStore((s) => s.setActiveFilename);
  const setTargetedElement = useFolioStore((s) => s.setTargetedElement);
  const setChatDraft = useFolioStore((s) => s.setChatDraft);
  const setView = useFolioStore((s) => s.setView);
  const setDesignSystemPrefs = useFolioStore((s) => s.setDesignSystemPrefs);
  const activeFilename = useFolioStore((s) => s.activeFilename);

  // ── Local loading chrome (v1 146–209) — the provider fetches; StudioView
  //    keeps the brief branded intro so the shell doesn't flash.
  const [isLoading, setIsLoading] = useState(true);
  const [, setLoadingProgress] = useState(10);
  const [, setLoadingTextIndex] = useState(0);

  const [userEmail, setUserEmail] = useState<string>(isCloud ? '' : 'local@vivio.local');
  const [userName, setUserName] = useState<string>(isCloud ? 'Cloud User' : 'OSS User');

  useEffect(() => {
    async function fetchUserSession() {
      if (isCloud && isSupabaseConfigured()) {
        try {
          const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
          const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
          const supabaseClient = createBrowserClient(url, key);
          const { data: { user } } = await supabaseClient.auth.getUser();
          if (user) {
            if (user.email) setUserEmail(user.email);
            if (user.user_metadata?.full_name) {
              setUserName(user.user_metadata.full_name);
            } else if (user.email) {
              setUserName(user.email.split('@')[0]);
            }
          }
        } catch (e) {
          console.error('Failed to load user info in Studio:', e);
        }
      }
    }
    fetchUserSession();
  }, []);

  const loadingMessages = [
    "Initializing workspace database...",
    "Calibrating glassmorphic workspace layout...",
    "Readying AI Design Co-pilot model layers...",
    "Connecting real-time collaboration engines...",
    "Drafting aesthetic tokens and layout guidelines...",
    "Workspace loaded! Booting up canvas..."
  ];

  // Smooth linear progress bar — driven by actual load time, capped at 800ms
  useEffect(() => {
    if (!isLoading) return;
    const startTime = Date.now();
    const duration = 800; // brief branded intro — no artificial stall

    setLoadingProgress(10);
    setLoadingTextIndex(0);

    const progressTimer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(Math.floor((elapsed / duration) * 90) + 10, 100);
      setLoadingProgress(progress);
    }, 30);

    const messageTimer = setInterval(() => {
      setLoadingTextIndex(prev => (prev < loadingMessages.length - 1 ? prev + 1 : prev));
    }, 500); // cycle through all messages nicely during the load

    return () => {
      clearInterval(progressTimer);
      clearInterval(messageTimer);
    };
  }, [isLoading, loadingMessages.length]);

  // Branded intro: dismiss once the provider's project is ready (v1's
  // min-delay was part of its own fetch; here the delay starts at `ready`).
  useEffect(() => {
    if (status === 'error') {
      setIsLoading(false);
      return;
    }
    if (status !== 'ready' || !project) return;
    const timer = setTimeout(() => setIsLoading(false), 800);
    return () => clearTimeout(timer);
  }, [status, project]);

  // ── Canvas/preview state (lobe A — kept local) ─────────────────────────
  const [activePreviewVersion, setActivePreviewVersionLocal] = useState<string>('');

  // Mirror the canvas version into the per-folio store so the header's
  // export/chat context read the version the preview is showing.
  useEffect(() => {
    setActivePreviewVersion(activePreviewVersion);
  }, [activePreviewVersion, setActivePreviewVersion]);

  const [viewportSize, setViewportSize] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [previewZoom, setPreviewZoom] = useState(1); // 0.5, 0.75, 1
  const [canvasMode, setCanvasMode] = useState<'preview' | 'code' | 'pins' | 'comments' | 'history' | 'map' | 'analytics'>('preview');
  const [isDesignDrawerOpen, setIsDesignDrawerOpen] = useState(false);

  const [projectMode, setProjectMode] = useState<'deck' | 'document' | 'spreadsheet' | 'dashboard' | 'infography'>('document');
  const [selectedTheme, setSelectedTheme] = useState<string>('Warm Editorial');
  const [selectedTypography, setSelectedTypography] = useState<string>('Lora & Inter');
  const [selectedColorPalette, setSelectedColorPalette] = useState<string>('Honey Amber');
  const [selectedLibraries, setSelectedLibraries] = useState<string[]>(['Tailwind CSS Core', 'Lucide Icons']);
  const [isVisualEditMode, setIsVisualEditMode] = useState(false);
  const [hasUnsavedVisualEdits, setHasUnsavedVisualEdits] = useState(false);
  // Optional commit message for the visual-edit bar — blank = auto-describe
  // the change from the line diff ("Updated lines X–Y").
  const [visualEditMsg, setVisualEditMsg] = useState('');
  // Radial-dial state (mobile tools fan + More sheet) — replaces the old FAB.
  const [isDialOpen, setIsDialOpen] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  const [editorCode, setEditorCode] = useState('');
  const [editorCommitMessage, setEditorCommitMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [isSavingPin, setIsSavingPin] = useState(false);
  const [newFileNameInput, setNewFileNameInput] = useState('');
  const [isCreatingPage, setIsCreatingPage] = useState(false);

  const [isCreateScreenOpen, setIsCreateScreenOpen] = useState(false);
  const [isImportRepoOpen, setIsImportRepoOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importPhase, setImportPhase] = useState<'reading' | 'transforming' | 'saving' | 'finalizing' | null>(null);
  const [liveImportCount, setLiveImportCount] = useState(0);

  // Attachment Portal States
  const [isAttachmentPortalOpen, setIsAttachmentPortalOpen] = useState(false);
  const [isUploadingAsset, setIsUploadingAsset] = useState(false);
  const [selectedAttachmentFile, setSelectedAttachmentFile] = useState<File | null>(null);
  const [extractedContextText, setExtractedContextText] = useState('');
  const [isExtractingText, setIsExtractingText] = useState(false);
  const [attachmentIntent, setAttachmentIntent] = useState<'enrich' | 'convert'>('enrich');

  const [, setProjectTitleInput] = useState('');
  const [, setProjectDescriptionInput] = useState('');

  // Rename & Delete states
  const [isRenameFolioOpen, setIsRenameFolioOpen] = useState(false);
  const [renameFolioTitle, setRenameFolioTitle] = useState('');
  const [renameFolioDesc, setRenameFolioDesc] = useState('');
  const [isSavingRenameFolio, setIsSavingRenameFolio] = useState(false);

  const [isDeleteFolioConfirmOpen, setIsDeleteFolioConfirmOpen] = useState(false);
  const [isDeletingFolio, setIsDeletingFolio] = useState(false);

  const [isRenamePageOpen, setIsRenamePageOpen] = useState(false);
  const [pageToRenameOldName, setPageToRenameOldName] = useState('');
  const [pageToRenameNewName, setPageToRenameNewName] = useState('');
  const [isSavingPageRename, setIsSavingPageRename] = useState(false);

  const [isDeletePageConfirmOpen, setIsDeletePageConfirmOpen] = useState(false);
  const [pageToDeleteName, setPageToDeleteName] = useState('');
  const [isDeletingPage, setIsDeletingPage] = useState(false);
  const [deleteReplacementFile, setDeleteReplacementFile] = useState('');

  const handleRenameFolio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project || !renameFolioTitle.trim() || isSavingRenameFolio) return;
    setIsSavingRenameFolio(true);
    try {
      const res = await fetch(`/api/files/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: renameFolioTitle.trim(),
          description: renameFolioDesc.trim()
        })
      });
      if (res.ok) {
        await fetchProject();
        setIsRenameFolioOpen(false);
      } else {
        showAlert("Error", "Failed to rename folio.");
      }
    } catch (err) {
      console.error(err);
      showAlert("Error", "Error renaming folio.");
    } finally {
      setIsSavingRenameFolio(false);
    }
  };

  const handleDeleteFolio = async () => {
    if (!project || isDeletingFolio) return;
    setIsDeletingFolio(true);
    try {
      const res = await fetch(`/api/files/${project.id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setIsDeleteFolioConfirmOpen(false);
        // v1 pushed '/' (dashboard) — the shell's folio home is /app.
        router.push('/app');
      } else {
        showAlert("Error", "Failed to delete folio.");
      }
    } catch (err) {
      console.error(err);
      showAlert("Error", "Error deleting folio.");
    } finally {
      setIsDeletingFolio(false);
    }
  };

  const handleRenamePageFile = async (oldName: string, newBaseName: string) => {
    if (!project) return;
    let base = newBaseName.trim();
    if (!base) {
      showAlert("Error", "Page name cannot be empty.");
      return;
    }
    // Clean any accidentally typed .html extensions to avoid double extension (e.g. billing.html.html)
    if (base.toLowerCase().endsWith('.html')) {
      base = base.slice(0, -5);
    }
    const trimmedNewName = base + '.html';

    if (trimmedNewName === 'index.html' || oldName === 'index.html') {
      showAlert("Error", "Cannot rename index.html, nor can you rename any page to index.html.");
      return;
    }
    const latestVersion = project.versions[project.versions.length - 1];
    if (!latestVersion) return;

    if (latestVersion.files[trimmedNewName]) {
      showAlert("Error", "A page with this name already exists.");
      return;
    }

    const nextFilesMap = { ...latestVersion.files };
    nextFilesMap[trimmedNewName] = nextFilesMap[oldName];
    delete nextFilesMap[oldName];

    setIsSavingPageRename(true);
    try {
      await handleSaveModifiedCode(nextFilesMap, `Renamed page ${oldName} to ${trimmedNewName}`);
      if (activeFilename === oldName) {
        setActiveFilename(trimmedNewName);
      }
      setIsRenamePageOpen(false);
    } catch (err) {
      console.error(err);
      showAlert("Error", "Failed to rename page.");
    } finally {
      setIsSavingPageRename(false);
    }
  };

  const handleDeletePageFile = async (filename: string) => {
    if (!project) return;
    const latestVersion = project.versions[project.versions.length - 1];
    if (!latestVersion) return;

    const htmlFiles = Object.keys(latestVersion.files).filter((k) => k.endsWith('.html'));
    if (filename.endsWith('.html') && htmlFiles.length <= 1) {
      showAlert("Error", `Cannot delete "${filename}" — it's the only HTML page in this folio. Add another page first.`);
      return;
    }

    // If deleting the active file, ask which file replaces it
    if (activeFilename === filename) {
      const otherHtml = htmlFiles.filter(k => k !== filename);
      if (otherHtml.length > 0) setDeleteReplacementFile(otherHtml[0]);
      return; // replacement picker dialog handles the rest
    }

    // Deleting a non-active file — simple
    const nextFilesMap = { ...latestVersion.files };
    delete nextFilesMap[filename];

    setIsDeletingPage(true);
    try {
      await handleSaveModifiedCode(nextFilesMap, `Deleted page ${filename}`);
      setIsDeletePageConfirmOpen(false);
      setPageToDeleteName('');
    } catch (err) {
      console.error(err);
      showAlert("Error", "Failed to delete page.");
    } finally {
      setIsDeletingPage(false);
    }
  };

  /** Delete the active file, switching to the chosen replacement */
  const handleDeletePageFileWithReplacement = async () => {
    if (!project) return;
    const filename = pageToDeleteName;
    const replacement = deleteReplacementFile;
    const latestVersion = project.versions[project.versions.length - 1];
    if (!latestVersion || !filename || !replacement) return;

    const nextFilesMap = { ...latestVersion.files };
    delete nextFilesMap[filename];
    if (!nextFilesMap[replacement]) return;

    // Switch active file BEFORE the save (handleSaveModifiedCode blanks the
    // iframe, fetchProject reloads, and React will point the iframe at the
    // new active file on next render)
    setActiveFilename(replacement);

    setIsDeletingPage(true);
    try {
      await handleSaveModifiedCode(nextFilesMap, `Deleted page ${filename}`);
      setIsDeletePageConfirmOpen(false);
      setPageToDeleteName('');
      setDeleteReplacementFile('');
    } catch (err) {
      console.error(err);
      showAlert("Error", "Failed to delete page.");
    } finally {
      setIsDeletingPage(false);
    }
  };

  const [isAnnotationMode, setIsAnnotationMode] = useState(false);
  const [tempPin, setTempPin] = useState<{ x: number; y: number; selector?: string; elementHtml?: string; slideIndex?: number; sectionLabel?: string } | null>(null);
  const [newCommentText, setNewCommentText] = useState('');
  const [availableDesignSystems, setAvailableDesignSystems] = useState<{ id: string; name: string; description: string; thumbnail: string }[]>([]);

  // Tunnel states for public share (OSS only)
  useEffect(() => {
    const fetchDesignSystems = async () => {
      try {
        const res = await fetch('/api/design-systems');
        if (res.ok) setAvailableDesignSystems(await res.json());
      } catch {}
    };
    fetchDesignSystems();
  }, []);

  const [isTargetInspectMode, setIsTargetInspectMode] = useState(false);

  // ── Canvas tools (Comment / Edit / Fix with AI) — derived from the three
  //    legacy mode booleans so all existing call sites keep working; the
  //    desktop trio and the mobile dial both drive `activateTool`.
  const activeToolId: StudioToolId | null = isAnnotationMode
    ? 'comment'
    : isVisualEditMode
      ? 'edit'
      : isTargetInspectMode
        ? 'polish'
        : null;
  const activeToolDef = getStudioTool(activeToolId);

  // Fan items in RadialDial slot order (near-inner · near-outer · far-inner ·
  // far-outer) → Edit · More · Comment · Fix with AI.
  const dialItems: RadialDialItem[] = [
    { ...getStudioTool('edit')!, active: activeToolId === 'edit' },
    { id: 'more', label: 'More', title: 'More — screens, views, import', icon: LayoutGrid },
    { ...getStudioTool('comment')!, active: activeToolId === 'comment' },
    { ...getStudioTool('polish')!, active: activeToolId === 'polish' },
  ];

  /** Activate exactly one canvas tool; null exits all three. */
  const activateTool = useCallback((tool: StudioToolId | null) => {
    setIsAnnotationMode(tool === 'comment');
    setIsVisualEditMode(tool === 'edit');
    setIsTargetInspectMode(tool === 'polish');
  }, []);

  // ── Radial-dial handlers (mobile tools fan + More sheet) ──
  const closeDialAll = () => {
    setIsDialOpen(false);
    setIsMoreOpen(false);
  };
  const handleDialTrigger = () => {
    // One tap while a tool is active (fan closed) stops the tool.
    if (activeToolId && !isDialOpen && !isMoreOpen) {
      activateTool(null);
      return;
    }
    if (isMoreOpen) setIsMoreOpen(false);
    setIsDialOpen((o) => !o);
  };
  const handleDialWedge = (id: string) => {
    if (id === 'more') {
      setIsDialOpen(false);
      setIsMoreOpen(true);
      return;
    }
    const tool = id as StudioToolId;
    activateTool(activeToolId === tool ? null : tool);
    closeDialAll();
  };

  // Esc exits canvas tools and closes the dial — never while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (activeToolId || isDialOpen || isMoreOpen) {
        activateTool(null);
        closeDialAll();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeToolId, isDialOpen, isMoreOpen, activateTool]);
  const [syncTrigger, setSyncTrigger] = useState(0);
  const [isIframeLoading, setIsIframeLoading] = useState(true);
  // Save lifecycle feedback: 'Saving…' → 'Saved ✓' — the iframe is blanked
  // during saves (raw-request drain safeguard), so without this the user
  // stares at white with no indication anything happened.
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const saveNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showSaveNotice = (msg: string | null) => {
    if (saveNoticeTimer.current) clearTimeout(saveNoticeTimer.current);
    setSaveNotice(msg);
    if (msg) saveNoticeTimer.current = setTimeout(() => setSaveNotice(null), 2600);
  };

  // Reset iframe loading state when page or version changes
  useEffect(() => {
    setIsIframeLoading(true);
  }, [activeFilename, activePreviewVersion]);

  const [alertDialog, setAlertDialog] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    actionLabel?: string;
    onAction?: () => void;
    variant?: 'default' | 'destructive';
  }>({
    isOpen: false,
    title: '',
    description: '',
  });

  const showAlert = (title: string, description: string) => {
    setAlertDialog({ isOpen: true, title, description, actionLabel: 'OK', onAction: () => {} });
  };

  const showConfirm = (title: string, description: string, onConfirm: () => void, variant: 'default' | 'destructive' = 'default') => {
    setAlertDialog({ isOpen: true, title, description, onAction: onConfirm, actionLabel: 'Confirm', variant });
  };

  const handleSendChatPromptRef = useRef<((e?: React.FormEvent, overridePrompt?: string, overrideScope?: ChatScope) => void) | null>(null);

  // Bridge-send wrapper: the iframe bridge, PinsView and CommentsView call the
  // v1-shaped `handleSendChatPrompt(e?, overridePrompt?, overrideScope?)`; the
  // actual pipeline lives in the provider store (`sendPrompt`, P2-T01).
  const handleSendChatPrompt = useCallback((e?: React.FormEvent, overridePrompt?: string, overrideScope?: ChatScope) => {
    if (e) e.preventDefault();
    if (!overridePrompt || !overridePrompt.trim()) return;
    void sendPrompt(overridePrompt, overrideScope);
  }, [sendPrompt]);

  useEffect(() => {
    handleSendChatPromptRef.current = handleSendChatPrompt;
  }, [handleSendChatPrompt]);

  // Listen for pin drops and other signals from the iframe bridge.
  // Only accept messages from our own origin — a malicious third-party
  // page must not be able to forge LIVEFOLIO_* events.
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
       if (e.origin !== window.location.origin) return;
       if (e.data?.type === 'LIVEFOLIO_PIN_DROP') {
          setTempPin({
             x: e.data.x,
             y: e.data.y,
             selector: e.data.selector,
             elementHtml: e.data.elementHtml,
             slideIndex: e.data.slideIndex,
             sectionLabel: e.data.sectionLabel,
          });
       }
       if (e.data?.type === 'LIVEFOLIO_CONTENT_UPDATE') {
          setEditorCode(e.data.html);
          setHasUnsavedVisualEdits(true);
       }
       if (e.data?.type === 'LIVEFOLIO_TARGET_SELECT') {
          setTargetedElement({
             selector: e.data.selector,
             outerHTML: e.data.outerHTML,
             tagName: e.data.tagName
          });
          setIsTargetInspectMode(false);
          // v1 opened the floating chat modal here — the shell switches to the
          // keep-alive Chat tab instead.
          setView('chat');
       }
       if (e.data?.type === 'LIVEFOLIO_SUGGEST_PROMPT') {
          // v1 also forced chatScope('Current Screen') before auto-sending; the
          // store's sendPrompt defaults to 'Current Screen', so the explicit
          // scope below is equivalent for the autoSend path.
          setChatDraft(e.data.prompt || '');
          if (e.data.autoSend) {
             handleSendChatPromptRef.current?.(undefined, e.data.prompt, 'Current Screen');
          }
       }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── v1 fetchProject(shouldJumpToLatest) re-derivation (see header) ──────
  const jumpToLatestRef = useRef(false);
  const activeFilenameRef = useRef(activeFilename);
  activeFilenameRef.current = activeFilename;
  const activePreviewVersionRef = useRef(activePreviewVersion);
  activePreviewVersionRef.current = activePreviewVersion;

  // Derive the v1-fetchProject side effects from `project` changes: title/
  // description/design-prefs state, the active version (initial + jump), the
  // entry-point filename resolution, and the code-editor restore.
  useEffect(() => {
    if (!project) return;
    const latestVersion = project.versions[project.versions.length - 1];
    if (!latestVersion) return;
    setProjectTitleInput(project.title);
    setProjectDescriptionInput(project.description || '');
    if (project.projectMode) setProjectMode(project.projectMode);
    if (project.designPreferences) {
      const prefs = project.designPreferences;
      if (prefs.theme) setSelectedTheme(prefs.theme);
      if (prefs.typography) setSelectedTypography(prefs.typography);
      if (prefs.palette) setSelectedColorPalette(prefs.palette);
      if (prefs.libraries) setSelectedLibraries(prefs.libraries || []);
    }

    // Version: jump to the newest when a save/restore/apply asked for it (v1
    // fetchProject(true)); otherwise keep the current version while it still
    // exists; on initial load pick the newest.
    const shouldJump = jumpToLatestRef.current;
    const resolvedVersionId = shouldJump
      || !activePreviewVersionRef.current
      || !project.versions.some((v) => v.versionId === activePreviewVersionRef.current)
      ? latestVersion.versionId
      : activePreviewVersionRef.current;
    if (shouldJump) jumpToLatestRef.current = false;
    if (resolvedVersionId !== activePreviewVersionRef.current) {
      setActivePreviewVersionLocal(resolvedVersionId);
    }

    // On initial load (and when the current file vanished), ensure the active
    // file exists — pick the first HTML, preferring index.html (v1 1208–1221).
    let resolvedFilename = activeFilenameRef.current;
    if (!latestVersion.files[resolvedFilename]) {
      const htmlFiles = Object.keys(latestVersion.files).filter(k => k.endsWith('.html'));
      const best = htmlFiles.includes('index.html') ? 'index.html'
        : htmlFiles.length > 0 ? htmlFiles.sort()[0]
        : Object.keys(latestVersion.files)[0] || 'index.html';
      if (best !== resolvedFilename) {
        resolvedFilename = best;
        setActiveFilename(best);
      }
    }

    // Restore editor code — use the resolved version and filename (v1 1223–1227)
    const targetVer = project.versions.find((v) => v.versionId === resolvedVersionId) || latestVersion;
    if (targetVer.files[resolvedFilename]) {
      setEditorCode(targetVer.files[resolvedFilename]);
    }
  }, [project, setActiveFilename]);

  // Auto-apply jump: when an AI generation that started while we watched lands
  // a NEW version, point the preview at it once `isAiResponding` falls (v1
  // fetchProject(isAutoApply)). Proposal-only runs create no version — no jump.
  const latestVersionAtAiSendRef = useRef<string>('');
  const wasAiRespondingRef = useRef(false);
  useEffect(() => {
    if (isAiResponding && !wasAiRespondingRef.current) {
      latestVersionAtAiSendRef.current = project?.versions[project.versions.length - 1]?.versionId ?? '';
    } else if (!isAiResponding && wasAiRespondingRef.current) {
      const latest = project?.versions[project.versions.length - 1];
      if (latest && latest.versionId !== latestVersionAtAiSendRef.current) {
        setActivePreviewVersionLocal(latest.versionId);
      }
    }
    wasAiRespondingRef.current = isAiResponding;
  }, [isAiResponding, project]);

  // v1's stream-done handler switched the canvas to preview when a proposal
  // arrived (and after commits) — the proposal overlay lives in the preview.
  useEffect(() => {
    if (activeProposal) setCanvasMode('preview');
  }, [activeProposal]);

  // v1 handleApplyProposal (StudioClient 1410–1415): apply the awaiting
  // proposal. The provider's commitProposal does the network + refetch; the
  // jump flag makes the [project] effect point the preview at the new version
  // (v1 fetchProject(true)).
  const handleApplyProposal = async () => {
    if (!activeProposal) return;
    const filesArray = Object.entries(activeProposal.files).map(([filename, code]) => ({ filename, code }));
    jumpToLatestRef.current = true;
    await commitProposal('last', filesArray, activeProposal.explanation);
    setActiveProposal(null);
  };

  // Inject Pin Script into iframe for robust anchoring and contentEditable support
  useEffect(() => {
    const iframe = document.getElementById('studio-sandbox-iframe') as HTMLIFrameElement;
    if (!iframe) return;

    const handleIframeLoad = () => {
       const doc = iframe.contentDocument || iframe.contentWindow?.document;
       if (!doc || !doc.head || !doc.body) return;

       // Typed handle for Studio-injected lifecycle hooks stashed on the
       // iframe document (script-globals that would otherwise need `any`).
       const docHooks = doc as Document & {
         __lfImageResilienceInjected?: boolean;
         _debounceTimer?: ReturnType<typeof setTimeout> | null;
         _cleanupInspect?: () => void;
         _cleanupAnnotation?: () => void;
       };

       // 0. Image resilience — catch broken/dead images before they spam the console
       if (!docHooks.__lfImageResilienceInjected) {
         docHooks.__lfImageResilienceInjected = true;
         const resilienceScript = doc.createElement('script');
         resilienceScript.textContent = `
           (function(){
             var PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200"><rect width="400" height="200" fill="%23F4F4F0" stroke="%230F0F0D" stroke-width="2"/><rect x="175" y="80" width="50" height="50" fill="%23FF3B00"/><text x="200" y="160" text-anchor="middle" font-family="monospace" font-size="10" fill="%230F0F0D" opacity="0.4">Image unavailable</text></svg>');
             var fallbackCache = {};
             function handleImgError(e) {
               var img = e.target;
               if (!img || img.tagName !== 'IMG') return;
               if (img.dataset.lfFallback) return; // already handled
               img.dataset.lfFallback = '1';
               // Don't retry — replace immediately
               if (!fallbackCache[img.src]) {
                 fallbackCache[img.src] = true;
               }
               img.src = PLACEHOLDER;
               img.style.opacity = '0.6';
               img.style.filter = 'grayscale(0.3)';
               e.stopPropagation();
             }
             // Catch errors in capture phase — before they hit the console
             document.addEventListener('error', handleImgError, true);
             // Also patch new images added dynamically
             var observer = new MutationObserver(function(mutations) {
               mutations.forEach(function(m) {
                 m.addedNodes.forEach(function(node) {
                   if (node.tagName === 'IMG') {
                     node.addEventListener('error', handleImgError, true);
                   }
                   if (node.querySelectorAll) {
                     node.querySelectorAll('img').forEach(function(img) {
                       img.addEventListener('error', handleImgError, true);
                     });
                   }
                 });
               });
             });
             observer.observe(document.documentElement, { childList: true, subtree: true });
             // Add lazy loading to all images without it
             document.querySelectorAll('img:not([loading])').forEach(function(img) {
               img.loading = 'lazy';
             });
           })();
         `;
         doc.head.appendChild(resilienceScript);
       }

       // 1. Visual Edit Mode (contentEditable) — debounced to avoid per-keystroke sends
       doc.body.contentEditable = isVisualEditMode ? 'true' : 'false';
       if (isVisualEditMode) {
          doc.body.style.outline = '2px dashed #3b82f6';
          doc.body.style.outlineOffset = '-2px';

          let debounceTimer: ReturnType<typeof setTimeout> | null = null;
          // Helper to get clean HTML without injected Studio chrome
          const sendContentUpdate = () => {
             const clone = doc.documentElement.cloneNode(true) as HTMLElement;
             clone.querySelector('#livefolio-pins-layer')?.remove();
             const b = clone.querySelector('body');
             if (b) {
                b.contentEditable = 'false';
                b.style.outline = 'none';
             }
             const cleanHtml = '<!DOCTYPE html>\n' + clone.outerHTML;
             window.parent.postMessage({ type: 'LIVEFOLIO_CONTENT_UPDATE', html: cleanHtml }, window.location.origin);
          };

          const debouncedUpdate = () => {
             if (debounceTimer) clearTimeout(debounceTimer);
             debounceTimer = setTimeout(sendContentUpdate, 300);
          };

          doc.body.oninput = () => debouncedUpdate();
          doc.body.onblur = () => { if (debounceTimer) { clearTimeout(debounceTimer); sendContentUpdate(); } };

          // Store cleanup ref for debounce timer
          docHooks._debounceTimer = debounceTimer;
       } else {
          doc.body.style.outline = 'none';
          doc.body.oninput = null;
          doc.body.onblur = null;
          if (docHooks._debounceTimer) {
             clearTimeout(docHooks._debounceTimer);
             docHooks._debounceTimer = null;
          }
       }

        // 1.5. Target Inspect Mode (Point & Polish)
        if (docHooks._cleanupInspect) {
           docHooks._cleanupInspect();
           delete docHooks._cleanupInspect;
        }

        if (isTargetInspectMode) {
           doc.body.style.cursor = 'crosshair';

           let lastHovered: HTMLElement | null = null;
           const handleMouseOver = (e: MouseEvent) => {
              e.stopPropagation();
              const target = e.target as HTMLElement;
              if (!target || target === doc.body || target === doc.documentElement) return;
              if (lastHovered) {
                 lastHovered.style.outline = '';
                 lastHovered.style.outlineOffset = '';
              }
              lastHovered = target;
              target.style.outline = '2px solid #6366f1';
              target.style.outlineOffset = '-2px';
           };

           const handleMouseOut = (e: MouseEvent) => {
              e.stopPropagation();
              const target = e.target as HTMLElement;
              if (target) {
                 target.style.outline = '';
                 target.style.outlineOffset = '';
              }
           };

           const handleClick = (e: MouseEvent) => {
              e.stopPropagation();
              e.preventDefault();
              const target = e.target as HTMLElement;
              if (!target || target === doc.body || target === doc.documentElement) return;

              const getUniqueSelector = (el: HTMLElement): string => {
                 if (el.id) return '#' + el.id;
                 if (el === doc.body) return 'body';

                 const path: string[] = [];
                 let curr: HTMLElement | null = el;
                 while (curr && curr.nodeType === Node.ELEMENT_NODE) {
                    let selector = curr.nodeName.toLowerCase();
                    if (curr.id) {
                       selector += '#' + curr.id;
                       path.unshift(selector);
                       break;
                    } else {
                       let sib: Element | null = curr;
                       let sibIndex = 1;
                       while (sib = sib.previousElementSibling) {
                          if (sib.nodeName.toLowerCase() === selector) {
                             sibIndex++;
                          }
                       }
                       selector += `:nth-of-type(${sibIndex})`;
                    }
                    path.unshift(selector);
                    curr = curr.parentNode as HTMLElement | null;
                 }
                 return path.join(' > ');
              };

               // CRITICAL BUG FIX: Temporarily remove the blue outline & offset
               // so that target.outerHTML doesn't contain the outline styles
               // which would be sent to the AI as part of the element's style.
               const originalOutline = target.style.outline;
               const originalOutlineOffset = target.style.outlineOffset;

               target.style.outline = '';
               target.style.outlineOffset = '';

               const selector = getUniqueSelector(target);
               const outerHTML = target.outerHTML;
               const tagName = target.tagName.toLowerCase();

               // Restore the original styles in case they are still needed
               target.style.outline = originalOutline;
               target.style.outlineOffset = originalOutlineOffset;

               window.parent.postMessage({
                  type: 'LIVEFOLIO_TARGET_SELECT',
                  selector,
                  outerHTML,
                  tagName
               }, window.location.origin);
           };

           doc.addEventListener('mouseover', handleMouseOver);
           doc.addEventListener('mouseout', handleMouseOut);
           doc.addEventListener('click', handleClick, true);

           // Touch support for mobile inspect mode
           let touchTarget: HTMLElement | null = null;
           const handleTouchStart = (e: TouchEvent) => {
              if (e.touches.length === 1) {
                 const target = document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY) as HTMLElement;
                 if (target && target !== doc.body && target !== doc.documentElement) {
                    if (touchTarget) { touchTarget.style.outline = ''; touchTarget.style.outlineOffset = ''; }
                    touchTarget = target;
                    target.style.outline = '2px solid #6366f1';
                    target.style.outlineOffset = '-2px';
                 }
              }
           };
           const handleTouchEnd = () => {
              if (touchTarget) {
                 // Simulate click on the touched element
                 const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
                 touchTarget.dispatchEvent(clickEvent);
                 touchTarget.style.outline = '';
                 touchTarget.style.outlineOffset = '';
                 touchTarget = null;
              }
           };
           doc.addEventListener('touchstart', handleTouchStart, { passive: false });
           doc.addEventListener('touchend', handleTouchEnd, { passive: false });

           docHooks._cleanupInspect = () => {
              doc.removeEventListener('mouseover', handleMouseOver);
              doc.removeEventListener('mouseout', handleMouseOut);
              doc.removeEventListener('click', handleClick, true);
              doc.removeEventListener('touchstart', handleTouchStart);
              doc.removeEventListener('touchend', handleTouchEnd);
              doc.body.style.cursor = '';
              if (lastHovered) {
                 lastHovered.style.outline = '';
                 lastHovered.style.outlineOffset = '';
              }
              if (touchTarget) {
                 touchTarget.style.outline = '';
                 touchTarget.style.outlineOffset = '';
                 touchTarget = null;
              }
           };
        }

       // 2. Annotation Overlay inside iframe
       const existingContainer = doc.getElementById('livefolio-pins-layer');
       if (existingContainer) existingContainer.remove();

       const container = doc.createElement('div');
       container.id = 'livefolio-pins-layer';
       container.style.position = 'absolute';
       container.style.top = '0';
       container.style.left = '0';
       container.style.width = '100%';
       // Cover the FULL scrollable document height, not just the viewport.
       // `height: 100%` on a body-appended layer resolves to the viewport
       // height, so clicks below the fold miss the pin layer entirely (pins
       // only worked on the top screenful of long pages). Size it to the real
       // scroll height so the whole document is annotatable.
       {
          const fullHeight = Math.max(
             doc.documentElement.scrollHeight,
             doc.body.scrollHeight,
             doc.documentElement.offsetHeight,
             doc.body.offsetHeight,
          );
          container.style.height = `${fullHeight}px`;
       }
       // NEVER intercepts events — an intercepting overlay can't see the
       // element under the pointer (hit-testing returns the overlay itself,
       // never the content beneath), which left every captured pin without a
       // selector. Pin capture runs on capture-phase document listeners; this
       // layer is markers + tint only. Same model as public/livefolio-pin-bridge.js.
       container.style.pointerEvents = 'none';
       container.style.zIndex = '999999';
       container.style.overflow = 'hidden';

       let pinTouchStart: { x: number; y: number } | null = null;

       // ── Element resolution (keep in sync with livefolio-pin-bridge.js) ──
       const normWs = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ');
       const htmlShape = (html?: string): string => String(html ?? '').replace(/\s+/g, '');
       const commonPrefixLen = (a: string, b: string): number => {
          const n = Math.min(a.length, b.length);
          let i = 0;
          while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
          return i;
       };

       // Text-search fallback: the element whose text mentions a seed taken
       // from the captured snapshot (or the comment itself). Lets pins survive
       // DOM edits that invalidate structural selectors.
       const findByText = (seed?: string): HTMLElement | null => {
          // Strip any markup (the seed may be a raw elementHtml snapshot).
          const want = normWs(seed).replace(/<[^>]*>/g, ' ').trim();
          if (want.length < 12) return null;
          const probe = want.slice(0, 48);
          const all = doc.querySelectorAll(
             'h1, h2, h3, h4, p, li, blockquote, figcaption, td, th, dt, dd, span, a, strong, em, b, i, label, button'
          );
          let best: HTMLElement | null = null;
          let bestLen = Infinity;
          let guard = 0;
          for (let i = 0; i < all.length && guard < 30000; i++, guard++) {
             const el = all[i] as HTMLElement;
             if (el.children.length > 0) continue; // leaf-ish nodes only
             const t = normWs(el.textContent).trim();
             if (t && t.includes(probe) && t.length < bestLen) {
                best = el;
                bestLen = t.length;
             }
          }
          return best;
       };

       // Resolve the live element a pin points at: exact selector → shortened
       // selector with structural affinity to the captured snapshot → text
       // affinity. Null when nothing can be trusted (caller falls back to %).
       const resolvePinTarget = (pin: HTMLComment): HTMLElement | null => {
          if (pin.selector) {
             try {
                const hit = doc.querySelector(pin.selector) as HTMLElement | null;
                if (hit) return hit;
             } catch { /* malformed — fall through */ }
             try {
                const parts = String(pin.selector).split(' > ');
                const snapshotShape = htmlShape(pin.elementHtml);
                while (parts.length > 1) {
                   parts.pop();
                   let nodes: HTMLElement[] = [];
                   try {
                      nodes = Array.from(doc.querySelectorAll(parts.join(' > '))) as HTMLElement[];
                   } catch { nodes = []; }
                   if (nodes.length === 0) continue;
                   if (!snapshotShape) return nodes[nodes.length - 1];
                   let best = nodes[0];
                   let bestScore = -1;
                   for (let i = 0; i < nodes.length; i++) {
                      const score = commonPrefixLen(htmlShape(nodes[i].outerHTML), snapshotShape);
                      if (score > bestScore) { bestScore = score; best = nodes[i]; }
                   }
                   return best;
                }
             } catch { /* selector walk failed — fall through */ }
          }
          const found = findByText(pin.elementHtml || pin.text);
          if (found) return found;
          return null;
       };

       // Click target may be a text node — normalize to its element, skipping
       // body/html (whole-page clicks can't name an element).
       const elementAtTarget = (t: EventTarget | null): HTMLElement | null => {
          let el = (t as HTMLElement | null) || null;
          if (el && el.nodeType === 3) el = el.parentElement;
          while (el && (el === doc.body || el === doc.documentElement)) el = el.parentElement;
          return el && el.nodeType === 1 ? el : null;
       };

       if (isAnnotationMode) {
          // Detach any listeners left by a previous run of this effect — it
          // re-runs while pinning stays ON (comments change, device toggle),
          // and doc-level listeners would otherwise stack duplicates.
          if (docHooks._cleanupAnnotation) {
             docHooks._cleanupAnnotation();
             delete docHooks._cleanupAnnotation;
          }
          container.style.backgroundColor = 'rgba(24, 24, 27, 0.05)';
          if (doc.body) doc.body.style.cursor = 'crosshair';

          // Helper to build a CSS selector for an element (reused from inspect mode)
          const getUniqueSelector = (el: HTMLElement): string => {
             if (el.id) return '#' + el.id;
             if (el === doc.body) return 'body';
             const path: string[] = [];
             let curr: HTMLElement | null = el;
             while (curr && curr.nodeType === Node.ELEMENT_NODE) {
                let s = curr.nodeName.toLowerCase();
                if (curr.id) { s += '#' + curr.id; path.unshift(s); break; }
                else {
                   let sib: Element | null = curr;
                   let idx = 1;
                   while (sib = sib.previousElementSibling) {
                      if (sib.nodeName.toLowerCase() === s) idx++;
                   }
                   s += `:nth-of-type(${idx})`;
                }
                path.unshift(s);
                curr = curr.parentNode as HTMLElement | null;
             }
             return path.join(' > ');
          };

          // Containing section context — the curated brief uses this to tell an
          // AI "Section 05" instead of "Whole Page / Global". Keep in sync with
          // public/livefolio-pin-bridge.js getSectionContext.
          const getSectionContext = (el: HTMLElement): { slideIndex?: number; sectionLabel?: string } => {
             let node: HTMLElement | null = el;
             while (node && node.nodeType === Node.ELEMENT_NODE &&
                    node !== doc.body && node !== doc.documentElement) {
                const tag = (node.tagName || '').toLowerCase();
                if (tag === 'section' || tag === 'article' ||
                    (node.hasAttribute && node.hasAttribute('data-section'))) break;
                node = node.parentElement;
             }
             if (!node || node === doc.body || node === doc.documentElement) return {};
             const sections = doc.querySelectorAll('section, article, [data-section]');
             let idx = -1;
             for (let i = 0; i < sections.length; i++) {
                if (sections[i] === node) { idx = i; break; }
             }
             const heading = node.querySelector('h1, h2, h3');
             const label = heading && heading.textContent
                ? String(heading.textContent).replace(/\s+/g, ' ').trim().slice(0, 120)
                : '';
             return {
                slideIndex: idx >= 0 ? idx : undefined,
                sectionLabel: label || undefined,
             };
          };

          const capturePin = (t: EventTarget | null, clientX: number, clientY: number) => {
             // Capture-phase listeners make t the REAL content element (nothing
             // overlays it in pin mode). Coordinates are scroll-absolute
             // percentages of the CURRENT layout.
             const absoluteX = clientX + doc.defaultView!.scrollX;
             const absoluteY = clientY + doc.defaultView!.scrollY;
             const x = (absoluteX / doc.documentElement.scrollWidth) * 100;
             const y = (absoluteY / doc.documentElement.scrollHeight) * 100;

             const targetEl = elementAtTarget(t);
             const selector = targetEl ? getUniqueSelector(targetEl) : undefined;
             const elementHtml = targetEl ? targetEl.outerHTML.substring(0, 500) : undefined;
             const sectionCtx = targetEl ? getSectionContext(targetEl) : {};

             window.parent.postMessage({
                type: 'LIVEFOLIO_PIN_DROP', x, y, selector, elementHtml,
                slideIndex: sectionCtx.slideIndex, sectionLabel: sectionCtx.sectionLabel,
             }, window.location.origin);
          };

          const handlePinClick = (e: MouseEvent) => {
             e.preventDefault();
             e.stopPropagation();
             capturePin(e.target, e.clientX, e.clientY);
          };

          // Touch support — touchend capture with a movement guard so a scroll
          // fling never drops a pin; preventDefault suppresses the phantom
          // click the browser would otherwise fire into the folio.
          const handleTouchStart = (e: TouchEvent) => {
             if (e.changedTouches.length === 1) {
                const touch = e.changedTouches[0];
                pinTouchStart = { x: touch.clientX, y: touch.clientY };
             }
          };
          const handleTouchPin = (e: TouchEvent) => {
             if (e.changedTouches.length !== 1) return;
             const touch = e.changedTouches[0];
             const moved = pinTouchStart
                ? Math.hypot(touch.clientX - pinTouchStart.x, touch.clientY - pinTouchStart.y)
                : 0;
             pinTouchStart = null;
             if (moved > 12) return; // a scroll, not a tap
             e.preventDefault();
             e.stopPropagation();
             capturePin(e.target, touch.clientX, touch.clientY);
          };

          doc.addEventListener('click', handlePinClick, true);
          doc.addEventListener('touchstart', handleTouchStart, { passive: true, capture: true });
          doc.addEventListener('touchend', handleTouchPin, { passive: false, capture: true });

          // Store cleanup
          docHooks._cleanupAnnotation = () => {
             doc.removeEventListener('click', handlePinClick, true);
             doc.removeEventListener('touchstart', handleTouchStart, { capture: true });
             doc.removeEventListener('touchend', handleTouchPin, { capture: true });
             if (doc.body) doc.body.style.cursor = '';
          };
       } else {
          if (docHooks._cleanupAnnotation) {
             docHooks._cleanupAnnotation();
             delete docHooks._cleanupAnnotation;
          }
          if (doc.body) doc.body.style.cursor = '';
       }

       // Render pins with selector-first anchoring, percentage fallback
       const allComments = project?.comments || [];
       const activePins = allComments.filter(c => c.filename === activeFilename && !c.resolved);
       // Folio iframes are sandboxed, so the app shell's CSS variables never
       // reach them — resolve the accent color HERE and inject hex values
       // (the old marker referenced var(--app-accent) and rendered with no
       // background at all inside the iframe).
       const accentHex =
          (typeof window !== 'undefined'
             ? getComputedStyle(document.documentElement).getPropertyValue('--app-accent').trim()
             : '') || '#FF3B00';
       activePins.forEach((pin) => {
          // Use stable index from the full comments array, not sequential filtered index
          const stableIndex = allComments.findIndex(c => c.id === pin.id);
          const pinNumber = stableIndex >= 0 ? stableIndex + 1 : 0;
          const pinEl = doc.createElement('div');
          pinEl.style.position = 'absolute';
          pinEl.style.width = '24px';
          pinEl.style.height = '24px';
          pinEl.style.marginLeft = '-12px';
          pinEl.style.marginTop = '-12px';
          // While pinning, markers must not intercept the click.
          pinEl.style.pointerEvents = isAnnotationMode ? 'none' : 'auto';
          pinEl.style.cursor = 'help';

          // Anchor to the resolved element's CURRENT rect (exact selector →
          // structure affinity → text affinity), so markers stay on the right
          // element across devices, layouts, and small DOM edits. Stored
          // percentages are the last resort — only trustworthy when the pin's
          // document layout never changed since capture.
          let left = pin.x != null ? `${pin.x}%` : '50%';
          let top = pin.y != null ? `${pin.y}%` : '50%';
          const targetEl = resolvePinTarget(pin);
          if (targetEl) {
             const rect = targetEl.getBoundingClientRect();
             if (rect.width > 0 || rect.height > 0) {
                const absX = rect.left + (doc.defaultView?.scrollX || 0) + rect.width / 2;
                const absY = rect.top + (doc.defaultView?.scrollY || 0) + rect.height / 2;
                left = `${(absX / doc.documentElement.scrollWidth) * 100}%`;
                top = `${(absY / doc.documentElement.scrollHeight) * 100}%`;
             }
          }
          pinEl.style.left = left;
          pinEl.style.top = top;

          // Soft marker + tooltip — matches the guest/share annotation layer
          // (accent circle, white ring, rounded dark card) so pins look the
          // same everywhere a folio is viewed or edited.
          pinEl.innerHTML = `
            <div style="width:100%;height:100%;background:${accentHex};color:#fff;border-radius:9999px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 10px rgba(15,15,13,0.25);border:2px solid #F4F4F0;font-size:10px;font-weight:700;font-family:system-ui,-apple-system,sans-serif;transition:transform 0.2s ease, box-shadow 0.2s ease;">
               ${pinNumber}
            </div>
            <div class="livefolio-tooltip" style="position:absolute;top:34px;left:50%;transform:translateX(-50%);display:none;background:#0F0F0D;color:#F4F4F0;font-size:11px;line-height:1.45;padding:8px 12px;border-radius:12px;max-width:240px;white-space:normal;box-shadow:0 4px 16px rgba(15,15,13,0.3);font-family:system-ui,-apple-system,sans-serif;font-weight:500;z-index:1000000;">
               <strong style="display:block;font-size:9px;text-transform:uppercase;letter-spacing:0.08em;opacity:0.7;margin-bottom:2px;">${escapeHtml(pin.author || 'Feedback')}</strong>
               <span style="opacity:0.95;">${escapeHtml(pin.text || 'View this note')}</span>
            </div>
          `;

          pinEl.onmouseenter = () => {
             (pinEl.children[0] as HTMLElement).style.transform = 'scale(1.15)';
             (pinEl.children[1] as HTMLElement).style.display = 'block';
          };
          pinEl.onmouseleave = () => {
             (pinEl.children[0] as HTMLElement).style.transform = 'scale(1)';
             (pinEl.children[1] as HTMLElement).style.display = 'none';
          };

          container.appendChild(pinEl);
       });

       doc.body.appendChild(container);
    };

    iframe.addEventListener('load', handleIframeLoad);

    // Fallback if already loaded
    if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
       handleIframeLoad();
    }

    return () => iframe.removeEventListener('load', handleIframeLoad);
    // viewportSize: switching the preview device reflows the folio — markers
    // must re-anchor against the new layout.
  }, [project?.comments, isAnnotationMode, activeFilename, syncTrigger, isVisualEditMode, isTargetInspectMode, viewportSize]);

  const handleSubmitTempComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tempPin || !newCommentText.trim() || !project || isSavingPin) return;
    setIsSavingPin(true);
    try {
      const res = await fetch(`/api/files/${project.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: newCommentText,
          author: currentUser.name,
          x: tempPin.x,
          y: tempPin.y,
          filename: activeFilename,
          versionId: activePreviewVersion,
          ...(tempPin.selector ? { selector: tempPin.selector } : {}),
          ...(tempPin.elementHtml ? { elementHtml: tempPin.elementHtml } : {}),
          ...(tempPin.slideIndex !== undefined ? { slideIndex: tempPin.slideIndex } : {}),
          ...(tempPin.sectionLabel ? { sectionLabel: tempPin.sectionLabel } : {}),
        })
      });

      if (res.ok) {
        await fetchProject();
        setTempPin(null);
        setNewCommentText('');
        setIsAnnotationMode(false);
      }
    } catch (err) {
      console.error('Failed to submit comment:', err);
    } finally {
      setIsSavingPin(false);
    }
  };

  const handleSaveModifiedCode = async (nextFilesMap: { [filename: string]: string }, message: string) => {
    if (!project) return;

    // Blank the iframe before the PUT.  Folios with many images trigger
    // dozens of concurrent /api/raw requests that saturate the DB pool.
    // Blanking cancels all of them so the PUT doesn't timeout.
    const iframe = document.getElementById('studio-sandbox-iframe') as HTMLIFrameElement | null;
    const previousSrc = iframe?.src || '';
    if (iframe) {
      iframe.src = 'about:blank';
      await new Promise(r => setTimeout(r, 100));
    }
    // Cover the blanked frame so the user sees progress, not white.
    setIsIframeLoading(true);
    showSaveNotice('Saving…');

    try {
      setImportPhase('transforming');
      await new Promise((r) => setTimeout(r, 50));

      const { files: leanFiles, extractedCount } = extractBase64Images(nextFilesMap);
      if (extractedCount > 0) {
        console.log(`[Studio] Extracted ${extractedCount} base64 images before save`);
      }

      // Split files into text (goes through PUT as JSON) and images
      // (uploaded as binary to bypass Next.js's 10 MB body buffer limit).
      const imageExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp']);
      const isImage = (path: string) => imageExts.has(path.split('.').pop()?.toLowerCase() || '');
      const textFiles: Record<string, string> = {};
      const imageFiles: Record<string, string> = {};
      // After extractBase64Images, every extracted image has TWO entries:
      // the original path AND the asset copy (assets/img-{hash}.ext).
      // HTML files reference the ORIGINAL paths (screenshots/hero.png), not
      // the asset copies. Keep originals, skip asset copies when content matches.
      const originalContents = new Set<string>();
      for (const [path, content] of Object.entries(leanFiles)) {
        if (isImage(path) && !path.startsWith('assets/')) {
          originalContents.add(content);
        }
      }
      for (const [path, content] of Object.entries(leanFiles)) {
        if (isImage(path)) {
          // Skip asset copy when the original file already provides this content
          if (path.startsWith('assets/') && originalContents.has(content)) continue;
          imageFiles[path] = content;
        } else {
          textFiles[path] = content;
        }
      }

      // 1. PUT with text-only files (always well under 10 MB — HTML/CSS/JS only)
      setImportPhase('saving');
      const putRes = await fetch(`/api/files/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: textFiles, commitMessage: message }),
      });
      if (!putRes.ok) {
        const errData = await putRes.json().catch(() => ({}));
        throw new Error(errData.error || `Server returned ${putRes.status}`);
      }

      // 2. Upload all images in one multipart request — raw binary,
      // no base64 inflation (saves 33%), no JSON body limits.
      if (Object.keys(imageFiles).length > 0) {
        setImportPhase('transforming');
        const form = new FormData();
        for (const [path, dataUrl] of Object.entries(imageFiles)) {
          const b64 = dataUrl.replace(/^data:[^;]+;base64,/, '');
          // atob() decodes base64 → latin1 binary string → Uint8Array
          const binary = atob(b64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const ext = path.split('.').pop()?.toLowerCase() || 'bin';
          const mime = {png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',ico:'image/x-icon',svg:'image/svg+xml'}[ext] || 'application/octet-stream';
          form.append('files', new Blob([bytes], { type: mime }), path);
        }
        const res = await fetch(`/api/files/${project.id}/upload-batch`, {
          method: 'POST',
          body: form,
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Batch upload failed (${res.status})`);
        }
        console.log(`[Studio] Uploaded ${Object.keys(imageFiles).length} images`);
      }

      // v1: fetchProject(true) — jump the preview to the new version. The
      // provider's fetchProject has no jump parameter; the [project] effect
      // consumes this flag and bumps activePreviewVersion on the next render.
      setImportPhase('finalizing');
      showSaveNotice('Saved ✓');
      jumpToLatestRef.current = true;
      await fetchProject();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- save errors are thrown with free-form messages; err.message is read
    } catch (err: any) {
      setImportPhase(null);
      showSaveNotice(null);
      showAlert('Error', err.message || 'Failed to save changes.');
      throw err;
    } finally {
      // Restore the iframe unless fetchProject already set a new src. When a
      // jump is pending the [project] effect points the iframe at the new
      // version immediately after this render — skipping the restore here
      // avoids loading the stale version (v1 restored `previousSrc`, then the
      // version bump aborted it and loaded the new one: two loads total; the
      // shell does one).
      if (iframe && iframe.src === 'about:blank' && !jumpToLatestRef.current) {
        iframe.src = previousSrc || `/api/raw/${project.id}/${activeFilename}?v=${activePreviewVersion}`;
      }
    }
  };

  const handleRestoreVersion = async (versionId: string) => {
    if (!project) return;

    showConfirm(
      "Restore Checkpoint",
      `Are you sure you want to restore the entire project to version ${versionId}? This will create a new history entry.`,
      async () => {
        try {
          const res = await fetch(`/api/files/${project.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              restoreVersionId: versionId,
              author: isCloud ? 'Talel' : 'OSS User'
            })
          });

          if (res.ok) {
            // v1: fetchProject(true) — jump to the new restore version.
            jumpToLatestRef.current = true;
            await fetchProject();
            setCanvasMode('preview');
          }
        } catch (err) {
          console.error('Failed to restore version:', err);
        }
      }
    );
  };

  const handleCommitManualEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editorCode.trim() || !editorCommitMessage.trim() || !project || isCommitting) return;
    setIsCommitting(true);
    try {
      const latestVersion = project.versions[project.versions.length - 1];
      const nextFilesMap = { ...latestVersion.files, [activeFilename]: editorCode };
      await handleSaveModifiedCode(nextFilesMap, editorCommitMessage);
      setEditorCommitMessage('');
    } finally {
      setIsCommitting(false);
    }
  };

;

  // Resolve/delete need a server-verified session; the routes fall back to the
  // session cookie, but a genuinely expired session still 401s. Surface that
  // instead of swallowing it (the old empty catch made deletes silently no-op).
  const handleCommentMutationError = async (res: Response, verb: string): Promise<void> => {
    if (res.status === 401) {
      await showConfirm(
        'Session expired',
        'Your session has expired. Please sign in again — no changes were made.',
        async () => { window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname); },
        'destructive'
      );
    } else {
      const data = await res.json().catch(() => null);
      await showConfirm(
        `Could not ${verb} note`,
        data?.error || 'Something went wrong. Please try again.',
        async () => {},
        'destructive'
      );
    }
  };

  const handleToggleResolveComment = async (commentId: string, currentResolved: boolean) => {
    if (!project) return;
    try {
      const res = await fetch(`/api/files/${project.id}/comments`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId, resolved: !currentResolved })
      });
      if (res.ok) await fetchProject();
      else await handleCommentMutationError(res, 'resolve');
    } catch {
      await showConfirm('Network error', 'Could not reach the server. Please try again.', async () => {}, 'destructive');
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!project) return;

    // Type-aware wording — pins (spatial annotations) vs discussion comments
    const comment = (project.comments || []).find(c => c.id === commentId);
    const isPin = comment ? (!comment.type || comment.type === 'pin') : true;

    showConfirm(
      isPin ? "Delete Pin" : "Delete Comment",
      isPin
        ? "Are you sure you want to permanently delete this feedback pin?"
        : "Are you sure you want to permanently delete this comment?",
      async () => {
        try {
          const res = await fetch(`/api/files/${project.id}/comments?commentId=${commentId}`, {
            method: 'DELETE'
          });
          if (res.ok) await fetchProject();
          else await handleCommentMutationError(res, 'delete');
        } catch {
          await showConfirm('Network error', 'Could not reach the server. Please try again.', async () => {}, 'destructive');
        }
      },
      'destructive'
    );
  };

  const handleAddNewPageFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileNameInput.trim() || !project || isCreatingPage) return;
    setIsCreatingPage(true);
    try {
    let finalName = newFileNameInput.trim();
    if (!finalName.endsWith('.html')) finalName += '.html';

    const latestVersion = project.versions[project.versions.length - 1];
    const nextFilesMap = {
      ...latestVersion.files,
      [finalName]: `<!DOCTYPE html>
<html lang="en" class="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Canvas is Ready - LiveFolio</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background-color: #fafafa;
    }
    h1 {
      font-family: 'Space Grotesk', sans-serif;
    }
  </style>
</head>
<body class="bg-[#fafafa] text-zinc-700 min-h-screen overflow-hidden flex flex-col justify-center items-center relative p-6 select-none">
  <!-- Central subtle background glow -->
  <div class="absolute w-[350px] h-[350px] rounded-full bg-indigo-500/5 blur-[120px] pointer-events-none z-0"></div>

  <!-- Centered container -->
  <div class="max-w-md w-full text-center relative z-10 flex flex-col items-center">
    <!-- Brand Logo in Center -->
    <div class="relative mb-6">
      <div class="absolute inset-0 bg-indigo-500/5 rounded-full blur-xl pointer-events-none"></div>
      <img src="/logo-v2.svg" alt="LiveFolio Logo" class="relative w-20 h-20 object-contain mx-auto" />
    </div>

    <!-- Title -->
    <h1 class="text-3xl font-extrabold tracking-tight text-zinc-900 mb-2">
      Your canvas is ready.
    </h1>

    <!-- Subtitle/Description -->
    <p class="text-zinc-500 text-sm leading-relaxed mb-8">
      Let's transform <span class="text-indigo-600  font-semibold">${finalName}</span> into a custom interactive web experience.
    </p>

    <!-- Clean, simple how-to helper blocks -->
    <div class="w-full space-y-3">
      <div class="p-4 rounded-xl bg-white border border-zinc-200/80 shadow-[0_2px_8px_-1px_rgba(0,0,0,0.03)] text-left hover:border-indigo-500/20 transition-colors duration-300">
        <div class="flex items-start gap-3">
          <div class="w-1.5 h-1.5 rounded-full bg-indigo-600 mt-1.5 shrink-0"></div>
          <div>
            <h4 class="text-xs font-bold text-zinc-900 uppercase tracking-wide">Ask AI Co-pilot</h4>
            <p class="text-xs text-zinc-500 mt-1">Use the chat on the right to easily generate layouts, edit content, or apply design system presets.</p>
          </div>
        </div>
      </div>

      <div class="p-4 rounded-xl bg-white border border-zinc-200/80 shadow-[0_2px_8px_-1px_rgba(0,0,0,0.03)] text-left hover:border-indigo-500/20 transition-colors duration-300">
        <div class="flex items-start gap-3">
          <div class="w-1.5 h-1.5 rounded-full bg-indigo-600 mt-1.5 shrink-0"></div>
          <div>
            <h4 class="text-xs font-bold text-zinc-900 uppercase tracking-wide">Visual Edit Mode</h4>
            <p class="text-xs text-zinc-500 mt-1">Enable "Visual Edit" mode at the top of the canvas to click and edit text or modify styles directly.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`
    };

    await handleSaveModifiedCode(nextFilesMap, `Created ${finalName}`);
    setIsCreateScreenOpen(false);
    setNewFileNameInput('');
    setActiveFilename(finalName);
    setCanvasMode('preview');
    } finally {
      setIsCreatingPage(false);
    }
  };

  const handleDirectHtmlUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !project) return;

    try {
      const content = await readTextFile(file);
      let filename = file.name;
      if (!filename.endsWith('.html')) {
        filename += '.html';
      }

      const latestVersion = project.versions[project.versions.length - 1];
      const nextFilesMap = {
        ...latestVersion.files,
        [filename]: content
      };

      await handleSaveModifiedCode(nextFilesMap, `Uploaded ${filename} directly`);
      setActiveFilename(filename);
      setCanvasMode('preview');
      showAlert("Upload Successful", `"${filename}" has been added to your screen list!`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- file-read errors are thrown with free-form messages; err.message is read
    } catch (err: any) {
      console.error('Failed to upload HTML file:', err);
      showAlert("Upload Failed", err.message || "An error occurred while reading the file.");
    } finally {
      e.target.value = '';
    }
  };

  const loadJSZip = (): Promise<StudioJsZipLib> => {
    const jszipWindow = window as Window & { JSZip?: StudioJsZipLib };
    return new Promise((resolve, reject) => {
      if (jszipWindow.JSZip) {
        resolve(jszipWindow.JSZip);
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      script.onload = () => {
        if (jszipWindow.JSZip) {
          resolve(jszipWindow.JSZip);
        } else {
          reject(new Error("JSZip was loaded but is not available on window."));
        }
      };
      script.onerror = () => reject(new Error("Failed to load ZIP extraction engine from CDN."));
      document.head.appendChild(script);
    });
  };

  const handleFolderImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !project) return;

    // Pre-flight: estimate total size and check against known limits
    let totalBytes = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const relativePath = file.webkitRelativePath || file.name;
      const segments = relativePath.split('/');
      const isExcluded = segments.some(part =>
        ['node_modules', '.git', '.github', '.next', '.gemini', 'dist', 'build', '__MACOSX'].includes(part) ||
        part.startsWith('.') || part === '.DS_Store'
      );
      if (!isExcluded) totalBytes += file.size;
    }
    // Base64 encoding adds ~33%, JSON wrapping adds ~10% → estimate ~1.5x
    const estimatedFoliobytes = Math.ceil(totalBytes * 1.5);
    if (estimatedFoliobytes > 32_000_000) {
      showAlert(
        "Folder Too Large",
        `This folder is approximately ${(estimatedFoliobytes / 1_000_000).toFixed(1)} MB after processing. Maximum folio size is 32 MB. Try removing large images or screenshots.`
      );
      e.target.value = '';
      return;
    }

    setIsImporting(true);
    setImportPhase('reading');
    setLiveImportCount(0);
    try {
      const latestVersion = project.versions[project.versions.length - 1];
      const nextFilesMap = { ...latestVersion.files };
      let importCount = 0;
      let firstHtml: string | null = null;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const relativePath = file.webkitRelativePath || file.name;

        // Strip top-level directory segment if present
        const segments = relativePath.split('/');
        let cleanPath = relativePath;
        if (segments.length > 1) {
          cleanPath = segments.slice(1).join('/');
        }

        // Filter out system directories, dependencies, and dotfiles
        const isExcluded = cleanPath.split('/').some(part =>
          ['node_modules', '.git', '.github', '.next', '.gemini', 'dist', 'build', '__MACOSX'].includes(part) ||
          part.startsWith('.') ||
          part === '.DS_Store'
        );
        if (isExcluded) continue;

        // Enforce file size limit (5MB)
        if (file.size > 5 * 1024 * 1024) continue;

        const ext = cleanPath.split('.').pop()?.toLowerCase();
        if (!ext) continue;

        const isText = ['html', 'css', 'js', 'jsx', 'ts', 'tsx', 'json', 'svg', 'md', 'txt'].includes(ext);
        const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico'].includes(ext);

        if (isText) {
          const content = await readTextFile(file);
          nextFilesMap[cleanPath] = content;
          importCount++;
          setLiveImportCount(importCount);
          if (ext === 'html' && (!firstHtml || cleanPath === 'index.html')) {
            firstHtml = cleanPath;
          }
        } else if (isImage) {
          const base64 = await readImageAsDataURL(file);
          nextFilesMap[cleanPath] = base64;
          importCount++;
          setLiveImportCount(importCount);
        }
      }

      if (importCount === 0) {
        throw new Error("No compatible web source files (.html, .css, .js, .svg, .json) or images were found in the folder.");
      }

      setImportPhase('saving');
      await handleSaveModifiedCode(nextFilesMap, `Imported Repository Folder (${importCount} files)`);
      setIsImportRepoOpen(false);
      if (firstHtml) {
        setActiveFilename(firstHtml);
      }
      setCanvasMode('preview');
      showAlert("Import Successful", `Successfully parsed and loaded ${importCount} files into your LiveFolio workspace!`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- import errors are thrown with free-form messages; err.message is read
    } catch (err: any) {
      console.error('Folder import failed:', err);
      setImportPhase(null);
      showAlert("Import Failed", err.message || "An error occurred while importing your files.");
    } finally {
      setIsImporting(false);
      setImportPhase(null);
      setLiveImportCount(0);
      e.target.value = '';
    }
  };

  const handleZipImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !project) return;

    // Pre-flight: ZIP files expand ~2-3x when unpacked + base64 encoded
    const estimatedFoliobytes = Math.ceil(file.size * 2.5);
    if (estimatedFoliobytes > 32_000_000) {
      showAlert(
        "ZIP Too Large",
        `This archive is ${(file.size / 1_000_000).toFixed(1)} MB and may expand to ${(estimatedFoliobytes / 1_000_000).toFixed(1)} MB after processing. Maximum folio size is 32 MB. Try removing large images or splitting into smaller archives.`
      );
      e.target.value = '';
      return;
    }

    setIsImporting(true);
    setImportPhase('reading');
    setLiveImportCount(0);
    try {
      const JSZip = await loadJSZip();
      const zip = await JSZip.loadAsync(file);

      const latestVersion = project.versions[project.versions.length - 1];
      const nextFilesMap = { ...latestVersion.files };
      let importCount = 0;
      let firstHtml: string | null = null;

      for (const [relativePath, entryVal] of Object.entries(zip.files)) {
        const zipEntry = entryVal;
        if (zipEntry.dir) continue;

        // Strip top-level folder name if zipped as a folder
        const segments = relativePath.split('/');
        let cleanPath = relativePath;
        if (segments.length > 1) {
          cleanPath = segments.slice(1).join('/');
        }

        // Filter out system files, node_modules, build directories, and dotfiles
        const isExcluded = cleanPath.split('/').some(part =>
          ['node_modules', '.git', '.github', '.next', '.gemini', 'dist', 'build', '__MACOSX'].includes(part) ||
          part.startsWith('.') ||
          part === '.DS_Store'
        );
        if (isExcluded) continue;

        const ext = cleanPath.split('.').pop()?.toLowerCase();
        if (!ext) continue;

        const isText = ['html', 'css', 'js', 'jsx', 'ts', 'tsx', 'json', 'svg', 'md', 'txt'].includes(ext);
        const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico'].includes(ext);

        if (isText) {
          const content = await zipEntry.async('string');
          nextFilesMap[cleanPath] = content;
          importCount++;
          setLiveImportCount(importCount);
          if (ext === 'html' && (!firstHtml || cleanPath === 'index.html')) {
            firstHtml = cleanPath;
          }
        } else if (isImage) {
          const base64 = await zipEntry.async('base64');
          const mime = ext === 'ico' ? 'image/x-icon' : `image/${ext}`;
          nextFilesMap[cleanPath] = `data:${mime};base64,${base64}`;
          importCount++;
          setLiveImportCount(importCount);
        }
      }

      if (importCount === 0) {
        throw new Error("No compatible web source files (.html, .css, .js, .svg, .json) or images were found in the ZIP archive.");
      }

      setImportPhase('saving');
      await handleSaveModifiedCode(nextFilesMap, `Imported ZIP Repository: ${file.name}`);
      setIsImportRepoOpen(false);
      if (firstHtml) {
        setActiveFilename(firstHtml);
      }
      setCanvasMode('preview');
      showAlert("Import Successful", `Successfully extracted and loaded ${importCount} files from ZIP archive!`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- import errors are thrown with free-form messages; err.message is read
    } catch (err: any) {
      console.error('ZIP import failed:', err);
      setImportPhase(null);
      showAlert("Import Failed", err.message || "An error occurred while extracting the ZIP repository.");
    } finally {
      setIsImporting(false);
      setImportPhase(null);
      setLiveImportCount(0);
      e.target.value = '';
    }
  };

  // --- ATTACHMENT PORTAL CLIENT UTILITIES ---

  const readTextFile = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string || '');
      reader.onerror = () => reject(new Error('Failed to read plain text file.'));
      reader.readAsText(file);
    });
  };

  const readImageAsDataURL = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string || '');
      reader.onerror = () => reject(new Error('Failed to read binary image file.'));
      reader.readAsDataURL(file);
    });
  };

  const extractTextFromPDF = async (file: File): Promise<string> => {
    const pdfWindow = window as Window & { pdfjsLib?: StudioPdfJsLib };
    return new Promise((resolve, reject) => {
      if (pdfWindow.pdfjsLib) {
        runExtraction(pdfWindow.pdfjsLib, file, resolve, reject);
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.onload = () => {
        const pdfjsLib = pdfWindow.pdfjsLib!;
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        runExtraction(pdfjsLib, file, resolve, reject);
      };
      script.onerror = () => reject(new Error('Failed to load secure client-side PDF.js extraction engine.'));
      document.head.appendChild(script);
    });
  };

  const runExtraction = async (pdfjsLib: StudioPdfJsLib, file: File, resolve: (val: string) => void, reject: (err: unknown) => void) => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      let fullText = '';

      const maxPages = Math.min(pdf.numPages, 15);
      for (let i = 1; i <= maxPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item) => item.str).join(' ');
        fullText += `--- Page ${i} ---\n${pageText}\n\n`;
      }

      if (pdf.numPages > 15) {
        fullText += `\n[Context Truncated: Document contains ${pdf.numPages} pages; first 15 pages extracted to prevent context window overflow.]`;
      }

      resolve(fullText.trim());
    } catch (err) {
      console.error('PDF text extraction error:', err);
      reject(err);
    }
  };

  const handleAttachmentFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedAttachmentFile(file);
    setExtractedContextText('');
    setAttachmentIntent('enrich');
    setIsAttachmentPortalOpen(true);

    const isImage = file.type.startsWith('image/');
    setIsExtractingText(true);
    try {
      if (isImage) {
        const dataUrl = await readImageAsDataURL(file);
        setExtractedContextText(dataUrl);
      } else if (file.name.endsWith('.pdf')) {
        const text = await extractTextFromPDF(file);
        setExtractedContextText(text);
      } else {
        const text = await readTextFile(file);
        setExtractedContextText(text);
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- file-parsing errors are thrown with free-form messages; err.message is read
    } catch (err: any) {
      showAlert("File Parsing Error", err.message || "LiveFolio was unable to extract contents from the selected file.");
    } finally {
      setIsExtractingText(false);
    }
  };

  const handleCommitAttachment = async () => {
    if (!project || !selectedAttachmentFile || !extractedContextText) return;
    setIsUploadingAsset(true);

    try {
      const filename = selectedAttachmentFile.name;
      const isImage = selectedAttachmentFile.type.startsWith('image/');

      if (isImage) {
        const latestVersion = project.versions[project.versions.length - 1];
        const assetPath = `assets/${filename}`;
        const nextFilesMap = { ...latestVersion.files, [assetPath]: extractedContextText };

        await handleSaveModifiedCode(nextFilesMap, `Upload Visual Asset: ${filename}`);
        showAlert("Asset Uploaded", `Successfully integrated "${filename}" as a version-controlled visual asset under "assets/". You can reference it in your code or ask the co-pilot to insert it.`);
      } else {
        if (attachmentIntent === 'enrich') {
          const currentRefs = project.referenceFiles || [];
          const exists = currentRefs.some(r => r.filename === filename);
          if (exists) {
            showAlert("Duplicate Reference", "A reference file with this exact name already exists in this folio context.");
            setIsUploadingAsset(false);
            return;
          }

          const updatedRefs = [...currentRefs, { filename, size: selectedAttachmentFile.size, content: extractedContextText }];
          const res = await fetch(`/api/files/${project.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ referenceFiles: updatedRefs })
          });

          if (res.ok) {
            await fetchProject();
            showAlert("Knowledge Base Enriched", `"${filename}" has been added to the folio's persistent context. The Co-pilot will automatically reference this text block in future queries.`);
          } else {
            throw new Error("Failed to write reference file database record.");
          }
        } else {
          // v1 setAiPrompt(...) — the composer draft now lives in the provider
          // store (ChatView reads it).
          setChatDraft(`Please analyze the attached reference document "${filename}" and build a completely new high-fidelity page/layout screen that maps its structure, elements, or context. Here is the text content from the file:\n\n${extractedContextText}`);
          showAlert("Ready to Convert", `Extracted text from "${filename}" has been loaded into your Co-Pilot prompt. Press Send to convert the document into a high-fidelity screen!`);
        }
      }

      setIsAttachmentPortalOpen(false);
      setSelectedAttachmentFile(null);
      setExtractedContextText('');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- upload errors are thrown with free-form messages; err.message is read
    } catch (err: any) {
      console.error(err);
      showAlert("Upload Failed", err.message || "An error occurred during upload.");
    } finally {
      setIsUploadingAsset(false);
    }
  };

  const handleDeleteReferenceFile = async (filename: string) => {
    if (!project) return;

    showConfirm(
      "Remove Context File",
      `Are you sure you want to remove "${filename}" from the project knowledge base? The Co-pilot will no longer read its context.`,
      async () => {
        try {
          const currentRefs = project.referenceFiles || [];
          const updatedRefs = currentRefs.filter(r => r.filename !== filename);

          const res = await fetch(`/api/files/${project.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ referenceFiles: updatedRefs })
          });

          if (res.ok) {
            await fetchProject();
            showAlert("Knowledge Base Updated", `"${filename}" was successfully removed.`);
          }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- delete errors are thrown with free-form messages; err.message is read
        } catch (err: any) {
          showAlert("Delete Failed", err.message || "Failed to remove the document.");
        }
      },
      'destructive'
    );
  };

  const handleDeleteVisualAsset = async (filename: string) => {
    if (!project) return;

    showConfirm(
      "Delete Visual Asset",
      `Are you sure you want to permanently delete the visual asset "${filename.replace('assets/', '')}" from this version checkpoint?`,
      async () => {
        try {
          const latestVersion = project.versions[project.versions.length - 1];
          const nextFilesMap = { ...latestVersion.files };
          delete nextFilesMap[filename];

          await handleSaveModifiedCode(nextFilesMap, `Delete Visual Asset: ${filename.replace('assets/', '')}`);
          showAlert("Asset Deleted", `"${filename.replace('assets/', '')}" has been deleted.`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- delete errors are thrown with free-form messages; err.message is read
        } catch (err: any) {
          showAlert("Delete Failed", err.message || "Failed to delete the visual asset.");
        }
      },
      'destructive'
    );
  };

  const handleUpdateDesignSystem = async (
    updatedMode?: 'deck' | 'document' | 'spreadsheet' | 'dashboard' | 'infography',
    updatedTheme?: string,
    updatedTypography?: string,
    palette?: string,
    libs?: string[],
    shouldRegenerate: boolean = false
  ) => {
    if (!project) return;

    const nextPrefs = {
      theme: updatedTheme || selectedTheme,
      typography: updatedTypography || selectedTypography,
      palette: palette || selectedColorPalette,
      libraries: libs || selectedLibraries
    };

    try {
      const res = await fetch(`/api/files/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectMode: updatedMode || projectMode,
          designPreferences: nextPrefs
        })
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          // Keep the provider's design mirrors in sync (sendPrompt payloads
          // them); v1 set the project from the PUT response, the shell refetches.
          setDesignSystemPrefs({
            theme: nextPrefs.theme,
            typography: nextPrefs.typography,
            palette: nextPrefs.palette,
            libraries: [...nextPrefs.libraries],
            projectMode: updatedMode || projectMode,
          });
          await fetchProject();
          if (shouldRegenerate) {
            handleSendChatPrompt(undefined, `Please re-generate the current page (${activeFilename}) using the new design system settings: ${nextPrefs.theme} theme.`);
          }
        }
      }
    } catch (err) {
      console.error('Error updating design system:', err);
    }
  };

  // Pure-JS ZIP generator for Export
;

  // ── Gate: provider fetch lifecycle (v1 2717 — the provider fetches; the
  //    loading screen is rendered locally until `project` arrives).
  if (isLoading || !project) {
    if (status === 'error') {
      return (
        <div className="flex flex-1 items-center justify-center bg-bone">
          <div className="max-w-sm text-center">
            <p className=" text-xs font-bold tracking-tight text-[var(--app-accent)]">
              Could not load this folio
            </p>
            <p className="mt-2 text-sm text-ink-secondary">{error}</p>
            <button
              type="button"
              onClick={() => void fetchProject()}
              className="mt-4 border border-[#0F0F0D]/15 dark:border-[#F4F4F0]/15 px-3 py-1.5  text-sm font-bold tracking-tight text-ink transition-colors hover:border-[var(--app-accent)] hover:text-[var(--app-accent)]"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return <LoadingScreen fullScreen={false} />;
  }

  const activeVersionObj = project.versions.find((v) => v.versionId === activePreviewVersion);
  const activeFileList = activeVersionObj ? Object.keys(activeVersionObj.files) : [];
  const currentUser = { name: userName, email: userEmail };

  // Auto-description for visual edits: the commit message is optional — when
  // left blank the save diffs the edited buffer against the last saved file
  // and summarizes it ("Visual edit — Updated lines 118–122"). Deterministic:
  // both sides are full documents, so the line diff IS what changed. Only
  // computed while the bar is visible (pending edits) to keep renders cheap.
  const autoEditMessage =
    hasUnsavedVisualEdits && editorCode
      ? summarizeEdits(activeVersionObj?.files?.[activeFilename] ?? '', editorCode).message
      : 'Visual edit update';

  return (
    <div className={cn(
      "h-full max-h-full relative px-0 flex flex-col select-none overflow-hidden antialiased",
      "bg-[#F4F4F0] dark:bg-[#0F0F0D] text-[#0F0F0D] dark:text-[#F4F4F0] "
    )}>
      {/* Background ambient light halos with higher intensity color accents */}
      <div
        className={cn(
          "absolute top-[-300px] left-[calc(50%-400px)] w-[800px] md:w-[1000px] h-[700px] rounded-full bg-gradient-to-b from-[var(--app-accent)]/20 via-[var(--app-accent)]/10 to-transparent blur-3xl pointer-events-none animate-glow-pulse animate-float animate-duration-1000",
          "hidden"
        )}
        aria-hidden="true"
      />
      <div
        className={cn(
          "absolute bottom-[-50px] right-[-50px] w-[500px] h-[500px] rounded-full bg-gradient-to-tr from-[var(--app-accent)]/12 via-[var(--app-accent)]/6 to-transparent blur-3xl pointer-events-none",
          "hidden"
        )}
        aria-hidden="true"
      />



      {/* Workspace — full-width canvas, chat lives in the shell's Chat tab */}
      <div className="flex-1 flex overflow-hidden">

        {/* Folio Canvas — always full-width, content-first */}
        <main className={cn(
          "flex-1 flex flex-col min-h-0 relative z-10",
          "bg-[#F4F4F0] dark:bg-[#0F0F0D]"
        )}>

           {/* Canvas toolbar — hidden on mobile (FAB replaces it), visible on desktop */}
           <div className={cn(
             "hidden lg:flex h-11 px-4 items-center justify-between shrink-0 z-20",
             "bg-[#F4F4F0] dark:bg-[#0F0F0D] border-b border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10"
           )}>
              <div className={cn(
                "flex p-0.5 gap-0.5 overflow-x-auto no-scrollbar max-w-[calc(100vw-16rem)] lg:max-w-none",
                "bg-transparent rounded-lg"
              )}>
                  {/* Chat lives in the shell tab bar — no in-studio shortcut. */}
                  {[
                   { id: 'preview', label: 'Preview', icon: Eye },
                   { id: 'pins', label: `Pins${(project?.comments || []).filter((c: HTMLComment) => !c.resolved && (!c.type || c.type === 'pin')).length > 0 ? ` (${(project?.comments || []).filter((c: HTMLComment) => !c.resolved && (!c.type || c.type === 'pin')).length})` : ''}`, icon: MessageSquare },
                   { id: 'comments', label: `Discuss${(project?.comments || []).filter((c: HTMLComment) => !c.resolved && c.type === 'comment').length > 0 ? ` (${(project?.comments || []).filter((c: HTMLComment) => !c.resolved && c.type === 'comment').length})` : ''}`, icon: MessageCircle },
                   { id: 'history', label: 'History', icon: History },
                   { id: 'map', label: 'Map', icon: Network },
                   { id: 'analytics', label: 'Metrics', icon: BarChart3 },
                   { id: 'code', label: 'Code', icon: Code }
                 ].map((mode) => (
                    <button
                      key={mode.id}
                      onClick={() => setCanvasMode(mode.id as 'preview' | 'code' | 'pins' | 'comments' | 'history' | 'map' | 'analytics')}
                      title={mode.label}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium transition-colors shrink-0 cursor-pointer min-h-[36px] min-w-[36px]",
                        cn(
                          "rounded-lg ",
                          canvasMode === mode.id
                            ? 'bg-[var(--app-accent)] text-white rounded-lg shadow-sm'
                            : 'text-ink/60 hover:text-ink hover:bg-black/5 rounded-lg'
                        )
                      )}
                    >
                      <mode.icon size={10} />
                      <span className="hidden sm:inline">{mode.label}</span>
                    </button>
                 ))}
              </div>

               <div className="flex items-center gap-2">
                  {canvasMode === 'preview' && (
                     <div className={cn(
                       "flex p-0.5 mr-3",
                       "bg-transparent rounded-lg"
                     )}>
                        <button onClick={() => setViewportSize('desktop')} className={cn("p-1.5 transition-dub cursor-pointer", cn("rounded-lg", viewportSize === 'desktop' ? 'bg-[var(--app-accent)] text-[#F4F4F0]' : 'text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50 hover:text-[var(--app-accent)]'))} title="Desktop View"><Monitor size={11}/></button>
                        <button onClick={() => setViewportSize('tablet')} className={cn("p-1.5 transition-dub cursor-pointer", cn("rounded-lg", viewportSize === 'tablet' ? 'bg-[var(--app-accent)] text-[#F4F4F0]' : 'text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50 hover:text-[var(--app-accent)]'))} title="Tablet View"><Tablet size={11}/></button>
                        <button onClick={() => setViewportSize('mobile')} className={cn("p-1.5 transition-dub cursor-pointer", cn("rounded-lg", viewportSize === 'mobile' ? 'bg-[var(--app-accent)] text-[#F4F4F0]' : 'text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50 hover:text-[var(--app-accent)]'))} title="Mobile View"><Smartphone size={11}/></button>
                     </div>
                  )}
                  {canvasMode === 'preview' && (
                     <button
                       onClick={() => {
                         const el = document.getElementById('studio-sandbox-iframe');
                         if (el) {
                           if (document.fullscreenElement) {
                             document.exitFullscreen();
                           } else {
                             el.requestFullscreen().then(() => {
                               // Brief exit hint for mobile users
                               const toast = document.createElement('div');
                               toast.textContent = 'Press Esc to exit fullscreen';
                               toast.className = 'fixed bottom-24 left-1/2 -translate-x-1/2 bg-zinc-950/90 text-white text-sm font-bold px-4 py-2 rounded-full z-[200] animate-fade';
                               document.body.appendChild(toast);
                               setTimeout(() => { toast.remove(); }, 3000);
                             }).catch(() => {});
                           }
                         }
                       }}
                       className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-bold tracking-tight transition-dub cursor-pointer bg-zinc-100/60 dark:bg-zinc-900/60 text-zinc-500 dark:text-zinc-400 hover:text-[var(--app-accent)] dark:hover:text-[var(--app-accent)] border border-zinc-200/50 dark:border-zinc-800/50 shadow-sm"
                       title="Toggle Presentation Mode"
                     >
                       <Monitor size={11} />
                       <span className="hidden sm:inline">Present</span>
                     </button>
                  )}
                  {/* Zoom controls — desktop preview mode only */}
                  {canvasMode === 'preview' && viewportSize === 'desktop' && (
                     <div className="hidden sm:flex items-center gap-0.5 bg-zinc-100/60 dark:bg-zinc-900/60 border border-zinc-200/50 dark:border-zinc-800/50 rounded-lg p-0.5 shadow-inner">
                        {[0.5, 0.75, 1].map(zoom => (
                          <button
                            key={zoom}
                            onClick={() => setPreviewZoom(zoom)}
                            className={cn(
                              "px-1.5 py-1 rounded text-[8px] font-bold tracking-tight transition-dub cursor-pointer",
                              previewZoom === zoom
                                ? "bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-xs"
                                : "text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                            )}
                          >
                            {Math.round(zoom * 100)}%
                          </button>
                        ))}
                     </div>
                  )}
                  <div className="flex items-center gap-1.5 shrink-0">
                     <Button
                       variant="ghost"
                       size="sm"
                       className="h-8 border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 hover:bg-white dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-[var(--app-accent)] dark:hover:text-[var(--app-accent)] transition-dub rounded-lg cursor-pointer shadow-sm flex items-center gap-1.5 px-3"
                       onClick={() => setIsImportRepoOpen(true)}
                       title="Import Repo / Files"
                     >
                        <Upload size={12}/>
                     </Button>
                     <Button variant="ghost" size="icon" className="h-8 w-8 border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 hover:bg-white dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-50 transition-dub rounded-lg cursor-pointer shadow-sm" onClick={() => setIsCreateScreenOpen(true)}><Plus size={13}/></Button>
                     <Dropdown
                       value={activeFilename}
                       onChange={(v) => {
                          setActiveFilename(v);
                          setCanvasMode('preview');
                          const activeVer = project.versions.find((ver) => ver.versionId === activePreviewVersion) || project.versions[project.versions.length - 1];
                          if (activeVer && activeVer.files[v]) {
                             setEditorCode(activeVer.files[v]);
                          }
                       }}
                       options={activeFileList.map((f) => ({
                         value: f,
                         label: f.replace(/\.html$/, '').split('/').pop() || f,
                       }))}
                       ariaLabel="Select page file"
                       title="Select page file"
                       menuClassName="w-56 max-h-72 overflow-y-auto"
                       className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-zinc-50 tracking-tight bg-white/50 dark:bg-zinc-900/50 hover:bg-white dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 px-3 py-1 rounded-lg h-8 shadow-sm max-w-[140px] sm:max-w-[180px] md:max-w-[220px]"
                     />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 hover:bg-white dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-[var(--app-accent)] dark:hover:text-[var(--app-accent)] transition-colors rounded-lg cursor-pointer shadow-sm disabled:opacity-30 disabled:cursor-not-allowed"
                        disabled={activeFilename === 'index.html'}
                        onClick={() => {
                          setPageToRenameOldName(activeFilename);
                          const baseName = activeFilename.endsWith('.html') ? activeFilename.slice(0, -5) : activeFilename;
                          setPageToRenameNewName(baseName);
                          setIsRenamePageOpen(true);
                        }}
                        title="Rename Page File"
                      >
                        <Pencil size={11} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 hover:bg-white dark:hover:bg-rose-950/20 text-zinc-500 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors rounded-lg cursor-pointer shadow-sm disabled:opacity-30 disabled:cursor-not-allowed"
                        disabled={(() => {
                          const latestVer = project?.versions[project.versions.length - 1];
                          if (!latestVer) return true;
                          const htmlFiles = Object.keys(latestVer.files).filter(k => k.endsWith('.html'));
                          return activeFilename.endsWith('.html') && htmlFiles.length <= 1;
                        })()}
                        onClick={() => {
                          setPageToDeleteName(activeFilename);
                          setIsDeletePageConfirmOpen(true);
                          // Pre-select replacement when deleting the active file
                          const latestVer = project?.versions[project.versions.length - 1];
                          if (latestVer) {
                            const other = Object.keys(latestVer.files).filter(k => k.endsWith('.html') && k !== activeFilename);
                            if (other.length > 0) setDeleteReplacementFile(other[0]);
                          }
                        }}
                        title={(() => {
                          const latestVer = project?.versions[project.versions.length - 1];
                          if (!latestVer) return 'Delete Page File';
                          const htmlFiles = Object.keys(latestVer.files).filter(k => k.endsWith('.html'));
                          return activeFilename.endsWith('.html') && htmlFiles.length <= 1
                            ? 'Cannot delete the last HTML page'
                            : 'Delete Page File';
                        })()}
                      >
                        <Trash2 size={11} />
                      </Button>
                  </div>
               </div>
           </div>

            <div className={cn(
               "flex-1 flex flex-col items-center overflow-hidden bg-gradient-to-b from-zinc-100 via-zinc-200/40 to-zinc-200 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-900 bg-dot-pattern relative w-full h-full border-t border-zinc-200/40 dark:border-zinc-800/40 shadow-inner pb-20 lg:pb-0",
               canvasMode === 'preview' && viewportSize === 'desktop' ? "p-0" : "p-6"
            )}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const file = e.dataTransfer.files?.[0];
                if (!file) return;
                if (file.name.endsWith('.html') || file.name.endsWith('.htm')) {
                  // Trigger direct HTML upload
                  const input = document.getElementById('direct-html-upload') as HTMLInputElement;
                  if (input) {
                    const dt = new DataTransfer();
                    dt.items.add(file);
                    input.files = dt.files;
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                  }
                } else if (file.name.endsWith('.zip')) {
                  const input = document.getElementById('direct-zip-import') as HTMLInputElement;
                  if (input) {
                    const dt = new DataTransfer();
                    dt.items.add(file);
                    input.files = dt.files;
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                  }
                } else {
                  // For other files, open the attachment portal
                  setIsAttachmentPortalOpen(true);
                }
              }}
            >
               {/* Glowing Background Radial Halos for Canvas Artboard */}
               <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-tr from-[var(--app-accent)]/10 via-[var(--app-accent)]/10 to-transparent rounded-full blur-3xl pointer-events-none animate-glow-pulse" />

               {canvasMode === 'preview' && (
                  <div
                    className={cn(
                      "flex flex-col relative h-full w-full overflow-hidden transition-all duration-500",
                      viewportSize !== 'desktop'
                        ? "bg-white/50 dark:bg-zinc-900/40 backdrop-blur-md border border-zinc-200/60 dark:border-zinc-800/50 p-2.5 rounded-lg shadow-[0_45px_100px_-20px_rgba(0,0,0,0.18),0_15px_30px_-10px_rgba(0,0,0,0.1),0_0_80px_rgba(255,59,0,0.05)] dark:shadow-[0_45px_100px_-20px_rgba(0,0,0,0.6),0_15px_30px_-10px_rgba(0,0,0,0.4),0_0_80px_rgba(255,59,0,0.15)] hover:shadow-[0_50px_110px_-15px_rgba(255,59,0,0.1),0_45px_100px_-20px_rgba(0,0,0,0.22)] dark:hover:shadow-[0_50px_110px_-15px_rgba(255,59,0,0.25),0_45px_100px_-20px_rgba(0,0,0,0.72)]"
                        : "p-0 rounded-lg border-none shadow-none",
                      activeProposal && "ring-4 ring-[var(--app-accent)]/20 dark:ring-[var(--app-accent)]/40 border-[var(--app-accent)] dark:border-[var(--app-accent)]"
                    )}
                    style={{ width: viewportSize === 'desktop' ? '100%' : viewportSize === 'tablet' ? '768px' : '380px', maxWidth: '100%' }}
                  >
                     <div className={cn(
                        "flex-1 overflow-hidden h-full w-full relative z-10",
                        viewportSize !== 'desktop'
                          ? "bg-white dark:bg-zinc-950 border border-zinc-100/60 dark:border-zinc-900/60 rounded-lg shadow-inner"
                          : "bg-white dark:bg-zinc-950 border-0 rounded-lg shadow-none"
                     )}>
                        {/* Iframe loading skeleton */}
                        {isIframeLoading && !isAiResponding && (
                           <div className="absolute inset-0 z-20 flex items-center justify-center bg-zinc-50/80 dark:bg-zinc-950/80 backdrop-blur-sm animate-fade">
                             <div className="flex flex-col items-center gap-3">
                               <span className="inline-block w-8 h-8 bg-[var(--app-accent)]" style={{ animation: 'lf-square-pulse 1.1s steps(2, start) infinite' }} />
                               <span className="text-sm font-bold text-zinc-400 tracking-tight">{saveNotice ?? 'Loading Preview'}</span>
                             </div>
                           </div>
                        )}

                        {/* Saved confirmation — lingers after the preview loads */}
                        {saveNotice === 'Saved ✓' && !isIframeLoading && (
                          <div className="absolute bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-zinc-950/90 px-4 py-2 text-xs font-bold text-white shadow-lg animate-in fade-in">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                            Saved ✓
                          </div>
                        )}

                        <div
                          className="w-full h-full overflow-auto"
                          style={{
                            transform: viewportSize === 'desktop' ? `scale(${previewZoom})` : 'none',
                            transformOrigin: 'top left',
                            width: viewportSize === 'desktop' ? `${100 / previewZoom}%` : '100%',
                            height: viewportSize === 'desktop' ? `${100 / previewZoom}%` : '100%',
                          }}
                        >
                          <iframe
                            id="studio-sandbox-iframe"
                            src={activeProposal ? undefined : `/api/raw/${project.id}/${activeFilename}?v=${activePreviewVersion}`}
                            srcDoc={activeProposal?.files[activeFilename]}
                            className="w-full h-full border-none"
                            onLoad={() => { setSyncTrigger(prev => prev + 1); setIsIframeLoading(false); }}
                          />
                        </div>

                        {/* High-fidelity Glassmorphic AI Overlay Loader */}
                        {isAiResponding && (
                           <div className="absolute inset-0 bg-white/60 dark:bg-zinc-950/70 backdrop-blur-md z-40 flex flex-col items-center justify-center animate-fade duration-300 overflow-hidden p-6 text-center select-none border-t border-zinc-100 dark:border-transparent">
                             <LoadingScreen fullScreen={false} />
                           </div>
                        )}
                     </div>

                     {/* Proposal Preview Overlay */}
                     {activeProposal && (
                       <div className="absolute top-0 left-0 w-full h-full bg-[var(--app-accent)]/5 pointer-events-none z-20" />
                     )}

                     {activeProposal && (
                       <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md border border-[var(--app-accent)]/40 dark:border-[var(--app-accent)]/40 rounded-lg shadow-2xl p-2.5 flex items-center gap-3 animate-slideDown z-50">
                          <div className="px-3 py-1 bg-[var(--app-accent)]/10 dark:bg-[var(--app-accent)]/10 border border-[var(--app-accent)]/30 dark:border-[var(--app-accent)]/30 rounded-lg flex items-center gap-2">
                             <Sparkles size={12} className="text-[var(--app-accent)] dark:text-[var(--app-accent)]" />
                             <span className="text-sm font-bold text-[var(--app-accent)] dark:text-[var(--app-accent)] uppercase">Reviewing Proposal</span>
                          </div>
                          <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-800 mx-1" />
                          <div className="flex items-center gap-2">
                             <Button onClick={() => { void handleApplyProposal(); }} size="sm" className="h-8 text-sm font-bold tracking-tight px-4 bg-[var(--app-accent)] hover:bg-[var(--app-accent)]/90 text-white rounded-lg border-none transition-dub">Apply Changes</Button>
                             <Button onClick={() => setActiveProposal(null)} variant="ghost" size="sm" className="h-8 text-sm font-bold tracking-tight px-3 text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-dub">Discard</Button>
                          </div>
                       </div>
                     )}

                     {/* Centered Pin Submission Modal */}
                     {tempPin && (
                        // fixed (not absolute-in-wrapper) so the composer
                        // stays centered & reachable above the keyboard, the
                        // dial and the commit bar; backdrop tap closes it.
                        // select-text undoes the shell's select-none, which
                        // blocks iOS caret/focus inside inputs.
                        <div
                          className="fixed inset-0 z-[95] flex items-center justify-center bg-[#0F0F0D]/50 dark:bg-[#0F0F0D]/70 animate-in fade-in duration-200"
                          onClick={() => setTempPin(null)}
                        >
                          <div
                            className="rounded-2xl select-text bg-white dark:bg-[#171714] shadow-xl ring-1 ring-black/5 dark:ring-white/10 p-6 w-80 max-h-[85vh] overflow-y-auto animate-in zoom-in-95 duration-200 text-left relative"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex justify-between items-center mb-4">
                               <span className="text-sm font-black tracking-tight  text-[#0F0F0D] dark:text-[#F4F4F0] flex items-center gap-1.5">
                                  <Pin size={12} strokeWidth={2.5} />
                                  Add Review Note
                               </span>
                               <button onClick={() => setTempPin(null)} aria-label="Close review note" className="rounded-lg text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:bg-[var(--app-accent)] hover:text-[#F4F4F0] transition-colors p-1 cursor-pointer"><X size={14}/></button>
                            </div>
                            <form onSubmit={handleSubmitTempComment} className="space-y-4">
                               <textarea
                                  // No autoFocus: it yanks the iOS keyboard
                                  // open the instant the modal mounts and can
                                  // fight the tap that just dropped the pin.
                                  required
                                  value={newCommentText}
                                  onChange={(e) => setNewCommentText(e.target.value)}
                                  placeholder="Describe the change or issue…"
                                  className="w-full text-xs font-semibold rounded-lg border border-[#0F0F0D] dark:border-[#F4F4F0] bg-[#F4F4F0] dark:bg-[#0F0F0D]  text-[#0F0F0D] dark:text-[#F4F4F0] p-3.5 resize-none h-24 transition-colors focus:border-[var(--app-accent)] focus:ring-2 focus:ring-[var(--app-accent)]/20 placeholder:text-[#0F0F0D]/40 dark:placeholder:text-[#F4F4F0]/40 focus:outline-none"
                               />
                               <div className="flex gap-2">
                                  <Button type="button" variant="outline" className="flex-1 text-xs font-bold tracking-tight h-9 rounded-lg border-[#0F0F0D] dark:border-[#F4F4F0] bg-transparent text-[#0F0F0D] dark:text-[#F4F4F0]  hover:bg-[var(--app-accent)] hover:text-[#F4F4F0]" onClick={() => setTempPin(null)}>Cancel</Button>
                                  <Button type="submit" disabled={isSavingPin} className="flex-1 text-xs font-extrabold tracking-tight h-9 rounded-lg border border-[#0F0F0D] dark:border-[#F4F4F0] bg-[var(--app-accent)] text-[#F4F4F0]  hover:bg-[#0F0F0D] dark:hover:bg-[#F4F4F0] dark:hover:text-[#0F0F0D]">{isSavingPin ? <><LoadingSpinner size="xs" className="mr-1" /> Saving…</> : 'Save Pin'}</Button>
                               </div>
                            </form>
                          </div>
                        </div>
                     )}

                     {/* Floating canvas tools — desktop only (≥lg): clean icons
                         + tooltips from the shared registry. They overlay the
                         folio itself, so they stay visible in every sidebar
                         state (open or collapsed). Right-middle, NOT top-right:
                         folio headers/hero content stay uncovered. */}
                     <div className="hidden lg:flex absolute right-3 top-1/2 -translate-y-1/2 flex-col gap-2 z-30">
                         {STUDIO_TOOLS.map((tool) => {
                           const isActive = activeToolId === tool.id;
                           const Icon = tool.icon;
                           return (
                             <button
                               key={tool.id}
                               type="button"
                               onClick={() => activateTool(isActive ? null : tool.id)}
                               title={tool.title}
                               aria-label={tool.title}
                               aria-pressed={isActive}
                               className={cn(
                                 "h-11 w-11 rounded-lg border shadow-md transition-dub cursor-pointer grid place-items-center",
                                 isActive
                                   ? 'bg-[var(--app-accent)] text-white border-[var(--app-accent)] shadow-[var(--app-accent)]/25'
                                   : 'bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md border-zinc-200/60 dark:border-zinc-800/60 text-zinc-600 dark:text-zinc-400 hover:bg-white dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-50'
                               )}
                             >
                               <Icon size={17} strokeWidth={2} />
                             </button>
                           );
                         })}
                     </div>

                     {/* Active-tool hint — tells the user what to click next;
                         hidden whenever the commit bar / proposal pill / dial
                         would collide with it. */}
                     {activeToolDef && !hasUnsavedVisualEdits && !activeProposal && !isDialOpen && !isMoreOpen && (
                       <div className="absolute bottom-24 lg:bottom-8 left-1/2 z-[65] -translate-x-1/2 animate-slideUp flex items-center gap-2 rounded-full bg-zinc-950/90 dark:bg-zinc-800/90 backdrop-blur-md px-4 py-2 text-xs font-semibold text-white shadow-lg">
                         {(() => {
                           const Icon = activeToolDef.icon;
                           return <Icon size={13} className="text-[var(--app-accent)]" strokeWidth={2.25} />;
                         })()}
                         <span>{activeToolDef.hint}</span>
                         <button
                           type="button"
                           aria-label={`Stop ${activeToolDef.label}`}
                           onClick={() => activateTool(null)}
                           className="ml-0.5 text-white/70 hover:text-white transition-colors cursor-pointer"
                         >
                           <X size={13} />
                         </button>
                       </div>
                     )}

                    {hasUnsavedVisualEdits && (
                       <div className="absolute bottom-24 left-1/2 z-[70] w-[calc(100%-2.5rem)] max-w-[540px] -translate-x-1/2 animate-slideUp rounded-2xl bg-white/95 px-4 py-3 shadow-2xl ring-1 ring-black/5 backdrop-blur-md dark:bg-zinc-900/95 dark:ring-white/10 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4 lg:bottom-8 lg:px-6 lg:py-3.5">
                          <div className="flex items-center gap-2">
                             <div className="w-1.5 h-1.5 bg-[var(--app-accent)] animate-pulse" />
                             <span className="text-sm font-bold text-zinc-500 dark:text-zinc-400 tracking-tight">Unsaved Visual Edits</span>
                          </div>

                          <div className="hidden h-6 w-px bg-zinc-100 dark:bg-zinc-800 sm:block" />

                          <form
                            onSubmit={async (e) => {
                              e.preventDefault();
                              const typed = visualEditMsg.trim();
                              const message = typed || autoEditMessage;
                              await handleSaveModifiedCode({ ...activeVersionObj!.files, [activeFilename]: editorCode }, message);
                              setVisualEditMsg('');
                              setHasUnsavedVisualEdits(false);
                            }}
                            className="flex-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4"
                          >
                             <div className="flex-1 flex flex-col gap-1 min-w-0">
                                <input
                                  value={visualEditMsg}
                                  onChange={(e) => setVisualEditMsg(e.target.value)}
                                  placeholder="Describe your changes (optional)"
                                  aria-label="Commit message — optional"
                                  className="w-full select-text text-[11px] font-medium bg-zinc-50/50 dark:bg-zinc-950/50 border border-zinc-200/60 dark:border-zinc-800/60 rounded-lg px-3 py-1.5 focus:outline-none focus:border-[var(--app-accent)]/40 focus:ring-4 focus:ring-[var(--app-accent)]/5 placeholder:text-zinc-300 dark:placeholder:text-zinc-600 text-zinc-700 dark:text-zinc-100 transition-all"
                                />
                                {!visualEditMsg.trim() && (
                                  <span className="truncate text-[10px] font-medium text-zinc-400 dark:text-zinc-500" title={autoEditMessage}>
                                    Will save as: “{autoEditMessage}”
                                  </span>
                                )}
                             </div>
                             <div className="flex items-center gap-3">
                                <Button type="submit" size="sm" className="h-8 rounded-lg text-sm font-bold tracking-tight px-6 shadow-md bg-zinc-950 dark:bg-zinc-50 hover:bg-zinc-900 dark:hover:bg-zinc-200 text-white dark:text-zinc-950 border-none transition-all">Save</Button>
                                <button
                                  type="button"
                                  className="text-xs font-bold tracking-tight text-zinc-400 dark:text-zinc-500 hover:text-rose-600 dark:hover:text-rose-400 transition-colors px-2 cursor-pointer"
                                  onClick={() => {
                                    showConfirm(
                                      "Discard Changes",
                                      "Are you sure you want to discard all unsaved visual edits? This action cannot be undone.",
                                      () => {
                                        setVisualEditMsg('');
                                        setHasUnsavedVisualEdits(false);
                                        fetchProject();
                                      },
                                      'destructive'
                                    );
                                  }}
                                >
                                  Discard
                                </button>
                             </div>
                          </form>
                       </div>
                     )}
                 </div>
              )}

              {canvasMode === 'code' && (
                 <CodeView
                   editorCode={editorCode}
                   setEditorCode={setEditorCode}
                   editorCommitMessage={editorCommitMessage}
                   setEditorCommitMessage={setEditorCommitMessage}
                   onCommit={handleCommitManualEdit}
                   isCommitting={isCommitting}
                 />
              )}

               {canvasMode === 'pins' && (
                  <PinsView
                    comments={project.comments || []}
                    onDeleteComment={handleDeleteComment}
                    onToggleResolve={handleToggleResolveComment}
                    onSendToAI={(prompt) => handleSendChatPrompt(undefined, prompt)}
                    onNavigate={(comment) => {
                      if (comment.filename) setActiveFilename(comment.filename);
                      setCanvasMode('preview');
                      setSyncTrigger(prev => prev + 1);
                    }}
                  />
               )}

               {canvasMode === 'comments' && (
                  <CommentsView
                    comments={project.comments || []}
                    onDeleteComment={handleDeleteComment}
                    onToggleResolve={handleToggleResolveComment}
                    onSendToAI={(prompt) => handleSendChatPrompt(undefined, prompt)}
                  />
               )}

              {canvasMode === 'history' && (
                 <HistoryView
                   versions={project.versions}
                   onRestore={handleRestoreVersion}
                 />
              )}

              {canvasMode === 'map' && (
                 <MapView
                   activeVersionFiles={activeVersionObj?.files}
                   activeFilename={activeFilename}
                   activeFileList={activeFileList}
                   onSelectFile={setActiveFilename}
                   onRenamePage={(oldName) => {
                     setPageToRenameOldName(oldName);
                     const baseName = oldName.endsWith('.html') ? oldName.slice(0, -5) : oldName;
                     setPageToRenameNewName(baseName);
                     setIsRenamePageOpen(true);
                   }}
                   onDeletePage={(filename) => {
                     setPageToDeleteName(filename);
                     setIsDeletePageConfirmOpen(true);
                     // Pre-select replacement when deleting the active file
                     const latestVer = project?.versions[project.versions.length - 1];
                     if (latestVer) {
                       const other = Object.keys(latestVer.files).filter(k => k.endsWith('.html') && k !== filename);
                       if (other.length > 0) setDeleteReplacementFile(other[0]);
                     }
                   }}
                   onNewScreen={() => setIsCreateScreenOpen(true)}
                 />
              )}


              {canvasMode === 'analytics' && (
                 <AnalyticsView project={project} />
              )}

            </div>

        </main>
      </div>

      <DesignDrawer
        isOpen={isDesignDrawerOpen}
        onClose={() => setIsDesignDrawerOpen(false)}
        availableDesignSystems={availableDesignSystems}
        selectedTheme={selectedTheme}
        selectedTypography={selectedTypography}
        selectedColorPalette={selectedColorPalette}
        projectMode={projectMode}
        onSelectTheme={(themeName) => { setSelectedTheme(themeName); handleUpdateDesignSystem(undefined, themeName); }}
        onSelectTypography={(typographyName) => { setSelectedTypography(typographyName); handleUpdateDesignSystem(undefined, undefined, typographyName); }}
        onSelectPalette={(paletteName) => { setSelectedColorPalette(paletteName); handleUpdateDesignSystem(undefined, undefined, undefined, paletteName); }}
        selectedLibraries={selectedLibraries}
        onSelectMode={(mode) => { setProjectMode(mode); handleUpdateDesignSystem(mode); }}
        onSelectLibraries={(libs) => { setSelectedLibraries(libs); handleUpdateDesignSystem(undefined, undefined, undefined, undefined, libs); }}
        onRegenerate={() => { handleUpdateDesignSystem(undefined, undefined, undefined, undefined, undefined, true); setIsDesignDrawerOpen(false); }}
      />

      <CreateScreenModal
        isOpen={isCreateScreenOpen}
        newFileNameInput={newFileNameInput}
        setNewFileNameInput={setNewFileNameInput}
        onClose={() => setIsCreateScreenOpen(false)}
        onSubmit={handleAddNewPageFile}
        isCreatingPage={isCreatingPage}
      />

      {/* Hidden File Input for Direct HTML Upload */}
      <input
        type="file"
        id="direct-html-upload"
        className="hidden"
        accept=".html"
        onChange={handleDirectHtmlUpload}
      />

      {/* Hidden File Input for Folder Import */}
      <input
        type="file"
        id="direct-folder-import"
        className="hidden"
        {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
        multiple
        onChange={handleFolderImport}
      />

      {/* Hidden File Input for ZIP Import */}
      <input
        type="file"
        id="direct-zip-import"
        className="hidden"
        accept=".zip"
        onChange={handleZipImport}
      />

      {/* Hidden File Input for Attachments */}
      <input
        type="file"
        id="folio-attachment-input"
        className="hidden"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.html,.css,.js,.json,.csv"
        onChange={handleAttachmentFileChange}
      />

      <ImportRepoModal
        isOpen={isImportRepoOpen}
        isImporting={isImporting}
        importPhase={importPhase}
        importCount={liveImportCount}
        onClose={() => setIsImportRepoOpen(false)}
        onImportSingle={() => document.getElementById('direct-html-upload')?.click()}
        onImportFolder={() => document.getElementById('direct-folder-import')?.click()}
        onImportZip={() => document.getElementById('direct-zip-import')?.click()}
      />

      <AttachmentPortal
        isOpen={isAttachmentPortalOpen}
        project={project}
        selectedAttachmentFile={selectedAttachmentFile}
        extractedContextText={extractedContextText}
        isExtractingText={isExtractingText}
        isUploadingAsset={isUploadingAsset}
        attachmentIntent={attachmentIntent}
        onClose={() => {
          setIsAttachmentPortalOpen(false);
          setSelectedAttachmentFile(null);
          setExtractedContextText('');
        }}
        onFileSelect={() => document.getElementById('folio-attachment-input')?.click()}
        onRemoveFile={() => {
          setSelectedAttachmentFile(null);
          setExtractedContextText('');
        }}
        onSetIntent={(intent) => setAttachmentIntent(intent)}
        onCommit={handleCommitAttachment}
        onDeleteReference={handleDeleteReferenceFile}
        onDeleteVisualAsset={handleDeleteVisualAsset}
      />

      {/* Radial tools dial — mobile (<lg) replacement for the old FAB. The fan
          holds the three canvas tools from the shared registry (slots in fan
          order: Edit · More · Comment · Fix with AI); the More wedge reopens
          the legacy popover (Screens / View / Actions) — the tool rows are
          gone from it because the fan already exposes them. */}
      <RadialDial
        items={dialItems}
        fanOpen={isDialOpen}
        moreOpen={isMoreOpen}
        activeWedgeId={activeToolId}
        onTrigger={handleDialTrigger}
        onSelect={handleDialWedge}
        onCloseAll={closeDialAll}
        triggerAriaLabel="Studio tools"
        className="lg:hidden"
        panel={
          <StudioMoreSheet
            activeFileList={activeFileList}
            activeFilename={activeFilename}
            canvasMode={canvasMode}
            activeTool={activeToolDef}
            onSelectFile={(f) => {
              setActiveFilename(f);
              setCanvasMode('preview');
              closeDialAll();
            }}
            onSelectMode={(m) => {
              setCanvasMode(m);
              closeDialAll();
            }}
            onStopTool={() => {
              activateTool(null);
              closeDialAll();
            }}
            onImport={() => {
              setIsImportRepoOpen(true);
              closeDialAll();
            }}
            onNewScreen={() => {
              setIsCreateScreenOpen(true);
              closeDialAll();
            }}
          />
        }
      />

      <AlertDialog
        isOpen={alertDialog.isOpen}
        title={alertDialog.title}
        description={alertDialog.description}
        actionLabel={alertDialog.actionLabel}
        onAction={alertDialog.onAction || (() => {})}
        onCancel={() => setAlertDialog({ ...alertDialog, isOpen: false })}
        variant={alertDialog.variant}
      />

      <Dialog
        isOpen={isRenameFolioOpen}
        onClose={() => {
          setIsRenameFolioOpen(false);
        }}
        title="Rename Folio"
        description="Update the title and description for your folio. This changes how it appears on your dashboard and headers."
      >
        <form onSubmit={handleRenameFolio} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="rename-folio-title" className="text-sm font-bold text-zinc-400 dark:text-zinc-500 tracking-tight block">Title</label>
            <Input
              id="rename-folio-title"
              value={renameFolioTitle}
              onChange={(e) => setRenameFolioTitle(e.target.value)}
              placeholder="e.g., Q3 Marketing deck"
              className="w-full text-xs font-bold text-zinc-800 dark:text-zinc-200 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/50 dark:border-zinc-800/40 rounded-lg"
              required
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="rename-folio-desc" className="text-sm font-bold text-zinc-400 dark:text-zinc-500 tracking-tight block">Description</label>
            <Input
              id="rename-folio-desc"
              value={renameFolioDesc}
              onChange={(e) => setRenameFolioDesc(e.target.value)}
              placeholder="e.g., Presentation deck for partners"
              className="w-full text-xs font-bold text-zinc-800 dark:text-zinc-200 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/50 dark:border-zinc-800/40 rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800/50 -mx-6 -mb-6 px-6 py-4 bg-zinc-50/50 dark:bg-zinc-950/50 rounded-b-none">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsRenameFolioOpen(false);
              }}
              className="text-sm font-bold tracking-tight text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="default"
              size="sm"
              disabled={isSavingRenameFolio}
              className="text-sm font-bold tracking-tight px-6"
            >
              {isSavingRenameFolio ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </Dialog>

      <AlertDialog
        isOpen={isDeleteFolioConfirmOpen}
        title="Delete Folio"
        description={`Are you sure you want to delete "${project?.title || 'this folio'}"? This action is absolute, cannot be undone, and will permanently delete all of its pages and version history.`}
        cancelLabel="Cancel"
        actionLabel={isDeletingFolio ? "Deleting..." : "Delete Permanently"}
        onCancel={() => {
          setIsDeleteFolioConfirmOpen(false);
        }}
        onAction={handleDeleteFolio}
        variant="destructive"
      />

      <Dialog
        isOpen={isRenamePageOpen}
        onClose={() => {
          setIsRenamePageOpen(false);
        }}
        title="Rename Page"
        description={`Rename "${pageToRenameOldName}".`}
      >
        <form onSubmit={(e) => {
          e.preventDefault();
          handleRenamePageFile(pageToRenameOldName, pageToRenameNewName);
        }} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="rename-page-name" className="text-sm font-bold text-zinc-400 dark:text-zinc-500 tracking-tight block">Page Name</label>
            <div className="relative flex items-center">
              <Input
                id="rename-page-name"
                value={pageToRenameNewName}
                onChange={(e) => setPageToRenameNewName(e.target.value)}
                placeholder="e.g., pricing"
                className="w-full text-xs font-bold text-zinc-800 dark:text-zinc-200 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/50 dark:border-zinc-800/40 rounded-lg pr-14"
                required
              />
              <span className="absolute right-3.5 text-xs font-bold text-zinc-400 dark:text-zinc-500 pointer-events-none select-none">
                .html
              </span>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800/50 -mx-6 -mb-6 px-6 py-4 bg-zinc-50/50 dark:bg-zinc-950/50 rounded-b-none">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsRenamePageOpen(false);
              }}
              className="text-sm font-bold tracking-tight text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="default"
              size="sm"
              disabled={isSavingPageRename}
              className="text-sm font-bold tracking-tight px-6"
            >
              {isSavingPageRename ? 'Renaming...' : 'Rename Page'}
            </Button>
          </div>
        </form>
      </Dialog>

      {isDeletePageConfirmOpen && activeFilename === pageToDeleteName ? (
        /* Deleting the active file — ask which file becomes the new default */
        <Dialog
          isOpen={isDeletePageConfirmOpen}
          onClose={() => {
            setIsDeletePageConfirmOpen(false);
            setPageToDeleteName('');
            setDeleteReplacementFile('');
          }}
          title="Delete Active Page"
          description={`"${pageToDeleteName}" is currently open. Choose which page to switch to after deletion:`}
        >
          <div className="space-y-3">
            {(() => {
              const latestVer = project?.versions[project.versions.length - 1];
              const htmlFiles = latestVer ? Object.keys(latestVer.files).filter(k => k.endsWith('.html') && k !== pageToDeleteName) : [];
              return htmlFiles.length > 0 ? (
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {htmlFiles.map(f => (
                    <label key={f} className={cn(
                      "flex items-center gap-3 px-3 py-2.5 border cursor-pointer transition-colors",
                      deleteReplacementFile === f
                        ? "border-[var(--app-accent)] bg-[var(--app-accent)]/10"
                        : "border-[#0F0F0D]/20 hover:border-[#0F0F0D]/50"
                    )}>
                      <input
                        type="radio"
                        name="replacement-file"
                        value={f}
                        checked={deleteReplacementFile === f}
                        onChange={() => setDeleteReplacementFile(f)}
                        className="accent-[var(--app-accent)]"
                      />
                      <span className="text-xs  text-[#0F0F0D] dark:text-[#F4F4F0]">{f}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[#0F0F0D]/50">No other HTML files available.</p>
              );
            })()}
            <div className="flex justify-end gap-2 pt-3 border-t border-[#0F0F0D]/10">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setIsDeletePageConfirmOpen(false);
                  setPageToDeleteName('');
                  setDeleteReplacementFile('');
                }}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                disabled={!deleteReplacementFile || isDeletingPage}
                onClick={handleDeletePageFileWithReplacement}
              >
                {isDeletingPage ? 'Deleting...' : `Delete & switch to ${deleteReplacementFile}`}
              </Button>
            </div>
          </div>
        </Dialog>
      ) : (
        /* Deleting a non-active file — simple confirm */
        <AlertDialog
          isOpen={isDeletePageConfirmOpen}
          title="Delete Page File"
          description={`Are you sure you want to delete the page "${pageToDeleteName}"? This action cannot be undone.`}
          cancelLabel="Cancel"
          actionLabel={isDeletingPage ? "Deleting..." : "Delete Page"}
          onCancel={() => {
            setIsDeletePageConfirmOpen(false);
            setPageToDeleteName('');
          }}
          onAction={() => handleDeletePageFile(pageToDeleteName)}
          variant="destructive"
        />
      )}
    </div>
  );
}

/**
 * StudioMoreSheet — the More-wedge popover content (the legacy FAB panel minus
 * the three canvas-tool rows, which the dial fan now owns). Pure presentational:
 * StudioView wires all folio state through the callbacks.
 */
function StudioMoreSheet({
  activeFileList,
  activeFilename,
  canvasMode,
  activeTool,
  onSelectFile,
  onSelectMode,
  onStopTool,
  onImport,
  onNewScreen,
}: {
  activeFileList: string[];
  activeFilename: string;
  canvasMode: 'preview' | 'code' | 'pins' | 'comments' | 'history' | 'map' | 'analytics';
  activeTool: StudioToolDef | null;
  onSelectFile: (filename: string) => void;
  onSelectMode: (mode: 'preview' | 'code' | 'pins' | 'comments' | 'history' | 'map' | 'analytics') => void;
  onStopTool: () => void;
  onImport: () => void;
  onNewScreen: () => void;
}) {
  const viewRows = [
    { id: 'preview', label: 'Preview', icon: Eye },
    { id: 'code', label: 'Code', icon: Code },
    { id: 'pins', label: 'Pins', icon: MessageSquare },
    { id: 'comments', label: 'Discuss', icon: MessageCircle },
    { id: 'history', label: 'History', icon: History },
    { id: 'map', label: 'Map', icon: Network },
    { id: 'analytics', label: 'Metrics', icon: BarChart3 },
  ] as const;

  const rowClass = (active: boolean) =>
    cn(
      'w-full flex items-center gap-2.5 px-3 py-1.5 text-[11px] font-semibold transition-all cursor-pointer min-h-[40px]',
      cn(
        'rounded-lg ',
        active
          ? 'bg-[var(--app-accent)] text-[#F4F4F0]'
          : 'text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70 hover:bg-[var(--app-accent)]/10 hover:text-[var(--app-accent)]'
      )
    );
  const dot = <span className={cn('ml-auto w-1.5 h-1.5 rounded-full shrink-0', 'bg-[#F4F4F0]')} />;

  return (
    <div className="flex flex-col">
      {/* Screens — every page in the folio */}
      {activeFileList.length > 0 && (
        <>
          <div className="px-3 pt-3 pb-1">
            <span className={cn('text-xs font-extrabold tracking-tight px-1', ' text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60')}>Screens</span>
          </div>
          <div className="px-2 pb-1 max-h-32 overflow-y-auto">
            {activeFileList.map((filename: string) => (
              <button key={filename} type="button" onClick={() => onSelectFile(filename)} className={rowClass(activeFilename === filename)}>
                <FileText size={13} className="shrink-0 opacity-60" />
                <span className="truncate">{filename.replace('.html', '')}</span>
                {activeFilename === filename && dot}
              </button>
            ))}
          </div>
          <div className={cn('mx-3 h-px', 'bg-[#0F0F0D] dark:bg-[#F4F4F0]')} />
        </>
      )}

      {/* Views — canvas mode tabs */}
      <div className="px-3 pt-2 pb-1">
        <span className={cn('text-xs font-extrabold tracking-tight px-1', ' text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60')}>View</span>
      </div>
      <div className="px-2 pb-1">
        {viewRows.map((mode) => (
          <button key={mode.id} type="button" onClick={() => onSelectMode(mode.id)} className={rowClass(canvasMode === mode.id)}>
            <mode.icon size={13} className="shrink-0" />
            <span>{mode.label}</span>
            {canvasMode === mode.id && dot}
          </button>
        ))}
      </div>

      <div className={cn('mx-3 h-px', 'bg-[#0F0F0D] dark:bg-[#F4F4F0]')} />

      {/* Actions */}
      <div className="px-3 pt-2 pb-1">
        <span className={cn('text-xs font-extrabold tracking-tight px-1', ' text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60')}>Actions</span>
      </div>
      <div className="px-2 pb-2">
        {activeTool && (
          <button type="button" onClick={onStopTool} className={rowClass(true)}>
            <activeTool.icon size={13} className="shrink-0" />
            <span>Stop {activeTool.label}</span>
            {dot}
          </button>
        )}
        <button type="button" onClick={onImport} className={rowClass(false)}>
          <Upload size={13} className="shrink-0" />
          <span>Import</span>
        </button>
        <button type="button" onClick={onNewScreen} className={rowClass(false)}>
          <Plus size={13} className="shrink-0" />
          <span>New Screen</span>
        </button>
      </div>
    </div>
  );
}
