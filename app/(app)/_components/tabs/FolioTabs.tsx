'use client';

/**
 * The `/app/[folioId]` center-column content — the "tab container": per-folio
 * provider + tab bar + keep-alive view container. Rendered by
 * `app/(app)/app/[folioId]/page.tsx` (which P1-T00's placeholder page hands
 * off to).
 *
 * The provider is KEYED by folioId: navigating /app/a → /app/b without a full
 * reload re-renders this component with a new prop, and the key forces a fresh
 * provider (fresh per-folio store, fresh persisted-slice read, auto-fetch of
 * the new folio) instead of leaking folio A's state into folio B.
 */
import { FolioProvider } from '../folio-provider/FolioProvider';
import { FolioHeader } from './FolioHeader';
import { KeepAliveTabs } from './KeepAliveTabs';
import { TabBar } from './TabBar';

export function FolioTabs({ folioId }: { folioId: string }) {
  return (
    <FolioProvider key={folioId} folioId={folioId}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Order per architecture §3: header (title + status) → tabs → content. */}
        <FolioHeader />
        <TabBar />
        <KeepAliveTabs />
      </div>
    </FolioProvider>
  );
}
