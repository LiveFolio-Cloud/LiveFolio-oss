import { ImageResponse } from 'next/og';
import { getProjectForShare } from '@/lib/db';
import FolioPoster, { FolioStat } from '@/components/og/folio-poster';
import { loadBrandFonts, CHROME_TEXT, FOLIO_MODE_LABELS } from '@/components/og/kit';

export const contentType = 'image/png';
export const size = { width: 1200, height: 630 };

/* ------------------------------------------------------------------ */
/*  Share OG image — v2 dynamic folio poster.                          */
/*                                                                     */
/*  Same data as before (mode glyph or the creator's custom thumbnail, */
/*  screens/views stats) rendered in the light-editorial language.     */
/* ------------------------------------------------------------------ */

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Scrapers sometimes hit the route with an empty/missing id — never let
  // that reach the slug resolver (extractUUIDFromSlug crashes on undefined).
  const project = id ? await getProjectForShare(id) : null;

  const title = project?.title || 'LiveFolio';
  const description = project?.description || 'A living canvas published on LiveFolio.';
  const mode = (project?.projectMode as string) || 'document';
  const pill = FOLIO_MODE_LABELS[mode] || 'Interactive folio';

  const latestVersion = project?.versions?.[project.versions.length - 1];
  const screenCount = latestVersion ? Object.keys(latestVersion.files).length : null;
  const viewCount = project?.analytics?.views;
  // Custom creator thumbnail (paid-gating feature). Only absolute http(s)
  // URLs are rendered — anything else falls back to the abstract preview
  // (crash-guard: a bad thumbnail must never 500 the OG route).
  const thumbnailUrl =
    project?.thumbnailUrl && /^https?:\/\//.test(project.thumbnailUrl) ? project.thumbnailUrl : null;

  const displayTitle = title.length > 45 ? title.slice(0, 42) + '...' : title;
  const displayDesc = description.length > 110 ? description.slice(0, 107) + '...' : description;

  const stats: FolioStat[] = [];
  if (screenCount != null) {
    stats.push({ value: String(screenCount), label: screenCount === 1 ? 'Screen' : 'Screens' });
  }
  if (viewCount != null && viewCount > 0) {
    stats.push({ value: viewCount.toLocaleString(), label: viewCount === 1 ? 'View' : 'Views' });
  }

  // Text content for the Google-fallback subset
  const fontText = [
    displayTitle,
    displayDesc,
    pill,
    'LiveFolio',
    'livefolio.cloud',
    'Interactive HTML folios',
    ...stats.flatMap((s) => [s.value, s.label]),
    CHROME_TEXT,
  ].join('');

  const fonts = await loadBrandFonts([
    { weight: 900, text: fontText },
    { weight: 700, text: fontText },
    { weight: 600, text: fontText },
    { weight: 500, text: fontText },
  ]);

  return new ImageResponse(
    <FolioPoster
      pill={pill}
      title={displayTitle}
      description={displayDesc}
      mode={mode}
      thumbnailUrl={thumbnailUrl}
      stats={stats}
      footerRight="Interactive HTML folios"
    />,
    {
      ...size,
      fonts,
    }
  );
}
