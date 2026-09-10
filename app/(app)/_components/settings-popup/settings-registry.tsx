'use client';

/**
 * Settings popup section registry (P2-T02).
 *
 * Sections register as `{ id, label, icon, component }`. Mode gates come from
 * `lib/env.ts` (build-time constants): Sharing/Tunnel is OSS-only, Billing/
 * Teammates is Cloud-only. The modal renders the nav rail from this array and
 * only ever mounts the active section's component (so each section fetches
 * fresh data when activated — same semantics as a page visit).
 *
 * JSX-free by construction (icons are `LucideIcon` components, not elements)
 * so the array is unit-testable without a DOM.
 */
import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import { BarChart3, CreditCard, Globe, Key, Link2, Receipt, User, Users, Wallet } from 'lucide-react';
import { isCloud, isOSS } from '@/lib/env';
import { GeneralSection } from './general-section';
import { SharingTunnelSection } from './sharing-tunnel-section';
import { ApiKeySection } from './api-key-section';
import { IntegrationsSection } from './integrations-section';
import { ReportsSection } from './reports-section';
import { BillingSection } from './billing-section';
import { TeammatesSection } from './teammates-section';
import { EarningsSection } from './earnings-section';
import { PurchasesSection } from './purchases-section';

export interface SettingsSection {
  id: string;
  label: string;
  icon: LucideIcon;
  component: ComponentType;
}

export const settingsSections: SettingsSection[] = [
  { id: 'general', label: 'General', icon: User, component: GeneralSection },
  { id: 'integrations', label: 'Integrations', icon: Link2, component: IntegrationsSection },
  { id: 'reports', label: 'Analytics', icon: BarChart3, component: ReportsSection },
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
