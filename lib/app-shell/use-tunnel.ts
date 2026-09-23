import { useCallback, useEffect, useState } from 'react';
import { isOSS } from '@/lib/env';

/**
 * Live tunnel state for OSS mode — GET /api/tunnel on mount, polled every
 * `pollMs`, plus a start/stop toggle.
 *
 * The hook gates itself on isOSS rather than relying on callers: /api/tunnel
 * 403s outside OSS, and a caller CANNOT guard a hook call with a condition
 * without breaking the Rules of Hooks. Cloud renders this hook inert — no
 * mount fetch, no interval, no toggle.
 */
export function useTunnel(pollMs = 10_000) {
  const [tunnelActive, setTunnelActive] = useState(false);
  const [tunnelUrl, setTunnelUrl] = useState('');
  const [customTunnelUrl, setCustomTunnelUrl] = useState('');
  const [toggling, setToggling] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/tunnel');
      if (res.ok) {
        const data = await res.json();
        setTunnelActive(!!data.active);
        setTunnelUrl(data.url || '');
        setCustomTunnelUrl(data.customTunnelUrl || '');
      }
    } catch {
      // Tunnel API unavailable (non-OSS) — leave state untouched.
    }
  }, []);

  useEffect(() => {
    if (!isOSS) return;
    void refresh();
    const t = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);

  const toggle = useCallback(async () => {
    if (!isOSS) return;
    setToggling(true);
    try {
      const action = tunnelActive ? 'stop' : 'start';
      const res = await fetch('/api/tunnel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const data = await res.json();
        setTunnelActive(!!data.active);
        setTunnelUrl(data.url || '');
      }
    } catch {
      // Best-effort — the next poll reconciles.
    } finally {
      setToggling(false);
    }
  }, [tunnelActive]);

  return { tunnelActive, tunnelUrl, customTunnelUrl, toggling, refresh, toggle };
}
