import { cookies } from 'next/headers';

/**
 * Cookie-backed Supabase client — the "who is this viewer?" seam.
 *
 * The raw blocks this replaces were byte-identical across every caller:
 * read the two public env vars, read the request cookie store, then build an
 * SSR client whose `getAll` delegates to that store and whose `setAll` is a
 * deliberate no-op. The no-op is the point: these routes only READ identity
 * (`.auth.getUser()`), and attempting to refresh the session from a route
 * handler would write cookies that Next.js cannot propagate back — the
 * refresh belongs to middleware. Keeping it explicitly empty (rather than
 * omitting `setAll`) is what tells the SSR SDK "read-only, don't try".
 *
 * The `@/lib/supabase` import stays DYNAMIC on purpose:
 * - it preserves the exact lazy-load ordering of the previous copies, and
 * - `@/lib/supabase` is the stub-swap seam for OSS, so this module stays
 *   Supabase-free in the OSS tree without a second swap entry.
 *
 * Callers must invoke this inside a try/catch: `cookies()` throws outside a
 * request scope, and every previous copy relied on its caller's catch to
 * treat that as "anonymous".
 */
export async function sessionSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  const cookieStore = await cookies();
  const { createServerClient } = await import('@/lib/supabase');
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} },
  });
}
