import { supabaseAdmin } from '@/lib/supabase';
import { GateTargetType } from './types';

/**
 * Purchase grants: the server-side record of who bought access to what.
 * Tables (`purchase_grants`, `pending_purchase_grants`) are RLS deny-all —
 * all access goes through supabaseAdmin (service role).
 */

export interface ProvisionGrantInput {
  buyerId: string;
  targetType: GateTargetType;
  targetId: string;
  grantSource: 'one_time' | 'rental' | 'subscription';
  stripeSessionId: string;
  stripePaymentIntentId?: string | null;
  stripeSubscriptionId?: string | null;
  amountCents: number;
  currency: string;
  rentalDays?: number | null;
}

/**
 * True when the user holds an unexpired, non-revoked grant for the target.
 */
export async function hasActiveGrant(
  userId: string,
  targetType: GateTargetType,
  targetId: string
): Promise<boolean> {
  if (!supabaseAdmin) return false;

  try {
    const { data, error } = await supabaseAdmin
      .from('purchase_grants')
      .select('id')
      .eq('buyer_id', userId)
      .eq('target_type', targetType)
      .eq('target_id', targetId)
      .eq('status', 'active')
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .limit(1);

    if (error || !data || data.length === 0) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the seller-declared license of a folio for grant evidence — the
 * terms snapshot stored on the grant is what the buyer actually received.
 * Best-effort: a deleted folio yields null (no snapshot, grant survives).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- license is an untyped JSONB column; only relayed, never interpreted here
async function snapshotLicense(targetType: GateTargetType, targetId: string): Promise<any | null> {
  if (!supabaseAdmin || targetType !== 'folio') return null;
  try {
    const { data, error } = await supabaseAdmin
      .from('folios')
      .select('license')
      .eq('id', targetId)
      .maybeSingle();
    if (error || !data) return null;
    return (data as { license?: unknown }).license ?? null;
  } catch {
    return null;
  }
}

/**
 * Insert a grant from a completed Stripe checkout session.
 * Idempotent: stripe_session_id is UNIQUE — replays of the webhook are no-ops.
 */
export async function provisionGrant(input: ProvisionGrantInput): Promise<boolean> {
  if (!supabaseAdmin) return false;

  const expiresAt = input.grantSource === 'rental' && input.rentalDays
    ? new Date(Date.now() + input.rentalDays * 24 * 60 * 60 * 1000).toISOString()
    : null;

  try {
    // Evidence record: which license terms this purchase actually sold.
    const licenseSnapshot = await snapshotLicense(input.targetType, input.targetId);

    const { error } = await supabaseAdmin
      .from('purchase_grants')
      .upsert(
        {
          buyer_id: input.buyerId,
          target_type: input.targetType,
          target_id: input.targetId,
          grant_source: input.grantSource,
          stripe_session_id: input.stripeSessionId,
          stripe_payment_intent_id: input.stripePaymentIntentId ?? null,
          stripe_subscription_id: input.stripeSubscriptionId ?? null,
          amount_cents: input.amountCents,
          currency: input.currency,
          status: 'active',
          granted_at: new Date().toISOString(),
          expires_at: expiresAt,
          license_snapshot: licenseSnapshot,
        },
        { onConflict: 'stripe_session_id' }
      );

    if (error) {
      console.error('[gating] provisionGrant failed:', error.message);
      return false;
    }
    return true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase errors are untyped; .message is read uniformly below
  } catch (err: any) {
    console.error('[gating] provisionGrant exception:', err?.message || err);
    return false;
  }
}

/**
 * Claim any purchases made under this email before an account existed
 * (guest-checkout safety net). Idempotent — re-runs are harmless.
 */
export async function claimPendingGrants(userId: string, email: string): Promise<number> {
  if (!supabaseAdmin || !email) return 0;

  try {
    const { data: pending, error: fetchErr } = await supabaseAdmin
      .from('pending_purchase_grants')
      .select('*')
      .eq('customer_email', email.toLowerCase());

    if (fetchErr || !pending || pending.length === 0) return 0;

    let claimed = 0;
    for (const p of pending) {
      const expiresAt = p.grant_source === 'rental' && p.rental_days
        ? new Date(Date.now() + p.rental_days * 24 * 60 * 60 * 1000).toISOString()
        : null;
      // Same evidence record as provisionGrant: the license sold to this buyer.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pending rows are untyped; fields read defensively
      const licenseSnapshot = await snapshotLicense(p.target_type as GateTargetType, p.target_id);

      const { error: insertErr } = await supabaseAdmin
        .from('purchase_grants')
        .upsert(
          {
            buyer_id: userId,
            target_type: p.target_type,
            target_id: p.target_id,
            grant_source: p.grant_source,
            stripe_session_id: p.stripe_session_id,
            stripe_payment_intent_id: p.stripe_payment_intent_id ?? null,
            amount_cents: p.amount_cents,
            currency: p.currency,
            status: 'active',
            granted_at: new Date().toISOString(),
            expires_at: expiresAt,
            license_snapshot: licenseSnapshot,
          },
          { onConflict: 'stripe_session_id' }
        );

      if (!insertErr) {
        claimed++;
        await supabaseAdmin.from('pending_purchase_grants').delete().eq('id', p.id);
      }
    }
    return claimed;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase errors are untyped; .message is read uniformly below
  } catch (err: any) {
    console.error('[gating] claimPendingGrants exception:', err?.message || err);
    return 0;
  }
}
