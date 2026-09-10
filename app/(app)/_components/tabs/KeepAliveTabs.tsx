'use client';

/**
 * Keep-alive tab container (spike §2 — the locked decision): renders EVERY
 * registered view, all of them MOUNTED; the inactive ones are hidden with CSS
 * `display: none` on the wrapper. This is what keeps the StudioView iframe
 * (`#studio-sandbox-iframe`, P2-T00) alive across tab switches — its browsing
 * context, loaded HTML, running JS and scroll position survive because the
 * element is never removed from the DOM.
 *
 * Each view gets an absolutely-positioned panel so all panels share the same
 * box; hidden panels take no layout. The wrapper element for the hidden view
 * stays in the tree (devtools: element present with `display: none`), and the
 * panel remains part of the accessibility tree only while active (display:none
 * removes it from AT).
 *
 * View → component mapping lives here; P2-T00 and P2-T01 replace the
 * placeholder branches with StudioView / ChatView.
 */
import { SHELL_VIEWS } from '@/lib/app-shell/views';
import { useFolioStore } from '../folio-provider/FolioProvider';
import { StudioView } from '../studio-view/StudioView';
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
            // CSS-hide, do NOT unmount (spike §2; P2-T00 verifies empirically
            // with the spike §7 recipe — fallback unmount+restore only if a
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
    case 'studio':
      // P2-T00: StudioView — fork of StudioClient (canvas + keep-alive iframe),
      // chat/AI lobe lives in the provider store (see studio-view/StudioView.tsx).
      return <StudioView />;
    case 'chat':
      // P2-T01: the unified ChatView — folio mode (editing chat), wired to
      // the per-folio provider store (sendPrompt/clearChat/commitProposal,
      // tool calls, proposals, draft/scroll persistence).
      return <ChatView mode="folio" />;
    default:
      return null;
  }
}
