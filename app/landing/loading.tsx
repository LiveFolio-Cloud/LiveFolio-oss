import { cn } from '@/lib/utils';

export default function LandingLoading() {
  return (
    <div
      className={cn(
        "min-h-screen flex flex-col items-center justify-center antialiased gap-8",
        "bg-[#F4F4F0] dark:bg-[#0F0F0D]"
      )}
    >
      {/* Hero skeleton */}
      <div className="space-y-4 text-center max-w-xl px-6">
        <div
          className={cn(
            "h-10 w-72 mx-auto animate-pulse",
            "rounded-lg bg-[#0F0F0D]/10 dark:bg-[#F4F4F0]/10"
          )}
        />
        <div
          className={cn(
            "h-4 w-full animate-pulse",
            "rounded-lg bg-[#0F0F0D]/10 dark:bg-[#F4F4F0]/10"
          )}
        />
        <div
          className={cn(
            "h-4 w-3/4 mx-auto animate-pulse",
            "rounded-lg bg-[#0F0F0D]/10 dark:bg-[#F4F4F0]/10"
          )}
        />
      </div>

      {/* CTA skeleton */}
      <div className="flex gap-3">
        <div
          className={cn(
            "h-11 w-36 animate-pulse",
            "rounded-lg bg-[#0F0F0D]/10 dark:bg-[#F4F4F0]/10"
          )}
        />
        <div
          className={cn(
            "h-11 w-36 animate-pulse",
            "rounded-lg bg-[#0F0F0D]/10 dark:bg-[#F4F4F0]/10"
          )}
        />
      </div>

      {/* Brand square loader */}
      <style>{`
        @keyframes lf-square-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.35); opacity: 0.55; }
        }
        .animate-lf-square-pulse {
          animation: lf-square-pulse 1.1s steps(2, start) infinite;
        }
      `}</style>
      <span
        className="inline-block h-6 w-6 bg-[#FF3B00] mt-6 animate-lf-square-pulse"
      />
    </div>
  );
}
