'use client';

/**
 * Local engine + BYOK provider keys — the ONE place keys are entered in OSS.
 * Embedded wherever the user first needs a model: the OSS home (/app),
 * inside the per-folio chat when no model is configured, and Settings →
 * General. Keys live in this browser under the LiveFolio_* localStorage keys
 * the chat reads (v1 parity) and travel only to the local server with each
 * chat request.
 */
import { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const BYOK_PROVIDERS = [
  { id: 'openai', label: 'OpenAI', placeholder: 'sk-…' },
  { id: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-…' },
  { id: 'gemini', label: 'Google Gemini', placeholder: 'AIza…' },
  { id: 'deepseek', label: 'DeepSeek', placeholder: 'sk-…' },
] as const;

const LS_KEY = (p: string) => `LiveFolio_${p}_api_key`;

export function LocalModelKeys({
  dense,
  onChanged,
}: {
  /** Compact paddings when embedded in the chat surface. */
  dense?: boolean;
  /** Fired with true once any key or a running Ollama makes chat possible. */
  onChanged?: (configured: boolean) => void;
}) {
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [ollamaHost, setOllamaHost] = useState('http://localhost:11434');
  const [ollamaState, setOllamaState] = useState<'checking' | 'active' | 'offline'>('checking');
  const [ollamaModelCount, setOllamaModelCount] = useState(0);

  const anyKeySet = Object.values(keys).some((v) => v.length > 0);

  const notify = useCallback(() => {
    onChanged?.(anyKeySet || ollamaState === 'active');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyKeySet, ollamaState]);

  const probeOllama = useCallback(async (host?: string) => {
    setOllamaState('checking');
    try {
      const target = host || 'http://localhost:11434';
      const res = await fetch(`/api/onboard?host=${encodeURIComponent(target)}`);
      if (res.ok) {
        const data = await res.json();
        setOllamaState(data.running ? 'active' : 'offline');
        setOllamaModelCount(Array.isArray(data.models) ? data.models.length : 0);
      } else {
        setOllamaState('offline');
      }
    } catch {
      setOllamaState('offline');
    }
  }, []);

  useEffect(() => {
    const read = (key: string) => localStorage.getItem(key) || '';
    const next: Record<string, string> = {};
    for (const p of BYOK_PROVIDERS) next[p.id] = read(LS_KEY(p.id));
    setKeys(next);
    const savedHost = read('LiveFolio_ollama_host');
    if (savedHost) setOllamaHost(savedHost);
    void probeOllama(read('LiveFolio_ollama_host') || 'http://localhost:11434');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    notify();
  }, [notify]);

  const saveKey = (provider: string, value: string) => {
    setKeys((prev) => ({ ...prev, [provider]: value }));
    localStorage.setItem(LS_KEY(provider), value);
    // A saved key implies BYOK — never leave a stale cloud 'managed' mode.
    localStorage.setItem('LiveFolio_api_provider', 'byok');
    if (value) onChanged?.(true);
  };

  const saveOllamaHost = (host: string) => {
    setOllamaHost(host);
    localStorage.setItem('LiveFolio_ollama_host', host);
    void probeOllama(host);
  };

  const inputCls = cn(
    'w-full rounded-lg border border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 bg-transparent font-mono text-[12px] text-ink placeholder:text-ink/40 focus:outline-none focus:border-[var(--app-accent)] transition-colors',
    dense ? 'h-7 px-2 pr-7' : 'h-8 px-2 pr-8'
  );

  return (
    <div className={cn('space-y-2.5', !dense && 'space-y-3')}>
      {/* Local engine status */}
      <div className="flex items-center justify-between">
        <span className={cn('font-medium text-ink', dense ? 'text-[13px]' : 'text-sm')}>
          Local engine
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 font-semibold',
            dense ? 'text-[11px]' : 'text-xs',
            ollamaState === 'active' ? 'text-emerald-600' : 'font-medium text-ink/60'
          )}
        >
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              ollamaState === 'active' ? 'bg-emerald-500' : 'bg-ink/30'
            )}
          />
          {ollamaState === 'checking'
            ? 'Checking…'
            : ollamaState === 'active'
              ? `Active · ${ollamaModelCount} model${ollamaModelCount === 1 ? '' : 's'}`
              : 'Offline'}
        </span>
      </div>

      {/* Ollama host */}
      <div>
        <label
          className={cn(
            'block font-medium text-ink/60',
            dense ? 'pb-1 text-[11px]' : 'pb-1 text-xs'
          )}
        >
          Ollama host
        </label>
        <div className="flex items-center gap-2">
          <input
            value={ollamaHost}
            onChange={(e) => setOllamaHost(e.target.value)}
            onBlur={(e) => saveOllamaHost(e.target.value.trim() || 'http://localhost:11434')}
            placeholder="http://localhost:11434"
            spellCheck={false}
            className={inputCls}
          />
          {ollamaState === 'checking' && (
            <Loader2 size={13} className="shrink-0 animate-spin text-ink/40" />
          )}
        </div>
      </div>

      {/* BYOK provider keys */}
      {BYOK_PROVIDERS.map((p) => {
        const value = keys[p.id] || '';
        const isSet = value.length > 0;
        const isRevealed = !!revealed[p.id];
        return (
          <div key={p.id}>
            <label
              className={cn(
                'block font-medium text-ink/60',
                dense ? 'pb-1 text-[11px]' : 'pb-1 text-xs'
              )}
            >
              {p.label}
            </label>
            <div className="relative">
              <input
                type={isRevealed ? 'text' : 'password'}
                value={value}
                onChange={(e) => saveKey(p.id, e.target.value)}
                placeholder={isSet ? '••••••••••••••••••' : p.placeholder}
                spellCheck={false}
                autoComplete="off"
                className={inputCls}
              />
              <button
                type="button"
                onClick={() => setRevealed((prev) => ({ ...prev, [p.id]: !isRevealed }))}
                title={isRevealed ? 'Hide key' : 'Show key'}
                aria-label={`${isRevealed ? 'Hide' : 'Show'} ${p.label} key`}
                className={cn(
                  'absolute top-1/2 -translate-y-1/2 p-0.5 text-ink/35 transition-colors hover:text-ink/70 cursor-pointer',
                  dense ? 'right-1.5' : 'right-2'
                )}
              >
                {isRevealed ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
              {isSet && (
                <span
                  className="absolute left-2 top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-emerald-500"
                  aria-hidden="true"
                />
              )}
            </div>
          </div>
        );
      })}

      <p className={cn('text-ink/45', dense ? 'text-[10px] leading-relaxed' : 'text-[11px] leading-relaxed')}>
        Keys are stored in this browser and sent only to the local server with
        each chat request — nothing ever leaves this machine. Pick the model in
        the chat&apos;s model menu once connected.
      </p>
    </div>
  );
}
