import crypto from 'crypto';
import { getStripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabase';
import { getEnterpriseAdminClient } from '@/ee/db/supabase';
import { MOCK_PAYMENTS } from '@/lib/env';
import { sanitizePaidAccess, resolveGateConfig } from './config';
import { platformFeeCents } from './fees';
import { provisionGrant } from './grants';
import { getProjectShareSlug } from '@/lib/slug';
import type { PaidAccessConfig } from './types';

/**
 * Gate checkout session creation — shared by the REST route
 * (app/api/billing/gate/checkout) and the MCP server's buy_project tool.
 *
 * The platform is the merchant of record (destination charge):
 * application_fee_amount goes to LiveFolio, transfer_data.destination sends
 * the remainder to the creator's Express account. Session metadata carries
 * the full grant context so the webhook can provision purchase_grants
 * without another DB round-trip.
 *
 * OSS-safe: lib/stripe, lib/supabase, and ee/db/supabase resolve to stubs in
 * the OSS sync, and every Stripe use degrades to a clean error when the
 * client is null.
 */

export type GateCheckoutResult =
  | { ok: true; url: string; mock?: boolean; sessionId?: string }
  | { ok: false; code: string; status: number; message?: string };

interface FolioTarget {
  id: string;
  title: string | null;
  slug: string | null;
  organization_id: string;
  project_id: string | null;
  paid_access: unknown;
}

function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://livefolio.cloud').replace(/\/+$/, '');
}

export async function createGateCheckoutSession(params: {
  userId: string;
  email: string | null;
  targetType: 'folio' | 'workspace';
  targetId: string;
  returnFolioId?: string | null;
  /** Internal-path-only return target (open-redirect guard: single leading
   * "/", no scheme, no "//host"). Built by the caller or omitted. */
  returnPath?: string | null;
}): Promise<GateCheckoutResult> {
  const { userId, email, targetType, targetId, returnFolioId } = params;
  const returnPath = params.returnPath || null;

  const stripe = getStripe();
  if (!stripe && !MOCK_PAYMENTS) {
    return { ok: false, code: 'STRIPE_NOT_CONFIGURED', status: 500 };
  }
  if (!supabaseAdmin) {
    return { ok: false, code: 'DATABASE_UNAVAILABLE', status: 500 };
  }

  // ── 1. Load the target and resolve the effective gate ──
  let creatorOrgId: string | null = null;
  let productTitle = '';
  let config: PaidAccessConfig | null = null;
  let effectiveTargetType: 'folio' | 'workspace' = targetType;
  let effectiveTargetId = targetId;
  let returnSlug: string | null = null;

  if (targetType === 'folio') {
    const { data: folio, error } = await supabaseAdmin
      .from('folios')
      .select('id, title, slug, organization_id, project_id, paid_access, moderation_status')
      .eq('id', targetId)
      .maybeSingle();

    if (error || !folio) {
      return { ok: false, code: 'TARGET_NOT_FOUND', status: 404 };
    }
    const f = folio as FolioTarget & { moderation_status?: string };
    // Content takedown — a moderated-down folio cannot be sold.
    if (f.moderation_status === 'hidden') {
      return { ok: false, code: 'TARGET_NOT_FOUND', status: 404 };
    }
    creatorOrgId = f.organization_id;
    productTitle = f.title || '';
    returnSlug = f.slug || getProjectShareSlug(f.title || '', f.id);

    // Folio's own gate wins; otherwise inherit the workspace gate. The
    // grant is stored against the resolved target (a workspace grant only
    // unlocks folios that inherit it).
    const resolved = await resolveGateConfig({
      paid_access: f.paid_access as PaidAccessConfig | null,
      project_id: f.project_id,
      organization_id: f.organization_id,
    });
    if (resolved) {
      config = resolved.config;
      effectiveTargetType = resolved.targetType;
      effectiveTargetId =
        resolved.targetType === 'workspace' ? f.project_id || f.id : f.id;
    }
  } else {
    const { data: project, error } = await supabaseAdmin
      .from('projects')
      .select('id, name, organization_id, paid_access')
      .eq('id', targetId)
      .maybeSingle();

    if (error || !project) {
      return { ok: false, code: 'TARGET_NOT_FOUND', status: 404 };
    }
    const p = project as {
      id: string;
      name: string;
      organization_id: string;
      paid_access: unknown;
    };
    creatorOrgId = p.organization_id;
    productTitle = p.name || '';
    config = sanitizePaidAccess(p.paid_access);

    // Workspaces have no share URL of their own — prefer the named folio
    // for the return URL; otherwise fall back to the app root.
    if (typeof returnFolioId === 'string' && returnFolioId) {
      const { data: rf } = await supabaseAdmin
        .from('folios')
        .select('id, title, slug, project_id')
        .eq('id', returnFolioId)
        .maybeSingle();
      // Only use a return folio that actually lives in this workspace.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- rf is a partial select; project_id is absent from the query's inferred row type
      if (rf && (rf as any).project_id === targetId) {
        const rfAny = rf as { id: string; title: string | null; slug: string | null };
        returnSlug = rfAny.slug || getProjectShareSlug(rfAny.title || '', rfAny.id);
      }
    }
  }

  if (!config || !config.enabled) {
    return { ok: false, code: 'NO_GATE_CONFIGURED', status: 400 };
  }
  if (config.priceType === 'subscription') {
    return { ok: false, code: 'SUBSCRIPTIONS_NOT_YET_SUPPORTED', status: 501 };
  }

  const origin = appOrigin();
  const buildSuccessUrl = (sessionRef: string) =>
    returnPath
      ? `${origin}${returnPath}?purchase=success&session_id=${sessionRef}`
      : returnSlug
        ? `${origin}/share/${returnSlug}?purchase=success&session_id=${sessionRef}`
        : `${origin}/app?purchase=success&session_id=${sessionRef}`;
  const buildCancelUrl = () =>
    returnPath
      ? `${origin}${returnPath}?purchase=cancelled`
      : returnSlug
        ? `${origin}/share/${returnSlug}?purchase=cancelled`
        : `${origin}/app?purchase=cancelled`;

  // ── 1b. Mock payments (dev/demo flag) ──
  // Simulate a successful purchase WITHOUT Stripe: provision the grant
  // directly and return a fake session id that the verify/poll flow
  // resolves. Never touches Stripe, never requires a connected creator.
  if (MOCK_PAYMENTS) {
    const mockSessionId = `mock_${crypto.randomUUID()}`;
    const ok = await provisionGrant({
      buyerId: userId,
      targetType: effectiveTargetType,
      targetId: effectiveTargetId,
      grantSource: config.priceType as 'one_time' | 'rental',
      stripeSessionId: mockSessionId,
      stripePaymentIntentId: null,
      amountCents: config.amountCents,
      currency: config.currency,
      rentalDays: config.rentalDays ?? null,
    });
    if (!ok) {
      return { ok: false, code: 'MOCK_GRANT_FAILED', status: 500 };
    }
    return { ok: true, url: buildSuccessUrl(mockSessionId), mock: true, sessionId: mockSessionId };
  }

  if (!stripe) {
    return { ok: false, code: 'STRIPE_NOT_CONFIGURED', status: 500 };
  }

  // ── 2. Creator: the target org's Owner with an ACTIVE Stripe account ──
  if (!creatorOrgId) {
    return { ok: false, code: 'CREATOR_NOT_CONNECTED', status: 400 };
  }
  const { data: members, error: membersErr } = await supabaseAdmin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', creatorOrgId)
    .eq('role', 'Owner');

  if (membersErr || !members || members.length === 0) {
    return { ok: false, code: 'CREATOR_NOT_CONNECTED', status: 400 };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- members derive from an untyped supabase client; annotation required under noImplicitAny
  const ownerIds: string[] = members.map((m: any) => m.user_id);
  const { data: ownerProfiles, error: ownerErr } = await supabaseAdmin
    .from('profiles')
    .select('id, stripe_account_id, stripe_account_status, account_status')
    .in('id', ownerIds);

  if (ownerErr) {
    console.error('Gate checkout: owner profile lookup failed:', ownerErr.message);
    return { ok: false, code: 'CREATOR_NOT_CONNECTED', status: 400 };
  }

  // Account takedown: a suspended seller cannot take new sales. Existing
  // purchase grants keep delivering (contractual) — this only gates NEW
  // checkouts; refunds/restoration go through platform moderation.
  const connectedOwner = (ownerProfiles || []).find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ownerProfiles derive from an untyped supabase client; annotation required under noImplicitAny
    (p: any) =>
      p.stripe_account_status === 'active' &&
      p.stripe_account_id &&
      p.account_status !== 'suspended'
  );
  if (!connectedOwner) {
    return { ok: false, code: 'CREATOR_NOT_CONNECTED', status: 400 };
  }
  const creatorAccountId: string = connectedOwner.stripe_account_id;

  // ── 3. Buyer platform customer (lazy-create + persist) ──
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', userId)
    .maybeSingle();

  if (profileErr) {
    console.error('Gate checkout: buyer profile lookup failed:', profileErr.message);
    return { ok: false, code: 'FAILED', status: 500, message: 'Failed to load buyer profile.' };
  }

  let customerId: string | null = (profile?.stripe_customer_id as string | null) ?? null;
  if (!customerId) {
    let buyerEmail: string | null = email;
    if (!buyerEmail) {
      const adminClient = getEnterpriseAdminClient();
      if (adminClient) {
        const { data } = await adminClient.auth.admin.getUserById(userId);
        buyerEmail = data?.user?.email ?? null;
      }
    }
    const customer = await stripe.customers.create({
      email: buyerEmail || undefined,
      metadata: { userId },
    });
    customerId = customer.id;
    await supabaseAdmin
      .from('profiles')
      .update({ stripe_customer_id: customerId })
      .eq('id', userId);
  }

  // ── 4. Checkout session (destination charge) ──
  const amountCents = config.amountCents;
  const feeCents = platformFeeCents(amountCents);

  // Stripe metadata is a string map — null is illegal, omit when absent.
  const metadata: Record<string, string> = {
    kind: 'folio_gate',
    targetType: effectiveTargetType,
    targetId: effectiveTargetId,
    grantKind: config.priceType,
    userId,
    creatorAccountId,
    amountCents: String(amountCents),
    currency: config.currency,
  };
  if (config.rentalDays != null) {
    metadata.rentalDays = String(config.rentalDays);
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      // Dynamic payment methods (no `payment_method_types`) — Stripe decides
      // what to offer from the Dashboard configuration.
      automatic_tax: { enabled: true },
      billing_address_collection: 'required',
      customer_update: { address: 'auto' },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: config.currency,
            unit_amount: amountCents,
            product_data: { name: `Folio: ${productTitle || 'access'}` },
          },
        },
      ],
      payment_intent_data: {
        application_fee_amount: feeCents,
        transfer_data: { destination: creatorAccountId },
        metadata: { kind: 'folio_gate' },
      },
      metadata,
      success_url: buildSuccessUrl('{CHECKOUT_SESSION_ID}'),
      cancel_url: buildCancelUrl(),
    });

    if (!session.url) {
      return { ok: false, code: 'FAILED', status: 500, message: 'Checkout session could not be created.' };
    }
    return { ok: true, url: session.url };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Stripe errors are untyped; .message is read uniformly below
  } catch (err: any) {
    console.error('Failed to create gate checkout session:', err);
    const msg: string = err?.message || '';
    const safe =
      msg.toLowerCase().includes('api key') ||
      msg.toLowerCase().includes('secret') ||
      msg.toLowerCase().includes('token')
        ? 'Stripe service is not configured correctly.'
        : msg || 'Billing service is currently unavailable.';
    return { ok: false, code: 'FAILED', status: 500, message: safe };
  }
}
