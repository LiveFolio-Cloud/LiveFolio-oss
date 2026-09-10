/**
 * Marketplace discovery + licensing metadata for a folio.
 *
 * Stored as individual snake_case columns on `folios` (category, tags,
 * creation, listed, license, rights_attested_at) and mirrored as a single
 * camelCase object on the flat-file `HTMLFile` in OSS mode — the same
 * split as `PaidAccessConfig`.
 *
 * Zero imports: shared by `lib/db.ts`, `lib/supabase.ts`, `lib/listing/*`
 * and all write surfaces without creating a dependency cycle.
 */

/** Curated discovery shelves — slug values stored in `folios.category`. */
export const LISTING_CATEGORIES = [
  'templates',
  'websites',
  'dashboards',
  'reports',
  'presentations',
  'marketing',
  'tools',
  'components',
  'games',
  'ai-apps',
] as const;
export type ListingCategory = (typeof LISTING_CATEGORIES)[number];

/** "Made with AI" axis — how the content was produced. */
export const CREATION_METHODS = [
  'human_made',
  'ai_assisted',
  'ai_generated',
  'human_ai',
] as const;
export type CreationMethod = (typeof CREATION_METHODS)[number];

/**
 * Explicit license metadata a seller attaches to a listed folio.
 * Legal posture: LiveFolio hosts and relays — the SELLER warrants the
 * underlying rights and the license terms are between seller and buyer.
 */
export interface LicenseSpec {
  /** 'personal' = buyer's own use only · 'commercial' = commercial use OK. */
  kind: 'personal' | 'commercial';
  /** Buyer may modify the content. */
  allowModify: boolean;
  /** Buyer may resell / redistribute (else "Resale prohibited"). */
  allowResale: boolean;
  /** Seller requires attribution on derived works. */
  requireAttribution: boolean;
  /** Max projects/instances the buyer may use it in. null = unlimited. */
  maxProjects: number | null;
}

/** Discovery + rights metadata for a folio. */
export interface ListingMetadata {
  /** Curated shelf slug (null = uncategorized). */
  category: ListingCategory | null;
  /** Free-form second axis — lowercase, ≤8 tags. */
  tags: string[];
  creation: CreationMethod | null;
  /** Opt-in to the public Explore/discovery index. */
  listed: boolean;
  license: LicenseSpec | null;
  /**
   * ISO timestamp of the seller's per-folio affirmation: "I own this content
   * or have the necessary rights/licenses to sell and distribute it."
   * Never cleared once set — it is the evidence record.
   */
  rightsAttestedAt: string | null;
}

/** Moderated-down folio (content takedown) — behaves as unpublished. */
export type ModerationStatus = 'ok' | 'hidden';

/** Account-level standing for a profile (seller delinquent → suspended). */
export type AccountStatus = 'active' | 'suspended';

/* ── Human labels + pure helpers ────────────────────────────────────────
 * This file stays zero-import so client components can import labels
 * without pulling the server Supabase client into the browser bundle. */

/** Human labels for the curated shelves (UI + Explore chips). */
export const CATEGORY_LABELS: Record<ListingCategory, string> = {
  templates: 'Templates',
  websites: 'Websites',
  dashboards: 'Dashboards',
  reports: 'Reports & Documents',
  presentations: 'Pitch Decks & Presentations',
  marketing: 'Landing Pages & Marketing',
  tools: 'Tools & Calculators',
  components: 'Components',
  games: 'Games & Entertainment',
  'ai-apps': 'AI Apps',
};

export const CREATION_LABELS: Record<string, string> = {
  human_made: 'Human-made',
  ai_assisted: 'AI-assisted',
  ai_generated: 'AI-generated',
  human_ai: 'Human + AI',
};

export const LICENSE_KIND_LABELS: Record<string, string> = {
  personal: 'Personal use',
  commercial: 'Commercial license',
};

/** Fresh "not listed" state — shape matches `sanitizeListing` output exactly. */
export function defaultListing(): ListingMetadata {
  return {
    category: null,
    tags: [],
    creation: null,
    listed: false,
    license: null,
    rightsAttestedAt: null,
  };
}

/**
 * The per-folio rights affirmation is an evidence record: it is written once
 * and must survive later listing edits (including unlisting). Merges the
 * existing attestation into any incoming metadata that omits it.
 */
export function preserveAttestation(
  incoming: ListingMetadata | null | undefined,
  existing: ListingMetadata | null | undefined
): ListingMetadata | null {
  if (!incoming) return incoming ?? null;
  if (incoming.rightsAttestedAt || !existing?.rightsAttestedAt) return incoming;
  return { ...incoming, rightsAttestedAt: existing.rightsAttestedAt };
}
