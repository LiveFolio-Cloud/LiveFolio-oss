'use client';

/**
 * Settings popup barrel (P2-T02).
 *
 * Public API:
 * - `SettingsPopupProvider` — wrap the AppShellFrame in `app/(app)/layout.tsx`.
 * - `SettingsPopupModal` — mount into the frame's `overlay` slot (inside the
 *   provider). Renders nothing while closed.
 * - `useSettingsPopup()` — the trigger API (sidebar gear, header, /settings
 *   deep-link): `{ open, activeSectionId, openPopup, closePopup, openSection,
 *   setActiveSection }`.
 */
export { SettingsPopupProvider, useSettingsPopup } from './settings-context';
export type { SettingsPopupApi } from './settings-context';
export { SettingsPopupModal } from './modal';
export { settingsSections } from './settings-registry';
export type { SettingsSection } from './settings-registry';
