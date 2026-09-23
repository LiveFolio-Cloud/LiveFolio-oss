import { redirect } from 'next/navigation';
import { isOSS } from '@/lib/env';
import { createServerSupabaseClient } from '@/ee/db/supabase';
import LandingSwitch from './landing/LandingSwitch';

export const dynamic = 'force-dynamic';

export default async function IndexController() {
  // The landing is always the OSS front door (same IA as Cloud's marketing
  // root) — `/app` is one click away and always reachable afterwards.
  // OSS has no session to resolve, so it skips the auth probe entirely.
  //
  // The landing bodies are rendered by LandingSwitch (a client component) so
  // the unselected variant's JS — notably `motion/react`, used only by
  // OSSLanding — is never shipped. Both variants stay SSR'd.
  if (!isOSS) {
    // Cloud/SaaS Mode Execution
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    if (supabaseUrl) {
      let user = null;
      try {
        const supabase = await createServerSupabaseClient();
        const { data } = await supabase.auth.getUser();
        user = data.user;
      } catch (error) {
        console.error('Failed to resolve authenticated session state:', error);
      }

      if (user) {
        redirect('/app');
      }
    }
  }

  return <LandingSwitch />;
}
