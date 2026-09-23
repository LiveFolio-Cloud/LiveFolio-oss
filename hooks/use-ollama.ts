'use client';

import { useCallback, useState } from 'react';

/**
 * useOllama — the Ollama reachability probe.
 *
 * Lifted from the two chat surfaces. The copies had drifted, so each difference
 * is an explicit option — none of them is silently unified:
 *
 *   • `host`               — the hero probes `/api/onboard?host=…` with its saved
 *                            host; the folio panel's older probe calls bare
 *                            `/api/onboard` and lets the server default. Omit
 *                            `host` to get the bare call.
 *   • `onAutoSelectModel`  — hero only: when the reported list does not contain
 *     (+ `selectedLocalModel`) the saved local model, the hero adopts the first
 *                            one. That call is genuinely observable (it can write
 *                            `LiveFolio_selected_model` and dispatch a `storage`
 *                            event), so it stays caller-owned.
 *   • `trackChecking`      — hero only: it has an in-flight flag. The folio panel
 *                            never had one, so it never had a `finally` either.
 *
 * ONE deliberate unification, and it is unobservable: `FolioChatPanel` gated its
 * success branch on `data.running && data.models` while the hero gated on
 * `data.running` alone. Both hosts discarded `running` and `models` on the spot
 * (`const [, setOllamaModels] = …`), so no render ever read them and no surface
 * can tell the two conditions apart. The hero's simpler condition is kept.
 */

export interface OllamaModel {
  name: string;
}

export interface UseOllamaOptions {
  /** Host to probe, sent as `?host=`. Omit for the bare `/api/onboard` call. */
  host?: string;
  /** Hero: the saved local model, checked against the reported list. */
  selectedLocalModel?: string;
  /** Hero: adopt the first reported model. Omit to skip the block entirely. */
  onAutoSelectModel?: (modelName: string) => void;
  /** Hero: set and expose the in-flight flag. */
  trackChecking?: boolean;
}

export function useOllama({
  host,
  selectedLocalModel,
  onAutoSelectModel,
  trackChecking,
}: UseOllamaOptions = {}) {
  const [ollamaRunning, setOllamaRunning] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [checkingOllama, setCheckingOllama] = useState(false);

  const probeOllama = useCallback(async () => {
    if (trackChecking) setCheckingOllama(true);
    try {
      const res = await fetch(host ? `/api/onboard?host=${encodeURIComponent(host)}` : '/api/onboard');
      if (res.ok) {
        const data = await res.json();
        if (data.running) {
          setOllamaRunning(true);
          setOllamaModels(data.models || []);
          if (onAutoSelectModel && data.models && data.models.length > 0) {
            if (!selectedLocalModel || !data.models.some((m: OllamaModel) => m.name === selectedLocalModel)) {
              onAutoSelectModel(data.models[0].name);
            }
          }
        } else {
          setOllamaRunning(false);
          setOllamaModels([]);
        }
      } else {
        setOllamaRunning(false);
        setOllamaModels([]);
      }
    } catch {
      setOllamaRunning(false);
      setOllamaModels([]);
    } finally {
      if (trackChecking) setCheckingOllama(false);
    }
  }, [host, selectedLocalModel, onAutoSelectModel, trackChecking]);

  return { ollamaRunning, ollamaModels, checkingOllama, probeOllama };
}
