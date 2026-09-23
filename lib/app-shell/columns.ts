/**
 * Pure concession-chain column solver for the three-column AppShellFrame.
 *
 * Ported from the deepseek-harness `ui-layout` package (`columns.ts`), adapted
 * to this repo's conventions (Tailwind v4, no CSS modules).
 *
 * Chain order is fixed by contract: keep center >= CENTER_MIN by shrinking
 * details, then auto-closing it (derived zero width — preferred width
 * preferences are never rewritten, so widening the window restores them).
 * The sidebar never concedes: its rendered width is always the drag
 * preference (or the collapsed rail), and center absorbs any remaining
 * deficit as the last resort. Inputs are the layout store's plain width
 * preferences (0 = closed); a closed sidebar resolves to the fixed
 * SIDEBAR_COLLAPSED control rail while closed details resolve to zero width.
 * The SIDEBAR_AUTO_COLLAPSE breakpoint is consumed by AppShellFrame, which
 * decides the effective sidebar preference before solving; the solver itself
 * stays breakpoint-free.
 */

/** Resolved widths for one frame; center may drop below CENTER_MIN only at the final fallback. */
export interface Columns {
  sidebar: number;
  center: number;
  details: number;
}

// Contract-frozen geometry: the three-column concession chain's fixed points.
/** Center column floor; only the final fallback may go below it. */
export const CENTER_MIN = 640;
/** Sidebar drag clamp floor. */
export const SIDEBAR_MIN = 264;
/** Sidebar drag clamp ceiling. */
export const SIDEBAR_MAX = 420;
/** Sidebar width before any user drag. */
export const SIDEBAR_DEFAULT = 280;
/** Closed-sidebar rail: a 56px icon column (24px icons between 16px gutters). */
export const SIDEBAR_COLLAPSED = 56;
/** Viewport width below which the sidebar auto-collapses to the rail.
 * Kept equal to PHONE_BREAKPOINT: the old 768–1024 auto-collapse band is
 * gone — every non-phone viewport keeps the sidebar at its preference
 * (open by default on refresh; manual collapse still yields the rail). */
export const SIDEBAR_AUTO_COLLAPSE = 768;
/** Viewport width below which the shell is a phone: sidebar hidden entirely,
 * opened on demand as a full-screen drawer (no rail). */
export const PHONE_BREAKPOINT = 768;
/** Informational sidebar width handed to the drawer-mounted slot (the panel
 * renders w-full; this caps the render-prop width on small screens). */
export const MOBILE_DRAWER_MAX = 320;
/** Details drag clamp floor. */
export const DETAILS_MIN = 300;
/** Details drag clamp ceiling. */
export const DETAILS_MAX = 520;
/** Details width before any user drag. */
export const DETAILS_DEFAULT = 360;

/**
 * Clamp a panel width into its contract range.
 * @param px - requested width.
 * @param min - range lower bound.
 * @param max - range upper bound.
 * @returns the clamped, rounded width.
 */
export function clampWidth(px: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(px)));
}

/**
 * Solve the three column widths for one viewport frame. Pure: no hysteresis —
 * the output is a function of (viewport, preferences) only, so recovery on
 * re-widening is automatic. Preferences re-clamp here because they cross the
 * store boundary and callers may still supply stale ranges.
 * @param viewport - available frame width in px.
 * @param sidebar - sidebar width preference in px (0 = collapsed).
 * @param details - details width preference in px (0 = closed).
 * @returns resolved widths; details 0 means visually closed (never unmounted),
 * while a collapsed sidebar keeps its compact rail.
 */
export function computeColumns(viewport: number, sidebar: number, details: number): Columns {
  // The sidebar is fixed at its preference (or the rail) — it never concedes.
  const s = sidebar === 0 ? SIDEBAR_COLLAPSED : clampWidth(sidebar, SIDEBAR_MIN, SIDEBAR_MAX);
  const d0 = details === 0 ? 0 : clampWidth(details, DETAILS_MIN, DETAILS_MAX);

  // Step 1: everything fits at preferred widths.
  if (s + d0 + CENTER_MIN <= viewport) return { sidebar: s, center: viewport - s - d0, details: d0 };

  // Step 2: shrink details toward its minimum.
  const d1 = d0 === 0 ? 0 : Math.max(DETAILS_MIN, viewport - s - CENTER_MIN);
  if (s + d1 + CENTER_MIN <= viewport) return { sidebar: s, center: CENTER_MIN, details: d1 };

  // Step 3: auto-close details (derived — preferences untouched); center
  // absorbs any remaining deficit (may drop below CENTER_MIN).
  return { sidebar: s, center: Math.max(0, viewport - s), details: 0 };
}
