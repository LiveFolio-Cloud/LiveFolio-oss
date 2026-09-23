/**
 * OSS stub for lib/supabase-config.ts — used by the self-hosted build.
 *
 * The OSS build never has Supabase configured (flat-file JSON database, no
 * centralized auth), and lib/supabase.ts's OSS stub reports `false` from the
 * same probe. Keeping the stub hardcoded here means the OSS tree reports
 * exactly the same answer as before this module was split out, with no
 * env-variable probing at all.
 */

/**
 * Determines if a valid, non-placeholder Supabase configuration is present.
 * Always false in OSS.
 */
export function isSupabaseConfigured(): boolean {
  return false;
}
