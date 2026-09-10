'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isCloud, isOSS } from '@/lib/env';
import { createBrowserClient, isSupabaseConfigured } from '@/lib/supabase';
import { useSettingsPopup } from './settings-context';

/** Sign-out — pinned to the bottom of the settings nav rail (desktop) or the
 * last chip of the mobile section row (variant="chip"). */
export function SignOutButton({ variant = 'rail' }: { variant?: 'rail' | 'chip' }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  // The popup modal lives in the ROOT layout — it survives navigation. Close
  // it before pushing to /login, or the modal stays on top of the login page.
  const { closePopup } = useSettingsPopup();

  // OSS has no sessions — there is nothing to sign out of. Rendering the
  // button would push /login, which does not exist in OSS (404 detour loop).
  // isOSS is inlined at build time, so the hook calls above are never
  // conditionally skipped from the linter's perspective.
  if (isOSS) return null;

  const signOut = async () => {
    setSigningOut(true);
    try {
      if (isCloud && isSupabaseConfigured()) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
        const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
        const supabaseClient = createBrowserClient(url, key);
        await supabaseClient.auth.signOut();
      }
    } catch (e) {
      console.error('Failed to sign out:', e);
    }
    closePopup();
    router.push('/login');
    router.refresh();
  };

  if (variant === 'chip') {
    return (
      <button
        type="button"
        onClick={signOut}
        disabled={signingOut}
        className={cn(
          'shrink-0 whitespace-nowrap rounded-full border border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 px-3 py-1.5 text-xs font-medium text-ink/60 transition-colors',
          'hover:border-red-500/20 hover:bg-red-500/5 hover:text-red-600 disabled:opacity-50 cursor-pointer'
        )}
      >
        {signingOut ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
        {signingOut ? 'Signing out…' : 'Sign out'}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={signingOut}
      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-ink/60 transition-colors hover:bg-red-500/5 hover:text-red-600 disabled:opacity-50 cursor-pointer"
    >
      {signingOut ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
      {signingOut ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
