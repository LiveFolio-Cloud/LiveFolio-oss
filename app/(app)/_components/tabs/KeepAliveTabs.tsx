'use client';

/**
 * Keep-alive tab container (the locked decision): renders EVERY
 * registered view, all of them MOUNTED; the inactive ones are hidden with CSS
 * `display: none` on the wrapper. This is what keeps the FolioView iframe
 * (`#folio-sandbox-iframe`) alive across tab switches — its browsing
 * context, loaded HTML, running JS and scroll position survive because the
 * element is never removed from the DOM.
 *
 * Each view gets an absolutely-positioned panel so all panels share the same
 * box; hidden panels take no layout. The wrapper element for the hidden view
 * stays in the tree (devtools: element present with `display: none`), and the
 * panel remains part of the accessibility tree only while active (display:none
 * removes it from AT).
 *
 * View → component mapping lives here; the real views replace the
 * placeholder branches with FolioView / ChatView.
 */
import { SHELL_VIEWS } from '@/lib/app-shell/views';
import { useFolioStore } from '../folio-provider/FolioProvider';
import { FolioView } from '../folio-view/FolioView';
import { ChatView } from '../chat-view/ChatView';

export function KeepAliveTabs() {
  const view = useFolioStore((s) => s.view);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      {SHELL_VIEWS.map((tab) => {
        const active = tab.id === view;
        return (
          <div
            key={tab.id}
            id={`app-panel-${tab.id}`}
            role="tabpanel"
            aria-labelledby={`app-tab-${tab.id}`}
            // CSS-hide, do NOT unmount (verified empirically
            // with the spike recipe — fallback unmount+restore only if a
            // target browser proves problematic).
            style={active ? undefined : { display: 'none' }}
            className="absolute inset-0 flex flex-col overflow-hidden"
          >
            <TabPanelView viewId={tab.id} />
          </div>
        );
      })}
    </div>
  );
}

function TabPanelView({ viewId }: { viewId: string }) {
  switch (viewId) {
    case 'editor':
      // FolioView — fork of the legacy editor (canvas + keep-alive iframe),
      // chat/AI lobe lives in the provider store (see folio-view/FolioView.tsx).
      return <FolioView />;
    case 'chat':
      // The unified ChatView — folio mode (editing chat), wired to
      // the per-folio provider store (sendPrompt/clearChat/commitProposal,
      // tool calls, proposals, draft/scroll persistence).
      return <ChatView mode="folio" />;
    default:
      return null;
  }
}
