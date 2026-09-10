'use client';

/**
 * Settings popup — API Key section (Cloud): the workspace integration key
 * (formerly buried in Billing/Teammates as "Developer Settings & MCP
 * Handshake"). Same endpoints (/api/keys), same lifecycle — generate,
 * reveal/hide, copy, revoke — relocated to its own nav section, restyled
 * soft (no mono, no old orange).
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Code2, Copy, Eye, EyeOff, Key, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { SectionShell } from './section-shell';

export function ApiKeySection() {
  const [apiKey, setApiKey] = useState('');
  const [revealKey, setRevealKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDeletingKey, setIsDeletingKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load an existing key on mount (same probe as the settings page).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/keys');
        if (res.ok && !cancelled) {
          const data = await res.json();
          setApiKey(data.apiKey || '');
        }
      } catch {
        // no key yet — the empty state handles it.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const generateCloudKey = async () => {
    setKeyError(null);
    setIsGenerating(true);
    try {
      const res = await fetch('/api/keys', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setApiKey(data.apiKey);
        setRevealKey(true);
      } else {
        const data = await res.json().catch(() => ({}));
        setKeyError(data.error || 'Failed to generate integration key.');
      }
    } catch {
      setKeyError('Network error. Failed to generate integration key.');
    } finally {
      setIsGenerating(false);
    }
  };

  const deleteCloudKey = async () => {
    setKeyError(null);
    setIsDeletingKey(true);
    try {
      const res = await fetch('/api/keys', { method: 'DELETE' });
      if (res.ok) {
        setApiKey('');
        setRevealKey(false);
        setShowRevokeConfirm(false);
      } else {
        const data = await res.json().catch(() => ({}));
        setKeyError(data.error || 'Failed to revoke integration key.');
      }
    } catch {
      setKeyError('Network error. Failed to revoke integration key.');
    } finally {
      setIsDeletingKey(false);
    }
  };

  return (
    <>
      <SectionShell icon={Code2} title="LiveFolio API Key">
          <p className="text-sm text-ink/60 leading-relaxed">
            Generate a secure API Key to connect external AI agents (like Claude Desktop,
            Cursor, or Slack connectors) directly to your LiveFolio workspace.
          </p>

          <div className="space-y-3">
            <span className="text-xs font-semibold tracking-tight text-ink/60">
              Workspace API Key
            </span>

            {loading ? (
              <p className="text-sm text-ink/60">Loading…</p>
            ) : !apiKey ? (
              <div className="space-y-3 rounded-lg p-5 text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-ink text-bone">
                  <Key size={16} strokeWidth={2.5} />
                </div>
                <p className="text-sm text-ink/60 leading-relaxed">
                  No active Integration Key found for this workspace. External AI agents
                  require a secure API Key to synchronize.
                </p>
                <Button onClick={generateCloudKey} disabled={isGenerating} className="w-full">
                  {isGenerating ? <LoadingSpinner size="xs" /> : <Plus size={12} className="mr-1.5" />}
                  <span>Generate Workspace API Key</span>
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2 rounded-lg p-3">
                  <span className="flex-1 truncate text-xs text-ink select-all">
                    {revealKey
                      ? apiKey
                      : `${apiKey.substring(0, 12)}••••••••••••••••${apiKey.substring(apiKey.length - 4)}`}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setRevealKey(!revealKey)}
                      className="p-1 text-ink/60 hover:text-[var(--app-accent)] transition-colors"
                      title={revealKey ? 'Hide API Key' : 'Reveal API Key'}
                    >
                      {revealKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(apiKey);
                        setCopiedKey(true);
                        setTimeout(() => setCopiedKey(false), 1500);
                      }}
                      className="p-1 text-ink/60 hover:text-[var(--app-accent)] transition-colors"
                      title="Copy API Key"
                    >
                      {copiedKey ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                    </button>
                  </div>
                </div>

                {showRevokeConfirm ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm space-y-2">
                    <p className="font-semibold text-red-700 flex items-center gap-1.5">
                      <AlertTriangle size={11} />
                      <span>Are you absolutely sure?</span>
                    </p>
                    <p className="text-ink/70 leading-normal">
                      Revoking this key will immediately lock out any active integrations
                      (Cursor, Claude Desktop, Slack, or CI pipelines) using it.
                    </p>
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={deleteCloudKey}
                        disabled={isDeletingKey}
                        className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isDeletingKey ? 'Revoking…' : 'Yes, Revoke Key'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowRevokeConfirm(false)}
                        className="rounded-lg bg-black/5 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-black/10 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowRevokeConfirm(true)}
                    className="text-xs font-semibold tracking-tight text-red-600 hover:underline flex items-center gap-1"
                  >
                    <Trash2 size={10} />
                    <span>Revoke and Rotate Key</span>
                  </button>
                )}
              </div>
            )}

            {keyError && (
              <p className={cn('text-xs mt-2 text-red-600')}>{keyError}</p>
            )}
          </div>
        </SectionShell>
    </>
  );
}
