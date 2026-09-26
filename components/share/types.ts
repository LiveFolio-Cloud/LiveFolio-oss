/**
 * Shared gate types for the share-viewer paywall surface.
 *
 * `GatePaidAccess` mirrors what `GET /api/files/[id]/public` returns: the
 * resolved gate config minus secrets and the `enabled` master switch — its
 * presence in the payload means "this folio has an effective gate".
 */
/**
 * How the gate surfaces report the viewer's standing.
 *
 * - `owner` — an org member. Also the standing a private access-key holder is
 *   reported with (the key IS the owner's act of sharing), and the legacy
 *   "there is no paywall to reconcile" sentinel the no-gate path has always
 *   returned.
 * - `granted` — a purchase grant (paid gate).
 * - `collaborator` — an active folio grant, role ≥ viewer, resolved by
 *   `resolveFolioRole`. A collaborator bypasses
 *   draft, the private access key and the paywall exactly as the owner does,
 *   but is NOT the owner — no surface may hand them owner-only chrome.
 * - `preview` — a gated reader inside their preview window.
 * - `none` — no standing: the paywall / unlock / locked surfaces.
 */
export type ViewerAccess = 'owner' | 'granted' | 'preview' | 'none' | 'collaborator';

export interface GatePaidAccess {
  /** What the gate was resolved against — the folio itself or its workspace. */
  targetType: 'folio' | 'workspace';
  priceType: 'one_time' | 'rental' | 'subscription';
  amountCents: number;
  currency: string;
  /** Rental only: access duration in days. */
  rentalDays?: number;
  previewMode: 'none' | 'timed' | 'first_page';
  /** Timed preview only: visible seconds. */
  previewSeconds?: number;
  /** Seller-controlled post-purchase actions (default off). */
  allowCopy?: boolean;
  allowDownload?: boolean;
}
