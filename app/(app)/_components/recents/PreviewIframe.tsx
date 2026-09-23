'use client';

import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Live preview for a recents card that has no thumbnail of its own.
 *
 * Deliberately a local copy of the pattern in `components/profile/FolioGrid.tsx`
 * rather than an import: that file lives under `components/`, which the OSS
 * sync excludes wholesale, and this shell component must keep compiling
 * downstream. The two differ anyway — this one is capped to a small grid and
 * never renders gated folios.
 *
 * A preview iframe is a full document render — its own request against the
 * `force-dynamic` /api/raw route and its own JS heap. Mounting one per card up
 * front costs one of each per folio, and the heaps are never given back. So the
 * iframe exists only while the card is near the viewport, and the observer
 * unmounts it again once the card is well past — that half is what keeps memory
 * tied to the viewport rather than to the number of cards.
 *
 * The observed element is always mounted and only the iframe inside it is
 * conditional: observing the iframe itself would tear down the observer the
 * moment it was needed to bring the iframe back.
 */
export function PreviewIframe({ src, title }: { src: string; title: string }) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      return;
    }
    // 600px of vertical lead: enough that a fast scroll never outruns the
    // mount, wide enough that nudging the page does not mount/unmount/refetch
    // the same preview. Versioned preview HTML is served `max-age=300`, so a
    // remount inside that window is a cache hit.
    const observer = new IntersectionObserver(
      (entries) => setNearViewport(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: '600px 0px' },
    );
    observer.observe(holder);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={holderRef} className="absolute inset-0">
      {nearViewport && (
        <iframe
          src={src}
          className={cn(
            'absolute inset-0 h-full w-full pointer-events-none',
            'transition-opacity duration-300 motion-reduce:transition-none',
            loaded ? 'opacity-100' : 'opacity-0',
          )}
          loading="lazy"
          sandbox="allow-scripts"
          title={title}
          // Previews are ALWAYS light: the embedded folio inherits color-scheme
          // from the iframe element, so its prefers-color-scheme queries resolve
          // light even when the app runs dark.
          style={{ colorScheme: 'light' }}
          onLoad={() => setLoaded(true)}
        />
      )}
    </div>
  );
}
