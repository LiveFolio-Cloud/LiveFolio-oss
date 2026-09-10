/* ------------------------------------------------------------------ */
/*  FolioPoster — the shared dynamic folio/workspace OG layout.        */
/*                                                                     */
/*  Used by /share/*, /@user/<folio-slug> and /@user/w/<workspace>     */
/*  so every folio share link renders the same v2 poster language.     */
/* ------------------------------------------------------------------ */

import {
  BONE,
  INK,
  VERMILLION,
  HAIRLINE,
  FONT_DISPLAY,
  Mark,
  BrandLockup,
  Rule,
  ModeGlyph,
} from './kit';

export interface FolioStat {
  value: string;
  label: string;
}

export interface FolioPosterProps {
  /** Pill text, e.g. "Presentation deck" or "Curated workspace". */
  pill: string;
  title: string;
  description: string;
  /** Right-card visual: custom thumbnail URL, else the mode glyph. */
  thumbnailUrl: string | null;
  mode: string;
  stats?: FolioStat[];
  /** Footer right-hand label, e.g. "By @username". */
  footerRight: string;
}

export default function FolioPoster({
  pill,
  title,
  description,
  thumbnailUrl,
  mode,
  stats = [],
  footerRight,
}: FolioPosterProps) {
  return (
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
          padding: '46px 72px 0 72px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <Mark size={12} />
          <span style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1 }}>
            LiveFolio
          </span>
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(15, 15, 13, 0.35)', letterSpacing: '-0.01em' }}>
          livefolio.cloud
        </span>
      </div>

      {/* ── Body: metadata column + preview card ── */}
      <div
        style={{
          display: 'flex',
          flex: 1,
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 56,
          padding: '0 72px',
        }}
      >
        {/* LEFT — metadata */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          {/* Mode pill */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              alignSelf: 'flex-start',
              padding: '7px 14px',
              borderRadius: 999,
              backgroundColor: 'rgba(255, 59, 0, 0.08)',
            }}
          >
            <Mark size={6} />
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: VERMILLION,
                letterSpacing: '-0.01em',
                lineHeight: 1,
              }}
            >
              {pill}
            </span>
          </div>

          {/* Title */}
          <div
            style={{
              marginTop: 18,
              fontSize: 46,
              fontWeight: 900,
              lineHeight: 1.04,
              letterSpacing: '-0.035em',
            }}
          >
            {title}
          </div>

          {/* Description */}
          <div
            style={{
              marginTop: 13,
              fontSize: 16,
              fontWeight: 500,
              lineHeight: 1.5,
              color: 'rgba(15, 15, 13, 0.5)',
              maxWidth: 540,
            }}
          >
            {description}
          </div>

          {/* Stats row */}
          {stats.length > 0 && (
            <div style={{ display: 'flex', gap: 40, marginTop: 24 }}>
              {stats.map((s) => (
                <div key={s.label} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 25, fontWeight: 900, letterSpacing: '-0.02em' }}>{s.value}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(15, 15, 13, 0.35)' }}>{s.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT — custom thumbnail or abstract glyph */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div
            style={{
              width: 372,
              height: 372,
              borderRadius: 20,
              border: `1px solid ${HAIRLINE}`,
              backgroundColor: '#FFFFFF',
              boxShadow: '0 1px 2px rgba(15, 15, 13, 0.04)',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumbnailUrl}
                width={372}
                height={372}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <div style={{ display: 'flex', width: '100%', height: '100%', padding: 26 }}>
                <ModeGlyph mode={mode} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Hairline rule + brand lockup ── */}
      <div style={{ display: 'flex', margin: '0 72px' }}>
        <Rule margin="0" />
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '18px 72px 42px 72px',
        }}
      >
        <BrandLockup fontSize={15} markSize={9} />
        <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(15, 15, 13, 0.4)', letterSpacing: '-0.01em' }}>
          {footerRight}
        </span>
      </div>
    </div>
  );
}
