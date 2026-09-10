'use client';

import React from 'react';
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

/**
 * Keyframes for the square pulse animation.
 * Include once in your layout or app root.
 */
export const loadingSquareKeyframes = `
@keyframes lf-square-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.35); opacity: 0.55; }
}
`;

interface LoadingButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  loadingText?: string;
  children: React.ReactNode;
}

/**
 * Button wrapper that auto-disables and shows a branded spinner when loading.
 * Drop-in replacement for <button> with loading state.
 */
export function LoadingButton({
  loading = false,
  loadingText,
  children,
  className,
  disabled,
  ...props
}: LoadingButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={cn(className)}
      {...props}
    >
      {loading ? (
        <>
          <LoadingSpinner size="xs" className="mr-1.5" />
          {loadingText || children}
        </>
      ) : (
        children
      )}
    </button>
  );
}
