'use client';

import { cn } from '@/lib/utils';

interface LoadingSpinnerProps {
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = {
  xs: 'h-3 w-3',
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-10 w-10',
};

/**
 * Branded loading spinner using the LiveFolio orange square motif.
 * Use this for inline button spinners instead of generic Loader2 circles.
 */
export function LoadingSpinner({ size = 'sm', className }: LoadingSpinnerProps) {
  return (
    <span
      className={cn(
        'inline-block animate-lf-square-pulse bg-[#FF3B00]',
        sizeMap[size],
        className
      )}
      style={{
        animationDuration: '0.9s',
        animationIterationCount: 'infinite',
        animationTimingFunction: 'steps(2, start)',
      }}
    />
  );
}

