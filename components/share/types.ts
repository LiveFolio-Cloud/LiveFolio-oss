/**
 * Shared gate types for the share-viewer paywall surface.
 *
 * `GatePaidAccess` mirrors what `GET /api/files/[id]/public` returns: the
 * resolved gate config minus secrets and the `enabled` master switch — its
 * presence in the payload means "this folio has an effective gate".
 */
export type ViewerAccess = 'owner' | 'granted' | 'preview' | 'none';

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
