import fs from 'fs';
import path from 'path';
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
   * Tool calls initiated by the AI assistant (Epic #96)
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
        <p class="text-zinc-500 leading-relaxed">This is an active, editable HTML folio. Pin comments, modify the layout, and use the AI Studio to build beautiful responsive documents.</p>
    </div>
</body>
</html>`
        }
      }
    ]
  }
];

/**
 * Internal helper to read the database file without acquiring a lock.
 */
async function readDBInternal(customFile: string = DB_FILE): Promise<HTMLFile[]> {
  if (!fs.existsSync(customFile)) {
    const initialData = customFile === DB_FILE ? DEFAULT_TEMPLATES : [];
    await writeDBInternal(initialData, customFile);
    return initialData;
  }
  const raw = await fs.promises.readFile(customFile, 'utf-8');
  if (!raw || raw.trim() === '') {
    const initialData = customFile === DB_FILE ? DEFAULT_TEMPLATES : [];
    await writeDBInternal(initialData, customFile);
    return initialData;
  }
  return JSON.parse(raw);
}

/**
 * Internal helper to write to the database file without acquiring a lock.
 */
async function writeDBInternal(data: HTMLFile[], customFile: string = DB_FILE): Promise<void> {
  const tempFile = `${customFile}.tmp.${Date.now()}`;
  await fs.promises.writeFile(tempFile, JSON.stringify(data, null, 2), 'utf-8');
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
    const release = await lock(DB_LOCK_PATH, { 
      retries: {
        retries: 50,
        minTimeout: 20,
        maxTimeout: 200,
      }
    });
    try {
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

/**
 * Writes to the database (OSS local or Cloud Supabase)
 */
export async function writeDB(data: HTMLFile[]): Promise<void> {
  if (isOSS) {
    const release = await lock(DB_LOCK_PATH, { 
      retries: {
        retries: 50,
        minTimeout: 20,
        maxTimeout: 200,
      }
    });
    try {
      await writeDBInternal(data, DB_FILE);
    } finally {
      await release();
    }
    return;
  }

  // Cloud Mode - Bulk upsert
  if (!supabaseAdmin) throw new Error('Supabase client is not initialized in Cloud mode.');
  const { orgId } = await getAuthContext();
  if (!orgId) throw new Error('Unauthorized: No organization context');

  const records = data.map(p => transformToFolioRecord(p, orgId));
  const { error } = await supabaseAdmin
    .from('folios')
    .upsert(records);

  if (error) throw error;
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
  const originalDbJson = JSON.stringify(db);

  const result = await cb(db);

  // Identify modified, added, or deleted records to minimize payload writes
  const modifiedRecords: HTMLFile[] = [];
  const deletedIds: string[] = [];

  const originalDb: HTMLFile[] = JSON.parse(originalDbJson);
  const originalMap = new Map(originalDb.map(p => [p.id, JSON.stringify(p)]));
  const currentIds = new Set(db.map(p => p.id));

  for (const project of db) {
    const originalStr = originalMap.get(project.id);
    if (!originalStr || originalStr !== JSON.stringify(project)) {
      modifiedRecords.push(project);
    }
  }

  for (const orig of originalDb) {
    if (!currentIds.has(orig.id)) {
      deletedIds.push(orig.id);
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
 */
export async function getProjectForShare(id: string): Promise<HTMLFile | null> {
  // Callers (share pages, OG-image scrapes) can pass undefined/malformed ids —
  // the slug resolver crashes on undefined, so bail out cleanly.
  if (!id) return null;
  if (isOSS) {
    const release = await lock(DB_LOCK_PATH, { 
      retries: {
        retries: 50,
        minTimeout: 20,
        maxTimeout: 200,
      }
    });
    try {
      const db = await readDBInternal(DB_FILE);
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
    } finally {
      await release();
    }
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
