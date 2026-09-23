'use client';

/**
 * Landing mode switch, with a real code-split.
 *
 * `app/page.tsx` and `app/landing/page.tsx` are Server Components, and both used
 * to statically import BOTH variants. The choice between them is a runtime
 * `isOSS` ternary, so the bundler shipped both: `motion/react` (imported only by
 * OSSLanding) rode along on the Cloud landing page — ~52 KB gzip of animation
 * library for a page that never calls it.
 *
 * The switch lives in a CLIENT component on purpose. `next/dynamic` in a Server
 * Component does not help here — the Next 16 docs are explicit that "when a
 * Server Component dynamically imports a Client Component, automatic code
 * splitting is currently not supported", and `ssr: false` is rejected outright
 * in a Server Component. In a Client Component `dynamic()` does split, and the
 * server only ever requests the chunk for the variant it actually renders.
 *
 * Both variants stay server-rendered: `dynamic()` defaults to `ssr: true`, so
 * the marketing copy remains in the SSR'd HTML for crawlers. Only the
 * UNSELECTED variant's JS stops being downloaded.
 */
import dynamic from 'next/dynamic';
import { isOSS } from '@/lib/env';

const CloudLanding = dynamic(() => import('./CloudLanding'));
const OSSLanding = dynamic(() => import('./OSSLanding'));

export default function LandingSwitch() {
  return isOSS ? <OSSLanding /> : <CloudLanding />;
}
