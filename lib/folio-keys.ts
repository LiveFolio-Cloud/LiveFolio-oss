/**
 * Invisible trace markers for paid-folio copies (buyer tracing).
 *
 * Every HTML page a buyer receives — live granted views, duplicated
 * copies, downloaded ZIPs — is stamped with an opaque marker comment:
 *
 *     <!-- lf-trace:TOKEN -->
 *
 * The token is AES-256-GCM over {folio, user, kind, ts} under a server
 * secret, so it needs no lookup table: when a leaked copy shows up
 * anywhere, the seller pastes it into POST /api/files/[id]/trace and gets
 * back who bought it, when, and through which channel (live / copy /
 * download). This is deterrence the way stock-photo sites do it: a leak
 * has a personal cost and an audit trail.
 *
 * Zero imports (node:crypto only) so the file syncs cleanly to OSS, where
 * no marker is ever minted (no grants, no secret set).
 */
import crypto from 'node:crypto';

/** Marker channels. */
export type TraceChannel = 'live' | 'copy' | 'download';

/** Plaintext inside a marker token. */
export interface TracePayload {
  /** Seller folio UUID the content came from. */
  f: string;
  /** Buyer (grant holder) auth user id. */
  u: string;
  /** Channel: which surface minted the marker. */
  k: TraceChannel;
  /** Unix ms. */
  t: number;
}

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const MAX_TOKEN_LENGTH = 512;

let warned = false;

function secretKey(): Buffer | null {
  const secret = process.env.FOLIO_MARKER_SECRET || process.env.FOLIO_TOKEN_SECRET || '';
  if (secret && secret.length >= 16) return Buffer.from(secret);
  if (!warned) {
    warned = true;
    console.warn(
      '[folio-keys] FOLIO_MARKER_SECRET (or FOLIO_TOKEN_SECRET) is not set — trace markers are disabled. ' +
        'Set it in production to enable buyer tracing.'
    );
  }
  return null;
}

/** Encrypt a payload into a marker token, or null when unconfigured. */
export function encryptTracePayload(payload: TracePayload): string | null {
  const key = secretKey();
  if (!key) return null;
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString('base64url');
}

/** Decrypt a marker token; null on any failure (wrong secret, tampering). */
export function decryptTracePayload(token: string): TracePayload | null {
  const key = secretKey();
  if (!key || !token || token.length > MAX_TOKEN_LENGTH) return null;
  try {
    const buf = Buffer.from(token, 'base64url');
    if (buf.length < IV_LEN + TAG_LEN + 8) return null;
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(buf.length - TAG_LEN);
    const ct = buf.subarray(IV_LEN, buf.length - TAG_LEN);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    const p = JSON.parse(plain) as Record<string, unknown>;
    if (typeof p.f !== 'string' || typeof p.u !== 'string' || typeof p.t !== 'number') return null;
    if (p.k !== 'live' && p.k !== 'copy' && p.k !== 'download') return null;
    return { f: p.f, u: p.u, k: p.k, t: p.t };
  } catch {
    return null;
  }
}

/** Marker constant shared by embed + extract (keep in sync!). */
export const TRACE_MARKER_PREFIX = 'lf-trace:';

/**
 * Embed a trace marker into an HTML document (comment + head meta, so both
 * view-source and saved files carry it). Returns the html unchanged when the
 * secret is unconfigured or the input is not HTML.
 */
export function embedTraceMarker(
  html: string,
  payload: TracePayload
): string {
  if (!/<\/?html|<\/body/i.test(html)) return html;
  const token = encryptTracePayload(payload);
  if (!token) return html;
  const comment = `<!-- ${TRACE_MARKER_PREFIX}${token} -->`;
  const meta = `<meta name="lf-trace" content="${token}">`;
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${meta}\n${comment}\n</head>`);
  }
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${comment}\n</body>`);
  }
  return html + comment;
}

/** Extract every marker token from a leaked document (any HTML/JS text). */
export function extractTraceTokens(text: string): string[] {
  const tokens: string[] = [];
  const re = /lf-trace:([A-Za-z0-9_-]{16,})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    tokens.push(m[1]);
  }
  return tokens;
}
