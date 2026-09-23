'use client';

import { useEffect, useState } from 'react';

/**
 * useDesignSystems — GET /api/design-systems once on mount.
 *
 * Lifted verbatim from three character-identical copies: `ChatHero`,
 * `FolioChatPanel` and `FolioView` (the last is not adopted yet).
 * Nothing needed parameterising: same URL, same `res.ok`
 * guard, same state shape, same silent catch.
 *
 * The fetch is best-effort: a failure leaves the list empty, which is exactly
 * what the design drawer already handles (it falls back to its own defaults).
 * That is why the catch is deliberately silent — do not turn it into a toast.
 */

export interface DesignSystem {
  id: string;
  name: string;
  description: string;
  thumbnail: string;
}

export function useDesignSystems() {
  const [availableDesignSystems, setAvailableDesignSystems] = useState<DesignSystem[]>([]);

  useEffect(() => {
    const fetchDesignSystems = async () => {
      try {
        const res = await fetch('/api/design-systems');
        if (res.ok) setAvailableDesignSystems(await res.json());
      } catch {}
    };
    fetchDesignSystems();
  }, []);

  return { availableDesignSystems, setAvailableDesignSystems };
}
