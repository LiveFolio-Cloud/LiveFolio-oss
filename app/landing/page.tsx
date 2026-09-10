import { isOSS } from '@/lib/env';
import CloudLanding from './CloudLanding';
import OSSLanding from './OSSLanding';

// Force dynamic rendering — both landing variants use client-side animations
// and lucide-react icons that trigger barrel optimizer issues during SSG.
export const dynamic = 'force-dynamic';

export default function LandingRouter() {
  return isOSS ? <OSSLanding /> : <CloudLanding />;
}
