'use client';

/**
 * No-folio mode of the unified ChatView (P2-T01) — the creation hero on
 * `/app`. A fork of `components/dashboard/DashboardChat.tsx` behavior plus the
 * model/design plumbing that lived in `app/dashboard/page.tsx` (read-only
 * sources): folio creation via `POST /api/files/ai-create`, template mode
 * chips, design drawer, auto-create toggle, staged-file attachments, and the
 * dash persona. After a successful creation the hero navigates to
 * `/app/<newId>` (the shell's folio route — Studio tab).
 *
 * Works in both modes. Cloud uses managed models resolved server-side; OSS
 * uses the visitor's own key (BYOK), sent with the request — the route has
 * carried an OSS branch since it was written. When no model is configured
 * locally the empty state asks for a key inline rather than pointing at
 * Settings.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  Send, Plus, Palette, Paperclip, Zap, RefreshCw, Check,
  Image as ImageIcon, X, FileText, ChevronDown, ArrowUpRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Toggle } from '../settings-popup/toggle';
import { Dropdown } from '@/components/ui/dropdown';
import { useSettingsPopup } from '../settings-popup';
import { LocalModelKeys } from '@/components/chat/LocalModelKeys';
import { isCloud, isOSS } from '@/lib/env';
import {
  type PendingMode,
  type StagedFile,
  TEMPLATE_OPTIONS,
  MODE_LABELS,
} from '@/lib/create-folio-state';

const DesignDrawer = dynamic(() => import('@/components/studio/DesignDrawer'), { ssr: false });

interface ChatMessage {
  sender: 'user' | 'assistant';
  text: string;
}

// Quick Actions — same two as studio ChatPanel / DashboardChat
const DASH_QUICK_ACTIONS = [
  { label: 'Apply Design System', prompt: 'Generate a folio using the current design system preferences (theme, typography, palette, libraries).' },
  { label: 'Audit UI', prompt: 'Generate a folio with a UI audit checklist — spacing, border radius, responsiveness, and color consistency. Reply with findings first, do not generate code yet.' },
];

/** Dashboard page defaults (v1 page.tsx lines 113–116).
 *  theme MUST be a real design-system name from design-systems/ (the drawer
 *  resolves these via /api/design-systems) — invented names get ignored by
 *  the model, which then improvises a generic/brutalist look. */
const DESIGN_DEFAULTS = {
  theme: 'Editorial',
  typography: 'Cabinet Grotesk & Inter',
  palette: 'Cobalt Ocean',
  libraries: ['Tailwind CSS Core', 'Lucide Icons'] as string[],
};


export function ChatHero() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [promptInput, setPromptInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [isAutoCreate, setIsAutoCreate] = useState(true);
  const [pendingMode, setPendingMode] = useState<PendingMode>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Options (ported from the modal's AI tab): name override + sharing
  const { openSection } = useSettingsPopup();
  const [showOptions, setShowOptions] = useState(false);
  const [folioTitle, setFolioTitle] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [accessKey, setAccessKey] = useState('');
  const [allowComments, setAllowComments] = useState(true);
  const [presentationModeOnly, setPresentationModeOnly] = useState(false);
  const [status, setStatus] = useState<'draft' | 'published'>('draft');

  // Tools menu (the ➕ labeled menu)
  const [isToolsMenuOpen, setIsToolsMenuOpen] = useState(false);
  const toolsBtnRef = useRef<HTMLButtonElement>(null);
  const [toolsMenuPos, setToolsMenuPos] = useState({ bottom: 0, left: 0 });

  // Anchor the tools menu to the ➕ button (fixed positioning needs real
  // coordinates — absolute inside a fixed backdrop would hit the viewport edge).
  const toggleToolsMenu = () => {
    if (!isToolsMenuOpen && toolsBtnRef.current) {
      const rect = toolsBtnRef.current.getBoundingClientRect();
      setToolsMenuPos({ bottom: window.innerHeight - rect.bottom + 8, left: rect.left });
    }
    setIsToolsMenuOpen(!isToolsMenuOpen);
  };
  // Display-only AI identity (labels); the persona editor was removed.
  const [personaName, setPersonaName] = useState('');
  const [, setPersonaRole] = useState('');

  // Staged files (attachments / visual assets)
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Model plumbing (v1 dashboard page 95–320)
  const [selectedModel, setSelectedModel] = useState('');
  const [availableModels, setAvailableModels] = useState<{ id: string; name: string; provider: string }[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [aiProvider, setAiProvider] = useState<'managed' | 'local' | 'byok'>(isCloud ? 'managed' : 'byok');
  const [openaiKey, setOpenaiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [deepseekKey, setDeepseekKey] = useState('');
  const [ollamaHost, setOllamaHost] = useState('http://localhost:11434');
  const [, setOllamaRunning] = useState(false);
  const [, setOllamaModels] = useState<{ name: string }[]>([]);
  const [selectedLocalModel, setSelectedLocalModel] = useState('');
  const [, setCheckingOllama] = useState(false);

  // Design state (hero drawer feeds the ai-create body)
  const [selectedTheme, setSelectedTheme] = useState(DESIGN_DEFAULTS.theme);
  const [selectedTypography, setSelectedTypography] = useState(DESIGN_DEFAULTS.typography);
  const [selectedColorPalette, setSelectedColorPalette] = useState(DESIGN_DEFAULTS.palette);
  const [selectedLibraries, setSelectedLibraries] = useState<string[]>(DESIGN_DEFAULTS.libraries);
  const [isDesignDrawerOpen, setIsDesignDrawerOpen] = useState(false);
  const [availableDesignSystems, setAvailableDesignSystems] = useState<{ id: string; name: string; description: string; thumbnail: string }[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load dash persona from localStorage (v1 DashboardChat)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setPersonaName(localStorage.getItem('LiveFolio_dash_persona_name') || '');
      setPersonaRole(localStorage.getItem('LiveFolio_dash_persona_role') || '');
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamText]);

  // Model sanitize + probes (v1 dashboard page 134–211 + 229–320)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let savedProvider = localStorage.getItem('LiveFolio_api_provider') as 'managed' | 'local' | 'byok' | null;
    let savedSelectedModel = localStorage.getItem('LiveFolio_selected_model') || '';

    if (isCloud) {
      if (!savedProvider) savedProvider = 'managed';
    } else {
      if (
        savedSelectedModel === 'gemini-1.5-flash' ||
        savedSelectedModel === 'gpt-4o-mini' ||
        savedSelectedModel === 'gemini-3.5-flash' ||
        savedSelectedModel === 'ollama/llama3'
      ) {
        localStorage.removeItem('LiveFolio_selected_model');
        savedSelectedModel = '';
      }
      if (!savedProvider || savedProvider === 'managed') {
        savedProvider = 'byok';
        localStorage.setItem('LiveFolio_api_provider', 'byok');
      }
    }

    setAiProvider(savedProvider as 'managed' | 'local' | 'byok');
    setOpenaiKey(localStorage.getItem('LiveFolio_openai_api_key') || '');
    setAnthropicKey(localStorage.getItem('LiveFolio_anthropic_api_key') || '');
    setGeminiKey(localStorage.getItem('LiveFolio_gemini_api_key') || '');
    setDeepseekKey(localStorage.getItem('LiveFolio_deepseek_api_key') || '');
    const savedHost = localStorage.getItem('LiveFolio_ollama_host');
    if (savedHost) setOllamaHost(savedHost);

    if (savedSelectedModel && savedSelectedModel.startsWith('ollama/')) {
      setSelectedLocalModel(savedSelectedModel.replace('ollama/', ''));
    }
    if (savedSelectedModel) setSelectedModel(savedSelectedModel);

    void checkOllamaStatus();
    void fetchAvailableModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const fetchDesignSystems = async () => {
      try {
        const res = await fetch('/api/design-systems');
        if (res.ok) setAvailableDesignSystems(await res.json());
      } catch {}
    };
    fetchDesignSystems();
  }, []);

  const checkOllamaStatus = useCallback(async (customHost?: string) => {
    setCheckingOllama(true);
    const targetHost = customHost || ollamaHost || 'http://localhost:11434';
    try {
      const res = await fetch(`/api/onboard?host=${encodeURIComponent(targetHost)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.running) {
          setOllamaRunning(true);
          setOllamaModels(data.models || []);
          if (data.models && data.models.length > 0) {
            if (!selectedLocalModel || !data.models.some((m: { name: string }) => m.name === selectedLocalModel)) {
              handleLocalModelChange(data.models[0].name);
            }
          }
        } else setOllamaRunning(false);
      } else setOllamaRunning(false);
    } catch {
      setOllamaRunning(false);
    } finally {
      setCheckingOllama(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ollamaHost, selectedLocalModel]);

  const handleLocalModelChange = (modelName: string) => {
    setSelectedLocalModel(modelName);
    if (typeof window !== 'undefined' && aiProvider === 'local') {
      localStorage.setItem('LiveFolio_selected_model', `ollama/${modelName}`);
      setSelectedModel(`ollama/${modelName}`);
      window.dispatchEvent(new Event('storage'));
    }
  };

  const fetchAvailableModels = useCallback(async () => {
    setIsLoadingModels(true);
    try {
      const bodyPayload = isCloud
        ? {
            provider: aiProvider,
            openaiKey: aiProvider === 'byok' ? localStorage.getItem('LiveFolio_openai_api_key') : undefined,
            anthropicKey: aiProvider === 'byok' ? localStorage.getItem('LiveFolio_anthropic_api_key') : undefined,
            geminiKey: aiProvider === 'byok' ? localStorage.getItem('LiveFolio_gemini_api_key') : undefined,
            deepseekKey: aiProvider === 'byok' ? localStorage.getItem('LiveFolio_deepseek_api_key') : undefined,
            ollamaHost: aiProvider === 'local' ? localStorage.getItem('LiveFolio_ollama_host') || 'http://localhost:11434' : undefined,
          }
        : {
            provider: 'all_oss',
            openaiKey: localStorage.getItem('LiveFolio_openai_api_key') || undefined,
            anthropicKey: localStorage.getItem('LiveFolio_anthropic_api_key') || undefined,
            geminiKey: localStorage.getItem('LiveFolio_gemini_api_key') || undefined,
            deepseekKey: localStorage.getItem('LiveFolio_deepseek_api_key') || undefined,
            ollamaHost: localStorage.getItem('LiveFolio_ollama_host') || 'http://localhost:11434',
          };

      const res = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.models)) {
          setAvailableModels(data.models);
          if (isCloud) {
            const auto = data.defaultModel || '';
            setSelectedModel(auto);
            if (auto) localStorage.setItem('LiveFolio_selected_model', auto);
            else localStorage.removeItem('LiveFolio_selected_model');
          } else {
            const currentInList = data.models.some((m: { id: string; provider: string }) => {
              const value = m.provider === 'local' ? `ollama/${m.id}` : m.id;
              return value === selectedModel;
            });
            if (!currentInList && data.models.length > 0) {
              const firstModel = data.models[0];
              const finalVal = firstModel.provider === 'local' ? `ollama/${firstModel.id}` : firstModel.id;
              setSelectedModel(finalVal);
              localStorage.setItem('LiveFolio_selected_model', finalVal);
            } else if (data.models.length === 0) {
              setSelectedModel('');
              localStorage.removeItem('LiveFolio_selected_model');
            }
          }
        }
      }
    } catch {
      console.error('Failed to fetch models');
    } finally {
      setIsLoadingModels(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCloud, aiProvider, selectedModel]);

  // ── File handling (v1 DashboardChat) ───────────────────────────────────

  const handleFilePick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const mime = file.type;
        const type = mime.startsWith('image/') ? 'image' : mime.includes('pdf') || mime.includes('text') || mime.includes('md') ? 'document' : 'other';
        setStagedFiles((prev) => [...prev, { name: file.name, dataUrl, type }]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  }, []);

  const removeStagedFile = (name: string) => {
    setStagedFiles((prev) => prev.filter((f) => f.name !== name));
  };

  // ── Folio creation (v1 dashboard page handleCreateWithPrompt 416–470) ──

  const handleCreateWithPrompt = async (prompt: string, mode?: PendingMode | null) => {
    setIsCreating(true);
    setCreateError(null);
    try {
      // Each mode carries an explicit design direction — without it the model
      // falls back to its default generic (often brutalist) aesthetic.
      const modeHints: Record<string, string> = {
        deck: 'Create a presentation deck with slides. Design: clean modern pitch deck — generous whitespace, large crisp sans headings, one restrained accent color, subtle shadows, refined borders. Polished and premium, NOT brutalist — no harsh outlines or raw offsets. ',
        document: 'Create a rich document with editorial layout. Design: elegant editorial long-form — comfortable reading measure, serif display headings, muted ink tones, refined hairline rules. ',
        spreadsheet: 'Create a live spreadsheet with data tables. Design: precise data tool — structured tables, clear hierarchy, restrained accent, comfortable density, generous cell padding. ',
        dashboard: 'Create an admin dashboard with metric cards and charts. Design: modern SaaS admin — soft-shadowed cards, rounded corners, muted background, single accent color, clean sans type. ',
        infography: 'Create a visual infography with oversized stat numerals and annotated charts. Design: refined editorial data story — oversized numerals, annotated charts, restrained high-contrast palette, elegant spacing, premium typography. ',
      };
      const fullPrompt = (mode ? modeHints[mode] || '' : '') + prompt;

      const body: Record<string, unknown> = { prompt: fullPrompt };
      if (isOSS) {
        const provider = aiProvider === 'local'
          ? 'ollama'
          : aiProvider === 'byok'
            ? (geminiKey ? 'gemini' : anthropicKey ? 'anthropic' : openaiKey ? 'openai' : deepseekKey ? 'deepseek' : 'gemini')
            : 'gemini';
        body.provider = provider;
        body.model = selectedModel || undefined;
        if (geminiKey) body.apiKey = geminiKey;
        else if (anthropicKey) body.apiKey = anthropicKey;
        else if (openaiKey) body.apiKey = openaiKey;
        else if (deepseekKey) body.apiKey = deepseekKey;
      }
      body.designPreferences = {
        theme: selectedTheme,
        typography: selectedTypography,
        palette: selectedColorPalette,
        libraries: selectedLibraries,
      };
      if (folioTitle.trim()) body.title = folioTitle.trim();
      body.isPrivate = isPrivate;
      if (isPrivate && accessKey) body.accessKey = accessKey;
      body.allowComments = allowComments;
      body.presentationModeOnly = presentationModeOnly;
      body.status = status;
      if (stagedFiles.length > 0) {
        body.referenceFiles = stagedFiles.map((f) => ({ filename: f.name, content: f.dataUrl }));
      }

      const res = await fetch('/api/files/ai-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        // The shell's folio route — lands on the Studio tab of the new folio.
        window.location.href = `/app/${data.project.id}`;
      } else {
        const errData = await res.json().catch(() => ({}));
        setCreateError(errData.error || 'Try a different prompt or pick a template mode.');
      }
    } catch {
      setCreateError('Something went wrong. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };

  // ── Chat actions (v1 DashboardChat executeSend) ────────────────────────

  const executeSend = async (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed || isStreaming || isCreating) return;

    let fullPrompt = trimmed;
    if (pendingMode) {
      const modeLabel = MODE_LABELS[pendingMode] || pendingMode;
      fullPrompt = `[Mode: ${modeLabel}] ${trimmed}`;
    }
    if (stagedFiles.length > 0) {
      const fileList = stagedFiles.map((f) => f.name).join(', ');
      fullPrompt = `${fullPrompt}\n\n[Attached files: ${fileList}]`;
    }

    const userMsg: ChatMessage = { sender: 'user', text: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setPromptInput('');
    setIsStreaming(true);
    setStreamText('');

    if (isAutoCreate) {
      try {
        setStreamText('Creating your folio…');
        await handleCreateWithPrompt(fullPrompt, pendingMode);
        setPendingMode(null);
        setStagedFiles([]);
        setMessages((prev) => [...prev, {
          sender: 'assistant',
          text: 'Your folio is ready! Opening it now.',
        }]);
      } catch {
        setMessages((prev) => [...prev, {
          sender: 'assistant',
          text: "I couldn't create that folio. Please check your AI configuration and try again.",
        }]);
      } finally {
        setIsStreaming(false);
        setStreamText('');
      }
    } else {
      await new Promise((r) => setTimeout(r, 800));
      setStreamText('Analyzing your request…');
      await new Promise((r) => setTimeout(r, 1200));
      const modeHint = pendingMode ? ` as a ${MODE_LABELS[pendingMode]}` : '';
      setMessages((prev) => [...prev, {
        sender: 'assistant',
        text: `I'll build this${modeHint} with a clean, responsive layout.\n\nToggle **Auto-Create** (🔄) and send your prompt — I'll generate it instantly.`,
      }]);
      setIsStreaming(false);
      setStreamText('');
    }
  };

  const handleSend = () => void executeSend(promptInput);

  const handleQuickAction = (prompt: string) => {
    setIsToolsMenuOpen(false);
    void executeSend(prompt);
  };

  const handleTemplateClick = (mode: 'deck' | 'document' | 'spreadsheet' | 'dashboard' | 'infography') => {
    setPendingMode((prev) => (prev === mode ? null : mode));
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (availableModels.length > 0) handleSend();
    }
  };

  const hasNoModels = availableModels.length === 0;
  const isInputDisabled = isStreaming || isCreating || (hasNoModels && !isLoadingModels);

  return (
    <div className="flex flex-col w-full h-full bg-[#F4F4F0] dark:bg-[#0F0F0D]">
      {/* Hidden file inputs */}
      <input ref={fileInputRef} type="file" className="hidden" multiple
        accept=".pdf,.txt,.md,.csv,.html,.json,.png,.jpg,.jpeg,.webp,.svg"
        onChange={handleFilePick} />
      <input ref={imageInputRef} type="file" className="hidden" multiple
        accept="image/*" onChange={handleFilePick} />

      {/* Messages Area — centered column like ChatGPT */}
      <div ref={chatContainerRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-6">
        <div className="max-w-2xl mx-auto w-full flex flex-col">
        {messages.length === 0 && !isStreaming ? (
          <div className="flex flex-col items-center justify-center flex-1 text-center px-4 py-8 space-y-4">
            <span className="inline-block h-8 w-8 bg-[var(--app-accent)]" />
            <h3 className="text-base font-semibold text-ink font-sans tracking-tight">
              What do you want to build?
            </h3>
            <button
              type="button"
              onClick={() => openSection('integrations')}
              className="group inline-flex items-center gap-1 text-xs font-medium text-ink/50 transition-colors hover:text-[var(--app-accent)] cursor-pointer"
            >
              Prefer your own agent? Connect it via MCP
              <ArrowUpRight size={11} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </button>
            {isOSS && availableModels.length === 0 && !isLoadingModels && (
              <div className="mx-auto w-full max-w-md space-y-2 text-left">
                <p className="text-[12px] font-semibold text-ink">
                  Add your model key to start building
                </p>
                <div className="rounded-xl border border-[#0F0F0D]/10 bg-[#0F0F0D]/[0.02] p-3 dark:border-[#F4F4F0]/10 dark:bg-[#F4F4F0]/[0.03]">
                  <LocalModelKeys
                    dense
                    onChanged={(configured) => {
                      if (configured) void fetchAvailableModels();
                    }}
                  />
                </div>
                <p className="text-[11px] leading-relaxed text-ink/45">
                  No keys handy? An agent on this machine can publish for you instead —
                  connect it via MCP above.
                </p>
              </div>
            )}
            {createError && (
              <p className="max-w-sm text-[11px] font-medium leading-relaxed text-red-600 dark:text-red-400 border border-red-600/50 px-3 py-2">
                {createError}
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((msg, idx) => (
              <div key={idx} className={cn('flex flex-col gap-1.5 mb-1', msg.sender === 'user' ? 'items-end' : 'items-start')}>
                <div className="flex items-center gap-2 px-1">
                  {msg.sender !== 'user' && (
                    <div className="w-1.5 h-1.5 rounded-full bg-[var(--app-accent)] shadow-[0_0_6px_color-mix(in srgb, var(--app-accent) 60%, transparent)]" />
                  )}
                  <span className="text-xs font-extrabold text-zinc-400 tracking-tight font-sans">
                    {msg.sender === 'user' ? 'You' : (personaName || 'LIVEFOLIO AI')}
                  </span>
                </div>
                <div className={cn(
                  'max-w-[95%] p-3 text-[13px] border transition-all duration-300',
                  msg.sender === 'user'
                    ? 'bg-ink text-bone font-medium rounded-xl shadow-sm ml-auto'
                    : 'bg-white dark:bg-zinc-900 text-ink rounded-xl border border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 shadow-sm',
                )}>
                  <p className="leading-relaxed font-semibold whitespace-pre-wrap">{msg.text}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {isStreaming && (
          <div className="flex flex-col gap-1.5 items-start mt-2">
            <div className="flex items-center gap-2 px-1">
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--app-accent)] shadow-[0_0_6px_color-mix(in srgb, var(--app-accent) 60%, transparent)] animate-pulse" />
              <span className="text-xs font-extrabold text-zinc-400 tracking-tight font-sans">
                {personaName || 'LIVEFOLIO AI'}
              </span>
            </div>
            <div className="max-w-[95%] px-3 py-2 text-[13px] border relative rounded-lg bg-[#F4F4F0] text-[#0F0F0D] border border-[#0F0F0D]">
              {streamText ? (
                <div className="relative">
                  <p className="leading-relaxed font-semibold whitespace-pre-wrap">{streamText}</p>
                  <span className="inline-block w-1 h-3.5 ml-0.5 animate-pulse align-middle bg-[var(--app-accent)]" />
                </div>
              ) : (
                <div className="flex items-center gap-0.5">
                  <div className="w-1 h-1 animate-pulse bg-[var(--app-accent)]" />
                  <div className="w-1 h-1 animate-pulse bg-[var(--app-accent)]" style={{ animationDelay: '0.15s' }} />
                  <div className="w-1 h-1 animate-pulse bg-[var(--app-accent)]" style={{ animationDelay: '0.3s' }} />
                </div>
              )}
            </div>
          </div>
        )}

        </div>
        <div ref={messagesEndRef} />
      </div>

      {/* Staged files preview */}
      {stagedFiles.length > 0 && (
        <div className="px-4 pb-1 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {stagedFiles.map((f) => (
            <div key={f.name} className="flex items-center gap-1 px-2 py-1 border border-[#0F0F0D] bg-bone shrink-0">
              {f.type === 'image' ? <ImageIcon size={10} className="text-ink/50" /> : <FileText size={10} className="text-ink/50" />}
              <span className="text-xs  font-bold text-ink/70 truncate max-w-[80px]">{f.name}</span>
              <button onClick={() => removeStagedFile(f.name)} className="text-ink/40 hover:text-[var(--app-accent)]"><X size={10} /></button>
            </div>
          ))}
        </div>
      )}

      {/* Template Mode Selector + Input Area */}
      <div className="px-4 pt-2 pb-4 space-y-2 z-20 shrink-0 bg-[#F4F4F0] dark:bg-[#0F0F0D]">
        {/* Template mode selector */}
        <div id="hero-templates" className="flex flex-wrap items-center justify-center gap-2">
          {TEMPLATE_OPTIONS.map(({ mode, label, icon: Icon }) => {
            const isActive = pendingMode === mode;
            return (
              <button key={mode} type="button" onClick={() => handleTemplateClick(mode)} disabled={isCreating}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium cursor-pointer transition-colors',
                  isActive ? 'bg-[var(--app-accent)] text-white shadow-sm'
                    : 'bg-black/5 dark:bg-white/10 text-ink/60 hover:bg-black/10 dark:hover:bg-white/15 hover:text-ink',
                  'disabled:opacity-40 disabled:cursor-not-allowed',
                )}>
                <Icon size={12} />{label}
              </button>
            );
          })}
        </div>

        {/* Options: name + sharing (ported from the modal's AI tab) */}
        <div className="mx-auto max-w-2xl">
          <button
            type="button"
            onClick={() => setShowOptions(!showOptions)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-ink/50 transition-colors hover:text-ink',
              showOptions && 'text-ink'
            )}
          >
            <ChevronDown size={12} className={cn('transition-transform', showOptions && 'rotate-180')} />
            Options
          </button>
          {showOptions && (
            <div className="space-y-2.5 rounded-xl border border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 p-3">
              <div className="flex items-center gap-3">
                <label className="w-20 shrink-0 text-xs font-medium text-ink/60">Name</label>
                <input
                  value={folioTitle}
                  onChange={(e) => setFolioTitle(e.target.value)}
                  placeholder="Optional — AI names it if empty"
                  className="h-7 min-w-0 flex-1 border-0 border-b border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 bg-transparent px-0.5 text-[13px] text-ink placeholder:text-ink/50 focus:border-b-2 focus:border-[var(--app-accent)] focus:outline-none"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-ink">Private folio</span>
                <Toggle checked={isPrivate} onChange={() => setIsPrivate(!isPrivate)} />
              </div>
              {isPrivate && (
                <div className="flex items-center gap-3">
                  <label className="w-20 shrink-0 text-xs font-medium text-ink/60">Access key</label>
                  <input
                    value={accessKey}
                    onChange={(e) => setAccessKey(e.target.value)}
                    placeholder="Optional access key"
                    className="h-7 min-w-0 flex-1 border-0 border-b border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 bg-transparent px-0.5 text-[13px] text-ink placeholder:text-ink/50 focus:border-b-2 focus:border-[var(--app-accent)] focus:outline-none"
                  />
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-ink">Allow comments</span>
                <Toggle checked={allowComments} onChange={() => setAllowComments(!allowComments)} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-ink">Presentation mode only</span>
                <Toggle checked={presentationModeOnly} onChange={() => setPresentationModeOnly(!presentationModeOnly)} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-ink">Status</span>
                <div className="flex items-center gap-3">
                  {(['draft', 'published'] as const).map((st) => (
                    <label key={st} className="flex cursor-pointer select-none items-center gap-1.5 text-[13px] text-ink/70">
                      <input type="radio" name="hero-status" checked={status === st} onChange={() => setStatus(st)} className="h-3.5 w-3.5 accent-[var(--app-accent)] cursor-pointer" />
                      {st}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <form
          id="hero-composer"
          onSubmit={(e) => { e.preventDefault(); handleSend(); }}
          className="relative w-full max-w-2xl mx-auto transition-all overflow-hidden rounded-xl border border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 bg-[#0F0F0D]/[0.03] dark:bg-[#F4F4F0]/[0.04] focus-within:border-[var(--app-accent)]/40">

          {/* Pending mode indicator */}
          {pendingMode && (
            <div className="px-3 py-1.5 flex items-center gap-2 bg-[var(--app-accent)]/10 border-b border-[var(--app-accent)]/20">
              <span className="px-1.5 py-0.5  text-xs font-bold uppercase bg-[var(--app-accent)] text-[#F4F4F0]">{MODE_LABELS[pendingMode]}</span>
              <span className=" text-xs text-zinc-500 truncate flex-1">Will create a {MODE_LABELS[pendingMode].toLowerCase()} folio</span>
              <button type="button" onClick={() => setPendingMode(null)} className="text-zinc-400 hover:text-zinc-600 p-0.5 cursor-pointer shrink-0"><X size={11} /></button>
            </div>
          )}

          <textarea ref={textareaRef} rows={2} value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)} onKeyDown={handleKeyDown}
            disabled={isInputDisabled}
            placeholder={
              isLoadingModels ? 'Loading available models…'
                : hasNoModels ? 'Add your model key above to start…'
                : pendingMode ? `Describe your ${MODE_LABELS[pendingMode].toLowerCase()}…`
                : 'Describe the folio you want to build…'
            }
            className="w-full bg-transparent border-0 px-4 py-2.5 text-[13px] text-[#0F0F0D] dark:text-[#F4F4F0] resize-none focus:outline-none focus:ring-0 placeholder:text-[#0F0F0D]/40 dark:placeholder:text-[#F4F4F0]/40 leading-relaxed disabled:text-zinc-400 disabled:cursor-not-allowed"
          />

          {/* Bottom Toolbar — ➕ [model▾] → */}
          <div className="flex items-center justify-between px-3 pt-1 gap-1 pb-3">
            <div className="flex items-center gap-0.5">
              <button type="button" ref={toolsBtnRef} onClick={toggleToolsMenu}
                className={cn('h-7 w-7 flex items-center justify-center transition-colors cursor-pointer shrink-0 rounded-lg',
                  isToolsMenuOpen ? 'bg-[var(--app-accent)]/10 text-[var(--app-accent)]' : 'text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:text-[var(--app-accent)] hover:bg-[var(--app-accent)]/10')}
                aria-label="Tools menu" title="Tools"><Plus size={14} /></button>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {!isCloud && (
                <div className="flex items-center gap-1 shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0 ml-1 bg-[var(--app-accent)]" />
                  <Dropdown
                    value={selectedModel}
                    onChange={(val) => { setSelectedModel(val); localStorage.setItem('LiveFolio_selected_model', val); }}
                    disabled={isLoadingModels || availableModels.length === 0}
                    title="AI Model"
                    ariaLabel="AI Model"
                    menuClassName="w-60 max-h-72 overflow-y-auto"
                    className="h-7 px-2 text-xs font-medium max-w-[110px] rounded-lg bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 border-0 text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70"
                    options={
                      isLoadingModels || availableModels.length === 0
                        ? [{ value: '', label: isLoadingModels ? 'Loading…' : 'No Models' }]
                        : availableModels.flatMap((m) => {
                            const value = m.provider === 'local' ? `ollama/${m.id}` : m.id;
                            const group = ({ local: 'Ollama', gemini: 'Gemini', openai: 'OpenAI', anthropic: 'Claude', deepseek: 'DeepSeek' } as Record<string, string>)[m.provider];
                            return { value, label: m.name, group };
                          })
                    }
                  />
                </div>
              )}
              <button type="submit"
                disabled={isInputDisabled || !promptInput.trim()}
                title={hasNoModels ? 'Add a model key to start' : undefined}
                className="w-7 h-7 flex items-center justify-center disabled:opacity-25 transition-colors cursor-pointer shrink-0 rounded-lg bg-[var(--app-accent)] text-white hover:bg-[var(--app-accent)]/90">
                {isStreaming || isCreating ? <LoadingSpinner size="xs" /> : <Send size={12} />}
              </button>
            </div>
          </div>

          {/* Tools menu — labeled rows, Apple-style (no borders) */}
          {isToolsMenuOpen && (
            <div className="fixed inset-0 z-[200]" onClick={() => setIsToolsMenuOpen(false)}>
              <div
                className="fixed p-1.5 w-56 space-y-0.5 rounded-xl bg-white dark:bg-[#171714] shadow-xl ring-1 ring-black/5 dark:ring-white/10 animate-in fade-in zoom-in-95 duration-100"
                style={{ bottom: toolsMenuPos.bottom, left: toolsMenuPos.left }}
                onClick={(e) => e.stopPropagation()}
              >
                <ToolsMenuRow
                  icon={Palette}
                  label="Design Library"
                  onClick={() => { setIsDesignDrawerOpen(true); setIsToolsMenuOpen(false); }}
                />
                <ToolsMenuRow
                  icon={Paperclip}
                  label="Attach File"
                  onClick={() => { fileInputRef.current?.click(); setIsToolsMenuOpen(false); }}
                />
                <ToolsMenuRow
                  icon={ImageIcon}
                  label="Visual Assets"
                  onClick={() => { imageInputRef.current?.click(); setIsToolsMenuOpen(false); }}
                />
                <div className="my-1 h-px bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10" />
                {DASH_QUICK_ACTIONS.map((action) => (
                  <ToolsMenuRow
                    key={action.label}
                    icon={Zap}
                    label={action.label}
                    disabled={isInputDisabled}
                    onClick={() => { handleQuickAction(action.prompt); setIsToolsMenuOpen(false); }}
                  />
                ))}
                <div className="my-1 h-px bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10" />
                <ToolsMenuRow
                  icon={RefreshCw}
                  label="Auto-Create"
                  active={isAutoCreate}
                  onClick={() => setIsAutoCreate(!isAutoCreate)}
                />
              </div>
            </div>
          )}
        </form>
      </div>

      <DesignDrawer
        isOpen={isDesignDrawerOpen}
        onClose={() => setIsDesignDrawerOpen(false)}
        availableDesignSystems={availableDesignSystems}
        selectedTheme={selectedTheme}
        selectedTypography={selectedTypography}
        selectedColorPalette={selectedColorPalette}
        projectMode={(pendingMode as 'deck' | 'document' | 'spreadsheet' | 'dashboard' | 'infography') || 'document'}
        onSelectTheme={(themeName) => setSelectedTheme(themeName)}
        onSelectTypography={(typographyName) => setSelectedTypography(typographyName)}
        onSelectPalette={(paletteName) => setSelectedColorPalette(paletteName)}
        selectedLibraries={selectedLibraries}
        onSelectMode={(mode) => setPendingMode(mode)}
        onSelectLibraries={(libs) => setSelectedLibraries(libs)}
        onRegenerate={() => setIsDesignDrawerOpen(false)}
      />
    </div>
  );
}

/** Labeled row for the composer's tools menu (Apple-style, borderless).
 *  Same component as FolioChatPanel / studio ChatPanel — one menu everywhere. */
function ToolsMenuRow({
  icon: Icon,
  label,
  onClick,
  active,
  disabled,
  hasIndicator,
}: {
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  hasIndicator?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full flex items-center gap-2.5 px-2.5 py-2 text-[13px] font-medium rounded-lg transition-colors cursor-pointer text-left disabled:opacity-40 disabled:cursor-not-allowed',
        active
          ? 'bg-[var(--app-accent)]/10 text-[var(--app-accent)]'
          : 'text-[#0F0F0D]/75 dark:text-[#F4F4F0]/75 hover:bg-[#0F0F0D]/5 dark:hover:bg-[#F4F4F0]/10 hover:text-[#0F0F0D] dark:hover:text-[#F4F4F0]',
      )}
    >
      <Icon size={14} className="shrink-0 text-[#0F0F0D]/45 dark:text-[#F4F4F0]/45" />
      <span className="truncate">{label}</span>
      {active ? (
        <Check size={12} className="ml-auto shrink-0 text-[var(--app-accent)]" />
      ) : hasIndicator ? (
        <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--app-accent)]" />
      ) : null}
    </button>
  );
}
