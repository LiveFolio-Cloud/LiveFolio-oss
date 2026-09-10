'use client';

/**
 * Client-side repo unpacking — extracted from app/studio/[id]/StudioClient.tsx
 * (Epic #135, spike Q2).
 *
 * Turns a ZIP archive or a picked folder (FileList) into the flat
 * `Record<string, string>` file map that `POST /api/files` `defaultFiles`
 * and the studio save path both expect: text files as strings, images as
 * base64 data URLs.
 *
 * OSS-safe: no dependencies — JSZip 3.10.1 is script-injected from cdnjs at
 * runtime (matches existing StudioClient behavior; jszip is NOT in package.json).
 * Client-only: uses window/document/FileReader. Do not import server-side.
 */

export interface UnpackResult {
  files: Record<string, string>;
  firstHtml: string | null;
  importCount: number;
}

const TEXT_EXTS = ['html', 'css', 'js', 'jsx', 'ts', 'tsx', 'json', 'svg', 'md', 'txt'];
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico'];
const EXCLUDED_DIRS = ['node_modules', '.git', '.github', '.next', '.gemini', 'dist', 'build', '__MACOSX'];

/** 5 MB per-file cap — applied to BOTH the folder and ZIP paths (spike parity fix). */
export const MAX_UNPACK_FILE_SIZE = 5 * 1024 * 1024;

/** Minimal JSZip 3.x surface we rely on (loaded from CDN, no type package). */
interface JSZipEntry {
  dir: boolean;
  async(type: 'string' | 'base64'): Promise<string>;
}

interface JSZipInstance {
  files: Record<string, JSZipEntry>;
}

interface JSZipStatic {
  loadAsync(file: File): Promise<JSZipInstance>;
}

function getWindowJSZip(): JSZipStatic | undefined {
  return (window as unknown as { JSZip?: JSZipStatic }).JSZip;
}

/**
 * Load JSZip 3.10.1 from cdnjs via <script> injection (idempotent).
 */
export function loadJSZip(): Promise<JSZipStatic> {
  return new Promise((resolve, reject) => {
    const existing = getWindowJSZip();
    if (existing) {
      resolve(existing);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    script.onload = () => {
      const loaded = getWindowJSZip();
      if (loaded) {
        resolve(loaded);
      } else {
        reject(new Error('JSZip was loaded but is not available on window.'));
      }
    };
    script.onerror = () => reject(new Error('Failed to load ZIP extraction engine from CDN.'));
    document.head.appendChild(script);
  });
}

// pako (zlib port) — loaded from CDN, same pattern as JSZip above.
interface PakoStatic { gzip(data: string | Uint8Array, options?: { level?: number }): Uint8Array }
function getWindowPako(): PakoStatic | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { pako?: PakoStatic }).pako ?? null;
}

let pakoLoadPromise: Promise<PakoStatic> | null = null;

export function loadPako(): Promise<PakoStatic> {
  if (pakoLoadPromise) return pakoLoadPromise;
  pakoLoadPromise = new Promise((resolve, reject) => {
    const existing = getWindowPako();
    if (existing) { resolve(existing); return; }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js';
    script.onload = () => {
      const loaded = getWindowPako();
      if (loaded) resolve(loaded);
      else reject(new Error('pako loaded but not on window.'));
    };
    script.onerror = () => reject(new Error('Failed to load pako from CDN.'));
    document.head.appendChild(script);
  });
  return pakoLoadPromise;
}

/** Strip the top-level directory segment if the path is nested. */
function cleanRelativePath(relativePath: string): string {
  const segments = relativePath.split('/');
  return segments.length > 1 ? segments.slice(1).join('/') : relativePath;
}

/** Filter out system directories, dependencies, build output, and dotfiles. */
function isExcludedPath(cleanPath: string): boolean {
  return cleanPath
    .split('/')
    .some((part) => EXCLUDED_DIRS.includes(part) || part.startsWith('.') || part === '.DS_Store');
}

export function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve((e.target?.result as string) || '');
    reader.onerror = () => reject(new Error('Failed to read plain text file.'));
    reader.readAsText(file);
  });
}

export function readImageAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve((e.target?.result as string) || '');
    reader.onerror = () => reject(new Error('Failed to read binary image file.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Unpack a .zip archive into a flat file map.
 * Text extensions → string content; image extensions → data URLs.
 * Tracks the first HTML file, preferring `index.html`.
 */
export async function unpackZip(file: File): Promise<UnpackResult> {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(file);

  const files: Record<string, string> = {};
  let importCount = 0;
  let firstHtml: string | null = null;
  let totalBytes = 0;
  // Zip-bomb protection: cap the total decoded size and entry count.
  const MAX_TOTAL_BYTES = 100 * 1024 * 1024; // 100 MB
  const MAX_ENTRIES = 2000;

  for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir) continue;
    if (importCount >= MAX_ENTRIES) break;

    const cleanPath = cleanRelativePath(relativePath);
    if (isExcludedPath(cleanPath)) continue;

    const ext = cleanPath.split('.').pop()?.toLowerCase();
    if (!ext) continue;

    if (TEXT_EXTS.includes(ext)) {
      const content: string = await zipEntry.async('string');
      // 5 MB per-file cap — parity with the folder path
      if (content.length > MAX_UNPACK_FILE_SIZE) continue;
      if (totalBytes + content.length > MAX_TOTAL_BYTES) break;
      totalBytes += content.length;
      files[cleanPath] = content;
      importCount++;
      if (ext === 'html' && (!firstHtml || cleanPath === 'index.html')) {
        firstHtml = cleanPath;
      }
    } else if (IMAGE_EXTS.includes(ext)) {
      const base64: string = await zipEntry.async('base64');
      // base64 inflates by ~4/3 — cap on decoded byte size
      if (base64.length * 0.75 > MAX_UNPACK_FILE_SIZE) continue;
      if (totalBytes + base64.length > MAX_TOTAL_BYTES) break;
      totalBytes += base64.length;
      const mime = ext === 'ico' ? 'image/x-icon' : `image/${ext}`;
      files[cleanPath] = `data:${mime};base64,${base64}`;
      importCount++;
    }
  }

  return { files, firstHtml, importCount };
}

/**
 * Unpack a picked folder (or plain multi-file selection) into a flat file map.
 * Uses `webkitRelativePath` when present to preserve directory structure.
 */
export async function unpackFileList(fileList: FileList | File[]): Promise<UnpackResult> {
  const list = Array.from(fileList);

  const files: Record<string, string> = {};
  let importCount = 0;
  let firstHtml: string | null = null;

  for (const file of list) {
    const relativePath = file.webkitRelativePath || file.name;
    const cleanPath = cleanRelativePath(relativePath);
    if (isExcludedPath(cleanPath)) continue;

    // Enforce file size limit (5 MB)
    if (file.size > MAX_UNPACK_FILE_SIZE) continue;

    const ext = cleanPath.split('.').pop()?.toLowerCase();
    if (!ext) continue;

    if (TEXT_EXTS.includes(ext)) {
      const content = await readTextFile(file);
      files[cleanPath] = content;
      importCount++;
      if (ext === 'html' && (!firstHtml || cleanPath === 'index.html')) {
        firstHtml = cleanPath;
      }
    } else if (IMAGE_EXTS.includes(ext)) {
      const base64 = await readImageAsDataURL(file);
      files[cleanPath] = base64;
      importCount++;
    }
  }

  return { files, firstHtml, importCount };
}
