/**
 * `/app/[folioId]` — a folio is selected. Renders the tab container
 * (P1-T02) inside the AppShellFrame center slot: per-folio provider +
 * role="tablist" bar + keep-alive Studio/Chat panels (placeholders until
 * P2-T00/P2-T01). The provider fetches `/api/files/[id]` on mount.
 * force-dynamic mirrors the studio route's rendering mode (the fetch happens
 * client-side through the provider).
 */
import { FolioTabs } from '../../_components/tabs/FolioTabs';

export const dynamic = 'force-dynamic';
export const dynamicParams = true;
export const revalidate = 0;

export default async function FolioPage({
  params,
}: {
  params: Promise<{ folioId: string }>;
}) {
  const { folioId } = await params;

  return <FolioTabs folioId={folioId} />;
}
