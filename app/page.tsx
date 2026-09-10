import { redirect } from 'next/navigation';
import { isOSS } from '@/lib/env';
import { createServerSupabaseClient } from '@/ee/db/supabase';
import CloudLanding from './landing/CloudLanding';
import OSSLanding from './landing/OSSLanding';

export const dynamic = 'force-dynamic';

export default async function IndexController() {
  if (isOSS) {
    // The landing is always the OSS front door (same IA as Cloud's marketing
    // root) — `/app` is one click away and always reachable afterwards.
    return <OSSLanding />;
  }

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

  return <CloudLanding />;
}
