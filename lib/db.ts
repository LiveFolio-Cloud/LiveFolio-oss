import fs from 'fs';
import path from 'path';
import { cache } from 'react';
import { lock } from 'proper-lockfile';
import { isOSS } from './env';
import { supabaseAdmin, transformFolioRecord, transformToFolioRecord, FolioRecord } from './supabase';
import { getAuthContext } from './auth';
import { extractUUIDFromSlug, isUUID } from './utils';
import type { PaidAccessConfig } from './gating/types';
import type { ListingMetadata } from './listing/types';

export interface HTMLComment {
  id: string;
  author: string;
  text: string;
  createdAt: string;
  versionId: string;
  filename: string;
  resolved?: boolean;
  /** 'pin' = spatially-anchored canvas annotation (default, existing behavior).
   *  'comment' = general discussion not tied to a specific element. */
  type?: 'pin' | 'comment';
  x?: number;
  y?: number;
  selector?: string;
  elementHtml?: string;
  slideIndex?: number;
  /** Heading/label text of the containing section at pin time (e.g. "Section 05"). */
  sectionLabel?: string;
  parentId?: string; // For threaded replies
}

export interface HTMLVersion {
  versionId: string;
  commitMessage: string;
  files: { [filename: string]: string };
  createdAt: string;
  author: string;
}

/**
 * Shared action interface for buttons and card triggers
 */
export interface ChatAction {
  label: string;      // Display text on the button
  value: string;      // Unique value sent back to the handler
  primary?: boolean;  // Visual emphasis
  icon?: string;       // Optional Lucide icon name or emoji
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- structured per-action payload read by arbitrary click handlers; no shared shape exists
  metadata?: Record<string, any>; // Structured data for the click handler
}

/**
 * Rich interactive UI blocks
 */
export interface InteractiveCard {
  type: 'design-system' | 'file-action' | 'survey' | 'promotion' | 'generic';
  title: string;
  description?: string;
  imageUrl?: string;
  actions: ChatAction[];
}

export interface ToolCallState {
  id: string;
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments are parsed JSON from the AI; shape varies per tool
  arguments: Record<string, any>;
  status: 'pending' | 'executing' | 'done' | 'error' | 'awaiting_confirmation';
  statusMessage?: string;
  result?: {
    type: 'text' | 'file' | 'files' | 'confirmation_required';
    message: string;
    files?: { [filename: string]: string };
    confirmationPrompt?: string;
    versionId?: string;
  };
  error?: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  createdAt: string;
  isProposal?: boolean;
  isApplied?: boolean;
  proposedExplanation?: string;
  proposedFiles?: { filename: string; code: string }[];
  contextScope?: string;

  /**
   * Standalone buttons displayed below the message text
   */
  actionButtons?: ChatAction[];

  /**
   * Structured UI card for complex interactions
   */
  interactiveCard?: InteractiveCard;

  /**
   * Tool calls initiated by the AI assistant
   */
  toolCalls?: ToolCallState[];
}

export interface HTMLFile {
  id: string;
  organization_id?: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  versions: HTMLVersion[];
  collaborators?: string[];
  isPrivate?: boolean;
  accessKey?: string;
  allowComments?: boolean;
  presentationModeOnly?: boolean;
  comments?: HTMLComment[];
  reactions?: { [emoji: string]: number };
  chats?: ChatMessage[];
  aiPersona?: {
    name: string;
    role: string;
    systemInstruction?: string;
  };
  projectMode?: 'deck' | 'document' | 'spreadsheet' | 'dashboard' | 'infography';
  designPreferences?: {
    theme: string;
    typography: string;
    palette: string;
    customColors?: {
      primary: string;
      secondary: string;
      accent: string;
    };
    customGuidelines?: string;
    libraries?: string[];
  };
  referenceFiles?: {
    filename: string;
    size: number;
    content: string;
  }[];
  analytics?: {
    views: number;
    totalTimeSeconds: number;
    avgTimeSeconds: number;
    mobileViews?: number;
    desktopViews?: number;
  };
  /**
   * Per-day view counts, keyed `YYYY-MM-DD` — the OSS mirror of the Cloud
   * `folio_daily_stats` table. The lifetime totals above answer "how many
   * views"; this answers "is it growing", which is what the Analytics chart
   * draws. Collection starts when this ships: days before it are simply absent.
   */
  analyticsDaily?: { [day: string]: { views: number; sessionSeconds: number } };
  cliLastSeen?: string;
  publicTunnelEnabled?: boolean;
  status?: 'draft' | 'published';
  /** Project/folder this folio belongs to (null = "Unfiled") */
  projectId?: string | null;
  folderId?: string | null;
  /** URL-safe slug derived from title, unique per user/org */
  slug?: string | null;
  /** Former slugs kept as aliases so shared links survive renames/heals. */
  slugHistory?: string[];
  /**
   * Paid gating config. null = inherit the workspace (project) gate.
   * Only enforced in cloud mode (FEATURES.paidGating) — OSS stores it raw
   * and never enforces.
   */
  paidAccess?: PaidAccessConfig | null;
  /** Custom thumbnail shown on profile cards / OG images. Falls back to the live iframe preview. */
  thumbnailUrl?: string | null;
  /**
   * Marketplace discovery + license metadata (category/tags/creation/listed/
   * license/rightsAttestedAt). null = explicitly unlisted/cleared. Only
   * surfaced in cloud mode (the Explore index); OSS stores it raw and never
   * enforces.
   */
  listing?: ListingMetadata | null;
  /**
   * Content-takedown standing. 'hidden' behaves as unpublished everywhere
   * public. Cloud-only — set by platform moderation, never by folio writes.
   */
  moderationStatus?: 'ok' | 'hidden';
  /**
   * Set when the owner archives this folio. Archiving also forces status to
   * 'draft' and clears the listing, so the existing draft gates hide it
   * everywhere public; this timestamp is the "Archived" marker the owner UI
   * groups by. Unarchiving clears it and leaves status at 'draft' — nothing
   * ever auto-republishes. Archived folios still count toward storage.
   */
  archivedAt?: string | null;
}

/** A user's public profile */
export interface UserProfile {
  id: string;
  username?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  website?: string | null;
  is_public?: boolean;
  /** Creator-curated folio pinned at the top of the public profile. */
  featured_folio_id?: string | null;
  /** Cover image for the public profile banner. */
  background_url?: string | null;
  /** Creator-chosen accent color (hex) for the public profile surfaces. */
  accent_color?: string | null;
  /** When the profile accepted the Seller Terms (marketplace listings). */
  seller_terms_accepted_at?: string | null;
  /** Version of the Seller Terms accepted (aligned with /tos). */
  seller_terms_version?: string | null;
  /** Account standing — 'suspended' hides public content + blocks sales. */
  account_status?: 'active' | 'suspended';
  updated_at?: string;
  created_at?: string;
}

/** A project (folder) that groups folios */
export interface Project {
  id: string;
  organization_id: string;
  created_by?: string | null;
  name: string;
  slug: string;
  description?: string | null;
  is_public?: boolean;
  created_at?: string;
  updated_at?: string;
  /** Populated on read: nested folios count */
  folio_count?: number;
}

// Honor LIVEFOLIO_DATA_DIR so standalone installs keep user data outside the
// ephemeral .next/standalone/ dir (which version upgrades wipe). When unset,
// falls back to process.cwd() — byte-identical to the previous behavior.
const DB_FILE = path.join(process.env.LIVEFOLIO_DATA_DIR || process.cwd(), 'database.json');
const DB_LOCK_PATH = DB_FILE + '.lock';

// Ensure the data dir exists before writing the lock file (fresh data dirs)
if (isOSS) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  if (!fs.existsSync(DB_LOCK_PATH)) {
    fs.writeFileSync(DB_LOCK_PATH, '');
  }
}

const DEFAULT_TEMPLATES: HTMLFile[] = [
  {
    id: 'welcome-folio',
    title: 'Welcome to LiveFolio',
    description: 'A living canvas to explore the power of AI-generated documents.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    projectMode: 'document',
    isPrivate: false,
    status: 'published',
    allowComments: true,
    designPreferences: {
      theme: 'minimal-zinc',
      typography: 'sans',
      palette: 'zinc',
    },
    comments: [
      {
        id: 'c_welcome_1',
        author: 'LiveFolio Guide',
        text: 'Welcome! You can click anywhere on this canvas to leave a comment for your AI coworker.',
        createdAt: new Date().toISOString(),
        versionId: 'v1',
        filename: 'index.html',
        resolved: false,
        x: 50,
        y: 20
      }
    ],
    chats: [
      {
        id: 'm_welcome_1',
        sender: 'assistant',
        text: 'Hello! I am your LiveFolio assistant. I can help you modify this document, add new sections, or change the design system. What should we build together?',
        createdAt: new Date().toISOString()
      }
    ],
    versions: [
      {
        versionId: 'v1',
        commitMessage: 'Genesis: Welcome to LiveFolio',
        author: 'LiveFolio System',
        createdAt: new Date().toISOString(),
        files: {
          'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to LiveFolio</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
    <style>body { font-family: 'Inter', sans-serif; }</style>
</head>
<body class="bg-zinc-50 text-zinc-900 min-h-screen flex items-center justify-center p-8">
    <div class="max-w-xl text-center space-y-6">
        <h1 class="text-4xl font-extrabold tracking-tight">Your Living Canvas</h1>
        <p class="text-zinc-500 leading-relaxed">This is an active, editable HTML folio. Pin comments, modify the layout, and use the AI assistant to build beautiful responsive documents.</p>
    </div>
</body>
</html>`
        }
      }
    ]
  }
];

/* ------------------------------------------------------------------------ *
 * In-process snapshot cache — reads used to cost O(database bytes) each.
 *
 * Keyed on (path, mtimeMs, size). A hit means "the bytes on disk are the ones
 * we already parsed", so both the file read and the JSON.parse are skipped.
 * One entry is enough: OSS has exactly one database file.
 *
 * Writes drop the entry *before* they touch disk. That is what makes a
 * same-process write visible to the next read (the next read must go to disk),
 * and it is also the failure case that matters most: if a write throws, the
 * mutated-but-unpersisted tree is already unreachable, so no later read can
 * serve it or re-persist it through some other write.
 *
 * Readers receive the cached array BY REFERENCE. That is safe because every
 * OSS mutation happens inside runTransaction, which parses its own private
 * copy (see readDBInternal) and never mutates this tree.
 * ------------------------------------------------------------------------ */
interface DBSnapshot {
  file: string;
  mtimeMs: number;
  size: number;
  data: HTMLFile[];
}

let dbSnapshot: DBSnapshot | null = null;

/** (mtimeMs, size) identity of a regular file, or null when it is absent. */
function statKey(customFile: string): { mtimeMs: number; size: number } | null {
  try {
    const st = fs.statSync(customFile);
    return st.isFile() ? { mtimeMs: st.mtimeMs, size: st.size } : null;
  } catch {
    return null;
  }
}

/** Cached parse for `customFile`, or null when there is none or it went stale. */
function readDBSnapshot(customFile: string): HTMLFile[] | null {
  const snap = dbSnapshot;
  if (!snap || snap.file !== customFile) return null;
  const current = statKey(customFile);
  if (!current || current.mtimeMs !== snap.mtimeMs || current.size !== snap.size) return null;
  return snap.data;
}

/**
 * Pure read of the database file: no lock, no cache side effects.
 *
 * Returns null when the file is missing or empty (the caller decides whether to
 * seed it — that is a WRITE and needs the lock); throws when the file exists
 * but is not valid JSON.
 *
 * Deliberately never publishes a snapshot: runTransaction mutates whatever this
 * returns, and a transaction that throws must not be able to poison the shared
 * cache.
 */
async function readDBFromDisk(customFile: string): Promise<HTMLFile[] | null> {
  let raw: string;
  try {
    raw = await fs.promises.readFile(customFile, 'utf-8');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fs errors are untyped; .code separates "no file yet" from a real read failure
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
  if (!raw || raw.trim() === '') return null;
  return JSON.parse(raw) as HTMLFile[];
}

/** A fresh copy of the first-run workspace — callers may mutate what they get. */
function seedTemplates(): HTMLFile[] {
  return JSON.parse(JSON.stringify(DEFAULT_TEMPLATES)) as HTMLFile[];
}

/**
 * Internal helper to read the database file without acquiring a lock.
 *
 * The seed-on-missing branch is a WRITE, so every caller must hold the
 * exclusive lock. It also returns a private parse rather than the cached tree,
 * because runTransaction mutates what it gets.
 */
async function readDBInternal(customFile: string = DB_FILE): Promise<HTMLFile[]> {
  const existing = await readDBFromDisk(customFile);
  if (existing) return existing;

  const initialData = customFile === DB_FILE ? seedTemplates() : [];
  await writeDBInternal(initialData, customFile);
  return initialData;
}

/**
 * Internal helper to write to the database file without acquiring a lock.
 */
async function writeDBInternal(data: HTMLFile[], customFile: string = DB_FILE): Promise<void> {
  // Drop the cached snapshot BEFORE touching disk: from here on the in-memory
  // tree is not known to match the file, so it may never be served again —
  // even if this write fails or the caller keeps mutating `data` afterwards.
  dbSnapshot = null;

  const tempFile = `${customFile}.tmp.${Date.now()}`;
  // Compact JSON (no indent): nothing outside this file parses database.json
  // (verified by grep), and pretty-printing inflated the file itself, which
  // every later read had to pay for.
  await fs.promises.writeFile(tempFile, JSON.stringify(data), 'utf-8');
  // Atomic replace: on Windows, rename can fail with EBUSY if the target
  // is locked (antivirus, indexer, etc.). Fall back to copy+unlink.
  try {
    await fs.promises.rename(tempFile, customFile);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fs.rename errors are untyped; .code is read to pick the fallback strategy
  } catch (err: any) {
    if (err.code === 'EBUSY' || err.code === 'EPERM') {
      await fs.promises.copyFile(tempFile, customFile);
      await fs.promises.unlink(tempFile);
    } else {
      throw err;
    }
  }
}

/**
 * Reads the database (OSS local or Cloud Supabase scoped to organization)
 */
export async function readDB(): Promise<HTMLFile[]> {
  if (isOSS) {
    // Fast path: unchanged (mtimeMs, size) — the parsed snapshot is still valid.
    const cached = readDBSnapshot(DB_FILE);
    if (cached) return cached;

    // Steady state: a plain read needs no lock. Writers replace the file with
    // an atomic rename, so a reader can only ever open a complete file, never a
    // torn one — and holding the lock here would serialise every concurrent
    // read behind every other one.
    const before = statKey(DB_FILE);
    if (before) {
      try {
        const data = await readDBFromDisk(DB_FILE);
        if (data) {
          // Cache only when the file's identity held still across the read;
          // otherwise the bytes we parsed may already be superseded.
          const after = statKey(DB_FILE);
          if (after && after.mtimeMs === before.mtimeMs && after.size === before.size) {
            dbSnapshot = { file: DB_FILE, mtimeMs: after.mtimeMs, size: after.size, data };
          }
          return data;
        }
      } catch {
        // Unparseable. Either the file is genuinely corrupt — the locked path
        // below re-throws exactly as before — or a writer replaced it with the
        // non-atomic copyFile fallback while we were reading, which the lock
        // serialises us against.
      }
    }

    // Missing or empty ⇒ the seed is a WRITE, so this branch keeps the
    // exclusive lock. Double-checked: another process may have seeded the file
    // while we waited for it.
    const release = await lock(DB_LOCK_PATH, {
      retries: {
        retries: 50,
        minTimeout: 20,
        maxTimeout: 200,
      }
    });
    try {
      const seeded = readDBSnapshot(DB_FILE);
      if (seeded) return seeded;
      return await readDBInternal(DB_FILE);
    } finally {
      await release();
    }
  }

  // Cloud Mode - Org Scoped
  if (!supabaseAdmin) throw new Error('Supabase client is not initialized in Cloud mode.');
  const { orgId } = await getAuthContext();
  if (!orgId) throw new Error('Unauthorized: No organization context');

  const { data, error } = await supabaseAdmin
    .from('folios')
    .select('*')
    .eq('organization_id', orgId)
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return (data as FolioRecord[]).map(transformFolioRecord);
}

// NOTE: `writeDB` used to live here as a whole-array bulk upsert. It was
// removed after a sweep found zero callers in either repo: every
// write path now goes through `runTransaction` (private parse + atomic write)
// or `writeDBInternal` directly. Removing the bare bulk upsert closes a
// read-modify-write hazard — the shared-cache mutation class that bit
// upload-batch earlier — and prevents new callers from reappearing it.

/* ------------------------------------------------------------------------ *
 * Structural snapshots for the Cloud transaction diff.
 *
 * After the callback returns, runTransaction has to name the folios it must
 * upsert. It cannot ask the callback — every caller mutates the tree in place
 * (`project.versions.push(...)`, `version.files[path] = ...`,
 * `comment.resolved = true`), so there is no dirty flag and no array slot to
 * watch: the array element is the same object before and after. The only way
 * to answer is to look at the content.
 *
 * Looking at content by re-serializing every folio is what this replaces. A
 * snapshot costs O(nodes) instead: containers are walked once and every leaf is
 * recorded BY REFERENCE. Primitives are immutable, so a leaf that was never
 * replaced still compares identical under Object.is in O(1) — a 1 MB file body
 * costs one pointer comparison, not a 1 MB copy.
 *
 * shapeMatches() walks the CURRENT value in parallel and answers yes only when
 * it can prove the serialization is byte-identical to the snapshot's source:
 * same container kinds, same keys IN THE SAME ORDER, same leaf values. Every
 * uncertainty — custom prototypes, a replaced string, a changed key, a hole —
 * answers no, which is "cannot prove", never "definitely changed". The caller
 * then falls back to the authoritative JSON.stringify comparison it always made,
 * so a wrong `no` costs time and a wrong `yes` is impossible.
 * ------------------------------------------------------------------------ */
type FolioShape =
  | { kind: 'leaf'; value: unknown }
  | { kind: 'array'; items: FolioShape[] }
  | { kind: 'object'; keys: string[]; values: FolioShape[] }
  | { kind: 'opaque' };

const OPAQUE_SHAPE: FolioShape = { kind: 'opaque' };

/** Snapshot `value`'s structure, holding leaves by reference. O(nodes). */
function snapshotShape(value: unknown): FolioShape {
  if (value === null || typeof value !== 'object') return { kind: 'leaf', value };

  const proto = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (proto !== Array.prototype) return OPAQUE_SHAPE;
    const items: FolioShape[] = [];
    // Index loop rather than .map(): reading a hole yields undefined, which is
    // the token JSON.stringify emits for one, so holes and explicit undefined
    // agree instead of silently shortening the snapshot.
    for (let i = 0; i < value.length; i++) items.push(snapshotShape(value[i]));
    return { kind: 'array', items };
  }

  // A custom prototype (Date, Buffer, Map, a class instance) can serialize to
  // something that is not derivable from its own enumerable properties, so its
  // contents can never be proven unchanged. Callers hand us fresh JSON from
  // Postgres, so this is a guard, not a path.
  if (proto !== Object.prototype && proto !== null) return OPAQUE_SHAPE;

  const keys = Object.keys(value);
  const values: FolioShape[] = [];
  for (const key of keys) values.push(snapshotShape((value as Record<string, unknown>)[key]));
  return { kind: 'object', keys, values };
}

/**
 * True only when `value` is provably byte-identical, under JSON.stringify, to
 * the value `shape` was taken from. False means "unproven", never "different".
 */
function shapeMatches(shape: FolioShape, value: unknown): boolean {
  if (shape.kind === 'opaque') return false;
  if (shape.kind === 'leaf') return Object.is(shape.value, value);

  if (shape.kind === 'array') {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
    if (value.length !== shape.items.length) return false;
    for (let i = 0; i < shape.items.length; i++) {
      if (!shapeMatches(shape.items[i], value[i])) return false;
    }
    return true;
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  const keys = Object.keys(value);
  if (keys.length !== shape.keys.length) return false;
  for (let i = 0; i < keys.length; i++) {
    // Property order is part of what JSON.stringify emits.
    if (keys[i] !== shape.keys[i]) return false;
    if (!shapeMatches(shape.values[i], (value as Record<string, unknown>)[keys[i]])) return false;
  }
  return true;
}

/**
 * Runs a transaction (OSS local with lock or Cloud Supabase fetch-modify-upsert)
 */
export async function runTransaction<T>(cb: (db: HTMLFile[]) => Promise<T> | T): Promise<T> {
  if (isOSS) {
    const release = await lock(DB_LOCK_PATH, { 
      retries: {
        retries: 100,
        minTimeout: 30,
        maxTimeout: 500,
      }
    });
    try {
      const db = await readDBInternal(DB_FILE);
      const result = await cb(db);
      await writeDBInternal(db, DB_FILE);
      return result;
    } finally {
      await release();
    }
  }

  // Cloud Mode
  if (!supabaseAdmin) throw new Error('Supabase client is not initialized in Cloud mode.');
  const { orgId } = await getAuthContext();
  if (!orgId) throw new Error('Unauthorized: No organization context');

  const db = await readDB();

  // Baseline, taken BEFORE the callback: every folio's exact serialization,
  // plus a structural snapshot that lets an untouched folio skip being
  // re-serialized at all. This replaces a JSON.stringify+parse of the whole
  // organization — a complete second copy of every folio, version and file
  // body, allocated on every write just to work out which single one changed.
  const beforeJson = new Map<string, string>();
  const beforeShape = new Map<string, FolioShape>();
  for (const folio of db) {
    // Serialize first: a value JSON cannot represent has always thrown here,
    // before the callback runs, and that ordering is preserved.
    beforeJson.set(folio.id, JSON.stringify(folio));
    beforeShape.set(folio.id, snapshotShape(folio));
  }

  const result = await cb(db);

  // Identify modified, added, or deleted records to minimize payload writes
  const modifiedRecords: HTMLFile[] = [];
  const deletedIds: string[] = [];

  const currentIds = new Set(db.map(p => p.id));

  for (const project of db) {
    const originalStr = beforeJson.get(project.id);
    const originalShape = beforeShape.get(project.id);

    // Added by the callback — there is no prior state to compare against.
    if (originalStr === undefined || originalShape === undefined) {
      modifiedRecords.push(project);
      continue;
    }

    // Unchanged, and provably so without re-serializing anything.
    if (shapeMatches(originalShape, project)) continue;

    // The snapshot could not prove it; this is the authoritative check, and it
    // is byte-for-byte the comparison this code has always made.
    if (originalStr !== JSON.stringify(project)) {
      modifiedRecords.push(project);
    }
  }

  // Array.from, not `for...of` over the MapIterator — this tsconfig target
  // cannot downlevel-iterate one (TS2802). Same trap as the map caches in
  // app/api/raw/[id]/[[...path]]/route.ts.
  for (const origId of Array.from(beforeJson.keys())) {
    if (!currentIds.has(origId)) {
      deletedIds.push(origId);
    }
  }

  if (modifiedRecords.length > 0) {
    const recordsToUpsert = modifiedRecords.map(p => transformToFolioRecord(p, orgId));
    const { error: upsertErr } = await supabaseAdmin
      .from('folios')
      .upsert(recordsToUpsert);
    if (upsertErr) throw upsertErr;
  }

  if (deletedIds.length > 0) {
    const { error: deleteErr } = await supabaseAdmin
      .from('folios')
      .delete()
      .in('id', deletedIds);
    if (deleteErr) throw deleteErr;
  }

  // Central in-memory project cache invalidation for Cloud mode
  try {
    const { projectMemoryCache } = await import('./project-cache');
    for (const record of modifiedRecords) {
      projectMemoryCache.invalidate(record.id);
    }
    for (const id of deletedIds) {
      projectMemoryCache.invalidate(id);
    }
  } catch (cacheErr) {
    console.error('Failed to invalidate project memory cache in transaction:', cacheErr);
  }

  return result;
}

/**
 * Reads a single project by ID for sharing purposes (no auth context required).
 *
 * Note: the OSS branch no longer takes the exclusive lock. This is a pure read
 * of a file that writers only ever replace atomically, and it now goes through
 * readDB() so it also benefits from the snapshot cache; the seed-on-missing
 * write still happens under the lock inside readDB().
 */
async function resolveProjectForShare(id: string): Promise<HTMLFile | null> {
  // Callers (share pages, OG-image scrapes) can pass undefined/malformed ids —
  // the slug resolver crashes on undefined, so bail out cleanly.
  if (!id) return null;
  if (isOSS) {
    const db = await readDB();
    let project = db.find((p) => p.id === id) || null;
    if (!project && id.includes('-')) {
      const parts = id.split('-');
      for (let i = 1; i <= parts.length; i++) {
        const candidate = parts.slice(-i).join('-');
        const found = db.find((p) => p.id === candidate);
        if (found) {
          project = found;
          break;
        }
      }
    }
    return project;
  }

  // Cloud Mode — extract UUID from human-readable slug before querying
  if (!supabaseAdmin) throw new Error('Supabase client is not initialized in Cloud mode.');

  const queryId = extractUUIDFromSlug(id);

  // A pure slug (no embedded UUID) can't match the id column — querying it
  // fires a Postgres UUID-cast error (logged as `{}`). Resolve via the slug
  // column instead, so /share/<title-slug> and OG scrapes work cleanly.
  if (!isUUID(queryId)) {
    const { data: bySlug, error: slugErr } = await supabaseAdmin
      .from('folios')
      .select('*')
      .eq('slug', id)
      .maybeSingle();
    if (slugErr || !bySlug) return null;
    const bySlugProject = transformFolioRecord(bySlug);
    // Content takedown: moderated-down folios are "not found" everywhere public.
    if (bySlugProject.moderationStatus === 'hidden') return null;
    return bySlugProject;
  }

  let { data, error } = await supabaseAdmin
    .from('folios')
    .select('*')
    .eq('id', queryId)
    .maybeSingle();

  if (!data && !error && queryId !== id) {
    // Fallback: try the full slug (edge case for manually-created non-UUID IDs)
    const res = await supabaseAdmin
      .from('folios')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (!res.error && res.data) data = res.data;
    error = res.error;
  }

  if (error) {
    console.error('Error fetching project for share:', error);
    return null;
  }
  if (!data) return null;

  const project = transformFolioRecord(data as FolioRecord);
  // Content takedown: moderated-down folios are "not found" everywhere public.
  if (project.moderationStatus === 'hidden') return null;
  return project;
}

/**
 * Per-request memoised share resolver.
 *
 * `app/share/[id]/page.tsx` calls this from both `generateMetadata` and the page
 * body, and `app/share/[id]/opengraph-image.tsx` calls it once per scrape —
 * without memoisation each of those re-ran the whole lookup. React's `cache()`
 * is the documented mechanism: it is scoped to a single request, so it cannot
 * leak between requests, and outside a render/request scope it degrades to a
 * plain call (scripts and tests behave exactly as before).
 *
 * Callers treat the result as read-only, which is what makes the shared
 * snapshot reference on the OSS path safe.
 */
export const getProjectForShare = cache(resolveProjectForShare);
