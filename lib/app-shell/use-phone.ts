'use client';

/**
 * Window-level phone detector for surfaces OUTSIDE the app shell frame.
 *
 * Do NOT use the layout store here: the store's `phone` mirror is fed by
 * AppShellFrame's ResizeObserver, and the frame only mounts on `/app` routes.
 * The settings popup renders from the ROOT layout on every route, so it must
 * read the window itself. SSR-safe: defaults to desktop, flips post-hydration
 * (invisible for the settings popup, which only renders after a user click).
 */
import { useEffect, useState } from 'react';

const PHONE_QUERY = '(max-width: 767px)'; // matches PHONE_BREAKPOINT = 768

export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const update = () => setPhone(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return phone;
}
