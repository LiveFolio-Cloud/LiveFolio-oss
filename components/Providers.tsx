'use client';

import { ToastProvider } from '@/components/ui/toast';
import PostHogProvider from '@/components/PostHogProvider';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PostHogProvider>
      <ToastProvider>{children}</ToastProvider>
    </PostHogProvider>
  );
}
