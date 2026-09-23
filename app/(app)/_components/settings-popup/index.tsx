'use client';

/**
 * Settings popup barrel.
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
// `settingsSections` is deliberately NOT re-exported here. It is an internal
// registry (the modal imports it directly from `./settings-registry`), and the
// barrel's documented public API is the provider, the modal and the hook —
// re-exporting it only widened the barrel. The type stays: it is erased at
// compile time and costs nothing at runtime.
export type { SettingsSection } from './settings-registry';
