import { HTMLFile, HTMLVersion, HTMLComment, ChatMessage } from './db';
import type { PaidAccessConfig } from './gating/types';
import type { ListingMetadata } from './listing/types';

/**
 * OSS stub for lib/supabase.ts.
 *
 * The OSS build never has Supabase configured — it runs on the flat-file
 * JSON database. This stub keeps the EXACT same export surface as the Cloud
 * original so the files that import it still type-check and run, but contains
 * zero Supabase package imports.
 */

/**
 * No-op stand-ins for the SSR client factories re-exported by the Cloud
 * lib/supabase. OSS callers only invoke these inside isCloud /
 * isSupabaseConfigured guards, so returning null is safe. Signatures accept
 * any args to remain drop-in compatible.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- no-op stand-ins must accept any args and return any to stay drop-in compatible without importing @supabase
export function createBrowserClient(..._args: any[]): any {
  return null;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- no-op stand-ins must accept any args and return any to stay drop-in compatible without importing @supabase
export function createServerClient(..._args: any[]): any {
  return null;
}

/**
 * Determines if a valid, non-placeholder Supabase configuration is present.
 * Always false in OSS.
 */
export function isSupabaseConfigured(): boolean {
  return false;
}

/**
 * Public client for client-side operations (standard RLS).
 * Null in OSS — no Supabase.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberate: preserves the Cloud export's client type so consumer narrowing compiles in the OSS tree
export const supabase = null as any;

/**
 * Admin client for server-side operations (bypasses RLS).
 * Null in OSS — no Supabase.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberate: preserves the Cloud export's client type so consumer narrowing compiles in the OSS tree
export const supabaseAdmin = null as any;

/**
 * Types for the Supabase tables matching our HTMLFile interface
 */
export type FolioRecord = {
  id: string;
  organization_id: string;
  title: string;
  description: string;
  versions: HTMLVersion[];
  comments: HTMLComment[];
  chats: ChatMessage[];
  reactions: Record<string, number>;
  design_preferences: HTMLFile['designPreferences'];
  reference_files: HTMLFile['referenceFiles'];
  ai_persona: HTMLFile['aiPersona'];
  project_mode: string;
  is_private: boolean;
  access_key: string | null;
  allow_comments: boolean;
  presentation_mode_only: boolean;
  cli_last_seen: string | null;
  public_tunnel_enabled?: boolean | null;
  collaborators?: string[];
  analytics?: HTMLFile['analytics'];
  status: string;
  project_id?: string | null;
  folder_id?: string | null;
  slug?: string | null;
  slug_history?: string[] | null;
  paid_access?: PaidAccessConfig | null;
  thumbnail_url?: string | null;
  listed?: boolean;
  category?: string | null;
  tags?: unknown[] | null;
  creation?: string | null;
  license?: unknown | null;
  rights_attested_at?: string | null;
  moderation_status?: string;
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Transforms a DB record to the application HTMLFile interface
 */
export function transformFolioRecord(record: FolioRecord): HTMLFile {
  return {
    id: record.id,
    organization_id: record.organization_id,
    title: record.title,
    description: record.description,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    versions: record.versions,
    isPrivate: record.is_private,
    accessKey: record.access_key || undefined,
    allowComments: record.allow_comments,
    presentationModeOnly: record.presentation_mode_only,
    comments: record.comments,
    reactions: record.reactions,
    chats: record.chats,
    aiPersona: record.ai_persona,
    projectMode: record.project_mode as HTMLFile['projectMode'],
    designPreferences: record.design_preferences,
    referenceFiles: record.reference_files,
    cliLastSeen: record.cli_last_seen || undefined,
    publicTunnelEnabled: record.public_tunnel_enabled ?? undefined,
    collaborators: record.collaborators || [],
    analytics: record.analytics,
    status: (record.status as 'draft' | 'published') || 'published',
    projectId: record.project_id ?? null,
    folderId: record.folder_id ?? null,
    slug: record.slug ?? null,
    slugHistory: Array.isArray(record.slug_history) ? (record.slug_history as string[]) : [],
    paidAccess: record.paid_access ?? null,
    thumbnailUrl: record.thumbnail_url ?? null,
    listing: {
      category: (record.category as ListingMetadata['category']) ?? null,
      tags: Array.isArray(record.tags)
        ? (record.tags as string[]).filter((t): t is string => typeof t === 'string')
        : [],
      creation: (record.creation as ListingMetadata['creation']) ?? null,
      listed: record.listed === true,
      license: record.license != null ? record.license as ListingMetadata['license'] : null,
      rightsAttestedAt: record.rights_attested_at ?? null,
    },
    moderationStatus: record.moderation_status === 'hidden' ? 'hidden' : 'ok',
    archivedAt: record.archived_at ?? null,
  };
}

export function transformToFolioRecord(project: HTMLFile, orgId: string): Partial<FolioRecord> {
  return {
    id: project.id,
    organization_id: orgId,
    title: project.title,
    description: project.description,
    versions: project.versions || [],
    comments: project.comments || [],
    chats: project.chats || [],
    reactions: project.reactions || {},
    design_preferences: project.designPreferences || {} as NonNullable<HTMLFile['designPreferences']>,
    reference_files: project.referenceFiles || [],
    ai_persona: project.aiPersona || {} as NonNullable<HTMLFile['aiPersona']>,
    project_mode: project.projectMode || 'document',
    is_private: !!project.isPrivate,
    access_key: project.accessKey || null,
    allow_comments: project.allowComments ?? true,
    presentation_mode_only: !!project.presentationModeOnly,
    cli_last_seen: project.cliLastSeen || null,
    public_tunnel_enabled: project.publicTunnelEnabled || null,
    collaborators: project.collaborators || [],
    analytics: project.analytics || undefined,
    status: project.status || 'draft',
    project_id: project.projectId ?? null,
    folder_id: project.folderId ?? null,
    slug: project.slug ?? null,
    paid_access: project.paidAccess ?? null,
    thumbnail_url: project.thumbnailUrl ?? null,
    listed: project.listing?.listed ?? false,
    category: project.listing?.category ?? null,
    tags: project.listing?.tags ?? [],
    creation: project.listing?.creation ?? null,
    license: project.listing?.license ?? null,
    rights_attested_at: project.listing?.rightsAttestedAt ?? null,
    // NOTE: moderation_status and archived_at are intentionally NEVER written
    // here — generic app updates must not clear a platform takedown or an
    // owner's archive. Same contract as the Cloud transform.
    created_at: project.createdAt || new Date().toISOString(),
    updated_at: project.updatedAt || new Date().toISOString(),
  };
}
