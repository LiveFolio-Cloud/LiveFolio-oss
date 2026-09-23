/**
 * `/app/inbox` — cross-folio feedback across every folio the user can see.
 *
 * A sibling of `/app`, not a child of it: this route is a destination in the
 * sidebar's primary nav, not a folio selection. No FolioProvider is mounted
 * here — the Inbox reads the aggregated `/api/inbox` feed, never a folio store.
 */
import InboxView from '../../_components/inbox/InboxView';

export default function InboxPage() {
  return <InboxView />;
}
