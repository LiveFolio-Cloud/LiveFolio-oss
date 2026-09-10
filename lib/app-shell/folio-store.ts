/**
 * Per-folio UI store for the app shell (spike §4). One store instance per
 * folio, created by `createFolioStore(folioId)` and provided to the tab views
 * by `<FolioProvider>` (which lives in
 * `app/(app)/_components/folio-provider/FolioProvider.tsx` and is the only
 * place this factory is consumed).
 *
 * WHAT LIVES HERE — and what doesn't:
 * - Chat HISTORY stays server-side in `project.chats` (already persisted by
 *   the API). The store holds only the UI state AROUND it: draft, scroll,
 *   active proposal, AI-responding flags.
 * - `project` + `status` are the server truth as loaded by `fetchProject`
 *   (GET `/api/files/<id>`). Views read from here instead of fetching.
 * - AI-config fields are MIRRORS of the legacy global localStorage keys the
 *   v1 UI writes (`LiveFolio_selected_model`, `LiveFolio_api_provider`, the
 *   four BYOK keys, `LiveFolio_ollama_host`, `LiveFolio_ai_persona`). Those
 *   keys remain the single source of truth; `syncAiConfigFromGlobal()`
 *   re-reads them (P2-T02's settings popup calls it after writing).
 *
 * PERSISTENCE — manual localStorage, matching `lib/app-shell/layout-store.ts`
 * (NOT the zustand/persist middleware — the existing shell style). Two keys,
 * both read once at store creation:
 * - `LiveFolio_app_view.<folioId>` — the active shell tab id (P1-T02 spec);
 *   stale/unknown ids resolve to `studio`.
 * - `LiveFolio_app_<folioId>` — the rest of the persisted UI slice
 *   (`chatDraft`, `chatScroll`), one JSON object.
 * Everything else (`project`, `status`, `activeProposal`, `isAiResponding`,
 * `aiStreamText`, `chatError`, `activeFilename`, `isAutoApply`,
 * `targetedElement`, `attachedAsset`, AI mirrors, design mirrors) is
 * in-memory by design: a reload must NOT show a stale proposal, stream text
 * or "AI responding".
 *
 * P2-T01 ADDITIONS (implemented here by the ChatView agent; P2-T00 must keep
 * the `sendPrompt` / `commitProposal` / `clearChat` signatures exact):
 * - `sendPrompt` / `commitProposal` / `clearChat` — no longer stubs; they
 *   run the v1 streaming pipeline (ported from StudioClient 1584–1806, 1376–
 *   1441) against the store state.
 * - Streaming text + transient error: `aiStreamText`, `chatError`.
 * - Chat-context mirrors shared with the keep-alive Studio tab (spike §1.2
 *   "activeFilename sync"): `activeFilename`, `isAutoApply`,
 *   `targetedElement`, `attachedAsset`, and the design-system mirrors
 *   (`selectedTheme` … `projectMode`) hydrated from `project.designPreferences`.
 * - Tool orchestration (Epic #96): `updateToolCallStatus` + `executeToolCall`
 *   actions (ported from StudioClient 1446–1582) so the ChatView tool cards
 *   and the streaming pipeline share one implementation.
 */
import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import type { HTMLFile, ToolCallState } from '@/lib/db';
import { DEFAULT_VIEW_ID, resolveActiveView } from './views';
import { isCloud } from '@/lib/env';

/** Provider fetch lifecycle for `project`. */
export type FolioStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Scope argument for `sendPrompt`, mirroring the v1 chat panel's. */
export type ChatScope = 'Whole Project' | 'Current Screen';

/** One proposed file inside `activeProposal` / `commitProposal`. */
export interface ProposedFile {
  filename: string;
  code: string;
}

/**
 * The proposal awaiting apply/decline, mirrored from the v1
 * `StudioClient` state at line 555 (shape kept identical so the P2 fork maps
 * 1:1).
 */
export interface ActiveProposal {
  files: { [filename: string]: string };
  explanation: string;
}

/** Targeted-element banner data (Point & Polish), mirror of v1 line 540. */
export interface TargetedElement {
  selector: string;
  outerHTML: string;
  tagName: string;
}

/** Design-system preferences mirror (v1 StudioClient lines 219–223). */
export type FolioProjectMode = HTMLFile['projectMode'];
export interface DesignSystemPrefs {
  theme: string;
  typography: string;
  palette: string;
  libraries: string[];
  projectMode: NonNullable<FolioProjectMode>;
}

/** v1 StudioClient design-state defaults (lines 219–223). */
export const DESIGN_DEFAULTS: DesignSystemPrefs = {
  theme: 'Warm Editorial',
  typography: 'Lora & Inter',
  palette: 'Honey Amber',
  libraries: ['Tailwind CSS Core', 'Lucide Icons'],
  projectMode: 'document',
};

/**
 * The persisted slice of the store (the two localStorage keys described in
 * the header). `view` lives under its own key; `chatDraft`/`chatScroll` under
 * `LiveFolio_app_<folioId>`.
 */
interface PersistedSlice {
  chatDraft: string;
  chatScroll: number;
}

export interface FolioState {
  // --- Server truth (in-memory) -----------------------------------------
  /** The folio document as returned by GET /api/files/<id>. */
  project: HTMLFile | null;
  status: FolioStatus;
  /** Human-readable fetch error message; null when the last fetch succeeded. */
  error: string | null;

  // --- Persisted UI slice -----------------------------------------------
  /** Active shell tab id; always a registered view (falls back to `studio`). */
  view: string;
  /** Chat composer draft, persisted per folio across reloads/tab switches. */
  chatDraft: string;
  /** Chat scroll offset, persisted per folio across reloads/tab switches. */
  chatScroll: number;

  // --- Chat/AI session state (in-memory, NOT persisted) -----------------
  /** Proposal awaiting apply/decline in the Studio overlay (P2-T00). */
  activeProposal: ActiveProposal | null;
  isAiResponding: boolean;
  /** Free-form status message, '' when idle (v1 `aiStreamStatus` mirror). */
  aiStreamStatus: string;
  /** Streaming assistant text for the in-flight bubble (v1 `aiStreamText`). */
  aiStreamText: string;
  /** Transient chat error (generation/tool/commit failures); cleared on next send. */
  chatError: string | null;
  /** The canvas file the folio editor is showing; shared with StudioView. */
  activeFilename: string;
  /** The version the preview iframe is showing; set on fetch and by StudioView. */
  activePreviewVersion: string;
  /** Auto-apply toggle (v1 `isAutoApply`, default true). */
  isAutoApply: boolean;
  /** Targeted element banner (Point & Polish); set by the Studio iframe bridge. */
  targetedElement: TargetedElement | null;
  /** Attached visual asset path included in the next prompt (v1). */
  attachedAsset: string | null;

  // --- AI-config mirrors (global keys are the source of truth) ----------
  selectedModel: string;
  aiProvider: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  geminiApiKey: string;
  deepseekApiKey: string;
  ollamaHost: string;
  personaName: string;
  personaRole: string;
  personaInstruction: string;

  // --- Design-system mirrors (project.designPreferences is server truth) -
  selectedTheme: string;
  selectedTypography: string;
  selectedColorPalette: string;
  selectedLibraries: string[];
  projectMode: NonNullable<FolioProjectMode>;

  // --- Actions -----------------------------------------------------------
  /** Fetch GET /api/files/<id> into `project`; guarded against re-entry
   *  while a fetch is already in flight. Does not clear `project` on error
   *  (a failed refetch keeps the last good document). Re-resolves the AI and
   *  design mirrors from the fetched project. */
  fetchProject: () => Promise<void>;
  /** Set the active tab; writes `LiveFolio_app_view.<folioId>` and resolves
   *  stale ids to `studio`. */
  setView: (id: string) => void;
  /** Update the persisted chat draft (`LiveFolio_app_<folioId>`). */
  setChatDraft: (draft: string) => void;
  /** Update the persisted chat scroll (`LiveFolio_app_<folioId>`). */
  setChatScroll: (scroll: number) => void;
  /** Re-read the legacy global localStorage keys into the AI-config mirrors
   *  (call after the P2-T02 settings popup writes them). */
  syncAiConfigFromGlobal: () => void;
  /** Set the file the Studio canvas shows (iframe src + `Current Screen`
   *  scope); shared with the Studio tab via the keep-alive provider. */
  setActiveFilename: (filename: string) => void;
  /** Set the version the preview iframe shows (shared with StudioView). */
  setActivePreviewVersion: (versionId: string) => void;
  /** Download the active preview version as a ZIP (ported from StudioClient). */
  exportFolio: () => void;
  /** Toggle auto-apply (v1 `isAutoApply`). */
  setIsAutoApply: (value: boolean) => void;
  /** Set the Point & Polish targeted element banner (iframe bridge). */
  setTargetedElement: (element: TargetedElement | null) => void;
  /** Set the attached visual asset included in the next prompt. */
  setAttachedAsset: (asset: string | null) => void;
  /** Set/clear the proposal awaiting apply/decline (P2-T00 proposal overlay). */
  setActiveProposal: (proposal: ActiveProposal | null) => void;
  /** Merge design-system preference mirrors (the caller persists to the
   *  server via PUT /api/files/<id> and refetches). */
  setDesignSystemPrefs: (prefs: Partial<DesignSystemPrefs>) => void;
  /**
   * Run the v1 streaming chat pipeline (P2-T01): POST
   * `/api/files/<id>/ai-stream` for Gemini models, `/api/files/<id>/ai`
   * otherwise, tool calls via `/api/chat/tools/execute`, propose/apply
   * writing `activeProposal`. On success the project is refetched (chats and
   * versions land server-side). Switches the shell to the Studio tab when a
   * proposal awaits review or an auto-apply lands (v1 auto-dismisses the
   * chat overlay to reveal the canvas).
   */
  sendPrompt: (prompt: string, scope?: ChatScope) => Promise<void>;
  /** Apply a proposed patch: POST `/api/files/<id>/ai` action
   *  `commit-proposal` (new version), then refetch `project`. */
  commitProposal: (
    msgId: string,
    files: ProposedFile[],
    explanation: string
  ) => Promise<void>;
  /** Clear the server-side chat history (`project.chats`), then refetch. */
  clearChat: () => Promise<void>;
  /** Update one tool call's status inside `project.chats` (Epic #96). */
  updateToolCallStatus: (
    toolCallId: string,
    status: ToolCallState['status'],
    statusMessage?: string,
    result?: ToolCallState['result'],
    error?: string
  ) => void;
  /** Execute a tool call via `/api/chat/tools/execute` with SSE status
   *  streaming; returns the `done` result (Epic #96). */
  executeToolCall: (
    toolCallId: string,
    toolName: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool arguments arrive as parsed JSON from the AI; shape varies per tool
    toolArguments: Record<string, any>,
    confirmed?: boolean
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- resolves to the SSE 'done' result payload; shape varies per tool
  ) => Promise<any>;
}

// ---------------------------------------------------------------------------
// Legacy localStorage keys (single source of truth for AI config) — key names
// identical to the v1 UI's (see `app/studio/[id]/StudioClient.tsx`).
// ---------------------------------------------------------------------------
const GLOBAL_KEYS = {
  model: 'LiveFolio_selected_model',
  provider: 'LiveFolio_api_provider',
  openai: 'LiveFolio_openai_api_key',
  anthropic: 'LiveFolio_anthropic_api_key',
  gemini: 'LiveFolio_gemini_api_key',
  deepseek: 'LiveFolio_deepseek_api_key',
  ollamaHost: 'LiveFolio_ollama_host',
  persona: 'LiveFolio_ai_persona',
} as const;

const OLLAMA_HOST_DEFAULT = 'http://localhost:11434';

export const DEFAULT_PERSONA = {
  name: 'LiveFolio Co-pilot',
  role: 'AI Design & Layout Guide',
  instruction: '',
} as const;

function readGlobal(key: string, fallback = ''): string {
  if (typeof window === 'undefined') return fallback;
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    // storage unavailable (private mode etc.) — mirrors stay at defaults.
    return fallback;
  }
}

/**
 * Persona resolution precedence (v1 `StudioClient` lines 1188–1209): the
 * user-level `LiveFolio_ai_persona` key wins, then the folio-level
 * `project.aiPersona`, then the defaults.
 */
function readPersonaMirrors(project: HTMLFile | null): {
  personaName: string;
  personaRole: string;
  personaInstruction: string;
} {
  const saved = readGlobal(GLOBAL_KEYS.persona, '');
  if (saved !== '') {
    try {
      const parsed = JSON.parse(saved) as {
        name?: string;
        role?: string;
        systemInstruction?: string;
      };
      return {
        personaName: parsed.name || DEFAULT_PERSONA.name,
        personaRole: parsed.role || DEFAULT_PERSONA.role,
        personaInstruction: parsed.systemInstruction || DEFAULT_PERSONA.instruction,
      };
    } catch {
      // ignore parse errors — fall through to folio-level/default persona.
    }
  }
  const folio = project?.aiPersona;
  return {
    personaName: folio?.name || DEFAULT_PERSONA.name,
    personaRole: folio?.role || DEFAULT_PERSONA.role,
    personaInstruction: folio?.systemInstruction || DEFAULT_PERSONA.instruction,
  };
}

/** Full AI-config mirror read from the global keys. */
function readAiMirrors(project: HTMLFile | null) {
  return {
    selectedModel: readGlobal(GLOBAL_KEYS.model),
    aiProvider: readGlobal(GLOBAL_KEYS.provider),
    openaiApiKey: readGlobal(GLOBAL_KEYS.openai),
    anthropicApiKey: readGlobal(GLOBAL_KEYS.anthropic),
    geminiApiKey: readGlobal(GLOBAL_KEYS.gemini),
    deepseekApiKey: readGlobal(GLOBAL_KEYS.deepseek),
    ollamaHost: readGlobal(GLOBAL_KEYS.ollamaHost, OLLAMA_HOST_DEFAULT),
    ...readPersonaMirrors(project),
  };
}

/** Design-system mirrors hydrated from the folio's server-side prefs. The
 *  state fields are the v1 `StudioClient` names (`selectedTheme` …), so the
 *  returned keys are mapped to those. */
function readDesignMirrors(project: HTMLFile | null): {
  selectedTheme: string;
  selectedTypography: string;
  selectedColorPalette: string;
  selectedLibraries: string[];
  projectMode: NonNullable<FolioProjectMode>;
} {
  return {
    selectedTheme: project?.designPreferences?.theme || DESIGN_DEFAULTS.theme,
    selectedTypography:
      project?.designPreferences?.typography || DESIGN_DEFAULTS.typography,
    selectedColorPalette:
      project?.designPreferences?.palette || DESIGN_DEFAULTS.palette,
    selectedLibraries: project?.designPreferences?.libraries?.length
      ? [...project.designPreferences.libraries]
      : [...DESIGN_DEFAULTS.libraries],
    projectMode: project?.projectMode || DESIGN_DEFAULTS.projectMode,
  };
}

// ---------------------------------------------------------------------------
// Per-folio persistence (manual localStorage, layout-store style).
// ---------------------------------------------------------------------------
const viewKey = (folioId: string) => `LiveFolio_app_view.${folioId}`;
const storeKey = (folioId: string) => `LiveFolio_app_${folioId}`;

function readPersistedSlice(folioId: string): PersistedSlice {
  if (typeof window === 'undefined') return { chatDraft: '', chatScroll: 0 };
  try {
    const raw = window.localStorage.getItem(storeKey(folioId));
    if (raw === null) return { chatDraft: '', chatScroll: 0 };
    const parsed = JSON.parse(raw) as Partial<PersistedSlice>;
    return {
      chatDraft: typeof parsed.chatDraft === 'string' ? parsed.chatDraft : '',
      chatScroll:
        typeof parsed.chatScroll === 'number' && Number.isFinite(parsed.chatScroll)
          ? parsed.chatScroll
          : 0,
    };
  } catch {
    // Corrupt JSON or unavailable storage — start from the empty slice.
    return { chatDraft: '', chatScroll: 0 };
  }
}

function writePersistedSlice(folioId: string, slice: PersistedSlice): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storeKey(folioId), JSON.stringify(slice));
  } catch {
    // storage unavailable — the store still works for this session.
  }
}

export function readViewPref(folioId: string): string {
  if (typeof window === 'undefined') return DEFAULT_VIEW_ID;
  try {
    return resolveActiveView(window.localStorage.getItem(viewKey(folioId)));
  } catch {
    return DEFAULT_VIEW_ID;
  }
}

function writeViewPref(folioId: string, view: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(viewKey(folioId), view);
  } catch {
    // storage unavailable — view still switches for this session.
  }
}

// ---------------------------------------------------------------------------
// Store factory.
// ---------------------------------------------------------------------------

/**
 * Create the zustand store for one folio. Called once per folio by the
 * `FolioProvider` (keyed by `folioId` so navigation between folios remounts
 * and gets a fresh store + persisted-slice read).
 */
export function createFolioStore(folioId: string): StoreApi<FolioState> {
  const persisted = readPersistedSlice(folioId);

  return createStore<FolioState>()((set, get) => ({
    // Server truth
    project: null,
    status: 'idle',
    error: null,

    // Persisted UI slice. `view` starts at the DEFAULT (never localStorage):
    // reading it at store-creation makes the server render one tab and the
    // client hydrate another (hydration mismatch). The FolioProvider restores
    // the persisted view in a mount effect instead.
    view: DEFAULT_VIEW_ID,
    chatDraft: persisted.chatDraft,
    chatScroll: persisted.chatScroll,

    // Chat/AI session state
    activeProposal: null,
    isAiResponding: false,
    aiStreamStatus: '',
    aiStreamText: '',
    chatError: null,
    activeFilename: 'index.html',
    activePreviewVersion: '',
    isAutoApply: true,
    targetedElement: null,
    attachedAsset: null,

    // AI-config mirrors (global keys are the source of truth)
    ...readAiMirrors(null),

    // Design-system mirrors (project.designPreferences is server truth)
    ...readDesignMirrors(null),

    // Actions
    fetchProject: async () => {
      if (get().status === 'loading') return; // one in-flight fetch per folio
      set({ status: 'loading', error: null });
      try {
        const res = await fetch(`/api/files/${folioId}`);
        if (!res.ok) {
          throw new Error(
            res.status === 404
              ? 'Folio not found.'
              : `Failed to load folio (HTTP ${res.status}).`
          );
        }
        const found = (await res.json()) as HTMLFile | { error?: string };
        if (typeof (found as { error?: string }).error === 'string') {
          throw new Error((found as { error: string }).error);
        }
        const project = found as HTMLFile;
        const latestVersion = project.versions[project.versions.length - 1];
        set({
          project,
          status: 'ready',
          error: null,
          activePreviewVersion: latestVersion?.versionId ?? get().activePreviewVersion,
          ...readAiMirrors(project),
          ...readDesignMirrors(project),
        });
      } catch (err) {
        // Keep the last good `project` on a failed refetch.
        set({
          status: 'error',
          error: err instanceof Error ? err.message : 'Failed to load folio.',
        });
      }
    },

    setView: (id) => {
      const resolved = resolveActiveView(id);
      if (resolved === get().view) return;
      writeViewPref(folioId, resolved);
      set({ view: resolved });
    },

    setChatDraft: (chatDraft) => {
      if (chatDraft === get().chatDraft) return;
      writePersistedSlice(folioId, { chatDraft, chatScroll: get().chatScroll });
      set({ chatDraft });
    },

    setChatScroll: (chatScroll) => {
      if (chatScroll === get().chatScroll) return;
      writePersistedSlice(folioId, { chatDraft: get().chatDraft, chatScroll });
      set({ chatScroll });
    },

    syncAiConfigFromGlobal: () => set((s) => ({ ...readAiMirrors(s.project) })),

    setActiveFilename: (activeFilename) => {
      if (activeFilename === get().activeFilename) return;
      set({ activeFilename });
    },

    setActivePreviewVersion: (activePreviewVersion) => {
      if (activePreviewVersion === get().activePreviewVersion) return;
      set({ activePreviewVersion });
    },

    exportFolio: () => {
      const { project, activePreviewVersion } = get();
      if (!project) return;
      const activeVersionObj =
        project.versions.find((v) => v.versionId === activePreviewVersion) ??
        project.versions[project.versions.length - 1];
      if (!activeVersionObj) return;
      const files = activeVersionObj.files;
      const filenames = Object.keys(files);
      if (filenames.length === 0) return;

      // Pure-JS ZIP generator (ported from StudioClient handleExport).
      const encoder = new TextEncoder();
      const fileEntries = [];
      const centralDir = [];
      let offset = 0;

      for (const name of filenames) {
        const content = files[name];
        const nameBytes = encoder.encode(name);
        const dataBytes = encoder.encode(content);

        let crc = 0xffffffff;
        for (let i = 0; i < dataBytes.length; i++) {
          crc ^= dataBytes[i];
          for (let j = 0; j < 8; j++) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
          }
        }
        crc = (crc ^ 0xffffffff) >>> 0;

        const localHeader = new Uint8Array(30 + nameBytes.length);
        const lv = new DataView(localHeader.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(6, 0x0800, true);
        lv.setUint16(8, 0, true);
        lv.setUint16(10, 0, true);
        lv.setUint16(12, 0, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, dataBytes.length, true);
        lv.setUint32(22, dataBytes.length, true);
        lv.setUint16(26, nameBytes.length, true);
        lv.setUint16(28, 0, true);
        localHeader.set(nameBytes, 30);

        fileEntries.push({ name: nameBytes, data: dataBytes, crc, offset });
        centralDir.push(localHeader, dataBytes);
        offset += localHeader.length + dataBytes.length;
      }

      const cdParts = [];
      const cdOffset = offset;
      for (const entry of fileEntries) {
        const cdHeader = new Uint8Array(46 + entry.name.length);
        const cv = new DataView(cdHeader.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x0800, true);
        cv.setUint16(10, 0, true);
        cv.setUint16(12, 0, true);
        cv.setUint32(16, entry.crc, true);
        cv.setUint32(20, entry.data.length, true);
        cv.setUint32(24, entry.data.length, true);
        cv.setUint16(28, entry.name.length, true);
        cv.setUint16(30, 0, true);
        cv.setUint16(32, 0, true);
        cv.setUint16(34, 0, true);
        cv.setUint16(36, 0, true);
        cv.setUint32(38, 0, true);
        cv.setUint32(42, entry.offset, true);
        cdHeader.set(entry.name, 46);
        cdParts.push(cdHeader);
      }
      const cdBytes = new Uint8Array(cdParts.reduce((acc, p) => acc + p.length, 0));
      let cdPos = 0;
      for (const part of cdParts) {
        cdBytes.set(part, cdPos);
        cdPos += part.length;
      }

      const eocd = new Uint8Array(22);
      const ev = new DataView(eocd.buffer);
      ev.setUint32(0, 0x06054b50, true);
      ev.setUint16(4, 0, true);
      ev.setUint16(6, 0, true);
      ev.setUint16(8, fileEntries.length, true);
      ev.setUint16(10, fileEntries.length, true);
      ev.setUint32(12, cdBytes.length, true);
      ev.setUint32(16, cdOffset, true);
      ev.setUint16(20, 0, true);

      const zipSize = offset + cdBytes.length + 22;
      const zip = new Uint8Array(zipSize);
      let zipPos = 0;
      for (const part of centralDir) {
        zip.set(part, zipPos);
        zipPos += part.length;
      }
      zip.set(cdBytes, zipPos);
      zip.set(eocd, zipPos + cdBytes.length);

      const blob = new Blob([zip], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (project?.title || 'folio') + '-export.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },

    setIsAutoApply: (isAutoApply) => {
      if (isAutoApply === get().isAutoApply) return;
      set({ isAutoApply });
    },

    setTargetedElement: (targetedElement) => set({ targetedElement }),

    setAttachedAsset: (attachedAsset) => set({ attachedAsset }),

    setActiveProposal: (activeProposal) => set({ activeProposal }),

    setDesignSystemPrefs: (prefs) =>
      set((s) => ({
        selectedTheme: prefs.theme ?? s.selectedTheme,
        selectedTypography: prefs.typography ?? s.selectedTypography,
        selectedColorPalette: prefs.palette ?? s.selectedColorPalette,
        selectedLibraries: prefs.libraries
          ? [...prefs.libraries]
          : s.selectedLibraries,
        projectMode: prefs.projectMode ?? s.projectMode,
      })),

    // --- P2-T01: the v1 streaming pipeline (ported from StudioClient) -----

    updateToolCallStatus: (toolCallId, status, statusMessage, result, error) => {
      const project = get().project;
      if (!project) return;
      const updatedChats = (project.chats || []).map((msg) => {
        if (!msg.toolCalls) return msg;
        const updatedToolCalls = msg.toolCalls.map((tc) => {
          if (tc.id !== toolCallId) return tc;
          return { ...tc, status, statusMessage, result, error };
        });
        return { ...msg, toolCalls: updatedToolCalls };
      });
      set({ project: { ...project, chats: updatedChats } });
    },

    executeToolCall: async (toolCallId, toolName, toolArguments, confirmed = false) => {
      const res = await fetch('/api/chat/tools/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: get().project?.id,
          toolName,
          toolArguments,
          confirmed,
          stream: true,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ message: 'Execution failed' }));
        throw new Error(errData.message || `Tool execution failed (${res.status})`);
      }

      // Read SSE stream for status updates
      const reader = res.body?.getReader();
      if (!reader) {
        const data = await res.json();
        return data.result;
      }

      const decoder = new TextDecoder();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SSE 'done' payload is parsed JSON; shape varies per tool
      let result: any = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === 'status') {
                // Update tool call status in chat
                get().updateToolCallStatus(toolCallId, 'executing', event.message);
              } else if (event.type === 'done') {
                result = event.result;
              }
            } catch {
              /* skip malformed events */
            }
          }
        }
      }

      return result;
    },

    commitProposal: async (msgId, files, explanation) => {
      const project = get().project;
      if (!project || get().isAiResponding) return;
      set({ isAiResponding: true });

      try {
        const filesMap: { [filename: string]: string } = {};
        files.forEach((f) => {
          filesMap[f.filename] = f.code;
        });

        const res = await fetch(`/api/files/${project.id}/ai`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'commit-proposal',
            messageId: msgId,
            proposedFiles: filesMap,
            proposedExplanation: explanation,
            simulatedAuthor: isCloud ? 'LiveFolio User' : 'OSS User',
          }),
        });

        if (res.ok) {
          await get().fetchProject();
        } else {
          const errData = await res.json().catch(() => ({}));
          set({
            chatError:
              (errData as { error?: string }).error ||
              'Failed to apply the proposal.',
          });
        }
      } catch (err) {
        console.error('Failed to commit proposal:', err);
        set({ chatError: 'Failed to apply the proposal.' });
      } finally {
        set({ isAiResponding: false });
      }
    },

    clearChat: async () => {
      const project = get().project;
      if (!project || get().isAiResponding) return;
      try {
        const res = await fetch(`/api/files/${project.id}/ai`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'clear-chat' }),
        });
        if (res.ok) {
          await get().fetchProject();
        } else {
          const errData = await res.json().catch(() => ({}));
          set({
            chatError:
              (errData as { error?: string }).error || 'Failed to clear chat.',
          });
        }
      } catch (err) {
        console.error('Failed to clear chat:', err);
        set({ chatError: 'Failed to clear chat.' });
      }
    },

    sendPrompt: async (prompt, scope) => {
      const finalPrompt = (prompt || '').trim();
      const project = get().project;
      if (!finalPrompt || !project || get().isAiResponding) return;

      const finalScope = scope ?? 'Current Screen';

      // Resolve API key from the store's AI mirrors based on the model.
      const model = get().selectedModel.toLowerCase();
      let apiKey = '';
      if (model.startsWith('gemini')) apiKey = get().geminiApiKey;
      else if (model.startsWith('claude')) apiKey = get().anthropicApiKey;
      else if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3'))
        apiKey = get().openaiApiKey;
      else if (model.startsWith('deepseek')) apiKey = get().deepseekApiKey;

      // Pre-flight validation: prevent request if model is empty or the key
      // is missing for cloud models (v1 lines 1606–1618). The ChatView
      // composer is disabled in the same situation, so this is a safety net
      // for bridge-initiated sends (LIVEFOLIO_SUGGEST_PROMPT).
      if (!get().selectedModel) {
        set({
          chatError:
            'No model configured. Configure an API key in Settings or start Ollama to chat.',
        });
        return;
      }
      const isCloudModel =
        model.startsWith('gemini') ||
        model.startsWith('claude') ||
        model.startsWith('gpt') ||
        model.startsWith('o1') ||
        model.startsWith('o3') ||
        model.startsWith('deepseek');
      if (isCloudModel && get().aiProvider !== 'managed' && !apiKey) {
        set({
          chatError: `Configuration missing. Provide a valid API key for the ${get().selectedModel} engine.`,
        });
        return;
      }

      const finalTargetedElement = get().targetedElement;
      const {
        selectedModel,
        aiProvider,
        isAutoApply,
        attachedAsset,
        activeFilename,
        personaName,
        personaRole,
        personaInstruction,
        selectedTheme,
        selectedTypography,
        selectedColorPalette,
        selectedLibraries,
      } = get();

      set({ targetedElement: null });
      get().setChatDraft('');
      set({
        isAiResponding: true,
        aiStreamText: '',
        aiStreamStatus: 'initiating co-pilot...',
        chatError: null,
      });

      const promptWithAsset = attachedAsset
        ? `${finalPrompt}\n\n[Context: Use the attached visual asset located at relative path "${attachedAsset}" in the project.]`
        : finalPrompt;

      try {
        const latestVersion = project.versions[project.versions.length - 1];
        const isGemini = selectedModel.toLowerCase().startsWith('gemini');

        const requestBody = {
          userPrompt: promptWithAsset,
          files: latestVersion.files,
          pageContext: finalScope,
          activeFilename: finalScope === 'Current Screen' ? activeFilename : undefined,
          chatHistory: project.chats || [],
          persona: {
            name: personaName,
            role: personaRole,
            systemInstruction: personaInstruction,
          },
          selectedModel,
          aiProvider,
          apiKey,
          executeImmediately: isAutoApply,
          designSystem: {
            theme: selectedTheme,
            typography: selectedTypography,
            palette: selectedColorPalette,
            libraries: selectedLibraries,
          },
          targetedElement: finalTargetedElement
            ? {
                selector: finalTargetedElement.selector,
                outerHTML: finalTargetedElement.outerHTML,
                tagName: finalTargetedElement.tagName,
                activeFilename,
              }
            : undefined,
        };

        if (isGemini) {
          const res = await fetch(`/api/files/${project.id}/ai-stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          });

          if (!res.ok) {
            let errMsg = 'The AI was unable to complete this request.';
            try {
              const errorData = await res.json();
              errMsg = errorData.error || errMsg;
            } catch {
              /* keep default message */
            }
            set({ chatError: errMsg });
            return;
          }

          const reader = res.body?.getReader();
          if (!reader) {
            set({ chatError: 'Unable to establish streaming connection.' });
            return;
          }

          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data: ')) continue;

              try {
                const data = JSON.parse(trimmed.slice(6));
                if (data.type === 'status') {
                  set({ aiStreamStatus: data.message });
                } else if (data.type === 'chunk') {
                  set({ aiStreamText: get().aiStreamText + data.text });
                } else if (data.type === 'done') {
                  if (data.success) {
                    if (!isAutoApply && data.proposedFiles) {
                      set({
                        activeProposal: {
                          files: data.proposedFiles,
                          explanation:
                            data.explanation ||
                            'AI generated a new design proposal.',
                        },
                      });
                      // Surface the proposal overlay on the Studio tab (v1
                      // dismisses the chat overlay to reveal the canvas).
                      get().setView('studio');
                    }
                    await get().fetchProject();
                    if (isAutoApply) {
                      get().setView('studio');
                    }
                  }
                } else if (data.type === 'error') {
                  set({
                    chatError:
                      data.message || 'An error occurred during generation.',
                  });
                }
              } catch (err) {
                console.error('Failed to parse stream event:', err);
              }
            }
          }
        } else {
          const res = await fetch(`/api/files/${project.id}/ai`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          });

          if (res.ok) {
            const data = await res.json();
            if (data.success) {
              // Epic #96: most tools are executed server-side. Only handle
              // tools the server couldn't execute (delete_page needs client
              // confirmation).
              if (data.toolCalls?.length > 0) {
                const pendingTools = data.toolCalls.filter(
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- data comes from res.json() (any); annotation required under noImplicitAny
                  (tc: any) => tc.status === 'pending' || tc.name === 'delete_page'
                );
                // Reload to show pending tool cards (or the results).
                await get().fetchProject();
                if (pendingTools.length === 0 && isAutoApply) {
                  get().setView('studio');
                }
              } else {
                if (!isAutoApply && data.proposedFiles) {
                  set({
                    activeProposal: {
                      files: data.proposedFiles,
                      explanation:
                        data.explanation || 'AI generated a new design proposal.',
                    },
                  });
                  get().setView('studio');
                }
                await get().fetchProject();
                if (isAutoApply) {
                  get().setView('studio');
                }
              }
            }
          } else {
            const errorData = await res.json();
            set({
              chatError:
                errorData.error ||
                'The AI was unable to complete this request. Please try a different prompt or check your model settings.',
            });
          }
        }
      } catch (err) {
        console.error(err);
        set({ chatError: 'Connection lost or internal failure.' });
      } finally {
        set({
          isAiResponding: false,
          aiStreamText: '',
          aiStreamStatus: '',
          attachedAsset: null,
        });
      }
    },
  }));
}
