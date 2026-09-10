'use client';

/**
 * Per-folio provider for the app shell center column (spike §4). Instantiates
 * the per-folio zustand store (`createFolioStore`, persisted under
 * `LiveFolio_app_<folioId>` / `LiveFolio_app_view.<folioId>`) and shares it
 * with every tab view via React context. Mount once per folio — the tab bar,
 * the keep-alive Studio/Chat views (P2-T00/P2-T01), and the proposal overlay
 * all read/write the SAME store, which is how Chat keeps Studio's proposal
 * state and `project` in sync across keep-alive tabs.
 *
 * The provider auto-fetches the folio on mount (`fetchProject` → GET
 * `/api/files/<id>`); views may also call `fetchProject` to refetch.
 *
 * Consuming (harness `useStore`-style):
 *   const project = useFolioStore((s) => s.project);
 *   const sendPrompt = useFolioStore((s) => s.sendPrompt);
 * Selectors subscribe only to their slice — no per-folio context re-renders
 * for unrelated fields.
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
} from 'react';
import type { ReactNode } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand';
import { createFolioStore, readViewPref } from '@/lib/app-shell/folio-store';
import type { FolioState } from '@/lib/app-shell/folio-store';

interface FolioStoreContextValue {
  folioId: string;
  store: StoreApi<FolioState>;
}

const FolioStoreContext = createContext<FolioStoreContextValue | null>(null);

export function FolioProvider({
  folioId,
  children,
}: {
  folioId: string;
  children: ReactNode;
}) {
  // Create the store exactly once per provider instance. The mount site keys
  // the provider by folioId (`<FolioProvider key={folioId} ...>`), so
  // navigating /app/a → /app/b remounts it and gets a fresh store + a fresh
  // read of the persisted slice — never the previous folio's state.
  const storeRef = useRef<StoreApi<FolioState> | null>(null);
  if (storeRef.current === null) {
    storeRef.current = createFolioStore(folioId);
  }

  useEffect(() => {
    // Auto-fetch on mount. `fetchProject` is re-entry guarded, so React
    // StrictMode's double-invoked effect fetches once.
    void storeRef.current?.getState().fetchProject();
  }, []);

  useEffect(() => {
    // Restore the persisted active tab AFTER hydration (the store seeds the
    // default view so server and client render identically; reading
    // localStorage here avoids the TabBar hydration mismatch).
    storeRef.current?.getState().setView(readViewPref(folioId));
  }, [folioId]);

  return (
    <FolioStoreContext.Provider value={{ folioId, store: storeRef.current }}>
      {children}
    </FolioStoreContext.Provider>
  );
}

/**
 * Subscribe to a slice of the active folio's store. Must be called from a
 * component rendered inside `<FolioProvider>`.
 */
export function useFolioStore<T>(selector: (state: FolioState) => T): T {
  const ctx = useContext(FolioStoreContext);
  if (ctx === null) {
    throw new Error('useFolioStore must be used inside <FolioProvider>.');
  }
  return useStore(ctx.store, selector);
}
