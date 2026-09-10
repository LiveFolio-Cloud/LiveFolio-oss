import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

export interface AssetPointer {
  pointer: string;
  hash: string;
  size: number;
}

// Honor LIVEFOLIO_DATA_DIR (same contract as lib/db.ts) so standalone installs
// keep user assets outside .next/standalone/; cwd fallback when unset.
const ASSET_DIR = path.join(process.env.LIVEFOLIO_DATA_DIR || process.cwd(), 'data', 'folio-assets');

// The folio id is used as a directory component — reject anything that could
// escape the asset root (path traversal via crafted ids).
function assertSafeFolioId(folioId: string): void {
  if (!folioId || folioId.includes('/') || folioId.includes('\\') || folioId.startsWith('.')) {
    throw new Error('Invalid folio id.');
  }
}

function hashBuffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function pointerFromHash(hash: string, ext: string): string {
  return `asset://sha256-${hash}.${ext.replace('.', '')}`;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export async function putAsset(
  folioId: string,
  _orgId: string,
  buf: Buffer,
  _mime: string,
  ext: string,
): Promise<AssetPointer> {
  assertSafeFolioId(folioId);
  const hash = hashBuffer(buf);
  const pointer = pointerFromHash(hash, ext);
  const dir = path.join(ASSET_DIR, folioId);
  ensureDir(dir);
  const filePath = path.join(dir, `${hash}${ext}`);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, buf);
  }
  return { pointer, hash, size: buf.length };
}

export async function getAssetUrl(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- OSS stub mirrors the cloud export surface; params unused (no signed URLs in OSS)
  _folioId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- OSS stub mirrors the cloud export surface; params unused (no signed URLs in OSS)
  _orgId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- OSS stub mirrors the cloud export surface; params unused (no signed URLs in OSS)
  _hash: string,
): Promise<string | null> {
  // OSS serves from disk via /api/raw directly, no signed URLs needed
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- OSS stub mirrors the cloud export surface; org scope param unused (disk cleanup is local)
export async function deleteFolioAssets(folioId: string, _orgId: string): Promise<void> {
  assertSafeFolioId(folioId);
  const dir = path.join(ASSET_DIR, folioId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
