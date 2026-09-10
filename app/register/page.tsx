'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import LoadingScreen from '@/components/LoadingScreen';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { createBrowserClient, isSupabaseConfigured } from '@/lib/supabase';
import { isOSS } from '@/lib/env';
import { ArrowRight, AlertCircle, CheckCircle, ChevronLeft, Gift } from 'lucide-react';
import { trackConversion, ConversionEvent } from '@/lib/conversion-tracking';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Register form — v2 smooth (mirrors the login treatment)            */
/* ------------------------------------------------------------------ */

function RegisterForm() {
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  // Browser-scoped Supabase client (safe defaults when not configured)
  const supabase = React.useMemo(() => {
    const isConfigured = isSupabaseConfigured();
    const url = isConfigured ? (process.env.NEXT_PUBLIC_SUPABASE_URL || '') : 'https://dummy.supabase.co';
    const key = isConfigured ? (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '') : 'dummy-key';
    return createBrowserClient(url, key);
  }, []);

  // Invitation context from query params (forwarded from invite emails)
  const inviteToken = searchParams.get('invite');
  const inviteEmail = searchParams.get('email');
  const inviteOrgName = searchParams.get('orgName');

  // Referral code from query params (e.g., /register?ref=LIVE-A7X3K9)
  const referralCode = searchParams.get('ref');

  // Capture referral code on mount and fire landing event
  useEffect(() => {
    if (referralCode && typeof window !== 'undefined') {
      // Persist through signup flow (survives redirects, OAuth flows)
      sessionStorage.setItem('livefolio_referral_code', referralCode);
      // Also set a cookie so the auth callback (server-side) can claim it
      // after email confirmation flows. Validate the format first — an
      // unsanitized value containing ';' could inject cookie attributes.
      const safeCode = /^[A-Za-z0-9-]{1,64}$/.test(referralCode) ? referralCode : '';
      if (safeCode) {
        document.cookie = `livefolio_ref=${encodeURIComponent(safeCode)}; path=/; max-age=86400; SameSite=Lax`;
        // Fire tracking event
        trackConversion(ConversionEvent.REFERRAL_LINK_CLICKED, {
          referral_code: safeCode,
        });
      }
    }
  }, [referralCode]);

  useEffect(() => {
    if (inviteEmail && !email) {
      setEmail(inviteEmail);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteEmail]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setMessage({ type: 'error', text: 'Please enter a valid email address.' });
      return;
    }
    if (password.length < 6) {
      setMessage({ type: 'error', text: 'Password must be at least 6 characters.' });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: email.split('@')[0] },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;

      if (data?.session) {
        // Claim referral if one was captured
        const storedRef = typeof window !== 'undefined' ? sessionStorage.getItem('livefolio_referral_code') : null;
        if (storedRef) {
          try {
            await fetch('/api/referrals/claim', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ referral_code: storedRef }),
            });
            trackConversion(ConversionEvent.REFERRAL_SIGNUP, {
              referral_code: storedRef,
            });
            sessionStorage.removeItem('livefolio_referral_code');
          } catch { /* non-critical — claim can be retried */ }
        }

        try {
          await fetch('/api/invitations/accept', { method: 'POST' });
        } catch { /* non-critical — callback also handles this */ }
        setMessage({ type: 'success', text: 'Account created. Redirecting…' });
        // Hard navigation — guarantees the shell loading renders while SSR boots
        window.location.href = '/app';
        return; // keep loading spinner active through navigation
      } else {
        // Store referral code for claiming after email confirmation
        // (the callback/auth page should also check sessionStorage)
        setMessage({ type: 'success', text: 'Check your email to confirm your registration.' });
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase/fetch errors are untyped; only `.message` is read
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'An authentication error occurred.' });
    }
    setLoading(false);
  };

  const inputCls =
    'w-full h-11 rounded-xl bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 border-0 px-4 text-sm text-[#0F0F0D] dark:text-[#F4F4F0] placeholder:text-[#0F0F0D]/40 dark:placeholder:text-[#F4F4F0]/40 focus:outline-none focus:ring-2 focus:ring-[#FF3B00]/40 transition-shadow';
  const labelCls = 'text-xs font-medium text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60';

  return (
    <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#171714] p-8 shadow-sm ring-1 ring-black/5 dark:ring-white/10 md:p-10">
      {/* Back to landing */}
      <Link
        href="/"
        className="mb-8 inline-flex items-center gap-1.5 text-xs font-medium text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50 transition-colors hover:text-[#FF3B00]"
      >
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2.5} />
        Back to landing
      </Link>

      {/* Brand mark */}
      <div className="mb-6 flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 bg-[#FF3B00]" />
        <span
          className="text-xl font-black tracking-tighter text-[#0F0F0D] dark:text-[#F4F4F0]"
          style={{ fontFamily: '"Cabinet Grotesk", "Space Grotesk", sans-serif' }}
        >
          LiveFolio
        </span>
      </div>

      {/* Invitation banner */}
      {inviteToken && (
        <div className="mb-6 rounded-xl bg-[#FF3B00]/10 p-4 ring-1 ring-[#FF3B00]/20">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#FF3B00]">
            You&rsquo;ve been invited to join
          </div>
          <div className="mt-1 text-lg font-bold tracking-tight text-[#0F0F0D] dark:text-[#F4F4F0]">
            {inviteOrgName || 'a workspace'}
          </div>
          <p className="mt-1.5 text-xs text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60">
            Create your account to accept this invitation.
          </p>
        </div>
      )}

      {/* Referral banner */}
      {referralCode && !inviteToken && (
        <div className="mb-6 rounded-xl bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 p-4">
          <div className="flex items-center gap-2">
            <Gift className="h-4 w-4 text-[#FF3B00]" strokeWidth={2.5} />
            <span className="text-sm font-semibold text-[#0F0F0D] dark:text-[#F4F4F0]">
              You&rsquo;ve been referred!
            </span>
          </div>
          <p className="mt-1.5 text-xs text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60">
            Create your account using referral code{' '}
            <code className="rounded-md bg-[#FF3B00]/10 px-1.5 py-0.5 font-mono text-[#FF3B00]">
              {referralCode}
            </code>
            .
          </p>
        </div>
      )}

      {/* Title */}
      <h1 className="text-2xl font-bold tracking-tight text-[#0F0F0D] dark:text-[#F4F4F0]">
        Create your account
      </h1>
      <p className="mt-2 text-sm text-[#0F0F0D]/55 dark:text-[#F4F4F0]/55">
        Start publishing interactive folios in seconds.
      </p>

      {/* Alert */}
      {message && (
        <div
          className={cn(
            'mt-6 flex items-start gap-2.5 rounded-xl p-3.5 text-sm font-medium',
            message.type === 'error'
              ? 'bg-[#FF3B00]/10 text-[#FF3B00]'
              : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
          )}
        >
          {message.type === 'error' ? (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
          ) : (
            <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <div className="space-y-2">
          <label htmlFor="email" className={labelCls}>
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="name@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className={inputCls}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className={labelCls}>
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className={inputCls}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="group flex w-full items-center justify-center gap-3 h-11 rounded-xl bg-[#FF3B00] text-white text-sm font-semibold hover:bg-[#0F0F0D] dark:hover:bg-[#F4F4F0] dark:hover:text-[#0F0F0D] transition-colors disabled:opacity-60 cursor-pointer"
        >
          {loading ? (
            <LoadingSpinner size="sm" />
          ) : (
            <>
              Create account
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" strokeWidth={2.5} />
            </>
          )}
        </button>
      </form>

      {/* Toggle to sign in */}
      <div className="mt-8 pt-6 text-center border-t border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10">
        <span className="text-sm text-[#0F0F0D]/55 dark:text-[#F4F4F0]/55">
          Already have an account?{' '}
        </span>
        <Link
          href="/login"
          className="text-sm font-medium text-[#FF3B00] underline-offset-4 transition-colors hover:underline"
        >
          Sign in
        </Link>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  // OSS mode has no accounts or auth — this cloud signup form submits
  // against Supabase (absent in OSS). Show a short local notice instead of
  // a dead form that throws on submit. isOSS is inlined at build time.
  if (isOSS) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 bg-[#F4F4F0] dark:bg-[#0F0F0D]">
        <div className="w-full max-w-sm rounded-2xl border border-[#0F0F0D]/10 bg-bone p-8 text-center dark:border-[#F4F4F0]/10 dark:bg-[#191917]">
          <span className="mx-auto mb-5 block h-5 w-5 bg-[#FF3B00]" aria-hidden="true" />
          <h1 className="text-xl font-black tracking-tight text-ink">No accounts here</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink/60">
            LiveFolio OSS runs locally without sign-in — there is nothing to
            register for. Accounts live on LiveFolio Cloud.
          </p>
          <Link
            href="/app"
            className="mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-[#FF3B00] px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0F0F0D]"
          >
            Launch the dashboard <ArrowRight size={15} />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6 bg-[#F4F4F0] dark:bg-[#0F0F0D]">
      <Suspense fallback={<LoadingScreen fullScreen={false} />}>
        <RegisterForm />
      </Suspense>
    </div>
  );
}
