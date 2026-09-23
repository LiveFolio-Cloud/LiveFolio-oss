/* eslint-disable @typescript-eslint/no-unused-vars -- stub mirrors the Cloud signatures exactly, but keeps no ledger to read them from */
import { GateTargetType } from './types';

/**
 * Self-hosted stub for lib/gating/grants.ts.
 *
 * Purchase grants are the server-side ledger of who bought access to what.
 * That whole flow is Cloud-only — an OSS install has no payment rails, no
 * a payment provider and no hosted database, so there is nothing to record and nothing to read.
 *
 * BEHAVIOUR-IDENTICAL, not merely a no-op. The Cloud original early-returns on
 * a null admin client before touching a table:
 *
 *   hasActiveGrant      → `if (!supabaseAdmin) return false`
 *   provisionGrant      → `if (!supabaseAdmin) return false`
 *   claimPendingGrants  → `if (!supabaseAdmin || !email) return 0`
 *
 * and the OSS `lib/supabase.ts` stub guarantees `supabaseAdmin === null`
 * (`export const supabaseAdmin = null as any`). So every value returned here is
 * the value the Cloud implementation already returned in OSS mode — this is a
 * swap of one implementation for the one it was already behaving as, not a
 * change of behaviour.
 *
 * It is also unreachable in practice: all five surviving call sites sit behind
 * an `isOSS`-gated early return or an `isCloud &&` branch.
 *
 * The export surface is kept identical because those five call sites still
 * import and call it.
 */

export interface ProvisionGrantInput {
  buyerId: string;
  targetType: GateTargetType;
  targetId: string;
  grantSource: 'one_time' | 'rental' | 'subscription';
  paymentSessionId: string;
  paymentIntentId?: string | null;
  subscriptionId?: string | null;
  amountCents: number;
  currency: string;
  rentalDays?: number | null;
}

/**
 * True when the user holds an unexpired, non-revoked grant for the target.
 * Always false in OSS — there is no grant ledger.
 */
export async function hasActiveGrant(
  userId: string,
  targetType: GateTargetType,
  targetId: string
): Promise<boolean> {
  return false;
}

/**
 * Insert a grant from a completed checkout session.
 * Always false in OSS — there is no checkout and no ledger.
 */
export async function provisionGrant(input: ProvisionGrantInput): Promise<boolean> {
  return false;
}

/**
 * Claim purchases made under an email before an account existed.
 * Always 0 in OSS — there is nothing pending to claim.
 */
export async function claimPendingGrants(userId: string, email: string): Promise<number> {
  return 0;
}
