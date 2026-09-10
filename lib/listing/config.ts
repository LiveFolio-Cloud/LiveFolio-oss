import { supabaseAdmin } from '@/lib/supabase';
import {
  CREATION_METHODS,
  LISTING_CATEGORIES,
  LicenseSpec,
  ListingCategory,
  ListingMetadata,
} from './types';

// Re-exported from the zero-import module so server-side callers can keep
// importing from config; CLIENT components must import these from types.
export {
  CATEGORY_LABELS,
  CREATION_LABELS,
  LICENSE_KIND_LABELS,
  defaultListing,
  preserveAttestation,
} from './types';

const MAX_TAGS = 8;
const MAX_TAG_LENGTH = 32;
const MAX_PROJECTS = 9999;
const TAG_PATTERN = /^[a-z0-9][a-z0-9 &+#-]*$/;

/** Seller Terms version — kept in lockstep with the /tos marketplace text. */
export const SELLER_TERMS_VERSION = '2026-09-03';

/**
 * Strict validation for listing metadata coming from ANY write surface
 * (MCP, REST files API, ai-create, Slack/Discord, studio Share menu).
 * Rejects instead of clamping — invalid metadata should fail loudly at
 * write time, never silently change what a buyer sees.
 */
export function sanitizeListing(input: unknown): ListingMetadata | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;

  if (typeof raw.listed !== 'boolean') return null;

  let category: ListingCategory | null = null;
  if (raw.category != null) {
    if (typeof raw.category !== 'string' || !(LISTING_CATEGORIES as readonly string[]).includes(raw.category)) {
      return null;
    }
    category = raw.category as ListingCategory;
  }

  const tags: string[] = [];
  if (raw.tags != null) {
    if (!Array.isArray(raw.tags) || raw.tags.length > MAX_TAGS) return null;
    const seen = new Set<string>();
    for (const t of raw.tags) {
      if (typeof t !== 'string') return null;
      const tag = t.trim().toLowerCase();
      if (tag.length === 0 || tag.length > MAX_TAG_LENGTH || !TAG_PATTERN.test(tag)) return null;
      if (seen.has(tag)) return null; // no duplicates
      seen.add(tag);
      tags.push(tag);
    }
  }

  let creation: ListingMetadata['creation'] = null;
  if (raw.creation != null) {
    if (typeof raw.creation !== 'string' || !(CREATION_METHODS as readonly string[]).includes(raw.creation)) {
      return null;
    }
    creation = raw.creation as ListingMetadata['creation'];
  }

  let license: LicenseSpec | null = null;
  if (raw.license != null) {
    if (typeof raw.license !== 'object' || Array.isArray(raw.license)) return null;
    const lic = raw.license as Record<string, unknown>;
    if (lic.kind !== 'personal' && lic.kind !== 'commercial') return null;
    if (typeof lic.allowModify !== 'boolean' || typeof lic.allowResale !== 'boolean' || typeof lic.requireAttribution !== 'boolean') return null;
    let maxProjects: number | null = null;
    if (lic.maxProjects != null) {
      if (!Number.isInteger(lic.maxProjects) || (lic.maxProjects as number) < 1 || (lic.maxProjects as number) > MAX_PROJECTS) return null;
      maxProjects = lic.maxProjects as number;
    }
    license = {
      kind: lic.kind,
      allowModify: lic.allowModify,
      allowResale: lic.allowResale,
      requireAttribution: lic.requireAttribution,
      maxProjects,
    };
  }

  let rightsAttestedAt: string | null = null;
  if (raw.rightsAttestedAt != null) {
    if (typeof raw.rightsAttestedAt !== 'string') return null;
    const ts = Date.parse(raw.rightsAttestedAt);
    if (Number.isNaN(ts)) return null;
    rightsAttestedAt = new Date(ts).toISOString();
  }

  return {
    listed: raw.listed,
    category,
    tags,
    creation,
    license,
    rightsAttestedAt,
  };
}

export type CanListResult =
  | { ok: true }
  | { ok: false; reason: 'needs_seller_agreement' | 'seller_suspended' };

/** Machine-readable listing-write errors surfaced to clients/agents. */
export type ListingWriteErrorCode =
  | 'LISTING_NEEDS_SELLER_AGREEMENT' // 403 — org owner hasn't accepted Seller Terms
  | 'LISTING_SELLER_SUSPENDED'        // 403 — org owner account is suspended
  | 'LISTING_NEEDS_RIGHTS_ATTESTATION'; // 400 — per-listing rights affirmation missing

/**
 * Shared guard for ANY write that turns a folio into a listing.
 * Returns an error code (null = the write may proceed).
 *
 * Two independent legal gates:
 * - account standing: the org OWNER must have accepted the Seller Terms and
 *   not be suspended (async — owner lookup) — `assertCanList`;
 * - per-listing rights affirmation: `rightsAttestedAt` in the payload, or an
 *   existing attestation already on the folio ("I own this content or have
 *   the necessary rights/licenses to sell and distribute it").
 */
export async function listingWriteGuard(args: {
  orgId?: string | null;
  listed: boolean;
  rightsAttestedAt: string | null;
  existingAttested?: boolean;
}): Promise<ListingWriteErrorCode | null> {
  if (!args.listed) return null;

  // Per-listing affirmation — cheap and synchronous.
  if (!args.rightsAttestedAt && !args.existingAttested) {
    return 'LISTING_NEEDS_RIGHTS_ATTESTATION';
  }

  // Account standing — cloud only; OSS listings are inert metadata.
  if (!args.orgId || !supabaseAdmin) return null;
  const standing = await assertCanList(args.orgId);
  if (!standing.ok) {
    return standing.reason === 'seller_suspended'
      ? 'LISTING_SELLER_SUSPENDED'
      : 'LISTING_NEEDS_SELLER_AGREEMENT';
  }
  return null;
}

/**
 * Cloud-mode gate for turning a folio INTO a listing (`listed: true`).
 *
 * Legal posture: sales are made by the seller, not by LiveFolio. Two
 * standing checks must pass before content enters the discovery index:
 *
 * 1. The workspace OWNER (the natural person liable for sales — payouts
 *    land on their Stripe account) must have accepted the Seller Terms,
 *    recording `profiles.seller_terms_accepted_at`.
 * 2. The owner's account must be 'active' (not suspended/taken down).
 *
 * OSS mode returns `{ ok: true }` unconditionally — the marketplace does
 * not exist there and listing is inert metadata.
 */
export async function assertCanList(orgId?: string | null): Promise<CanListResult> {
  if (!orgId || !supabaseAdmin) return { ok: true };

  const { data: owner, error } = await supabaseAdmin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', orgId)
    .eq('role', 'Owner')
    .maybeSingle();

  if (error || !owner) return { ok: false, reason: 'needs_seller_agreement' };

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select('seller_terms_accepted_at, account_status')
    .eq('id', owner.user_id)
    .maybeSingle();

  if (profileErr || !profile) return { ok: false, reason: 'needs_seller_agreement' };
  if (profile.account_status === 'suspended') return { ok: false, reason: 'seller_suspended' };
  if (!profile.seller_terms_accepted_at) return { ok: false, reason: 'needs_seller_agreement' };

  return { ok: true };
}
