/**
 * Shell view registry — the deepseek-harness `contract/views.ts` analog for
 * the app shell center column. The tab bar and the keep-alive container both
 * render from this single registry, so adding a view is one entry here (plus
 * the component mapping in `app/(app)/_components/tabs/KeepAliveTabs.tsx`).
 *
 * Registered views (P1-T02): `studio` (default) and `chat`. The actual view
 * components arrive in P2-T00 (StudioView) and P2-T01 (ChatView); until then
 * the keep-alive container renders placeholders.
 *
 * Purely data — no React, no components in here (the registry stays usable
 * from tests and from the provider store).
 */
export interface ShellView {
  /** Stable view id, used for the persisted active-tab value and tab ids. */
  id: string;
  /** Label rendered on the tab bar button. */
  label: string;
  /** Left-to-right position on the tab bar. */
  order: number;
}

export const DEFAULT_VIEW_ID = 'studio';

/**
 * All registered center-column views, ordered by `order`. Studio is the
 * default; Chat is second (architecture spec §3).
 */
export const SHELL_VIEWS: readonly ShellView[] = [
  { id: 'studio', label: 'Studio', order: 0 },
  { id: 'chat', label: 'Chat', order: 1 },
];

/** True when the id names a registered view. */
export function isRegisteredView(id: string | null | undefined): id is string {
  return typeof id === 'string' && SHELL_VIEWS.some((view) => view.id === id);
}

/**
 * Resolve a (possibly persisted, possibly stale) view id to a registered one.
 * Unknown/stale ids — e.g. localStorage from a build where a view was
 * renamed — fall back to the stable default (`studio`), mirroring the harness
 * `resolveActiveView` fallback.
 */
export function resolveActiveView(selectedId: string | null | undefined): string {
  if (isRegisteredView(selectedId)) return selectedId;
  return DEFAULT_VIEW_ID;
}
