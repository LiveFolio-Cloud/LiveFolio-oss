import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth';
import { isOSS } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase';
import { SELLER_TERMS_VERSION } from '@/lib/listing/config';

export const dynamic = 'force-dynamic';

/**
 * POST /api/profile/attest — accept the LiveFolio Seller Terms.
 *
 * Legal posture: the workspace OWNER is the natural person liable for
 * marketplace sales (payouts land on their Stripe account), so listings are
 * blocked until THIS profile records acceptance: `seller_terms_accepted_at`
 * + the exact terms version accepted (alignment with /tos).
 */
export async function POST(request: Request) {
  try {
    const { userId } = await getAuthContext();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    if (isOSS || !supabaseAdmin) {
      return NextResponse.json({
        error: 'The marketplace is not available in OSS mode.',
        message: 'OSS mode does not host the LiveFolio marketplace. Switch to Cloud mode (Supabase) to list folios.',
      }, { status: 501 });
    }

    const body = await request.json();
    if (body.accept !== true) {
      return NextResponse.json({ error: 'INVALID_ATTESTATION', message: 'Attestation requires { accept: true }.' }, { status: 400 });
    }

    const version = typeof body.version === 'string' && body.version.trim()
      ? body.version.trim().slice(0, 40)
      : SELLER_TERMS_VERSION;

    // Re-accepting the SAME terms version must not re-stamp the acceptance
    // date — the record should show when the user first accepted. Only a NEW
    // terms version (a /tos update requires re-acceptance) refreshes it.
    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('seller_terms_accepted_at, seller_terms_version')
      .eq('id', userId)
      .maybeSingle();

    if (!existing || existing.seller_terms_version !== version) {
      const { error } = await supabaseAdmin
        .from('profiles')
        .update({
          seller_terms_accepted_at: new Date().toISOString(),
          seller_terms_version: version,
        })
        .eq('id', userId);

      if (error) {
        console.error('[POST /api/profile/attest]', error.message);
        return NextResponse.json({ error: 'Failed to record acceptance.' }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      seller_terms_version: version,
    });
  } catch (err) {
    console.error('[POST /api/profile/attest]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
