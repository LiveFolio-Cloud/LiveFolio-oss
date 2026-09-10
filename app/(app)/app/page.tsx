/**
 * `/app` — no folio selected. Renders inside the AppShellFrame center slot.
 * The creation hero (P2-T01): ChatView in hero mode — a fork of the
 * dashboard's DashboardChat behavior (creation via POST /api/files/ai-create,
 * template chips, design drawer, auto-create toggle). No folio is selected,
 * so no FolioProvider is mounted here; the hero never touches the folio store.
 */
import { ChatView } from '../_components/chat-view/ChatView';

export default function AppHomePage() {
  return (
    <main className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <ChatView mode="hero" />
    </main>
  );
}
