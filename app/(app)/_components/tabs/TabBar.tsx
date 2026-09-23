'use client';

/**
 * The phone-only tab row (architecture spec §3, harness
 * `ConversationSessionHeader` pattern).
 *
 * On desktop this renders NOTHING: the Editor/Chat switcher lives inside
 * `FolioHeader`, left of the title, and the shared `<ViewTabs>` owns the
 * tablist semantics in both places. Phones keep a row of their own because
 * the phone header is icons-only and has no room for the switcher.
 *
 * The active tab id lives in the per-folio store (`view`), persisted to
 * `LiveFolio_app_view.<folioId>` by the store's `setView` — stale ids already
 * resolve to the default view inside the store, so the bar never renders an
 * unregistered tab.
 */
import { useLayoutStore } from '@/lib/app-shell/layout-store';
import { FolioTitle, ViewTabs } from './FolioHeader';

export function TabBar() {
  // Left padding on phones clears the floating hamburger (top-left).
  const phone = useLayoutStore((s) => s.phone);

  // Desktop renders the switcher inside FolioHeader, left of the title — the
  // whole separate row is gone, giving the canvas back 48px. This row exists
  // only on phones, where the header is icons-only and has no room for it.
  if (!phone) return null;

  return (
    <div className="flex h-12 shrink-0 items-center gap-1 bg-bone px-3 pl-16">
      <ViewTabs />

      {/* Phones: the filename shares THIS line — divider, then the editable
          title (moved down from the icon row) so Editor/Chat stay left. */}
      <div role="presentation" className="flex min-w-0 flex-1 items-center">
        <span
          aria-hidden
          className="mx-2 h-5 w-px shrink-0 bg-[#0F0F0D]/10 dark:bg-[#F4F4F0]/10"
        />
        <FolioTitle className="min-w-0 flex-1" />
      </div>
    </div>
  );
}
