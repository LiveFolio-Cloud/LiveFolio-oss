'use client';

/**
 * Settings popup section registry.
 *
 * Sections register as `{ id, label, icon, component }`. Mode gates come from
 * `lib/env.ts` (build-time constants): Sharing/Tunnel is OSS-only, Billing/
 * Teammates is Cloud-only. The modal renders the nav rail from this array and
 * only ever mounts the active section's component (so each section fetches
 * fresh data when activated — same semantics as a page visit).
 *
 * Each section COMPONENT is loaded through `next/dynamic`: the section bodies
 * (2,854 LOC across the nine files, plus the `@supabase/ssr` browser client
 * that `general-section` pulls in via `@/lib/supabase`) stay out of the
 * every-route client bundle and
 * are fetched only when a section is first rendered — which, because the modal
 * returns `null` while closed, means only while the popup is actually open.
 * Labels, icons and ordering below are unchanged and still resolve
 * synchronously; only the component load is deferred.
 *
 * Each module is imported for its NAMED export (`.then(m => m.X)`), since the
 * loader must resolve to a component, not a module namespace object.
 *
 * Icons stay `LucideIcon` components (not elements) so the array is still
 * DOM-free to construct. Note the components are now lazy, so rendering one
 * outside the app (a bare unit test) needs a Suspense boundary.
 */
import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import { CreditCard, Globe, Key, Link2, Receipt, ShieldCheck, User, Users, Wallet } from 'lucide-react';
import { isCloud, isOSS } from '@/lib/env';

const GeneralSection = dynamic(() => import('./general-section').then((m) => m.GeneralSection));
const SharingTunnelSection = dynamic(() =>
  import('./sharing-tunnel-section').then((m) => m.SharingTunnelSection)
);
const ApiKeySection = dynamic(() => import('./api-key-section').then((m) => m.ApiKeySection));
const IntegrationsSection = dynamic(() =>
  import('./integrations-section').then((m) => m.IntegrationsSection)
);
const PublishingSection = dynamic(() =>
  import('./publishing-section').then((m) => m.PublishingSection)
);
const BillingSection = dynamic(() => import('./billing-section').then((m) => m.BillingSection));
const TeammatesSection = dynamic(() =>
  import('./teammates-section').then((m) => m.TeammatesSection)
);
const EarningsSection = dynamic(() => import('./earnings-section').then((m) => m.EarningsSection));
const PurchasesSection = dynamic(() =>
  import('./purchases-section').then((m) => m.PurchasesSection)
);

export interface SettingsSection {
  id: string;
  label: string;
  icon: LucideIcon;
  component: ComponentType;
}

export const settingsSections: SettingsSection[] = [
  { id: 'general', label: 'General', icon: User, component: GeneralSection },
  { id: 'integrations', label: 'Integrations', icon: Link2, component: IntegrationsSection },
  // Was "Analytics" — the reading half moved to /app/analytics; what is left is
  // the per-folio governance switches, which is what settings is for.
  { id: 'publishing', label: 'Publishing', icon: ShieldCheck, component: PublishingSection },
  ...(isCloud
    ? [
        {
          id: 'api-key',
          label: 'API Key',
          icon: Key,
          component: ApiKeySection,
        },
      ]
    : []),
  ...(isOSS
    ? [
        {
          id: 'sharing',
          label: 'Sharing / Tunnel',
          icon: Globe,
          component: SharingTunnelSection,
        },
      ]
    : []),
  ...(isCloud
    ? [
        {
          id: 'billing',
          label: 'Billing',
          icon: CreditCard,
          component: BillingSection,
        },
        {
          id: 'teammates',
          label: 'Teammates',
          icon: Users,
          component: TeammatesSection,
        },
        {
          id: 'earnings',
          label: 'Earnings',
          icon: Wallet,
          component: EarningsSection,
        },
        {
          id: 'purchases',
          label: 'Purchases',
          icon: Receipt,
          component: PurchasesSection,
        },
      ]
    : []),
];
