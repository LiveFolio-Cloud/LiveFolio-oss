'use client';

/**
 * The folio header row — one icon per concern, each opening its OWN menu
 * (all chrome: HeaderMenuSurface):
 *
 *   ★ Featured     — profile-hero pin + public-page link
 *   $  Access      — paid gating (price/preview/thumbnail) + Stripe connect
 *   🏪 Marketplace — Explore listing + license + seller terms
 *   ⇪ Share        — link, publish toggle, privacy, collaborators
 *   ⇩ Export ZIP   — gated by a confirmation panel
 *
 * Active features draw ON the trigger (orange brand square when paid /
 * listed / published; filled star when pinned).
 *
 * Title placement: desktop shows the editable title next to the icons; on
 * phones the title lives INSIDE the tab row (TabBar renders <FolioTitle/>
 * after the Studio/Chat tabs with a divider) so the top bar is icons-only
 * and the filename is never squeezed.
 *
 * Phone menus portal to <body> (HeaderMenuSurface) so no overflow-hidden
 * ancestor clips them; the outside-click closer is desktop-only — the modal
 * mask owns dismissal on phones (Escape still works).
 */
import { useEffect, useRef, useState } from 'react';
import { Download, Pencil, Check, X, Star, Store, DollarSign, Share2, User, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ShareMenu } from './share-menu';
import { HeaderMenuSurface } from './header-menu';
import { AccessMenuContent, ListingMenuContent, FeaturedMenuContent, ExportMenuContent, TunnelMenuContent } from './header-menus';
import { useFolioStore } from '../folio-provider/FolioProvider';
import { useLayoutStore } from '@/lib/app-shell/layout-store';
import { useTunnel } from '@/lib/app-shell/use-tunnel';
import { isOSS } from '@/lib/env';

type MenuName = 'share' | 'featured' | 'access' | 'listing' | 'export' | 'tunnel';

const MENU_TITLES: Record<MenuName, string> = {
  share: 'Share',
  featured: 'Featured',
  access: 'Access & payments',
  listing: 'Marketplace',
  export: 'Export ZIP',
  tunnel: 'Tunnel',
};

/**
 * Editable folio title — pencil → inline rename. Shared by the desktop
 * header (title next to the icons) and, on phones, the tab row slot
 * (TabBar renders it after Studio/Chat with a divider).
 */
export function FolioTitle({ className }: { className?: string }) {
  const project = useFolioStore((s) => s.project);
  const fetchProject = useFolioStore((s) => s.fetchProject);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [savingRename, setSavingRename] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renaming]);

  if (!project) return null;

  const saveRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameValue.trim() || savingRename) return;
    setSavingRename(true);
    try {
      const res = await fetch(`/api/files/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: renameValue.trim() }),
      });
      if (res.ok) await fetchProject();
      setRenaming(false);
    } finally {
      setSavingRename(false);
    }
  };

  return (
    <div className={cn('flex min-w-0 items-center gap-1.5', className)}>
      {renaming ? (
        <form onSubmit={saveRename} className="flex min-w-0 flex-1 items-center gap-1.5">
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            className="h-7 min-w-0 flex-1 rounded-lg border border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 bg-white px-2.5 text-sm text-ink focus:border-[var(--app-accent)] focus:outline-none"
          />
          <button
            type="submit"
            disabled={savingRename}
            className="flex h-7 w-7 min-h-0! min-w-0! shrink-0 items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50"
            aria-label="Save"
          >
            <Check size={14} />
          </button>
          <button
            type="button"
            onClick={() => setRenaming(false)}
            className="flex h-7 w-7 min-h-0! min-w-0! shrink-0 items-center justify-center rounded-lg text-ink/50 hover:bg-black/5"
            aria-label="Cancel"
          >
            <X size={14} />
          </button>
        </form>
      ) : (
        <>
          <button
            type="button"
            onClick={() => {
              setRenameValue(project.title ?? '');
              setRenaming(true);
            }}
            title="Rename folio"
            aria-label="Rename folio"
            className="flex h-7 w-7 min-h-0! min-w-0! shrink-0 items-center justify-center rounded-lg text-ink/40 transition-colors hover:bg-black/5 hover:text-ink"
          >
            <Pencil size={12} />
          </button>
          <h1 className="min-w-0 truncate text-sm font-semibold tracking-tight text-ink">
            {project.title}
          </h1>
        </>
      )}
    </div>
  );
}

export function FolioHeader() {
  const project = useFolioStore((s) => s.project);
  const fetchProject = useFolioStore((s) => s.fetchProject);
  const exportFolio = useFolioStore((s) => s.exportFolio);
  const phone = useLayoutStore((s) => s.phone);
  const [openMenu, setOpenMenu] = useState<MenuName | null>(null);
  const [profile, setProfile] = useState<{ username?: string; avatar?: string } | null>(null);
  const [featuredFolioId, setFeaturedFolioId] = useState<string | null>(null);

  // Public-page identity + pinned hero folio — the star trigger needs the
  // pin state even while its menu is closed.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/profile')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const p = data?.profile;
        if (p?.username) setProfile({ username: p.username, avatar: p.avatar_url });
        setFeaturedFolioId(p?.featured_folio_id ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const shareRef = useRef<HTMLDivElement>(null);
  const featuredRef = useRef<HTMLDivElement>(null);
  const accessRef = useRef<HTMLDivElement>(null);
  const listingRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const tunnelRef = useRef<HTMLDivElement>(null);
  // OSS-only: live tunnel state drives the header icon + the tunnel menu.
  const tunnel = useTunnel();

  // Close the open menu on outside click / Escape (desktop only — phone
  // menus are portals under <body>, so the mask inside the modal owns
  // dismissal; a global handler here would kill every toggle click).
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      if (phone) return;
      const inside = [shareRef, featuredRef, accessRef, listingRef, exportRef, tunnelRef].some((r) =>
        r.current?.contains(e.target as Node)
      );
      if (!inside) setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openMenu, phone]);

  if (!project) return null;

  const close = () => setOpenMenu(null);
  const toggle = (m: MenuName) => setOpenMenu((cur) => (cur === m ? null : m));

  /** Trigger + anchored desktop panel; phone panels portal via the surface. */
  const menu = (
    ref: React.RefObject<HTMLDivElement | null>,
    name: MenuName,
    activeFeature: boolean,
    label: string,
    trigger: React.ReactNode,
    content: React.ReactNode,
    shareMenu?: boolean
  ) => (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => toggle(name)}
        title={label}
        aria-label={label}
        aria-expanded={openMenu === name}
        className={cn(
          'flex h-7 w-7 min-h-0! min-w-0! items-center justify-center rounded-lg transition-colors',
          activeFeature
            ? 'bg-[var(--app-accent)] text-white shadow-sm'
            : openMenu === name
              ? 'bg-[var(--app-accent)]/10 text-[var(--app-accent)]'
              : 'text-ink/60 hover:bg-black/5 hover:text-ink'
        )}
      >
        {trigger}
      </button>
      {openMenu === name && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-50">
          {shareMenu ? (
            content // ShareMenu renders its own HeaderMenuSurface
          ) : (
            <HeaderMenuSurface open onClose={close} title={MENU_TITLES[name]}>
              {content}
            </HeaderMenuSurface>
          )}
        </div>
      )}
    </div>
  );

  const isPublished = (project as { status?: string }).status === 'published';
  const isPaid = Boolean(project.paidAccess?.enabled);
  const isListed = Boolean(project.listing?.listed);
  const isPinned = featuredFolioId === project.id;

  const rightCluster = (
    <>
      {/* Avatar chip — desktop only on phones (space); cloud-only feature. */}
      {!isOSS && !phone && profile?.username && (
        <a
          href={`/@${profile.username}`}
          target="_blank"
          rel="noopener noreferrer"
          title={`Your public page — @${profile.username}`}
          aria-label="Your public page"
          className="mr-1 flex h-7 w-7 min-h-0! min-w-0! items-center justify-center rounded-lg text-ink/60 transition-colors hover:text-[var(--app-accent)]"
        >
          {profile.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.avatar} alt="" className="h-5 w-5 rounded-full object-cover ring-1 ring-[#0F0F0D]/10 dark:ring-[#F4F4F0]/15" />
          ) : (
            <User size={13} />
          )}
        </a>
      )}

      {!isOSS &&
        menu(
          featuredRef,
          'featured',
          isPinned,
          isPinned ? 'Featured on your profile' : 'Feature on your profile',
          <Star size={13} className={isPinned ? 'fill-current' : ''} />,
          <FeaturedMenuContent
            projectId={project.id}
            pinned={isPinned}
            username={profile?.username}
            onPinnedChange={(p) => {
              setFeaturedFolioId(p ? project.id : null);
              void fetchProject();
            }}
          />
        )}

      {!isOSS &&
        menu(
          accessRef,
          'access',
          isPaid,
          isPaid ? 'Access & payments — selling' : 'Access & payments',
          <DollarSign size={13} />,
          <AccessMenuContent project={project} onSaved={() => void fetchProject()} />
        )}

      {!isOSS &&
        menu(
          listingRef,
          'listing',
          isListed,
          isListed ? 'Marketplace — listed in Explore' : 'Marketplace listing',
          <Store size={13} />,
          <ListingMenuContent project={project} onSaved={() => void fetchProject()} />
        )}

      {/* Tunnel status — OSS-only (cloud folios are publicly hosted) */}
      {isOSS &&
        menu(
          tunnelRef,
          'tunnel',
          tunnel.tunnelActive,
          tunnel.tunnelActive ? 'Tunnel live — click to manage' : 'Go live — share via tunnel',
          <Globe size={13} className={tunnel.tunnelActive ? '' : 'opacity-80'} />,
          <TunnelMenuContent tunnel={tunnel} />
        )}

      {menu(
        shareRef,
        'share',
        isPublished,
        isPublished ? 'Published — open share' : 'Share — not published',
        <Share2 size={13} />,
        <ShareMenu
          project={project}
          open={openMenu === 'share'}
          onSaved={() => void fetchProject()}
          onClose={close}
        />,
        true
      )}

      {menu(
        exportRef,
        'export',
        false,
        'Export ZIP',
        <Download size={13} />,
        <ExportMenuContent
          title={(project as { title?: string }).title ?? 'this folio'}
          onExport={() => exportFolio()}
          onCancel={close}
        />
      )}
    </>
  );

  if (phone) {
    // Top bar = actions only (left space clears the floating hamburger).
    // The editable title lives in the TAB row below (TabBar → FolioTitle).
    return (
      <div className="flex shrink-0 items-center justify-end gap-0.5 border-b border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 bg-bone py-1 pl-16 pr-2">
        {rightCluster}
      </div>
    );
  }

  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 bg-bone px-4">
      <FolioTitle className="flex-1" />
      <div className="flex shrink-0 items-center gap-0.5">{rightCluster}</div>
    </div>
  );
}
