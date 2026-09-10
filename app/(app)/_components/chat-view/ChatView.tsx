'use client';

/**
 * Unified ChatView (P2-T01) — one component, two modes (arch §5):
 *
 * - `mode="folio"` — a folio is selected: the Chat tab renders
 *   `FolioChatPanel` (fork of `components/studio/ChatPanel.tsx` re-wired to
 *   the per-folio provider store — editing chat via the store's `sendPrompt`
 *   streaming pipeline, tool calls, proposals). Must be rendered inside
 *   `<FolioProvider>` (the keep-alive tab container does this).
 * - `mode="hero"` — no folio: the `/app` page renders the AI creation hero
 *   in Cloud (`ChatHero` — `POST /api/files/ai-create`, template chips,
 *   auto-create; navigates to `/app/<newId>`), and the local start page in
 *   OSS (`OssHome` — key/model ask + folio list; creation and chat are
 *   Cloud or per-folio features locally).
 *
 * The hero mode does NOT touch the folio store (no folio is selected), so it
 * can be rendered outside `FolioProvider`.
 */
import { isOSS } from '@/lib/env';
import { FolioChatPanel } from './FolioChatPanel';
import { ChatHero } from './ChatHero';
import { OssHome } from './OssHome';

export function ChatView({ mode }: { mode: 'hero' | 'folio' }) {
  if (mode === 'folio') return <FolioChatPanel />;
  // Inlined at build time — Cloud ships ChatHero, OSS ships OssHome.
  return isOSS ? <OssHome /> : <ChatHero />;
}
