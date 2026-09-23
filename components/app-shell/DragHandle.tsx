'use client';

/**
 * One drag handle for the AppShellFrame: pointer capture + rAF-throttled dx
 * reports against the drag-start origin. `side` keys the hover-reveal pill to
 * the owning column. Ported from the deepseek-harness `AppFrame.tsx`
 * DragHandle, adapted to Tailwind v4 utility classes.
 */
import { useCallback, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface DragHandleProps {
  side: 'sidebar' | 'details';
  /** Left edge of the owning column border (inline style on the handle). */
  left: number;
  /** Details column hover state, decided by the frame (pill affordance). */
  visible?: boolean;
  onStart: () => void;
  onDrag: (dx: number) => void;
  onEnd: () => void;
}

export function DragHandle({
  side,
  left,
  visible = false,
  onStart,
  onDrag,
  onEnd,
}: DragHandleProps) {
  const [dragging, setDragging] = useState(false);
  const origin = useRef(0);
  const latest = useRef(0);
  const frame = useRef<number | null>(null);
  // Latest-callback ref: the handlers below are stable, the gesture always
  // reports into the freshest props without re-binding pointer listeners.
  const callbacks = useRef({ onStart, onDrag, onEnd });
  callbacks.current = { onStart, onDrag, onEnd };

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    origin.current = e.clientX;
    latest.current = e.clientX;
    callbacks.current.onStart();
    setDragging(true);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    latest.current = e.clientX;
    // rAF throttle: at most one width write per frame, deltas against the
    // frozen drag-start origin (never compounded).
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null;
      callbacks.current.onDrag(latest.current - origin.current);
    });
  }, []);

  const finish = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    // Flush the last position so the pointer-up never leaves a stale edge.
    callbacks.current.onDrag(latest.current - origin.current);
    setDragging(false);
    callbacks.current.onEnd();
  }, []);

  const pillVisible = side === 'details' && (visible || dragging);

  return (
    <div
      className={cn(
        'absolute bottom-0 top-0 z-20 w-2 -ml-1 cursor-col-resize touch-none',
        // Details pill: a 12x32 affordance at vertical center, revealed on
        // handle hover / owning-column hover / drag. Rides the column border.
        side === 'details' &&
          'after:pointer-events-none after:absolute after:left-1/2 after:top-1/2 after:h-8 after:w-3 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-lg after:border after:border-[#0F0F0D]/10 dark:border-[#F4F4F0]/20 after:bg-bone after:opacity-0 after:transition-opacity after:duration-150',
        pillVisible && 'after:opacity-100',
        dragging && 'after:border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10/60'
      )}
      style={{ left }}
      data-side={side}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      aria-hidden="true"
    />
  );
}
