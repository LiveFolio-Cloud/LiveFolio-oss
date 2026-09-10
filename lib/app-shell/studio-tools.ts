/**
 * Studio canvas tools — the single source of truth for the three in-folio
 * tool modes (drop-a-note, direct visual edit, AI polish) shared by the
 * desktop canvas buttons and the mobile radial dial.
 *
 * Before this file existed, each surface re-declared the same actions with
 * different names and icons (toolbar chips vs. the floating trio vs. the FAB
 * rows) — that drift is what made the trio's icons read as Chat / magic-wand
 * / game-crosshair. Icons here are chosen to not collide with any other
 * icon in the shell: chat bubbles stay reserved for the Chat tab and the
 * Discuss/Pins chips.
 *
 * Consumers: `StudioView` (desktop trio + active-tool hint) and
 * `StudioRadialDial` (mobile fan + trigger state).
 */
import type { LucideIcon } from 'lucide-react';
import { Pin, PencilLine, Sparkles } from 'lucide-react';

export type StudioToolId = 'comment' | 'edit' | 'polish';

export interface StudioToolDef {
  id: StudioToolId;
  /** Short verb shown on mobile wedges and active states. */
  label: string;
  /** Full plain-English description — button title / aria-label. */
  title: string;
  /** One-line hint shown while the tool is active. */
  hint: string;
  icon: LucideIcon;
}

export const STUDIO_TOOLS: readonly StudioToolDef[] = [
  {
    id: 'comment',
    label: 'Comment',
    title: 'Comment — click anywhere in the folio to leave a note',
    hint: 'Click the folio to leave a note — Esc to stop',
    icon: Pin,
  },
  {
    id: 'edit',
    label: 'Edit',
    title: 'Edit — click any text or image in the folio and change it',
    hint: 'Click a text or image to edit it — Esc to stop',
    icon: PencilLine,
  },
  {
    id: 'polish',
    label: 'Fix with AI',
    title: 'Fix with AI — click an element and ask AI to improve it',
    hint: 'Click an element to fix it with AI — Esc to stop',
    icon: Sparkles,
  },
];

export function getStudioTool(id: StudioToolId | null | undefined): StudioToolDef | null {
  if (!id) return null;
  return STUDIO_TOOLS.find((t) => t.id === id) ?? null;
}
