'use client';

import { useCallback, useState } from 'react';
import { isCloud } from '@/lib/env';

/**
 * useAvailableModels — POST /api/models for both chat surfaces.
 *
 * `ChatHero` (the `/app` creation hero) and `FolioChatPanel` (the Chat tab of
 * a folio) each carried their own copy of this request, its response handling
 * and its `localStorage` reconciliation. The copies had ALREADY drifted, so
 * every divergence is an explicit option rather than a silently chosen winner —
 * the stored model is what the next AI request sends:
 *
 *   • `buildPayload`          — the Cloud bodies differ: the hero sends its live
 *                               `aiProvider` plus any BYOK keys, the folio panel
 *                               asks for `managed`. The OSS body is identical in
 *                               both, and is built here from the caller's thunk
 *                               so keys are read at request time, as before.
 *   • `onCloudDefaultModel`   — the hero mirrors the server default into its own
 *                               `selectedModel` state; the folio panel leaves
 *                               the model to its store.
 *   • `onOssModelResolved`    — the same split for the OSS reconciliation result
 *                               (called with '' when the list came back empty).
 *   • `onSettled`             — the folio panel re-syncs its provider store after
 *                               every attempt, success or failure; the hero has
 *                               nothing to sync.
 *   • `errorLog`              — the two surfaces word their `console.error`
 *                               differently, and both strings are kept verbatim.
 *
 * Everything else is a verbatim lift: the endpoint, the
 * `data.success && Array.isArray(data.models)` guard, the exact `localStorage`
 * writes, and the `isLoadingModels` flag. The OSS branch was written as two
 * shapes (`ChatHero` used `!currentInList && length > 0` / `else if length === 0`,
 * `FolioChatPanel` nested the same two cases) — they are provably equivalent,
 * since `.some()` on an empty list is always false, so the nested form is kept
 * once here.
 */

export interface AvailableModel {
  id: string;
  name: string;
  provider: string;
}

export interface UseAvailableModelsOptions {
  /** Body for POST /api/models. A thunk, so whatever it reads (provider, BYOK
   *  keys, ollama host) is read at request time, exactly as inline. */
  buildPayload: () => unknown;
  /** The caller's current model value — drives the OSS list reconciliation. */
  selectedModel: string;
  onCloudDefaultModel?: (modelId: string) => void;
  onOssModelResolved?: (modelId: string) => void;
  onSettled?: () => void;
  errorLog: string;
}

export function useAvailableModels({
  buildPayload,
  selectedModel,
  onCloudDefaultModel,
  onOssModelResolved,
  onSettled,
  errorLog,
}: UseAvailableModelsOptions) {
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  const fetchAvailableModels = useCallback(async () => {
    setIsLoadingModels(true);
    try {
      const res = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.models)) {
          setAvailableModels(data.models);
          if (isCloud) {
            const auto = data.defaultModel || '';
            onCloudDefaultModel?.(auto);
            if (auto) localStorage.setItem('LiveFolio_selected_model', auto);
            else localStorage.removeItem('LiveFolio_selected_model');
          } else {
            // Keep the stored model while the live list still offers it —
            // otherwise fall to the first model, or clear it when empty.
            const currentInList = data.models.some((m: AvailableModel) => {
              const value = m.provider === 'local' ? `ollama/${m.id}` : m.id;
              return value === selectedModel;
            });
            if (!currentInList) {
              if (data.models.length > 0) {
                const firstModel = data.models[0];
                const finalVal = firstModel.provider === 'local' ? `ollama/${firstModel.id}` : firstModel.id;
                onOssModelResolved?.(finalVal);
                localStorage.setItem('LiveFolio_selected_model', finalVal);
              } else {
                onOssModelResolved?.('');
                localStorage.removeItem('LiveFolio_selected_model');
              }
            }
          }
        }
      }
    } catch {
      console.error(errorLog);
    } finally {
      setIsLoadingModels(false);
      onSettled?.();
    }
  }, [buildPayload, selectedModel, onCloudDefaultModel, onOssModelResolved, onSettled, errorLog]);

  return { availableModels, setAvailableModels, isLoadingModels, fetchAvailableModels };
}
