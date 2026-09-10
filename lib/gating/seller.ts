import { getStripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabase';
import { getEnterpriseAdminClient } from '@/ee/db/supabase';

/**
 * Stripe Connect seller onboarding — shared by the REST route
 * (app/api/billing/connect/start) and the MCP server's
 * manage_seller_account (onboard) tool.
 *
 * Creates (or reuses) the user's Stripe Express account and returns an
 * account-onboarding link. The `transfers` capability MUST be explicitly
 * requested here (never `card_payments`). Status transitions to 'active'
 * come ONLY from the account.updated webhook — arriving at the return_url
 * does NOT mean onboarding completed.
 *
 * OSS-safe: lib/stripe, lib/supabase, and ee/db/supabase resolve to stubs in
 * the OSS sync; the function degrades to clean errors when Stripe is absent.
 */

// Mirrors app/api/billing/connect/shared.ts (kept inline — that file lives
// under the excluded app/api/billing tree).
const CONNECT_REFRESH_PATH = '/app?stripe_connect=refresh';
const CONNECT_RETURN_PATH = '/app?stripe_connect=return';

export type SellerOnboardingResult =
  | { ok: true; url: string }
  | { ok: false; code: string; status: number; message?: string };

export async function createSellerOnboardingLink(params: {
  userId: string;
  email: string | null;
}): Promise<SellerOnboardingResult> {
  const { userId, email } = params;

  const stripe = getStripe();
  if (!stripe) {
    return { ok: false, code: 'STRIPE_NOT_CONFIGURED', status: 500 };
  }
  if (!supabaseAdmin) {
    return { ok: false, code: 'DATABASE_UNAVAILABLE', status: 500 };
  }

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select('stripe_account_id, stripe_account_status')
    .eq('id', userId)
    .maybeSingle();

  if (profileErr) {
    console.error('Connect start: profile lookup failed:', profileErr.message);
    return { ok: false, code: 'FAILED', status: 500, message: 'Failed to load profile.' };
  }

  const existing = profile as {
    stripe_account_id?: string | null;
    stripe_account_status?: string | null;
  } | null;

  if (existing?.stripe_account_status === 'active') {
    return { ok: false, code: 'ALREADY_CONNECTED', status: 400 };
  }

  // Reuse a previously created account that is still onboarding — pressing
  // Connect twice must not orphan accounts.
  let accountId: string | null = existing?.stripe_account_id || null;

  if (!accountId) {
    let userEmail: string | null = email;
    if (!userEmail) {
      const adminClient = getEnterpriseAdminClient();
      if (adminClient) {
        const { data } = await adminClient.auth.admin.getUserById(userId);
        userEmail = data?.user?.email ?? null;
      }
    }

    const account = await stripe.accounts.create({
      type: 'express',
      email: userEmail || undefined,
      metadata: { userId },
      capabilities: { transfers: { requested: true } },
    });
    accountId = account.id;

    const { error: updErr } = await supabaseAdmin
      .from('profiles')
      .update({
        stripe_account_id: accountId,
        stripe_account_status: 'pending',
      })
      .eq('id', userId);

    if (updErr) {
      console.error('Connect start: failed to persist account id:', updErr.message);
      return { ok: false, code: 'FAILED', status: 500, message: 'Failed to save Stripe account.' };
    }
  }

  const origin = (process.env.NEXT_PUBLIC_APP_URL || 'https://livefolio.cloud').replace(/\/+$/, '');
  try {
    const link = await stripe.accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      refresh_url: `${origin}${CONNECT_REFRESH_PATH}`,
      return_url: `${origin}${CONNECT_RETURN_PATH}`,
    });
    return { ok: true, url: link.url };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Stripe errors are untyped; .message is read uniformly below
  } catch (err: any) {
    console.error('Failed to start Stripe Connect onboarding:', err);
    const msg: string = err?.message || '';
    const safe =
      msg.toLowerCase().includes('api key') ||
      msg.toLowerCase().includes('secret') ||
      msg.toLowerCase().includes('token')
        ? 'Stripe service is not configured correctly.'
        : msg || 'Failed to start Stripe Connect onboarding.';
    return { ok: false, code: 'FAILED', status: 500, message: safe };
  }
}
