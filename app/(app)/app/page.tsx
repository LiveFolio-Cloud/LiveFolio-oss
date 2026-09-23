/**
 * `/app` — no folio selected. Renders inside the AppShellFrame center slot.
 *
 * RecentsHome picks between the two faces of this route:
 * - **empty account** → the creation hero (ChatView hero mode: creation via
 *   POST /api/files/ai-create, template chips, design drawer, auto-create
 *   toggle) — verbatim the behaviour this page had when it was the hero outright;
 * - **account with work** → the recents grid, newest first, each card opening
 *   that folio in the editor.
 *
 * Neither branch mounts a FolioProvider — no folio is selected here, so the
 * folio store is never touched.
 */
import RecentsHome from '../_components/recents/RecentsHome';

export default function AppHomePage() {
  return <RecentsHome />;
}
