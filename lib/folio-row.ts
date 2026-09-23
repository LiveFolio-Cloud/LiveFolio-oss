/**
 * folio-row — normalise a raw folio row into the `FolioData` shape the folio
 * cards render on.
 *
 * There were two mappers, and they are NOT the same mapper. Only three fields
 * are read identically; the rest diverge, on purpose, because the two surfaces
 * are fed different rows:
 *
 *   'card'    — the public profile page. Rows are already canonical
 *               (`folios_metadata` columns, or camelCase OSS flat-file rows),
 *               so most fields pass straight through and the card extras
 *               (`isNew`, marketplace `listing`) are added by the caller.
 *   'listing' — the workspace page. Rows come straight from `select *`, so
 *               every field needs a default and the aggregates (comments /
 *               reactions / versions) are normalised to their rendered types.
 *
 * Every difference is preserved exactly as it shipped. Do not "simplify" one
 * variant toward the other — the table below is the contract:
 *
 *   | field           | 'card'                        | 'listing'                        |
 *   |-----------------|-------------------------------|----------------------------------|
 *   | title           | passthrough                   | `?? 'Untitled'`                  |
 *   | description     | passthrough                   | `?? ''`                          |
 *   | updated_at      | `f.updated_at` (no fallback)  | `updated_at \|\| updatedAt`          |
 *   | updatedAt       | `f.updatedAt` (no fallback)   | `updated_at \|\| updatedAt`          |
 *   | comments        | passthrough (array)           | array → `.length`, else `0`      |
 *   | reactions       | passthrough                   | object-guarded, else `{}`        |
 *   | versions        | passthrough                   | `[]`                             |
 *   | thumbnail_url   | `?? thumbnailUrl ?? null`     | `?? null` (no camelCase alias)   |
 *   | paid_access     | `?? paidAccess ?? null`       | `?? null` (no camelCase alias)   |
 *   | isNew           | absent — caller adds it       | `false`                          |
 *   | listed/listing  | absent                        | present                          |
 *
 * Note the asymmetry in the two `updated_at` spellings on 'card': each reads
 * only its own casing. That is preserved verbatim — changing it to a shared
 * `|| ` chain would start populating a field that is `undefined` today.
 *
 * ⚠️ One latent type lie is preserved on purpose (see the inline NOTE): the
 * 'listing' branch stores a comment COUNT in `comments`, which `FolioData`
 * declares as `unknown[]`. It compiled before only because the original
 * parameter was typed `any`.
 */

// Moved here from `components/profile/FolioGrid.tsx`.
//
// `components/profile/` is EXCLUDED from the self-hosted build while `lib/`
// ships. Importing this type from there meant this file referenced a module
// that build does not have, so it failed to type-check. The dependency now
// runs components -> lib, which is the direction that survives. `FolioGrid.tsx`
// re-exports the type so
// its existing importers are unaffected.
import type { PaidAccessConfig } from '@/lib/gating/types';
import type { ListingMetadata } from '@/lib/listing/types';

export interface FolioData {
  id: string;
  /** Author @username — used for canonical card links when the grid mixes authors (Explore). */
  username?: string | null;
  slug?: string | null;
  title?: string;
  description?: string;
  project_mode?: string;
  updated_at?: string;
  updatedAt?: string;
  comments?: unknown[];
  reactions?: Record<string, number>;
  /** True when updated within the last 7 days — emerald dot on the preview. */
  isNew?: boolean;
  /** Creator-set cover image — rendered instead of the live iframe preview. */
  thumbnail_url?: string | null;
  /** Paid gate — gated folios never render the raw iframe inside cards. */
  paid_access?: PaidAccessConfig | null;
  /** Marketplace: true when the creator listed the folio in Explore. */
  listed?: boolean;
  /** Full listing metadata when the row carries it (category for tooltips). */
  listing?: ListingMetadata | null;
  /** Author avatar — shown with the @username chip when showAuthor is on. */
  avatarUrl?: string | null;
  versions?: Array<{
    versionId: string;
    files: Record<string, number | string>;
  }>;
}

/** A raw folio row: snake_case cloud columns or camelCase OSS flat-file rows. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- must accept both row spellings via index access
export type FolioRow = Record<string, any>;

export type FolioRowVariant = 'card' | 'listing';

/**
 * Map a raw folio row into `FolioData`.
 *
 * @param row   the raw row (camelCase OSS or snake_case cloud)
 * @param variant which surface is asking — see the difference table above
 */
export function toFolioData(row: FolioRow, variant: FolioRowVariant): FolioData {
  // The three fields both surfaces read the same way.
  const shared = {
    id: row.id,
    slug: row.slug ?? null,
    project_mode: row.project_mode,
  };

  if (variant === 'listing') {
    return {
      ...shared,
      title: row.title ?? 'Untitled',
      description: row.description ?? '',
      updated_at: row.updated_at || row.updatedAt,
      updatedAt: row.updated_at || row.updatedAt,
      // NOTE: this branch has always stored the COUNT here, not the array —
      // `FolioData.comments` is declared `unknown[]` and the original mapper
      // was typed `any`, so the mismatch never surfaced to the compiler.
      // Keep the number: the workspace page renders no comment count from it
      // today, and "fixing" it to pass the array through would be a visible
      // change to the card. The cast is deliberate, not an oversight.
      comments: (Array.isArray(row.comments) ? row.comments.length : 0) as unknown as unknown[],
      reactions: row.reactions && typeof row.reactions === 'object' ? row.reactions : {},
      isNew: false,
      thumbnail_url: row.thumbnail_url ?? null,
      paid_access: row.paid_access ?? null,
      listed: row.listed === true,
      listing: {
        category: row.category ?? null,
        tags: Array.isArray(row.tags) ? row.tags : [],
        creation: row.creation ?? null,
        listed: row.listed === true,
        license: row.license ?? null,
        rightsAttestedAt: row.rights_attested_at ?? null,
      },
      versions: [],
    };
  }

  return {
    ...shared,
    title: row.title,
    description: row.description,
    updated_at: row.updated_at,
    updatedAt: row.updatedAt,
    comments: row.comments,
    reactions: row.reactions,
    versions: row.versions,
    thumbnail_url: row.thumbnail_url ?? row.thumbnailUrl ?? null,
    paid_access: row.paid_access ?? row.paidAccess ?? null,
  };
}
