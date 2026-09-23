'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { FONT_DISPLAY } from '@/lib/fonts';

interface LoadingScreenProps {
  fullScreen?: boolean;
}

export default function LoadingScreen({ fullScreen = true }: LoadingScreenProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center relative overflow-hidden antialiased transition-colors duration-300",
        fullScreen
          ? "min-h-screen w-full bg-[#F4F4F0] dark:bg-[#0F0F0D] text-[#0F0F0D] dark:text-[#F4F4F0]"
          : "w-full h-full min-h-[400px] bg-transparent text-[#0F0F0D] dark:text-[#F4F4F0]"
      )}
    >
      {/* `lf-square-pulse` / `.animate-lf-square-pulse` now live once, in
          app/globals.css — see the note there. `lf-horizontal-load` is local
          to this loader and stays. */}
      <style>{`
        @keyframes lf-horizontal-load {
          0% { left: -50%; }
          100% { left: 100%; }
        }
        .animate-lf-hload { animation: lf-horizontal-load 1.8s cubic-bezier(0.25, 1, 0.5, 1) infinite; }
      `}</style>

      <div className="flex flex-col items-center justify-center gap-6 relative z-10">
        {/* CSS square logo — the brand primitive */}
        <div className="flex items-center gap-2.5">
          <span className="inline-block h-4 w-4 bg-[#FF3B00] animate-lf-square-pulse" />
          <span className="text-xl tracking-tighter font-black" style={{ fontFamily: FONT_DISPLAY }}>
            LiveFolio
          </span>
        </div>

        <span className="text-[11px] font-medium tracking-[0.18em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40 uppercase select-none">
          Loading
        </span>

        {/* Sharp horizontal loader */}
        <div className="w-36 h-[2px] bg-[#0F0F0D]/10 dark:bg-[#F4F4F0]/10 overflow-hidden relative">
          <div className="absolute top-0 bottom-0 w-1/2 bg-[#FF3B00] animate-lf-hload" />
        </div>
      </div>
    </div>
  );
}
