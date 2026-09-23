/**
 * `/app/chat` — the AI creation chat, as its own destination.
 *
 * This is the app's original `/app` surface (ChatView hero mode: describe a
 * folio, pick a template, watch it build). When Home became the recents grid,
 * the chat was left as a zero-folio fallback — which meant anyone with folios
 * could no longer reach it at all. It is a primary creation surface, not an
 * empty state, so it gets a permanent row in the sidebar instead.
 *
 * Home still falls back to this view at zero folios: a brand-new account
 * should land on "make something", not on an empty grid with a button.
 */
import { ChatView } from '../../_components/chat-view/ChatView';

export default function ChatPage() {
  return (
    <main className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <ChatView mode="hero" />
    </main>
  );
}
