'use client';

/**
 * Client-side repo unpacking — runs in the browser on a user-picked
 * ZIP archive or a picked directory.
 *
 * Turns a ZIP archive or a picked folder (FileList) into the flat
 * `Record<string, string>` file map that `POST /api/files` `defaultFiles`
 * and the folio save path both expect: text files as strings, images as
 * base64 data URLs.
 *
 * OSS-safe: no dependencies — JSZip 3.10.1 is script-injected from cdnjs at
 * runtime; jszip is NOT in package.json, it is fetched on demand.
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

/**
 * Bounded fan-out for entry decoding. This module is client-side (`'use
 * client'`), so "concurrency" here overlaps FileReader / JSZip work inside the
 * browser tab rather than opening server sockets — but the cap still matters:
 * an unbounded `Promise.all` over a 2000-entry archive would hold every
 * decoded entry (each up to 5 MB) in memory simultaneously.
 */
const UNPACK_CONCURRENCY = 6;

/**
 * `Promise.all` over a fixed pool of `limit` workers, preserving input order.
 *
 * Same idiom as `mapWithConcurrency` in `lib/process-upload.ts` (which is
 * module-private, hence the local copy). Fail-fast, matching a serial loop:
 * the FIRST rejection stops new work being claimed and is rethrown once every
 * worker has drained, so no rejection escapes unobserved.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  type Outcome = { ok: true; value: R } | { ok: false; error: unknown };

  const outcomes = new Array<Outcome>(items.length);
  // Held on an object so TypeScript does not narrow these across the awaits
  // below (they are mutated from inside the worker closure).
  const state: { halted: boolean; error?: unknown } = { halted: false };
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (state.halted) return;
      const index = next++;
      if (index >= items.length) return;
      try {
        outcomes[index] = { ok: true, value: await fn(items[index]) };
      } catch (error) {
        outcomes[index] = { ok: false, error };
        if (!state.halted) {
          state.halted = true;
          state.error = error;
        }
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));

  if (state.halted) throw state.error;
  return outcomes.map((outcome) => (outcome as { ok: true; value: R }).value);
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

  // ── Pass 1 (synchronous, zip entry order) ──────────────────────────────
  // Every filter that needs no decoding, using the same predicates in the same
  // order as the serial loop: an entry that was skipped there is never claimed
  // by the pool, and `tasks` preserves entry order.
  interface DecodeTask {
    readonly cleanPath: string;
    readonly ext: string;
    readonly entry: JSZipEntry;
  }
  const tasks: DecodeTask[] = [];

  for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir) continue;

    const cleanPath = cleanRelativePath(relativePath);
    if (isExcludedPath(cleanPath)) continue;

    const ext = cleanPath.split('.').pop()?.toLowerCase();
    if (!ext) continue;
    if (!TEXT_EXTS.includes(ext) && !IMAGE_EXTS.includes(ext)) continue;

    tasks.push({ cleanPath, ext, entry: zipEntry });
  }

  // ── Pass 2: decode (bounded concurrency) ───────────────────────────────
  // Independent per entry — JSZip's `async()` is a pure read of an immutable
  // archive, so no entry can observe another's decode.
  const decoded = await mapWithConcurrency(
    tasks,
    UNPACK_CONCURRENCY,
    ({ ext, entry }) => (TEXT_EXTS.includes(ext) ? entry.async('string') : entry.async('base64')),
  );

  // ── Pass 3: fold in entry order ────────────────────────────────────────
  // Replays the serial loop's accumulators verbatim. Order is load-bearing
  // three times over: `files` keeps a stable key order, `totalBytes` is a
  // running sum, and `firstHtml` is a first-seen-with-`index.html`-override
  // rule. The two `break`s are reproduced exactly, so the entries *kept* are
  // identical — the only difference is that up to `UNPACK_CONCURRENCY - 1`
  // entries past an abort point were decoded (and then discarded) rather than
  // never decoded at all. That overshoot is bounded by the pool size and by
  // the 5 MB per-entry cap, and it cannot widen what is RETURNED.
  for (let i = 0; i < tasks.length; i++) {
    if (importCount >= MAX_ENTRIES) break;

    const { cleanPath, ext } = tasks[i];
    const value = decoded[i];

    if (TEXT_EXTS.includes(ext)) {
      // 5 MB per-file cap — parity with the folder path
      if (value.length > MAX_UNPACK_FILE_SIZE) continue;
      if (totalBytes + value.length > MAX_TOTAL_BYTES) break;
      totalBytes += value.length;
      files[cleanPath] = value;
      importCount++;
      if (ext === 'html' && (!firstHtml || cleanPath === 'index.html')) {
        firstHtml = cleanPath;
      }
    } else {
      // base64 inflates by ~4/3 — cap on decoded byte size
      if (value.length * 0.75 > MAX_UNPACK_FILE_SIZE) continue;
      if (totalBytes + value.length > MAX_TOTAL_BYTES) break;
      totalBytes += value.length;
      const mime = ext === 'ico' ? 'image/x-icon' : `image/${ext}`;
      files[cleanPath] = `data:${mime};base64,${value}`;
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

  // ── Pass 1 (synchronous, selection order) ──────────────────────────────
  // Same skip predicates as the serial loop, so a skipped file is never read.
  interface ReadTask {
    readonly cleanPath: string;
    readonly ext: string;
    readonly file: File;
  }
  const tasks: ReadTask[] = [];

  for (const file of list) {
    const relativePath = file.webkitRelativePath || file.name;
    const cleanPath = cleanRelativePath(relativePath);
    if (isExcludedPath(cleanPath)) continue;

    // Enforce file size limit (5 MB)
    if (file.size > MAX_UNPACK_FILE_SIZE) continue;

    const ext = cleanPath.split('.').pop()?.toLowerCase();
    if (!ext) continue;
    if (!TEXT_EXTS.includes(ext) && !IMAGE_EXTS.includes(ext)) continue;

    tasks.push({ cleanPath, ext, file });
  }

  // ── Pass 2: read (bounded concurrency) ─────────────────────────────────
  // The one site in this module that is genuinely I/O-bound: FileReader is
  // real browser I/O, so overlapping six reads beats one-at-a-time.
  const contents = await mapWithConcurrency(
    tasks,
    UNPACK_CONCURRENCY,
    ({ ext, file }) => (TEXT_EXTS.includes(ext) ? readTextFile(file) : readImageAsDataURL(file)),
  );

  // ── Pass 3: fold in selection order ────────────────────────────────────
  // `files` key order, `importCount` and the first-`index.html`-wins rule all
  // depend on it, so the fold replays the serial loop's writes verbatim.
  for (let i = 0; i < tasks.length; i++) {
    const { cleanPath, ext } = tasks[i];
    files[cleanPath] = contents[i];
    importCount++;
    if (ext === 'html' && (!firstHtml || cleanPath === 'index.html')) {
      firstHtml = cleanPath;
    }
  }

  return { files, firstHtml, importCount };
}
