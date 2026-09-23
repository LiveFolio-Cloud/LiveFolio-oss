import fs from 'fs';
import path from 'path';
import { buildAssetPointer, hashAssetBytes } from '@/lib/mime';

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
  const hash = hashAssetBytes(buf);
  const pointer = buildAssetPointer(hash, ext);
  const dir = path.join(ASSET_DIR, folioId);
  ensureDir(dir);
  const filePath = path.join(dir, `${hash}${ext}`);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, buf);
  }
  return { pointer, hash, size: buf.length };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- OSS stub mirrors the cloud export surface; org scope param unused (disk cleanup is local)
export async function deleteFolioAssets(folioId: string, _orgId: string): Promise<void> {
  assertSafeFolioId(folioId);
  const dir = path.join(ASSET_DIR, folioId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
