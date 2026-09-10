'use client';

/**
 * Settings popup — Sharing / Tunnel section (P2-T02, OSS-only).
 *
 * Fork of the settings page's two OSS cards: "Local Security" (the local MCP
 * master key with regenerate + debounced manual-edit persistence) and
 * "Public Share Tunnel" (Go Live / Disconnect, temporary URL copy, custom
 * tunnel override). The master key lifecycle is consolidated HERE (the page
 * shows it in two places — Local Security and Developer Settings); the popup
 * shows it once, so no other section generates or writes it.
 *
 * Mount behavior mirrors the page's OSS branch of `fetchGlobalSettings`: GET
 * `/api/settings`, generate + persist a key if the server has none, then GET
 * `/api/tunnel` for the live tunnel state. Registration in the registry is
 * gated by `isOSS`, so this file never renders in Cloud mode.
 */
import { useRef, useState } from 'react';
import { Check, Copy, Globe, Key, RefreshCw, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SectionShell } from './section-shell';

const subtleInk = { backgroundColor: 'rgba(15,15,13,0.05)' };

/** 32 hex chars — same generator as the settings page (16 random bytes). */
function randomHexKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function persistMasterKey(key: string) {
  return fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mcpKey: key }),
  }).catch(() => {
    // persistence is best-effort; the local key still works until the next
    // sync (same tolerance as the settings page).
  });
}

export function SharingTunnelSection() {
  const [apiKey, setApiKey] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);
  const keySaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isRegeneratingKey, setIsRegeneratingKey] = useState(false);
  const [tunnelActive, setTunnelActive] = useState(false);
  const [tunnelUrl, setTunnelUrl] = useState('');
  const [customTunnelUrl, setCustomTunnelUrl] = useState('');
  const [isTogglingTunnel, setIsTogglingTunnel] = useState(false);
  const [copiedTunnelUrl, setCopiedTunnelUrl] = useState(false);
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const toggleTunnel = async () => {
    setIsTogglingTunnel(true);
    try {
      const action = tunnelActive ? 'stop' : 'start';
      const res = await fetch('/api/tunnel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const data = await res.json();
        if (action === 'start') {
          setTunnelActive(true);
          setTunnelUrl(data.url || '');
        } else {
          setTunnelActive(false);
          setTunnelUrl('');
        }
      }
    } catch (err) {
      console.error('Failed to toggle tunnel:', err);
    } finally {
      setIsTogglingTunnel(false);
    }
  };

  const handleSaveCustomTunnelUrl = (val: string) => {
    setCustomTunnelUrl(val);
    fetch('/api/tunnel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save_custom', customTunnelUrl: val }),
    }).catch(() => {
      // best-effort; the input keeps the local value.
    });
  };

  const regenerateKey = async () => {
    setIsRegeneratingKey(true);
    try {
      const newKey = randomHexKey();
      setApiKey(newKey);
      localStorage.setItem('LiveFolio_API_KEY', newKey);
      await persistMasterKey(newKey);
    } finally {
      setIsRegeneratingKey(false);
    }
  };

  const handleKeyManualEdit = (val: string) => {
    setApiKey(val);
    localStorage.setItem('LiveFolio_API_KEY', val);
    if (keySaveTimer.current) clearTimeout(keySaveTimer.current);
    keySaveTimer.current = setTimeout(() => {
      persistMasterKey(val);
    }, 600);
  };

  return (
    <>
      {/* Local Security */}
      <SectionShell icon={Key} title="Local Security">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold tracking-tight text-ink/60">
                Master Key
              </label>
              <button
                type="button"
                onClick={regenerateKey}
                disabled={isRegeneratingKey}
                className="text-xs font-semibold tracking-tight text-[var(--app-accent)] hover:underline flex items-center gap-1 disabled:opacity-50"
              >
                <RefreshCw size={10} />
                <span>Regenerate</span>
              </button>
            </div>
            <div className="relative">
              <Input
                value={apiKey}
                onChange={(e) => handleKeyManualEdit(e.target.value)}
                className="pr-11"
                placeholder={apiKey ? undefined : 'Syncing master key…'}
              />
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-11 w-11"
                onClick={() => copyToClipboard(apiKey)}
                aria-label="Copy master key"
              >
                {copiedKey ? (
                  <Check size={14} className="text-[var(--app-accent)]" />
                ) : (
                  <Copy size={14} />
                )}
              </Button>
            </div>
          </div>
          <div className="p-4 flex gap-3" style={subtleInk}>
            <Shield size={16} className="text-[var(--app-accent)] shrink-0 mt-0.5" strokeWidth={2.5} />
            <p className="text-sm text-ink/70 leading-relaxed">
              LiveFolio operates entirely <strong className="text-ink">locally</strong>. No
              credentials or files ever leave this system.
            </p>
          </div>
        </SectionShell>

      {/* Public Share Tunnel */}
      <SectionShell icon={Globe} title="Public Share Tunnel">
          <div className="flex items-center justify-between p-4" style={subtleInk}>
            <div className="space-y-0.5 text-left">
              <span className="block text-sm font-semibold text-ink">
                {tunnelActive ? 'Tunnel Connected' : 'Tunnel Closed'}
              </span>
              <p className="text-xs text-ink/60 leading-tight">
                {tunnelActive ? 'Live on the public internet' : 'Only bound to localhost'}
              </p>
            </div>
            <button
              type="button"
              onClick={toggleTunnel}
              disabled={isTogglingTunnel}
              className={cn(
                'h-9 px-4 text-xs font-semibold tracking-tight flex items-center gap-2 transition-all  hover:shadow-sm disabled:opacity-50',
                tunnelActive ? 'bg-bone text-ink' : 'bg-[var(--app-accent)] text-bone'
              )}
            >
              {isTogglingTunnel && <LoadingSpinner size="xs" />}
              <span>{tunnelActive ? 'Disconnect' : 'Go Live'}</span>
            </button>
          </div>

          {tunnelActive && tunnelUrl && (
            <div className="space-y-2">
              <label className="text-xs font-semibold tracking-tight text-ink/60 block">
                Temporary Public URL
              </label>
              <div className="relative">
                <Input readOnly value={tunnelUrl} className="pr-11 text-xs" />
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-11 w-11"
                  onClick={() => {
                    navigator.clipboard.writeText(tunnelUrl);
                    setCopiedTunnelUrl(true);
                    setTimeout(() => setCopiedTunnelUrl(false), 2000);
                  }}
                  aria-label="Copy tunnel URL"
                >
                  {copiedTunnelUrl ? (
                    <Check size={14} className="text-[var(--app-accent)]" />
                  ) : (
                    <Copy size={14} />
                  )}
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-2 pt-4 border-t border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10">
            <label className="text-xs font-semibold tracking-tight text-ink/60 block">
              Custom Tunnel Override (ngrok/Cloudflare)
            </label>
            <Input
              placeholder="e.g., https://my-livefolio.ngrok-free.app"
              value={customTunnelUrl}
              onChange={(e) => handleSaveCustomTunnelUrl(e.target.value)}
              className="text-xs"
            />
            <p className="text-xs text-ink/60 leading-tight">
              If set, share buttons will use this URL instead of the temporary Cloudflare
              tunnel.
            </p>
          </div>
        </SectionShell>

    </>
  );
}
