/**
 * OSS stub for lib/profile-banners.ts — the cloud module is excluded from the
 * OSS sync (public-profile ecosystem is cloud-only per policy). Swapped in by
 * bin/sync-oss.js STUB_SWAPS with an identical export surface so the settings
 * General section keeps compiling. ProfileRows never renders under isOSS, so
 * the empty list is dead data — it only satisfies the module contract.
 */

export interface ProfileBanner {
  id: string;
  label: string;
  path: string;
}

export const PROFILE_BANNERS: ProfileBanner[] = [];

/** Shown when the creator hasn't picked or uploaded anything. */
export const DEFAULT_BANNER = '';

/** True when the URL is one of the curated presets (not a custom upload). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const isPresetBanner = (_url: string | null | undefined): boolean => false;
