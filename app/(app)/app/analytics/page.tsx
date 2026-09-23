/**
 * `/app/analytics` — creator analytics.
 *
 * Promoted out of the settings modal: it is a surface you check repeatedly to
 * answer "is this working?", and burying a recurring surface behind one you
 * configure once is why people report not finding it. The publish/privacy
 * switches that used to share the section stayed behind in settings
 * (Publishing) — reading and governance are different jobs.
 */
import AnalyticsView from '../../_components/analytics/AnalyticsView';

export default function AnalyticsPage() {
  return <AnalyticsView />;
}
