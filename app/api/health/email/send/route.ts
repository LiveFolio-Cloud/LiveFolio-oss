import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { getAuthContext } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

/**
 * POST /api/health/email/send
 *
 * Sends a test email through Resend to verify end-to-end delivery.
 * Only works when RESEND_API_KEY is properly configured (not placeholder).
 * Requires an authenticated session — this endpoint relays email from the
 * LiveFolio domain and must not be an anonymous spam relay.
 *
 * Body: { to: "recipient@example.com" }
 *
 * Response:
 * {
 *   success: boolean,
 *   provider: 'resend' | 'console',
 *   messageId?: string,
 *   latencyMs?: number,
 *   error?: string
 * }
 */
export async function POST(request: Request) {
  // Require an authenticated user.
  const auth = await getAuthContext();
  if (!auth || !auth.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Rate limit per user and per IP.
  const clientIp = getClientIp(request);
  const perUser = checkRateLimit(`email-test:user:${auth.userId}`, 5, 60 * 60_000, 24 * 60 * 60_000);
  if (!perUser.allowed) {
    return NextResponse.json({ error: 'Too many test emails. Please try again later.' }, { status: 429 });
  }
  const perIp = checkRateLimit(`email-test:ip:${clientIp}`, 20, 60 * 60_000, 24 * 60 * 60_000);
  if (!perIp.allowed) {
    return NextResponse.json({ error: 'Too many test emails from this network.' }, { status: 429 });
  }

  const apiKey = process.env.RESEND_API_KEY || '';
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

  // Parse request body
  let toEmail: string;
  try {
    const body = await request.json();
    toEmail = body.to;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body. Provide: { "to": "email@example.com" }' },
      { status: 400 }
    );
  }

  if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
    return NextResponse.json(
      { error: 'Please provide a valid "to" email address.' },
      { status: 400 }
    );
  }

  // Check if Resend is configured
  const isConfigured =
    apiKey.length > 0 &&
    apiKey !== 're_your_resend_api_key_here' &&
    apiKey.startsWith('re_') &&
    apiKey.length >= 20;

  if (!isConfigured) {
    return NextResponse.json(
      {
        success: false,
        provider: 'console',
        error: 'RESEND_API_KEY is not configured. Set it in environment variables.',
      },
      { status: 500 }
    );
  }

  // Send test email
  const startTime = Date.now();

  try {
    const resend = new Resend(apiKey);
    const response = await resend.emails.send({
      from: `LiveFolio Test <${fromEmail}>`,
      to: toEmail,
      subject: '🧪 LiveFolio Resend Connectivity Test',
      text: `LiveFolio Resend connectivity test completed successfully at ${new Date().toISOString()}.

This email confirms that your Resend integration is properly configured and operational.

From: ${fromEmail}
To: ${toEmail}

— LiveFolio Email System`,
      html: `<div style="font-family: -apple-system, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #d97706;">LiveFolio — Connectivity Test ✅</h2>
        <p>This email confirms that your <strong>Resend email integration</strong> is properly configured and operational.</p>
        <div style="background: #f5f5f5; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <p style="margin: 4px 0; font-size: 14px; color: #666;">Timestamp: ${new Date().toISOString()}</p>
          <p style="margin: 4px 0; font-size: 14px; color: #666;">From: ${fromEmail}</p>
          <p style="margin: 4px 0; font-size: 14px; color: #666;">To: ${toEmail}</p>
        </div>
        <p style="font-size: 12px; color: #999;">— LiveFolio Email System</p>
      </div>`,
    });

    const latencyMs = Date.now() - startTime;

    if (response.data?.id) {
      return NextResponse.json({
        success: true,
        provider: 'resend',
        messageId: response.data.id,
        latencyMs,
        from: fromEmail,
        to: toEmail,
      });
    } else if (response.error) {
      return NextResponse.json(
        {
          success: false,
          provider: 'resend',
          error: response.error.message,
          latencyMs,
        },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { success: false, provider: 'resend', error: 'Unknown response from Resend', latencyMs },
      { status: 502 }
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Resend SDK error shape is dynamic (err.message read below)
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return NextResponse.json(
      {
        success: false,
        provider: 'resend',
        error: err?.message || String(err),
        latencyMs,
      },
      { status: 502 }
    );
  }
}
