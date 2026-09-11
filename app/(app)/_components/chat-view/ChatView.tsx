'use client';

/**
 * Unified ChatView (P2-T01) — one component, two modes (arch §5):
 *
 * - `mode="folio"` — a folio is selected: the Chat tab renders
 *   `FolioChatPanel` (fork of `components/studio/ChatPanel.tsx` re-wired to
 *   the per-folio provider store — editing chat via the store's `sendPrompt`
 *   streaming pipeline, tool calls, proposals). Must be rendered inside
 *   `<FolioProvider>` (the keep-alive tab container does this).
 * - `mode="hero"` — no folio: the `/app` page renders the creation hero
 *   (`ChatHero` — `POST /api/files/ai-create`, template chips, auto-create;
 *   navigates to `/app/<newId>`). Same component in both modes: Cloud resolves
 *   a managed model server-side, OSS uses the visitor's own key, and when no
 *   key is configured locally the hero asks for one inline.
 *
 * The hero mode does NOT touch the folio store (no folio is selected), so it
 * can be rendered outside `FolioProvider`.
 */
import { FolioChatPanel } from './FolioChatPanel';
import { ChatHero } from './ChatHero';

export function ChatView({ mode }: { mode: 'hero' | 'folio' }) {
  if (mode === 'folio') return <FolioChatPanel />;
  return <ChatHero />;
}
