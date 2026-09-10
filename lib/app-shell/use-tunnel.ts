import { useCallback, useEffect, useState } from 'react';

/**
 * Live tunnel state for OSS mode — GET /api/tunnel on mount, polled every
 * `pollMs`, plus a start/stop toggle. Cloud mode never calls the tunnel API
 * (it 403s outside OSS by design); callers gate on isOSS themselves.
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
    void refresh();
    const t = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);

  const toggle = useCallback(async () => {
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
