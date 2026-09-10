'use client';

/**
 * The center-column tab bar (architecture spec §3, harness
 * `ConversationSessionHeader` pattern): a `role="tablist"` rendering every
 * registered view from `lib/app-shell/views.ts`. The active tab id lives in
 * the per-folio store (`view`), persisted to `LiveFolio_app_view.<folioId>`
 * by the store's `setView` — stale ids already resolve to `studio` inside the
 * store, so the bar never renders an unregistered tab.
 *
 * a11y: each button is `role="tab"` with `aria-selected`, wired to its panel
 * (`app-panel-<id>`) via `aria-controls`. Only the active tab is in the tab
 * sequence (`tabIndex 0` / `-1`).
 */
import { SHELL_VIEWS } from '@/lib/app-shell/views';
import { cn } from '@/lib/utils';
import { useFolioStore } from '../folio-provider/FolioProvider';
import { useLayoutStore } from '@/lib/app-shell/layout-store';
import { FolioTitle } from './FolioHeader';

export function TabBar() {
  const view = useFolioStore((s) => s.view);
  const setView = useFolioStore((s) => s.setView);
  // Left padding on phones clears the floating hamburger (top-left).
  const phone = useLayoutStore((s) => s.phone);

  return (
    <div
      role="tablist"
      aria-label="Folio views"
      className={cn('flex h-12 shrink-0 items-stretch gap-1 bg-bone px-3', phone && 'pl-16')}
    >
      {SHELL_VIEWS.map((tab) => {
        const active = tab.id === view;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`app-tab-${tab.id}`}
            aria-selected={active}
            aria-controls={`app-panel-${tab.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => setView(tab.id)}
            className={cn(
              // -mb-px lets the active tab's underline sit exactly on the
              // tablist's bottom border.
              '-mb-px flex items-center border-b-2 px-4 text-[13px] font-medium transition-colors',
              active
                ? 'border-[var(--app-accent)] text-ink'
                : 'border-transparent text-ink/50 hover:text-ink'
            )}
          >
            {tab.label}
          </button>
        );
      })}

      {/* Phones: the filename shares THIS line — divider, then the editable
          title (moved down from the icon row) so Studio/Chat stay left. */}
      {phone && (
        <div role="presentation" className="flex min-w-0 flex-1 items-center">
          <span
            aria-hidden
            className="mx-2 h-5 w-px shrink-0 bg-[#0F0F0D]/10 dark:bg-[#F4F4F0]/10"
          />
          <FolioTitle className="min-w-0 flex-1" />
        </div>
      )}
    </div>
  );
}
