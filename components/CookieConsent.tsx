'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { isCloud } from '@/lib/env';
import { setAnalyticsConsent } from '@/lib/consent';

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isCloud) return;
    const stored = localStorage.getItem('livefolio-cookie-consent');
    if (!stored) {
      // Small delay so the banner doesn't flash on page load
      const timer = setTimeout(() => setVisible(true), 800);
      return () => clearTimeout(timer);
    }
  }, []);

  const accept = () => {
    localStorage.setItem('livefolio-cookie-consent', 'accepted');
    setAnalyticsConsent('accepted'); // cookie so analytics providers can check it
    setVisible(false);
  };

  const decline = () => {
    localStorage.setItem('livefolio-cookie-consent', 'declined');
    setAnalyticsConsent('declined');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[150] w-[calc(100%-2rem)] max-w-lg px-5 pt-5 pb-6 animate-in slide-in-from-bottom-4 fade-in duration-300 rounded-2xl bg-white dark:bg-[#171714] shadow-xl ring-1 ring-black/5 dark:ring-white/10"
      role="dialog"
      aria-labelledby="cookie-consent-title"
      aria-describedby="cookie-consent-desc"
    >
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <h3 id="cookie-consent-title" className="text-sm font-semibold tracking-tight mb-2 text-[#0F0F0D] dark:text-[#F4F4F0]">
            Cookie Preferences
          </h3>
          <p id="cookie-consent-desc" className="text-[13px] leading-relaxed text-[#0F0F0D]/65 dark:text-[#F4F4F0]/65">
            We use essential cookies for authentication and security. With your consent, we also use analytics
            cookies to understand how LiveFolio is used and improve the platform.{' '}
            <a href="/privacy" className="font-medium underline underline-offset-2 text-[#FF3B00] hover:text-[#FF3B00]/80">
              Privacy Policy
            </a>
          </p>
          <div className="flex items-center gap-2 mt-3 mb-1.5">
            <button
              onClick={accept}
              className="h-7 px-3.5 rounded-lg bg-[#FF3B00] text-white text-xs font-semibold hover:bg-[#FF3B00]/90 transition-colors cursor-pointer"
            >
              Accept All
            </button>
            <button
              onClick={decline}
              className="h-7 px-3.5 rounded-lg bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70 text-xs font-semibold hover:bg-[#0F0F0D]/10 dark:hover:bg-[#F4F4F0]/15 hover:text-[#FF3B00] transition-colors cursor-pointer"
            >
              Essential Only
            </button>
          </div>
        </div>
        <button
          onClick={decline}
          aria-label="Close cookie banner"
          className="shrink-0 p-1.5 rounded-lg transition-colors text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40 hover:text-[#0F0F0D] dark:hover:text-[#F4F4F0] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
