'use client';

/**
 * WorkspaceSidebar
 *
 * Fork of `components/dashboard/Sidebar.tsx` (read-only source) for the `/app`
 * shell.
 *
 * KEPT from the original, semantics unchanged: accordion workspace groups,
 * folio list with draft badge, drag-and-drop move between workspaces, inline
 * new-workspace form, floating ⋯ menus, and the shared `MoveToProjectDialog` /
 * `ProjectSettingsDialog` imports (import-as-is — their internal "project"
 * copy is out of scope).
 *
 * ADDED for the shell:
 * - UI copy projects → workspaces (API fields untouched — still `/api/projects`).
 * - Folio navigation targets the NEW shell route `/app/{id}` (not /studio).
 * - Self-contained data: fetches `/api/files`, `/api/projects`, `/api/profile`
 *   itself (same endpoints as `app/dashboard/page.tsx`'s fetch pattern; the
 *   shell's pages are data-free placeholders).
 * - Search filter over folio titles (+ descriptions when present).
 * - View options: group by workspace | flat; order manual | recently updated
 *   (persisted to `LiveFolio_app_sidebar_view`; default: workspace + recent).
 * - Explicit **+ New folio** (opens `CreateFolioModal`, imported as-is per the
 *   import map) and **+ New workspace** (inline form) buttons.
 * - Foot: profile link + settings gear that calls the `onOpenSettings` prop
 *   ONLY — the settings popup may not exist yet.
 *
 * Renders inside the AppShellFrame sidebar slot and honors the
 * `{ collapsed, width }` contract: collapsed renders the 56px icon rail
 * (`SIDEBAR_COLLAPSED`), expanded renders the full list. The collapse toggle
 * is driven by the shell's layout store (the v1 sidebar had no toggle of its
 * own; the shell owns chrome state).
 */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { isOSS, isCloud } from '@/lib/env';
import {
  FolderKanban,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Trash2,
  Globe,
  Lock,
  User,
  Settings,
  Loader2,
  ArrowUpRight,
  FolderInput,
  Search,
  X,
  Check,
  SlidersHorizontal,
  FilePlus2,
  FolderPlus,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Archive,
  ArchiveRestore,
  Home,
  Inbox,
  Compass,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { useInboxUnread } from '@/hooks/use-inbox-unread';
import { splitWorkspacesByOwnership } from '@/lib/app-shell/workspace-ownership';
import MoveToProjectDialog from '@/components/dashboard/MoveToProjectDialog';
import ProjectSettingsDialog from '@/components/dashboard/ProjectSettingsDialog';
import ThemeToggle from '@/components/ui/theme-toggle';

// Lazy: the modal (incl. its zip-unpacking code) loads only when first
// opened — keeps the sidebar bundle light.
const CreateFolioModal = dynamic(
  () => import('@/components/dashboard/CreateFolioModal'),
  { ssr: false },
);
import { useLayoutStore } from '@/lib/app-shell/layout-store';
import type { SidebarSlotProps } from '@/components/app-shell/AppShellFrame';
import type { PaidAccessConfig } from '@/lib/gating/types';
import { PaidIndicator } from '@/components/gating/PaidIndicator';
import { ListedIndicator } from '@/components/listing/ListedIndicator';
import type { ListingMetadata } from '@/lib/listing/types';
import { FONT_DISPLAY } from '@/lib/fonts';

interface FolioData {
  id: string;
  title: string;
  description?: string;
  status?: string;
  projectId?: string | null;
  updatedAt?: string;
  isPrivate?: boolean;
  slug?: string | null;
  /** Explicit paid gate on this folio (the /api/files records carry it). */
  paidAccess?: PaidAccessConfig | null;
  /** Marketplace listing metadata (the /api/files records carry it). */
  listing?: ListingMetadata | null;
  /** Set while the folio is archived — moves the row into the Archived group. */
  archivedAt?: string | null;
}

interface WorkspaceData {
  id: string;
  name: string;
  slug?: string;
  description?: string | null;
  is_public?: boolean;
  folio_count?: number;
  /** Workspace gate default (paid_access JSONB). */
  paid_access?: PaidAccessConfig | null;
  /** Set while the workspace is archived — moves it into the Archived group. */
  archived_at?: string | null;
  /**
   * Owner of the workspace. GET /api/projects returns EVERY workspace in the
   * org, not just the caller's — so this is what separates "mine" from "shared
   * with me". There is no per-workspace membership table (membership is
   * org-level), so this comparison is the only ownership signal available.
   */
  created_by?: string | null;
}

/**
 * Where a floating row menu is pinned, in viewport coordinates.
 *
 * `fromBottom` records which edge `y` measures from, so a menu that has to
 * open upward can be anchored by its BOTTOM edge. That way it grows upward
 * from the row regardless of how tall it actually renders — the only guess
 * left is whether there is room below, and overestimating there just flips
 * the menu a little early.
 */
interface MenuAnchor {
  x: number;
  y: number;
  fromBottom: boolean;
}

/** Generous ceiling for the tallest row menu (4 items + separator + padding). */
const MENU_MAX_HEIGHT = 200;
const MENU_GAP = 4;

/**
 * Pin a row menu to its trigger, flipping it above the row when the row sits
 * too low in the viewport. Without this, a menu opened from the bottom of the
 * sidebar (the Archived section, or any folio near the fold) renders past the
 * bottom edge and is simply invisible — it is `position: fixed`, so nothing
 * scrolls it back into view.
 */
function anchorRowMenu(el: HTMLElement): MenuAnchor {
  const rect = el.getBoundingClientRect();
  const fitsBelow = rect.bottom + MENU_GAP + MENU_MAX_HEIGHT <= window.innerHeight;
  return {
    x: rect.right - 12,
    y: fitsBelow ? rect.bottom + MENU_GAP : window.innerHeight - rect.top + MENU_GAP,
    fromBottom: !fitsBelow,
  };
}

/** Spreads a MenuAnchor into inline styles for the fixed-positioned menu. */
function menuAnchorStyle(a: MenuAnchor): React.CSSProperties {
  return {
    left: a.x,
    ...(a.fromBottom ? { bottom: a.y } : { top: a.y }),
    transform: 'translateX(-100%)',
  };
}

export interface WorkspaceSidebarProps extends SidebarSlotProps {
  /** Settings popup trigger — call only; the popup may not exist yet. */
  onOpenSettings?: () => void;
  /** Mobile drawer close — when provided (drawer mount), the header toggle
   * becomes a close (X) instead of the desktop collapse button. */
  onCloseDrawer?: () => void;
}

type ViewGroup = 'workspace' | 'flat';
type ViewOrder = 'manual' | 'recent';

/** Persisted view preferences (shell chrome state naming). */
const VIEW_KEY = 'LiveFolio_app_sidebar_view';
const DEFAULT_VIEW: { group: ViewGroup; order: ViewOrder } = { group: 'workspace', order: 'recent' };

/** Escape hatch: overlays/dialogs mount on document.body so no ancestor
 * (overflow-hidden column, backdrop-filter, transforms) can clip them —
 * iOS Safari clips `position: fixed` + `backdrop-filter` to the nearest
 * overflow-hidden ancestor, which hid the create-folio modal on mobile. */
function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}

function readViewPref(): { group: ViewGroup; order: ViewOrder } {
  if (typeof window === 'undefined') return DEFAULT_VIEW;
  try {
    const raw = window.localStorage.getItem(VIEW_KEY);
    if (!raw) return DEFAULT_VIEW;
    const parsed = JSON.parse(raw) as Partial<Record<keyof typeof DEFAULT_VIEW, unknown>>;
    const group: ViewGroup = parsed.group === 'flat' ? 'flat' : 'workspace';
    const order: ViewOrder = parsed.order === 'manual' ? 'manual' : 'recent';
    return { group, order };
  } catch {
    return DEFAULT_VIEW;
  }
}

function writeViewPref(group: ViewGroup, order: ViewOrder): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VIEW_KEY, JSON.stringify({ group, order }));
  } catch {
    // storage unavailable — view options just don't persist.
  }
}

/* Logo = verbatim copy of the dashboard Navbar logo (components/Navbar.tsx):
 * 2.5px orange square inside a 4px box + FONT_DISPLAY wordmark, as a Link. */

export function WorkspaceSidebar({ collapsed, onOpenSettings, onCloseDrawer }: WorkspaceSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  // Phone (full-screen drawer): roomier titles, tighter rows.
  const phone = useLayoutStore((s) => s.phone);

  // ── Self-contained data (same fetches as the original: /api/files,
  //    /api/projects, /api/profile) ────────────────────────────────────
  const [folios, setFolios] = useState<FolioData[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [profileUsername, setProfileUsername] = useState<string | null>(null);
  const [profileAvatar, setProfileAvatar] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  /** The caller's own user id — the "mine vs shared with me" comparison key. */
  const [myUserId, setMyUserId] = useState<string | null>(null);
  // Unread feedback count for the Inbox badge. Polls quietly in the background
  // and renders nothing at zero.
  const { unreadCount } = useInboxUnread();
  // Bought folios/workspaces — the buyer's library in their own sidebar.
  const [purchases, setPurchases] = useState<
    { id: string; title: string | null; shareSlug: string | null; workspacePage: string | null }[]
  >([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      try {
        const [filesRes, projectsRes] = await Promise.all([
          fetch('/api/files', { cache: 'no-store' }),
          fetch('/api/projects', { cache: 'no-store' }),
        ]);
        if (cancelled) return;
        if (filesRes.ok) {
          const data = await filesRes.json();
          if (Array.isArray(data)) setFolios(data);
        }
        if (projectsRes.ok) {
          const data = await projectsRes.json();
          if (Array.isArray(data)) setWorkspaces(data);
        }
        // Buyer's library — cloud only (purchases require billing).
        if (isCloud) {
          const purchasesRes = await fetch('/api/billing/purchases', { cache: 'no-store' });
          if (purchasesRes.ok) {
            const data = await purchasesRes.json();
            if (Array.isArray(data.purchases)) {
              setPurchases(
                data.purchases.map((p: { id: string; title: string | null; shareSlug: string | null; workspacePage: string | null }) => ({
                  id: p.id,
                  title: p.title,
                  shareSlug: p.shareSlug,
                  workspacePage: p.workspacePage,
                }))
              );
            }
          }
        }
      } catch {
        // transient fetch failure — the sidebar renders with what it has.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    (async () => {
      try {
        const res = await fetch('/api/profile');
        if (res.ok) {
          const data = await res.json();
          if (data.profile?.username) setProfileUsername(data.profile.username);
          if (data.profile?.avatar_url) setProfileAvatar(data.profile.avatar_url);
          if (data.profile?.full_name) setProfileName(data.profile.full_name);
          if (data.profile?.id) setMyUserId(data.profile.id);
        }
      } catch {
        // profile link just doesn't render.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  // ── View options (search + group/order), persisted ──────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [viewGroup, setViewGroup] = useState<ViewGroup>('workspace');
  const [viewOrder, setViewOrder] = useState<ViewOrder>('recent');
  const [isViewOpen, setViewOpen] = useState(false);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const [viewMenuPosition, setViewMenuPosition] = useState<MenuAnchor | null>(null);

  // Hydration-safe pref restore: localStorage is read AFTER the first render
  // (initial render matches SSR exactly — same pattern as the shell's layout
  // store, which the frame also reconciles via effects).
  useEffect(() => {
    const pref = readViewPref();
    setViewGroup(pref.group);
    setViewOrder(pref.order);
  }, []);

  const setGroup = (g: ViewGroup) => {
    setViewGroup(g);
    writeViewPref(g, viewOrder);
  };
  const setOrder = (o: ViewOrder) => {
    setViewOrder(o);
    writeViewPref(viewGroup, o);
  };
  const viewIsCustom = viewGroup !== DEFAULT_VIEW.group || viewOrder !== DEFAULT_VIEW.order;
  // OSS has no workspaces (the projects API is Cloud-only) — always show the
  // flat list locally; keep the persisted pref untouched so Cloud keeps it.
  const activeGroup: ViewGroup = isOSS ? 'flat' : viewGroup;

  // ── Accordion + floating-menu state (as in the original) ─────────────
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(
    () => new Set(),
  );
  // Archived shelf starts closed — it is a deliberate destination, not a
  // place the eye should land on every session.
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<MenuAnchor | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Dialogs
  const [moveFolio, setMoveFolio] = useState<FolioData | null>(null);
  const [settingsWorkspace, setSettingsWorkspace] = useState<WorkspaceData | null>(null);
  const [isCreateOpen, setCreateOpen] = useState(false);

  // Drag-and-drop state
  const [dragFolioId, setDragFolioId] = useState<string | null>(null);
  const [dragOverWorkspaceId, setDragOverWorkspaceId] = useState<string | null>(null);

  // Inline create workspace
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);

  // Close floating menus on outside click / Escape (extended from the
  // original's single ⋯-menu effect to also cover the view-options popover).
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const inMenu =
        (menuRef.current && menuRef.current.contains(e.target as Node)) ||
        (viewMenuRef.current && viewMenuRef.current.contains(e.target as Node));
      if (!inMenu) {
        setOpenMenuId(null);
        setMenuPosition(null);
        setViewOpen(false);
        setViewMenuPosition(null);
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenMenuId(null);
        setMenuPosition(null);
        setViewOpen(false);
        setViewMenuPosition(null);
        setIsCreatingWorkspace(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, []);

  // Auto-expand newly added workspaces (e.g. created via the Move dialog).
  useEffect(() => {
    setExpandedWorkspaces((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const w of workspaces) {
        if (!next.has(w.id)) {
          next.add(w.id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [workspaces]);

  const toggleWorkspace = (id: string) => {
    setExpandedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Mutations (same endpoints as the original) ──────────────────────
  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspaceName.trim() || isSavingWorkspace) return;
    setIsSavingWorkspace(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newWorkspaceName.trim() }),
      });
      if (res.ok) {
        setNewWorkspaceName('');
        setIsCreatingWorkspace(false);
        refresh();
      }
    } catch {
      // leave the inline form open so the user can retry
    } finally {
      setIsSavingWorkspace(false);
    }
  };

  const handleDeleteFolio = async (folioId: string) => {
    if (!window.confirm('Delete this folio permanently? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/files/${folioId}`, { method: 'DELETE' });
      setOpenMenuId(null);
      setMenuPosition(null);
      // Deleting the folio you are currently viewing would leave the editor
      // rendering a record that no longer exists — refreshing the sidebar
      // alone strands the view on a dead route. Leave for the dashboard, but
      // only when the folio is genuinely gone: 2xx, or 404 for one deleted
      // from another tab. Anything else means the delete failed and the view
      // is still valid.
      const gone = res.ok || res.status === 404;
      if (gone && pathname === `/app/${folioId}`) {
        router.push('/app');
      }
      refresh();
    } catch {
      // deletion failed — keep the list as-is
    }
  };

  /** Archive hides a folio everywhere public without deleting it. Reversible,
   *  so no confirm step — the row just moves to the Archived group. */
  const handleArchiveFolio = async (folioId: string) => {
    try {
      await fetch(`/api/files/${folioId}/archive`, { method: 'POST' });
      setOpenMenuId(null);
      setMenuPosition(null);
      refresh();
    } catch {
      // archive failed — keep the list as-is
    }
  };

  const handleUnarchiveFolio = async (folioId: string) => {
    try {
      await fetch(`/api/files/${folioId}/unarchive`, { method: 'POST' });
      setOpenMenuId(null);
      setMenuPosition(null);
      refresh();
    } catch {
      // unarchive failed — keep the list as-is
    }
  };

  /** Restoring a workspace brings every folio in it back as a draft — worth a
   *  confirm, since the owner is about to see a pile of unpublished rows. */
  const handleUnarchiveWorkspace = async (workspaceId: string) => {
    if (
      !window.confirm(
        'Restore this workspace? Its folios come back as drafts and stay unpublished until you publish them.'
      )
    )
      return;
    try {
      await fetch(`/api/projects/${workspaceId}/unarchive`, { method: 'POST' });
      refresh();
    } catch {
      // unarchive failed — keep the list as-is
    }
  };

  const handleDropOnWorkspace = async (workspaceId: string) => {
    if (!dragFolioId) return;
    const folioId = dragFolioId;
    setDragFolioId(null);
    setDragOverWorkspaceId(null);
    if (folios.find((f) => f.id === folioId)?.projectId === workspaceId) return;
    try {
      await fetch(`/api/projects/${workspaceId}/folios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folioId }),
      });
      refresh();
    } catch {
      // move failed — no-op
    }
  };

  // Claude-style menu anchor: open the ⋯ menu near the item, flipping above
  // the row when it sits too low to fit below.
  const openFolioMenu = (e: React.MouseEvent, folioId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setOpenMenuId(folioId);
    setMenuPosition(anchorRowMenu(e.currentTarget as HTMLElement));
  };

  const openViewMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setViewOpen((open) => {
      const next = !open;
      setViewMenuPosition(next ? anchorRowMenu(e.currentTarget as HTMLElement) : null);
      return next;
    });
  };

  // ── Derived lists: search → order → group ───────────────────────────
  const orderedFolios =
    viewOrder === 'recent'
      ? [...folios].sort(
          (a, b) =>
            new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime(),
        )
      : folios; // manual: the API's order, untouched

  const q = searchQuery.trim().toLowerCase();
  const filteredFolios =
    q.length === 0
      ? orderedFolios
      : orderedFolios.filter(
          (f) =>
            f.title.toLowerCase().includes(q) ||
            (f.description ?? '').toLowerCase().includes(q),
        );

  // Archived items are pulled out of the normal tree and rendered in their own
  // collapsed group at the bottom — the owner's "out of the way, not gone".
  // An archived folio is one whose own flag is set; a folio inside an archived
  // workspace is reachable through that workspace's group instead.
  const archivedWorkspaces = workspaces.filter((w) => !!w.archived_at);
  const archivedWorkspaceIds = new Set(archivedWorkspaces.map((w) => w.id));
  const archivedFolios = filteredFolios.filter(
    (f) => !!f.archivedAt && !(f.projectId && archivedWorkspaceIds.has(f.projectId)),
  );
  const archivedFolioIds = new Set(archivedFolios.map((f) => f.id));
  const archivedWorkspaceFolios = filteredFolios.filter(
    (f) => !!f.projectId && archivedWorkspaceIds.has(f.projectId),
  );
  const hasArchived = archivedFolios.length > 0 || archivedWorkspaces.length > 0;

  // `archivedFolioIds` only holds folios archived in their OWN right, so a
  // folio that is merely inside an archived workspace has to be excluded
  // separately — otherwise the flat view (which renders liveFolios directly,
  // with no workspace grouping to hide behind) still lists it.
  const liveFolios = filteredFolios.filter(
    (f) =>
      !archivedFolioIds.has(f.id) &&
      !(f.projectId && archivedWorkspaceIds.has(f.projectId)),
  );
  const liveWorkspaces = workspaces.filter((w) => !w.archived_at);

  const unfiledFolios = liveFolios.filter((f) => !f.projectId);
  const hasSearch = q.length > 0;

  // ── Mine vs shared with me ──────────────────────────────────────────
  // GET /api/projects returns every workspace in the org, so a team member's
  // sidebar has always been a mix of their own and their colleagues'. Splitting
  // them is what makes the Team plan read as a team product rather than "your
  // folders, plus some you didn't make".
  //
  // Ownership is derived from `created_by` (there is no per-workspace
  // membership table — membership is org-level). Until the profile fetch lands
  // `myUserId` is null, and everything stays in the un-split list: a wrong
  // split is worse than a late one, and this state lasts one request.
  const ownership = splitWorkspacesByOwnership(liveWorkspaces, isCloud ? myUserId : null);
  const myWorkspaces = ownership.mine;
  const sharedWorkspaces = ownership.shared;
  // The label only earns its place above at least one visible group: with a
  // search active, groups with no matching folios render as null, and a
  // stranded "Shared with me" heading over empty space is worse than no split.
  const visibleShared = sharedWorkspaces.filter(
    (w) => !hasSearch || liveFolios.some((f) => f.projectId === w.id),
  );
  const hasShared = visibleShared.length > 0;

  // Section labels are small-caps signposts, NOT headings — they must read
  // quieter than the item titles beneath them. (They used to be 12px bold
  // while the titles were 11px, which inverted the hierarchy: "WORKSPACES"
  // shouted louder than the folio names it labelled.)
  const sectionLabel =
    'px-2.5 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-ink/40';
  const itemBase = cn(
    'group/item w-full flex items-center gap-2 px-2.5 font-medium transition-colors rounded-lg text-left',
    // Phones (drawer, full width): larger titles, tighter rows.
    phone ? 'py-1 text-[13px]' : 'py-1.5 text-[12px]'
  );

  /**
   * One workspace accordion. Extracted so the "Shared with me" group renders
   * the EXACT same rows as the caller's own — same drag targets, same ⋯
   * affordances, same counts. A second copy of this markup would drift.
   */
  const renderWorkspaceGroup = (w: WorkspaceData) => {
    const workspaceFolios = liveFolios.filter((f) => f.projectId === w.id);
    // With a search active, hide groups with no matches.
    if (hasSearch && workspaceFolios.length === 0) return null;
    const isOpen = expandedWorkspaces.has(w.id);
    return (
      <div key={w.id}>
        <div
          className={cn(
            itemBase,
            'text-ink/90 hover:bg-[#0F0F0D]/5 dark:hover:bg-[#F4F4F0]/10 cursor-pointer',
            dragOverWorkspaceId === w.id && 'bg-[var(--app-accent)]/10 ring-1 ring-vermillion/50',
            dragFolioId && dragOverWorkspaceId !== w.id && 'opacity-90',
          )}
          onDragOver={(e) => {
            if (!dragFolioId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (dragOverWorkspaceId !== w.id) setDragOverWorkspaceId(w.id);
          }}
          onDragLeave={() => {
            if (dragOverWorkspaceId === w.id) setDragOverWorkspaceId(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            handleDropOnWorkspace(w.id);
          }}
        >
          <button
            onClick={() => toggleWorkspace(w.id)}
            className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer"
          >
            {isOpen ? (
              <ChevronDown size={12} className="shrink-0 text-ink/60" />
            ) : (
              <ChevronRight size={12} className="shrink-0 text-ink/60" />
            )}
            <FolderKanban size={13} className="shrink-0 text-[var(--app-accent)]/70" />
            <span className="truncate">{w.name}</span>
            <PaidIndicator config={w.paid_access} />
            {w.is_public ? (
              <Globe size={10} className="shrink-0 text-ink/45" />
            ) : (
              <Lock size={10} className="shrink-0 text-ink/45" />
            )}
            <span className="text-[11px] tabular-nums text-ink/45 shrink-0">
              {workspaceFolios.length}
            </span>
          </button>
          {/* Workspace settings — hover on desktop, always on touch */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setSettingsWorkspace(w);
            }}
            className={cn(
              'h-5 w-5 items-center justify-center text-ink/50 hover:text-[var(--app-accent)] rounded-lg transition-all cursor-pointer shrink-0',
              phone
                ? 'flex opacity-100'
                : 'hidden opacity-0 group-hover/item:flex group-hover/item:opacity-100'
            )}
            title="Workspace settings"
          >
            <Pencil size={10} />
          </button>
        </div>
        {isOpen && (
          <div className="ml-3 pl-2.5 border-l border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10">
            {workspaceFolios.length === 0 ? (
              <p className="px-2.5 py-1.5 text-sm font-medium text-ink/45 ">
                Empty — use ⋯ on a folio to move it here
              </p>
            ) : (
              workspaceFolios.map((f) => (
                <FolioItem
                  key={f.id}
                  folio={f}
                  pathname={pathname}
                  onOpenMenu={openFolioMenu}
                  isDragging={dragFolioId === f.id}
                  onDragStart={(e, id) => {
                    e.dataTransfer.effectAllowed = 'move';
                    setDragFolioId(id);
                  }}
                  onDragEnd={() => {
                    setDragFolioId(null);
                    setDragOverWorkspaceId(null);
                  }}
                />
              ))
            )}
          </div>
        )}
      </div>
    );
  };

  // Dialogs must render in BOTH states — the rail's New folio button
  // opens the modal while collapsed, and the collapsed branch returns
  // early (dialogs in the expanded branch alone would never mount).
  const dialogs = (
    <Portal>
      {moveFolio && (
        <MoveToProjectDialog
          isOpen={!!moveFolio}
          onClose={() => setMoveFolio(null)}
          folioId={moveFolio.id}
          folioTitle={moveFolio.title}
          currentProjectId={moveFolio.projectId || null}
          projects={liveWorkspaces}
          onMoved={() => {
            refresh();
          }}
          onProjectsChange={refresh}
        />
      )}
      <ProjectSettingsDialog
        isOpen={!!settingsWorkspace}
        onClose={() => setSettingsWorkspace(null)}
        project={settingsWorkspace}
        profileUsername={profileUsername}
        onSaved={() => {
          refresh();
        }}
      />
      {isCreateOpen && (
        <CreateFolioModal isOpen onClose={() => setCreateOpen(false)} onCreated={refresh} />
      )}
    </Portal>
  );

  // ── Collapsed: 56px icon rail (SIDEBAR_COLLAPSED) ───────────────────
  if (collapsed) {
    return (
      <>
      {/* Transparent: the frame's bone-deep tint IS the rail surface. */}
      <aside className="flex h-full w-full flex-col items-center gap-2 py-3">
        <span className="inline-flex h-4 w-4 items-center justify-center">
          <span className="inline-block h-2.5 w-2.5 bg-[#FF3B00]" />
        </span>
        {/* Expand toggle sits at the top in BOTH states — the same corner as
            the expanded header's collapse button, so the control never
            moves between open and closed. */}
        <button
          type="button"
          onClick={toggleSidebar}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink/70 hover:text-ink"
          title="Expand sidebar"
          aria-label="Expand sidebar"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
        {/* Primary navigation — the same three destinations as the expanded
            sidebar. The Inbox carries a DOT rather than a count: a 56px rail
            has no room for digits, and the dot is the "go look" signal. */}
        <div className="mt-2 flex flex-col items-center gap-1">
          <Link
            href="/app"
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-lg',
              pathname === '/app' ? 'text-[var(--app-accent)]' : 'text-ink/70 hover:text-ink',
            )}
            title="Home"
            aria-label="Home"
            aria-current={pathname === '/app' ? 'page' : undefined}
          >
            <Home className="h-4 w-4" />
          </Link>
          <Link
            href="/app/inbox"
            className={cn(
              'relative flex h-8 w-8 items-center justify-center rounded-lg',
              pathname.startsWith('/app/inbox')
                ? 'text-[var(--app-accent)]'
                : 'text-ink/70 hover:text-ink',
            )}
            title={unreadCount > 0 ? `Inbox — ${unreadCount} unread` : 'Inbox'}
            aria-label={unreadCount > 0 ? `Inbox, ${unreadCount} unread` : 'Inbox'}
          >
            <Inbox className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[var(--app-accent)]" />
            )}
          </Link>
          <Link
            href="/app/chat"
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-lg',
              pathname.startsWith('/app/chat')
                ? 'text-[var(--app-accent)]'
                : 'text-ink/70 hover:text-ink',
            )}
            title="Chat"
            aria-label="Chat"
            aria-current={pathname.startsWith('/app/chat') ? 'page' : undefined}
          >
            <Sparkles className="h-4 w-4" />
          </Link>
          {!isOSS && (
            <Link
              href="/app/explore"
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg',
                pathname.startsWith('/app/explore')
                  ? 'text-[var(--app-accent)]'
                  : 'text-ink/70 hover:text-ink',
              )}
              title="Explore"
              aria-label="Explore"
            >
              <Compass className="h-4 w-4" />
            </Link>
          )}
          <Link
            href="/app/analytics"
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-lg',
              pathname.startsWith('/app/analytics')
                ? 'text-[var(--app-accent)]'
                : 'text-ink/70 hover:text-ink',
            )}
            title="Analytics"
            aria-label="Analytics"
            aria-current={pathname.startsWith('/app/analytics') ? 'page' : undefined}
          >
            <TrendingUp className="h-4 w-4" />
          </Link>
        </div>

        {/* Identity chip — cloud-only (profiles + /@username pages are excluded from OSS) */}
        {!isOSS && profileUsername && (
          <Link
            id="sidebar-profile"
            href={`/@${profileUsername}`}
            target="_blank"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink/70 hover:text-ink"
            title="Your public page"
            aria-label="Your public page"
          >
            {profileAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profileAvatar} alt="" className="h-5 w-5 rounded-full object-cover" />
            ) : (
              <User className="h-4 w-4" />
            )}
          </Link>
        )}
        <div className="mt-4 flex flex-1 flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink/70 transition-colors hover:bg-black/5 hover:text-[var(--app-accent)]"
            title="New folio"
            aria-label="New folio"
          >
            <FilePlus2 className="h-4 w-4" />
          </button>
          {/* Workspaces are Cloud-only — hidden in OSS */}
          {!isOSS && (
            <button
              type="button"
              onClick={() => {
                // No room for the inline form in the rail — expand, then offer it.
                toggleSidebar();
                setIsCreatingWorkspace(true);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 text-ink/70 hover:border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10/30 hover:text-[var(--app-accent)]"
              title="New workspace"
              aria-label="New workspace"
            >
              <FolderPlus className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => onOpenSettings?.()}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink/70 hover:text-ink"
          title="Settings"
          aria-label="Settings"
        >
          <Settings className="h-4 w-4" />
        </button>
      </aside>
      {dialogs}
      </>
    );
  }

  // ── Expanded ────────────────────────────────────────────────────────
  return (
    <>
    {/* Transparent: the frame's bone-deep tint IS the rail surface. */}
    <aside className="flex h-full w-full flex-col">
      {/* Header: brand + collapse toggle (shell chrome). No border — the
          tinted surface separates it from the list below. */}
      <div className="relative flex h-12 items-center justify-center px-4">
        <Link href="/app" className="flex items-center gap-2.5 hover:opacity-90 transition-opacity">
          <span className="inline-flex h-4 w-4 items-center justify-center">
            <span className="inline-block h-2.5 w-2.5 bg-[#FF3B00]" />
          </span>
          <span className="font-black text-[#0F0F0D] dark:text-[#F4F4F0] text-base tracking-tighter leading-none" style={{ fontFamily: FONT_DISPLAY }}>LiveFolio</span>
        </Link>
        {onCloseDrawer ? (
          <button
            type="button"
            onClick={onCloseDrawer}
            className="absolute right-3 flex h-7 w-7 items-center justify-center rounded-lg text-ink/70 hover:text-ink"
            title="Close sidebar"
            aria-label="Close sidebar"
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={toggleSidebar}
            className="absolute right-3 flex h-7 w-7 items-center justify-center rounded-lg text-ink/70 hover:text-ink"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Your public page — prominent identity chip, above the search row.
          Cloud-only: profiles are excluded from the OSS sync (no /@username pages). */}
      {!isOSS && profileUsername && (
        <Link
          id="sidebar-profile"
          href={`/@${profileUsername}`}
          target="_blank"
          title={`Your public page — @${profileUsername}`}
          className="group mx-3 mb-1 mt-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-[#0F0F0D]/5 dark:hover:bg-[#F4F4F0]/10"
        >
          {profileAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profileAvatar} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />
          ) : (
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black/5 text-ink/60 dark:bg-white/10">
              <User size={12} />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold leading-tight text-ink">
              {profileName || `@${profileUsername}`}
            </span>
            <span className="block truncate text-[11px] leading-tight text-ink/45">
              Your public page
            </span>
          </span>
          <ArrowUpRight
            size={11}
            className="shrink-0 text-ink/25 transition-colors group-hover:text-[var(--app-accent)]"
          />
        </Link>
      )}

      {/* ── Primary navigation ──────────────────────────────────────────
          Above the library on purpose: these are destinations, the tree below
          is content. Explore is Cloud-only (the marketplace is excluded from
          the OSS build), so OSS shows Home + Inbox. */}
      <nav className="flex flex-col gap-0.5 px-3 pb-1">
        <NavRow
          href="/app"
          icon={<Home size={13} />}
          label="Home"
          active={pathname === '/app'}
        />
        <NavRow
          href="/app/inbox"
          icon={<Inbox size={13} />}
          label="Inbox"
          active={pathname === '/app/inbox' || pathname.startsWith('/app/inbox/')}
          badge={unreadCount}
        />
        {/* The AI creation chat gets its own row — it used to be the `/app`
            default, and demoting it to a zero-folio fallback hid it from
            everyone who already had folios. */}
        <NavRow
          href="/app/chat"
          icon={<Sparkles size={13} />}
          label="Chat"
          active={pathname === '/app/chat' || pathname.startsWith('/app/chat/')}
        />
        {/* Explore points INSIDE the shell. The public `/explore` is a
            marketing page with its own header and hero — linking there threw
            the user out of their account and read as a redirect away. */}
        {!isOSS && (
          <NavRow
            href="/app/explore"
            icon={<Compass size={13} />}
            label="Explore"
            active={pathname === '/app/explore' || pathname.startsWith('/app/explore/')}
          />
        )}
        {/* Promoted out of the settings modal: analytics is something you check
            repeatedly, settings is something you configure once. */}
        <NavRow
          href="/app/analytics"
          icon={<TrendingUp size={13} />}
          label="Analytics"
          active={pathname === '/app/analytics' || pathname.startsWith('/app/analytics/')}
        />
      </nav>

      {/* Library label — everything below (search + tree + shelves) is the
          user's own filing. Small-caps signpost, quieter than the rows. */}
      <div className="px-3">
        <div className={cn(sectionLabel, 'pt-2')}>Library</div>
      </div>

      {/* Search + view options */}
      <div className="flex items-center gap-1.5 px-3 pb-2 pt-1">
        <div className="relative flex-1 min-w-0">
          <Search
            size={11}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink/35"
          />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search folios…"
            aria-label="Search folios"
            className="w-full h-7 pl-7 pr-6 text-[13px] font-medium rounded-lg border-0 bg-black/5 text-ink placeholder:text-ink/50 focus:outline-none focus:bg-black/[0.07]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-1 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center text-ink/40 hover:text-[var(--app-accent)] cursor-pointer"
              aria-label="Clear search"
            >
              <X size={10} />
            </button>
          )}
        </div>
        <button
          type="button"
          id="sidebar-new-folio"
          onClick={() => setCreateOpen(true)}
          className="relative flex h-7 w-7 min-h-0 min-w-0 shrink-0 items-center justify-center rounded-lg text-ink/60 transition-colors cursor-pointer hover:bg-black/5 hover:text-[var(--app-accent)]"
          title="New folio"
          aria-label="New folio"
        >
          <FilePlus2 className="h-3.5 w-3.5" />
        </button>
        {/* Workspaces are Cloud-only — hidden in OSS */}
        {!isOSS && (
          <button
            type="button"
            id="sidebar-new-workspace"
            onClick={() => setIsCreatingWorkspace((v) => !v)}
            className={cn(
              // min-h-0/min-w-0: compact chrome button — opts out of the 40px
              // coarse-pointer touch floor that would inflate it past its icon.
              'relative flex h-7 w-7 min-h-0 min-w-0 shrink-0 items-center justify-center rounded-lg transition-colors cursor-pointer',
              isCreatingWorkspace
                ? 'bg-[var(--app-accent)]/10 text-[var(--app-accent)]'
                : 'text-ink/60 hover:bg-black/5 hover:text-[var(--app-accent)]',
            )}
            title={isCreatingWorkspace ? 'Cancel new workspace' : 'New workspace'}
            aria-label={isCreatingWorkspace ? 'Cancel new workspace' : 'New workspace'}
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={openViewMenu}
          className={cn(
            'relative flex h-7 w-7 min-h-0 min-w-0 shrink-0 items-center justify-center rounded-lg transition-colors cursor-pointer',
            viewIsCustom
              ? 'bg-[var(--app-accent)]/10 text-[var(--app-accent)]'
              : 'text-ink/60 hover:bg-black/5 hover:text-ink',
          )}
          title="View options"
          aria-label="View options"
          aria-haspopup="true"
          aria-expanded={isViewOpen}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {viewIsCustom && (
            <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-[var(--app-accent)]" />
          )}
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-3 pb-2">
        {/* Inline new-workspace form (explicit button above toggles it) —
            Cloud-only: the projects API 501s in OSS. */}
        {!isOSS && isCreatingWorkspace && (
          <form onSubmit={handleCreateWorkspace} className="flex gap-1.5 px-1 py-1.5 mt-0.5">
            <input
              autoFocus
              value={newWorkspaceName}
              onChange={(e) => setNewWorkspaceName(e.target.value)}
              placeholder="Workspace name…"
              className="flex-1 h-7 px-2 text-[13px] font-medium rounded-lg border-0 bg-black/5 text-ink placeholder:text-ink/50 focus:outline-none focus:bg-black/[0.07]"
            />
            <button
              type="submit"
              disabled={isSavingWorkspace || !newWorkspaceName.trim()}
              className="h-7 min-h-0 px-2.5 text-xs font-bold tracking-tight  bg-[var(--app-accent)] text-bone hover:bg-ink disabled:opacity-30 rounded-lg transition-colors cursor-pointer"
            >
              {isSavingWorkspace ? <Loader2 size={9} className="animate-spin" /> : 'Add'}
            </button>
            <button
              type="button"
              onClick={() => setIsCreatingWorkspace(false)}
              className="h-7 w-7 min-h-0 min-w-0 flex items-center justify-center rounded-lg text-ink/50 hover:text-ink hover:bg-black/5 transition-colors cursor-pointer shrink-0"
              title="Cancel"
              aria-label="Cancel new workspace"
            >
              <X size={12} />
            </button>
          </form>
        )}

        {activeGroup === 'workspace' ? (
          /* ── Group by workspace (accordions, as in the original) ── */
          <>
            {/* No "Workspaces" header — folder rows are self-evident, and the
                label only pushed the real content down. "Unfiled" stays
                because it marks a boundary, not a category. */}
            {liveWorkspaces.length === 0 && !isLoading ? (
              <p className="px-2.5 py-1 text-sm font-medium text-ink/45 ">
                No workspaces yet — create one above
              </p>
            ) : (
              <>
                {myWorkspaces.map(renderWorkspaceGroup)}

                {/* Shared with me — workspaces someone else in the org owns.
                    Same rows, same drag targets, same ⋯ menu: the only thing
                    that differs is the label above them. Hidden entirely when
                    empty (a solo account never sees it) and in OSS (no orgs). */}
                {hasShared && (
                  <>
                    <div className={sectionLabel}>Shared with me</div>
                    {visibleShared.map(renderWorkspaceGroup)}
                  </>
                )}
              </>
            )}

            {/* Folios without a workspace */}
            {unfiledFolios.length > 0 && (
              <div>
                <div className={sectionLabel}>Unfiled</div>
                <div className="ml-0 pl-2.5 border-l border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10">
                  {unfiledFolios.map((f) => (
                    <FolioItem
                      key={f.id}
                      folio={f}
                      pathname={pathname}
                      onOpenMenu={openFolioMenu}
                      isDragging={dragFolioId === f.id}
                      onDragStart={(e, id) => {
                        e.dataTransfer.effectAllowed = 'move';
                        setDragFolioId(id);
                      }}
                      onDragEnd={() => {
                        setDragFolioId(null);
                        setDragOverWorkspaceId(null);
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          /* ── Flat: one list of all folios ── */
          <>
            <div className={sectionLabel}>All folios</div>
            {isLoading && folios.length === 0 ? (
              <div className="px-2.5 py-2 text-center">
                <Loader2 size={12} className="animate-spin mx-auto text-ink/20" />
              </div>
            ) : liveFolios.length === 0 ? (
              <p className="px-2.5 py-1 text-sm font-medium text-ink/45 ">
                {hasSearch ? 'No folios match your search' : 'No folios yet — create one above'}
              </p>
            ) : (
              liveFolios.map((f) => (
                <FolioItem
                  key={f.id}
                  folio={f}
                  pathname={pathname}
                  onOpenMenu={openFolioMenu}
                  isDragging={dragFolioId === f.id}
                  onDragStart={(e, id) => {
                    e.dataTransfer.effectAllowed = 'move';
                    setDragFolioId(id);
                  }}
                  onDragEnd={() => {
                    setDragFolioId(null);
                    setDragOverWorkspaceId(null);
                  }}
                />
              ))
            )}
          </>
        )}

        {isLoading && folios.length > 0 && (
          <div className="flex items-center justify-center gap-1.5 py-2 text-ink/30">
            <Loader2 size={10} className="animate-spin" />
            <span className="text-xs font-bold tracking-tight ">
              Refreshing…
            </span>
          </div>
        )}

        {/* Archived — the "out of the way, not gone" shelf. Reached by the
            menu on any folio or from workspace settings. Nothing here is
            publicly reachable, and nothing here has been deleted. */}
        {hasArchived && (
          <>
            <button
              type="button"
              onClick={() => setArchivedOpen((v) => !v)}
              aria-expanded={archivedOpen}
              className={cn(
                sectionLabel,
                'w-full flex items-center gap-1 hover:text-ink/70 transition-colors cursor-pointer',
              )}
            >
              {archivedOpen ? (
                <ChevronDown size={12} className="shrink-0" />
              ) : (
                <ChevronRight size={12} className="shrink-0" />
              )}
              Archived
              <span className="text-xs font-medium text-ink/45">
                {archivedWorkspaces.length + archivedFolios.length}
              </span>
            </button>
            {archivedOpen && (
              <div className="ml-0 pl-2.5 border-l border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10">
                <p className="px-2.5 pt-0.5 pb-1.5 text-xs font-medium leading-snug text-ink/40">
                  Hidden from everyone but you. They still count toward storage.
                </p>
                {archivedWorkspaces.map((w) => (
                  <div key={w.id} className={cn(itemBase, 'text-ink/70')}>
                    <FolderKanban size={13} className="shrink-0 text-ink/40" />
                    <span className="truncate flex-1">{w.name}</span>
                    <button
                      type="button"
                      onClick={() => handleUnarchiveWorkspace(w.id)}
                      title="Restore this workspace"
                      className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-bold text-ink/50 transition-colors hover:bg-[var(--app-accent)]/10 hover:text-[var(--app-accent)] cursor-pointer"
                    >
                      <ArchiveRestore size={11} /> Restore
                    </button>
                  </div>
                ))}
                {archivedWorkspaceFolios.map((f) => (
                  <FolioItem
                    key={f.id}
                    folio={f}
                    pathname={pathname}
                    onOpenMenu={openFolioMenu}
                    isDragging={false}
                    onDragStart={() => {}}
                    onDragEnd={() => {}}
                  />
                ))}
                {archivedFolios.map((f) => (
                  <FolioItem
                    key={f.id}
                    folio={f}
                    pathname={pathname}
                    onOpenMenu={openFolioMenu}
                    isDragging={false}
                    onDragStart={() => {}}
                    onDragEnd={() => {}}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* Purchases — the buyer's library, pinned in their own sidebar */}
        {isCloud && purchases.length > 0 && (
          <>
            <div className={sectionLabel}>Purchases</div>
            {purchases.map((p) => {
              const href = p.shareSlug ? `/share/${p.shareSlug}` : p.workspacePage ?? null;
              if (!href) return null;
              return (
                <Link
                  key={p.id}
                  href={href}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-ink/75 transition-colors hover:text-[var(--app-accent)]"
                >
                  <Receipt size={12} className="shrink-0 text-[var(--app-accent)]/70" />
                  <span className="truncate flex-1">{p.title ?? 'Purchased item'}</span>
                </Link>
              );
            })}
          </>
        )}
      </div>

      {/* Foot: theme toggle + settings gear (settings popup trigger). No
          border — the tinted surface separates it from the list above.
          (Your public page lives in the identity chip at the top.) */}
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <ThemeToggle compact />
        <button
          id="sidebar-settings"
          type="button"
          onClick={() => onOpenSettings?.()}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink/60 hover:text-ink"
          title="Settings"
          aria-label="Settings"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>

      {/* Floating ⋯ menu (as in the original) — portaled like the dialogs */}
      {openMenuId && menuPosition && (
        <Portal>
        <div
          ref={menuRef}
          className="fixed z-[450] w-44 py-1 rounded-xl bg-white shadow-xl ring-1 ring-black/5 dark:bg-[#171714] dark:ring-white/10 animate-in fade-in zoom-in-95 duration-100"
          style={menuAnchorStyle(menuPosition)}
        >
          <button
            onClick={() => {
              setMoveFolio(folios.find((f) => f.id === openMenuId) || null);
              setOpenMenuId(null);
              setMenuPosition(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] font-medium text-ink/70 hover:bg-[#0F0F0D]/5 dark:hover:bg-[#F4F4F0]/10  text-left rounded-lg transition-colors cursor-pointer"
          >
            <FolderInput size={12} /> Move to workspace
          </button>
          <button
            onClick={() => {
              setOpenMenuId(null);
              setMenuPosition(null);
              const f = folios.find((x) => x.id === openMenuId);
              if (f) router.push(`/app/${f.id}`);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] font-medium text-ink/70 hover:bg-[#0F0F0D]/5 dark:hover:bg-[#F4F4F0]/10  text-left rounded-lg transition-colors cursor-pointer"
          >
            <ArrowUpRight size={12} /> Open in app
          </button>
          {/* Archive is the reversible counterpart to Delete below — no
              confirm dialog, because nothing is destroyed. */}
          <button
            onClick={() => {
              const f = folios.find((x) => x.id === openMenuId);
              if (f?.archivedAt) void handleUnarchiveFolio(openMenuId);
              else void handleArchiveFolio(openMenuId);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] font-medium text-ink/70 hover:bg-[#0F0F0D]/5 dark:hover:bg-[#F4F4F0]/10  text-left rounded-lg transition-colors cursor-pointer"
          >
            {folios.find((x) => x.id === openMenuId)?.archivedAt ? (
              <>
                <ArchiveRestore size={12} /> Unarchive
              </>
            ) : (
              <>
                <Archive size={12} /> Archive
              </>
            )}
          </button>
          <div className="my-1 h-px bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10" />
          <button
            onClick={() => handleDeleteFolio(openMenuId)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] font-medium text-[var(--app-accent)] hover:bg-[var(--app-accent)]/5  text-left rounded-lg transition-colors cursor-pointer"
          >
            <Trash2 size={12} /> Delete
          </button>
        </div>
        </Portal>
      )}

      {/* View-options popover — portaled like the dialogs */}
      {isViewOpen && viewMenuPosition && (
        <Portal>
        <div
          ref={viewMenuRef}
          className="fixed z-[450] w-48 py-1.5 rounded-xl bg-white shadow-xl ring-1 ring-black/5 dark:bg-[#171714] dark:ring-white/10 animate-in fade-in zoom-in-95 duration-100"
          style={menuAnchorStyle(viewMenuPosition)}
        >
          <p className="px-3 pb-1 pt-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-ink/40">
            Group by
          </p>
          <div className="px-1.5 pb-1">
            {(
              [
                ['workspace', 'Workspaces'],
                ['flat', 'Flat'],
              ] as const
            )
              // Workspaces are Cloud-only — the option is hidden in OSS.
              .filter(([value]) => !(isOSS && value === 'workspace'))
              .map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setGroup(value)}
                aria-pressed={viewGroup === value}
                className={cn(
                  'w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-[13px] font-medium rounded-md transition-colors cursor-pointer text-left',
                  viewGroup === value
                    ? 'text-ink bg-black/5 dark:bg-white/10'
                    : 'text-ink/60 hover:text-ink hover:bg-black/5 dark:hover:bg-white/10',
                )}
              >
                <span className="truncate">{label}</span>
                {viewGroup === value && (
                  <Check size={11} className="text-[var(--app-accent)] shrink-0" />
                )}
              </button>
            ))}
          </div>
          <div className="mx-2 my-1 h-px bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10" />
          <p className="px-3 pb-1 pt-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-ink/40">
            Order
          </p>
          <div className="px-1.5 pb-1">
            {(
              [
                ['manual', 'Manual'],
                ['recent', 'Recently updated'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setOrder(value)}
                aria-pressed={viewOrder === value}
                className={cn(
                  'w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-[13px] font-medium rounded-md transition-colors cursor-pointer text-left',
                  viewOrder === value
                    ? 'text-ink bg-black/5 dark:bg-white/10'
                    : 'text-ink/60 hover:text-ink hover:bg-black/5 dark:hover:bg-white/10',
                )}
              >
                <span className="truncate">{label}</span>
                {viewOrder === value && (
                  <Check size={11} className="text-[var(--app-accent)] shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>
        </Portal>
      )}

    </aside>
    {dialogs}
    </>
  );
}

/**
 * Badge shown on the Inbox row: unread feedback count, capped so a busy week
 * cannot stretch the row. Renders nothing at zero — an empty badge is noise
 * that trains people to ignore the badge.
 */
function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="ml-auto shrink-0 rounded-full bg-[var(--app-accent)] px-1.5 py-px text-[10px] font-bold leading-tight text-bone tabular-nums"
      aria-label={`${count} unread`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

/**
 * A primary navigation row (Home / Inbox / Explore).
 *
 * Deliberately NOT a folio row: nav rows sit above the library and use the
 * active-route accent fill the folio rows use, but never carry a ⋯ menu,
 * drag handle, or publish dot — those belong to content, not destinations.
 */
function NavRow({
  href,
  icon,
  label,
  active,
  badge = 0,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  badge?: number;
}) {
  const phone = useLayoutStore((s) => s.phone);
  return (
    <Link
      href={href}
      className={cn(
        'group/nav flex w-full items-center gap-2 rounded-lg px-2.5 font-medium transition-colors',
        phone ? 'py-1 text-[13px]' : 'py-1.5 text-[12px]',
        active
          ? 'bg-[var(--app-accent)]/5 text-[var(--app-accent)]'
          : 'text-ink/85 hover:bg-[#0F0F0D]/5 hover:text-ink dark:hover:bg-[#F4F4F0]/10',
      )}
      aria-current={active ? 'page' : undefined}
    >
      <span className="shrink-0 opacity-80">{icon}</span>
      <span className="truncate">{label}</span>
      <UnreadBadge count={badge} />
    </Link>
  );
}

/* ── Folio row with hover ⋯ (as in the original, navigation → /app/{id}) ── */
function FolioItem({
  folio,
  pathname,
  onOpenMenu,
  isDragging,
  onDragStart,
  onDragEnd,
}: {
  folio: FolioData;
  pathname: string;
  onOpenMenu: (e: React.MouseEvent, id: string) => void;
  isDragging?: boolean;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
}) {
  const isActive = pathname === `/app/${folio.id}`;
  // Anything that is not explicitly a draft is treated as published — that is
  // how the rest of the app reads a missing status.
  const isDraft = folio.status === 'draft';
  // Phone (full-screen drawer): larger titles, tighter rows.
  const phone = useLayoutStore((s) => s.phone);
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, folio.id)}
      onDragEnd={onDragEnd}
      className={cn(
        'group/item w-full flex items-center gap-2 px-2.5 font-medium transition-colors rounded-lg text-left cursor-grab active:cursor-grabbing',
        phone ? 'py-1 text-[13px]' : 'py-1.5 text-[11px]',
        isDragging && 'opacity-40',
        isActive
          ? 'bg-[var(--app-accent)]/5 text-[var(--app-accent)]'
          : 'text-ink/85 hover:bg-[#0F0F0D]/5 dark:hover:bg-[#F4F4F0]/10 hover:text-ink',
      )}
    >
      <Link href={`/app/${folio.id}`} className="flex items-center gap-2 flex-1 min-w-0 pl-1.5">
        {/* Sale/listing marks lead the row — read before the title */}
        <PaidIndicator config={folio.paidAccess} />
        <ListedIndicator listing={folio.listing} />
        <span className="truncate flex-1">{folio.title || 'Untitled'}</span>
        {/* Publish state — rendered in BOTH states. Previously only drafts got
            a mark (a 6px dot at 25% opacity, all but invisible), which left
            published folios unmarked: "live" and "no indicator" looked
            identical. Filled green = live, hollow = draft is the convention
            every publishing tool uses, so it needs no learning. */}
        <span
          role="img"
          title={isDraft ? 'Draft — only you can see it' : 'Published — live on the web'}
          aria-label={isDraft ? 'Draft' : 'Published'}
          className={cn(
            'h-2 w-2 shrink-0 rounded-full',
            isDraft
              ? 'border border-ink/35 dark:border-[#F4F4F0]/35'
              : 'bg-emerald-500 dark:bg-emerald-400',
          )}
        />
      </Link>
      <button
        onClick={(e) => onOpenMenu(e, folio.id)}
        className={cn(
          'h-5 w-5 flex items-center justify-center text-ink/50 hover:text-[var(--app-accent)] rounded-lg transition-all cursor-pointer shrink-0',
          // Touch has no hover: the ⋯ menu must always be visible on phones.
          phone ? 'opacity-100' : 'opacity-0 group-hover/item:opacity-100'
        )}
        aria-label="Folio actions"
      >
        <MoreHorizontal size={12} />
      </button>
    </div>
  );
}
