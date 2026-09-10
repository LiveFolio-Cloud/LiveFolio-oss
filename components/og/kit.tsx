/* ------------------------------------------------------------------ */
/*  OG image kit — the v2 light-editorial design language              */
/*                                                                     */
/*  Shared building blocks for every opengraph-image renderer so the   */
/*  whole platform's link previews speak one visual language:          */
/*  bone canvas · ink type in Cabinet Grotesk · vermillion accents ·   */
/*  hairline rings · rounded geometry. No borders, no rotations,       */
/*  no uppercase-mono labels (v2 killed the brutalism).                */
/* ------------------------------------------------------------------ */

export const BONE = '#F4F4F0';
export const INK = '#0F0F0D';
export const VERMILLION = '#FF3B00';

/** Hairline ring/dividers — v2 uses `ring-[#0F0F0D]/5…/10` equivalents. */
export const HAIRLINE = 'rgba(15, 15, 13, 0.08)';
export const HAIRLINE_SOFT = 'rgba(15, 15, 13, 0.05)';

/** Font stack mirrored on the CSS side (image layers have Cabinet embedded). */
export const FONT_DISPLAY = '"Cabinet Grotesk", "Space Grotesk", sans-serif';

/** Folio mode → poster pill labels. */
export const FOLIO_MODE_LABELS: Record<string, string> = {
  deck: 'Presentation deck',
  document: 'Rich document',
  spreadsheet: 'Live spreadsheet',
  dashboard: 'Admin dashboard',
  infography: 'Visual data story',
};

type OGWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

export interface OGTypeFace {
  name: 'Cabinet Grotesk' | 'Space Grotesk';
  data: ArrayBuffer;
  weight: OGWeight;
  style: 'normal' | 'italic';
}

/* ------------------------------------------------------------------ */
/*  Brand font loading                                                 */
/*                                                                     */
/*  Cabinet Grotesk ships from Fontshare (not Google Fonts), so the    */
/*  loader knows both sources. Fontshare serves full files per weight  */
/*  (no text subsetting) — if Fontshare hiccups we degrade to Space    */
/*  Grotesk (Google, subsetted) so a preview never ships without the   */
/*  brand type.                                                        */
/* ------------------------------------------------------------------ */

const FONT_CACHE_REVALIDATE = 86400;

async function fetchFontFile(url: string): Promise<ArrayBuffer | null> {
  try {
    return await fetch(url, { next: { revalidate: FONT_CACHE_REVALIDATE } }).then((r) =>
      r.ok ? r.arrayBuffer() : null
    );
  } catch {
    return null;
  }
}

/** Google css2 only hands out woff2 to real browsers — send one. */
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/** Clean a css `url(...)` capture: strip quotes + whitespace, fix scheme. */
function cleanCssUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/^['"]|['"]$/g, '');
  if (!trimmed) return null;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return null;
}

/**
 * Parse a css document into per-@font-face blocks.
 *
 * IMPORTANT: this Next/ImageResponse build cannot parse WOFF2 ("Unsupported
 * OpenType signature wOF2"), so we only ever pick truetype/opentype/woff and
 * never woff2.
 *
 * Fontshare's css2 API decorates the requested face with pairing faces from
 * OTHER families (e.g. cabinet-grotesk@900 returns Cabinet Grotesk 900 plus a
 * block of General Sans fallbacks). A whole-document "last url per format"
 * pick therefore grabs the wrong family's file (a variable TTF) and crashes
 * the ImageResponse layout with `Cannot read properties of undefined` — so
 * each face's urls are kept in their own block and selection is scoped to the
 * block whose family+weight match the request.
 */
interface ParsedFace {
  /** Normalized family token (lowercased, stripped of spaces/quotes/+). */
  family: string;
  /** Fixed weight, or null for variable/range faces. */
  weight: number | null;
  weightMin: number | null;
  weightMax: number | null;
  /** url per supported format, present only if offered. */
  truetype: string | null;
  opentype: string | null;
  woff: string | null;
}

const FACE_BLOCK_RE = /@font-face\s*\{([^}]*)\}/g;
const URL_RE = /url\(\s*['"]?([^'")]+)['"]?\s*\)\s*format\(['"]([a-z0-9]+)['"]\)/g;

/** 'Cabinet Grotesk' / 'Space+Grotesk' / 'cabinet-grotesk' → comparable token. */
function familyToken(name: string): string {
  return name.toLowerCase().replace(/[\s+'"]/g, '');
}

function parseCssFaces(css: string): ParsedFace[] {
  const faces: ParsedFace[] = [];
  let block: RegExpExecArray | null;
  while ((block = FACE_BLOCK_RE.exec(css)) !== null) {
    const body = block[1];
    const face: ParsedFace = {
      family: '',
      weight: null,
      weightMin: null,
      weightMax: null,
      truetype: null,
      opentype: null,
      woff: null,
    };
    const fam = body.match(/font-family:\s*['"]?([^;'"}]+)/i);
    if (fam) face.family = familyToken(fam[1].trim());
    const w = body.match(/font-weight:\s*([0-9]+(?:\s+[0-9]+)?)/i);
    if (w) {
      const nums = w[1].trim().split(/\s+/).map(Number);
      face.weight = nums.length === 1 ? nums[0] : null;
      face.weightMin = nums.length === 1 ? nums[0] : nums[0];
      face.weightMax = nums.length === 1 ? nums[0] : nums[nums.length - 1];
    }
    let u: RegExpExecArray | null;
    while ((u = URL_RE.exec(body)) !== null) {
      const url = cleanCssUrl(u[1]);
      if (!url) continue;
      if (u[2] === 'truetype') face.truetype ??= url;
      else if (u[2] === 'opentype') face.opentype ??= url;
      else if (u[2] === 'woff') face.woff ??= url;
    }
    if (face.truetype || face.opentype || face.woff) faces.push(face);
  }
  return faces;
}

function pickBestFontUrl(css: string, family: string, weight: number): string | null {
  const faces = parseCssFaces(css);
  if (faces.length === 0) return null;
  const token = familyToken(family);
  let pool = faces.filter((f) => f.family === token);
  if (pool.length === 0) pool = faces; // unknown family — take whatever it gave us
  const exact = pool.find((f) => f.weight === weight);
  const inRange = pool.find(
    (f) => f.weightMin !== null && f.weightMax !== null && f.weightMin! <= weight && weight <= f.weightMax!
  );
  const face = exact ?? inRange ?? pool[0];
  return face.truetype ?? face.opentype ?? face.woff ?? null;
}

/** Fontshare css → best font url (css lists woff2/woff/ttf per face). */
async function loadFontshareCss(weight: number, family: string): Promise<ArrayBuffer | null> {
  try {
    const cssUrl = `https://api.fontshare.com/v2/css?f[]=${encodeURIComponent(family)}@${weight}&display=swap`;
    const css = await fetch(cssUrl, { next: { revalidate: FONT_CACHE_REVALIDATE } }).then((r) =>
      r.ok ? r.text() : null
    );
    if (!css) return null;
    const url = pickBestFontUrl(css, family, weight);
    return url ? fetchFontFile(url) : null;
  } catch {
    return null;
  }
}

/** Google Fonts css2 — subsetted to the exact glyphs used. */
async function loadGoogleCss(family: string, weight: number, text: string): Promise<ArrayBuffer | null> {
  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&text=${encodeURIComponent(text)}`;
    const css = await fetch(cssUrl, {
      next: { revalidate: FONT_CACHE_REVALIDATE },
      headers: { 'user-agent': BROWSER_UA },
    }).then((r) => (r.ok ? r.text() : null));
    if (!css) return null;
    const url = pickBestFontUrl(css, family, weight);
    return url ? fetchFontFile(url) : null;
  } catch {
    return null;
  }
}

/**
 * Load one weight of the brand typeface, falling back Cabinet → Space
 * Grotesk. `text` subsets the Google fallback only.
 */
export async function loadBrandFont(weight: 500 | 600 | 700 | 800 | 900, text: string): Promise<OGTypeFace | null> {
  const cabinet = await loadFontshareCss(weight, 'cabinet-grotesk');
  if (cabinet) return { name: 'Cabinet Grotesk', data: cabinet, weight, style: 'normal' };
  // Cabinet has no 900 → Space Grotesk tops out at 800.
  const googleWeight = weight === 900 ? 800 : weight;
  const spaceGrotesk = await loadGoogleCss('Space+Grotesk', googleWeight, text);
  if (spaceGrotesk) return { name: 'Space Grotesk', data: spaceGrotesk, weight: googleWeight, style: 'normal' };
  return null;
}

/** All weights are embedded under a shared family name list per image. */
export async function loadBrandFonts(
  specs: Array<{ weight: 500 | 600 | 700 | 800 | 900; text: string }>
): Promise<OGTypeFace[]> {
  const loaded = await Promise.all(specs.map((s) => loadBrandFont(s.weight, s.text)));
  return loaded.filter((f): f is OGTypeFace => f !== null);
}

/** Text glyphs the default/preview chrome needs — kept in one shared pool. */
export const CHROME_TEXT = [
  'LiveFolio',
  'livefolio.cloud',
  'MCP',
  'AI-native',
  'publishing',
  'screens',
  'Screens',
  'views',
  'Views',
  'folios',
  'published',
  'on',
  'by',
  'folio',
  'interactive',
  '0123456789kM×%$.',
].join('');

/* ------------------------------------------------------------------ */
/*  Shared chrome                                                      */
/* ------------------------------------------------------------------ */

/** The LiveFolio mark: bare vermillion square (favicon), as public UI uses. */
export function Mark({ size = 12, color = VERMILLION }: { size?: number; color?: string }) {
  return <div style={{ width: size, height: size, backgroundColor: color, borderRadius: Math.max(2, size * 0.16) }} />;
}

/** v2 footer brand lockup — small mark + wordmark at hairline scale. */
export function BrandLockup({ fontSize = 15, markSize = 9 }: { fontSize?: number; markSize?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <Mark size={markSize} />
      <span style={{ fontFamily: FONT_DISPLAY, fontSize, fontWeight: 900, color: INK, letterSpacing: '-0.03em' }}>
        LiveFolio
      </span>
    </div>
  );
}

/** Tiny pill chip — hairline ring + optional accent dot (v2 pill idiom). */
export function Chip({
  label,
  dot = true,
  fontSize = 12,
}: {
  label: string;
  dot?: boolean;
  fontSize?: number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        padding: '6px 13px',
        borderRadius: 999,
        border: `1px solid ${HAIRLINE_SOFT}`,
        backgroundColor: 'rgba(255, 255, 255, 0.4)',
      }}
    >
      {dot && <Mark size={6} />}
      <span style={{ fontFamily: FONT_DISPLAY, fontSize, fontWeight: 600, color: 'rgba(15, 15, 13, 0.55)' }}>
        {label}
      </span>
    </div>
  );
}

/** 1px hairline rule across a content column. */
export function Rule({ color = HAIRLINE, margin = '22px 0 0 0' }: { color?: string; margin?: string }) {
  return <div style={{ width: '100%', height: 1, backgroundColor: color, margin }} />;
}

/** Mode → minimal glyph panels. Cleaner re-draws of the v2 product cards. */
export function ModeGlyph({ mode }: { mode: string }) {
  const card = {
    width: '100%',
    height: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    border: `1px solid ${HAIRLINE}`,
    boxShadow: '0 1px 2px rgba(15, 15, 13, 0.04)',
    display: 'flex' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    overflow: 'hidden' as const,
    padding: 26,
  };

  const bar = (w: number, h: number, o: number, c = INK) => ({
    width: w,
    height: h,
    borderRadius: 3,
    backgroundColor: c,
    opacity: o,
  });

  switch (mode) {
    case 'deck':
      return (
        <div style={card}>
          <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 14 }}>
            {/* inner slide — layered, no rotation */}
            <div style={{ width: '100%', padding: 18, borderRadius: 14, backgroundColor: '#FDFDFC', border: `1px solid ${HAIRLINE_SOFT}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={bar(140, 10, 0.85)} />
              {[86, 120, 64].map((w, i) => (
                <div key={i} style={bar(w, 4, 0.12)} />
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: VERMILLION }} />
                <div style={{ display: 'flex', gap: 3, marginLeft: 4 }}>
                  {[0, 1, 2].map((i) => (
                    <div key={i} style={{ width: 14, height: 3, borderRadius: 999, backgroundColor: i === 0 ? 'rgba(15, 15, 13, 0.5)' : 'rgba(15, 15, 13, 0.12)' }} />
                  ))}
                </div>
              </div>
              <div style={bar(46, 5, 0.14)} />
            </div>
          </div>
        </div>
      );
    case 'spreadsheet':
      return (
        <div style={card}>
          <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ display: 'flex', gap: 3, marginBottom: 8 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ flex: 1, height: 18, borderRadius: 6, backgroundColor: i === 0 ? VERMILLION : 'rgba(15,15,13,0.07)' }} />
              ))}
            </div>
            {[0, 1, 2, 3].map((r) => (
              <div key={r} style={{ display: 'flex', gap: 3, marginTop: 3 }}>
                <div style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: 'rgba(15,15,13,0.10)' }} />
                <div style={{ flex: 1.4, height: 6, borderRadius: 3, backgroundColor: r === 1 ? 'rgba(255,59,0,0.35)' : 'rgba(15,15,13,0.10)' }} />
                <div style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: 'rgba(15,15,13,0.10)' }} />
              </div>
            ))}
          </div>
        </div>
      );
    case 'dashboard':
      return (
        <div style={card}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, width: '100%', height: '100%', alignContent: 'center' }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{ width: 'calc(50% - 6px)', height: 88, borderRadius: 14, border: `1px solid ${HAIRLINE}`, backgroundColor: i === 1 ? 'rgba(255, 59, 0, 0.05)' : '#FFFFFF', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 12px', gap: 6 }}>
                <div style={bar(26, 4, i === 1 ? 0.5 : 0.15)} />
                <div style={{ ...bar(44, 12, i === 1 ? 0.7 : 0.3, i === 1 ? VERMILLION : INK) }} />
              </div>
            ))}
          </div>
        </div>
      );
    case 'infography':
      return (
        <div style={card}>
          <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', justifyContent: 'center', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontFamily: FONT_DISPLAY, fontSize: 72, fontWeight: 900, color: INK, lineHeight: 0.9, letterSpacing: '-0.04em' }}>87%</span>
            </div>
            <div style={{ width: 130, height: 4, borderRadius: 999, backgroundColor: VERMILLION, opacity: 0.5 }} />
            <div style={{ display: 'flex', gap: 10, marginTop: 2 }}>
              {[38, 62, 26, 48, 20].map((w, i) => (
                <div key={i} style={{ width: w, height: 10, borderRadius: 5, backgroundColor: i === 1 ? 'rgba(255, 59, 0, 0.4)' : 'rgba(15, 15, 13, 0.10)' }} />
              ))}
            </div>
          </div>
        </div>
      );
    case 'workspace':
      // A shelf of folios — the storefront card idiom.
      return (
        <div style={card}>
          <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10 }}>
            {[
              { accent: true, w1: 120, w2: 64 },
              { accent: false, w1: 96, w2: 84 },
              { accent: false, w1: 132, w2: 48 },
            ].map((row, i) => (
              <div
                key={i}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: `1px solid ${HAIRLINE_SOFT}`,
                  backgroundColor: i === 0 ? '#FFFFFF' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <div style={{ width: 26, height: 26, borderRadius: 7, backgroundColor: row.accent ? VERMILLION : 'rgba(15, 15, 13, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ width: 9, height: 9, borderRadius: 2.5, backgroundColor: row.accent ? '#FFFFFF' : 'rgba(15, 15, 13, 0.25)' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                  <div style={bar(row.w1, 7, row.accent ? 0.7 : 0.2)} />
                  <div style={bar(row.w2, 4, 0.1)} />
                </div>
                <div style={{ width: 16, height: 16, borderRadius: 999, backgroundColor: 'rgba(15, 15, 13, 0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ width: 6, height: 6, borderTop: `1.5px solid rgba(15,15,13,0.35)`, borderRight: `1.5px solid rgba(15,15,13,0.35)`, transform: 'rotate(45deg)', marginTop: -2 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    case 'document':
    default:
      return (
        <div style={card}>
          <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 9 }}>
            <div style={bar(150, 11, 0.85)} />
            <div style={bar(104, 5, 0.12)} />
            <div style={bar(128, 5, 0.10)} />
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <div style={{ width: 4, height: 76, borderRadius: 2, backgroundColor: VERMILLION, opacity: 0.55 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center' }}>
                <div style={bar(150, 5, 0.12)} />
                <div style={bar(120, 5, 0.10)} />
                <div style={bar(136, 5, 0.08)} />
              </div>
            </div>
          </div>
        </div>
      );
  }
}
