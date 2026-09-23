'use client';

/**
 * use-copy-to-clipboard — the write-to-clipboard-then-flip-a-label dance.
 *
 * Two components did this inline with the same shape and DIFFERENT dwell
 * times, and the difference is deliberate (a header pill that confirms fast
 * vs. a text link that stays confirmed longer):
 *
 *   CopyLinkButton      1500ms
 *   ShareProfileButton  2000ms
 *
 * The timeout is therefore an argument, not a constant. Pass the value each
 * call site uses today — the default of 1500 matches the shorter one only.
 *
 * Failure semantics are preserved from the inline versions: a rejected
 * `writeText` never flips the label and never surfaces anything (`copy`
 * resolves `false` so a caller can react, but the existing two ignore it).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface CopyToClipboard {
  /** True from a successful copy until `resetMs` later. */
  copied: boolean;
  /** Copy `text`; resolves true on success. Never throws. */
  copy: (text: string) => Promise<boolean>;
}

/**
 * @param resetMs how long the copied state stays true after a copy
 */
export function useCopyToClipboard(resetMs = 1500): CopyToClipboard {
  const [copied, setCopied] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Pending resets are dropped on unmount so a late timer can't fire into a
  // gone component. Timers are NOT cancelled on re-copy, matching the inline
  // versions: a second click within the window schedules a second reset.
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    },
    []
  );

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        timers.current.push(setTimeout(() => setCopied(false), resetMs));
        return true;
      } catch {
        // Clipboard unavailable (insecure origin, denied permission) — the
        // label stays as it was, exactly as before.
        return false;
      }
    },
    [resetMs]
  );

  return { copied, copy };
}
