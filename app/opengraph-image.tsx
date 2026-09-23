import { ImageResponse } from 'next/og';
import {
  BONE,
  INK,
  VERMILLION,
  FONT_DISPLAY,
  Mark,
  Chip,
  Rule,
  loadBrandFonts,
  CHROME_TEXT,
} from '@/components/og/kit';

export const runtime = 'edge';
export const contentType = 'image/png';
export const size = { width: 1200, height: 630 };

/* ------------------------------------------------------------------ */
/*  Default OG image — v2 light-editorial brand poster.                */
/*                                                                     */
/*  The site-wide fallback preview (root, marketing, docs, explore…).  */
/*  Bone canvas · Cabinet Grotesk ink headline · vermillion accents —  */
/*  the language of the public pages, not the old brutalist stack.     */
/* ------------------------------------------------------------------ */

export default async function Image() {
  const headlineA = 'Your Ideas,';
  const headlineB = 'Alive.';
  const sub = 'AI agents publish interactive HTML folios in seconds — share, version, and collaborate.';
  const chip = 'MCP · AI-native publishing';

  const fontText = [
    headlineA,
    headlineB,
    sub,
    'LiveFolio',
    'livefolio.cloud',
    chip,
    CHROME_TEXT,
  ].join('');

  const fonts = await loadBrandFonts([
    { weight: 900, text: fontText },
    { weight: 600, text: fontText },
    { weight: 500, text: fontText },
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: BONE,
          color: INK,
          fontFamily: FONT_DISPLAY,
          position: 'relative',
        }}
      >
        {/* ── Brand row ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '52px 76px 0 76px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <Mark size={12} />
            <span style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1 }}>
              LiveFolio
            </span>
          </div>
          {/* bare accent dot — the same quiet vermillion pulse as the navs */}
          <Mark size={8} />
        </div>

        {/* ── Headline — centered vertically in the remaining air ── */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            flex: 1,
            padding: '0 76px',
          }}
        >
          <div style={{ fontSize: 92, fontWeight: 900, letterSpacing: '-0.045em', lineHeight: 0.98 }}>
            {headlineA}
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              fontSize: 92,
              fontWeight: 900,
              letterSpacing: '-0.045em',
              lineHeight: 0.98,
            }}
          >
            <span>Alive</span>
            <span style={{ color: VERMILLION }}>.</span>
          </div>
          <div
            style={{
              marginTop: 34,
              fontSize: 21,
              fontWeight: 500,
              lineHeight: 1.5,
              color: 'rgba(15, 15, 13, 0.55)',
              maxWidth: 660,
            }}
          >
            {sub}
          </div>
        </div>

        {/* ── Hairline rule + meta row ── */}
        <div style={{ display: 'flex', margin: '0 76px' }}>
          <Rule />
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px 76px 46px 76px',
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(15, 15, 13, 0.35)', letterSpacing: '-0.01em' }}>
            livefolio.cloud
          </span>
          <Chip label={chip} fontSize={12} />
        </div>
      </div>
    ),
    {
      ...size,
      fonts,
    }
  );
}
