'use client';

/**
 * Folio-selected mode of the unified ChatView — the "Chat" tab in
 * `/app/[folioId]`. A fork of `components/folio/ChatPanel.tsx` (read-only
 * source, ~80 props) re-wired to read the per-folio provider store:
 * `useFolioStore` selectors replace every prop. The streaming AI pipeline,
 * tool orchestration, proposal state and persona/design mirrors
 * live in `lib/app-shell/folio-store.ts` (ported from the legacy editor); this
 * component is the presentation layer on top of it.
 *
 * What was STRIPPED from the source (the shell owns these):
 * - the aside positioning (sidebar-collapse / mobile-panel classes) — the
 *   keep-alive tab container owns the box;
 * - the ~80 props — replaced by store selectors + component-local UI state
 *   (chatScope, drawer/portal open flags, tool-processing flags, alerts);
 * - the send/clear/proposal/tool handlers — replaced by store actions
 *   (`sendPrompt`, `clearChat`, `commitProposal`, `executeToolCall`,
 *   `updateToolCallStatus`) and thin local wrappers;
 * - the handleSendChatPromptRef — the FolioView iframe bridge calls
 *   the store's `sendPrompt` directly.
 *
 * Kept byte-identical: every bubble/toolbar/drawer/portal JSX block from the
 * source (bubbles, proposed-patch card, interactive cards, ToolCallCard
 * wiring, persona popover, asset shelf, preset chips, design drawer and
 * attachment portal triggers).
 *
 * Cloud/OSS gating identical to the source: the model picker renders only
 * when `!isCloud`; persona persists to the folio only in cloud mode.
 */
import React from 'react';
import dynamic from 'next/dynamic';
import {
  KeyRound, MessageSquare, Send, Zap, Wand2, Palette, Paperclip, X,
  Search, RefreshCw, Image, Plus, History,
  CheckCircle, Network,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { AlertDialog } from '@/components/ui/dialog';
import { Dropdown } from '@/components/ui/dropdown';
import ChatMessageRenderer from '@/components/folio/ChatMessageRenderer';
import ToolCallCard from '@/components/folio/ToolCallCard';
import { isCloud, isOSS } from '@/lib/env';
import { useFolioStore } from '../folio-provider/FolioProvider';
import type { ChatScope } from '@/lib/app-shell/folio-store';
import { LocalModelKeys } from '@/components/chat/LocalModelKeys';
import { ToolsMenuRow, useToolsMenu } from '@/components/chat/ToolsMenuRow';
import { useAvailableModels } from '@/hooks/use-available-models';
import { useDesignSystems } from '@/hooks/use-design-systems';
import { useOllama } from '@/hooks/use-ollama';
import { isLegacyModelId } from '@/lib/ai/legacy-models';
import { useAttachmentIntake } from '@/lib/attachments/use-attachment-intake';

// Lazy-loaded panels — mount only when the user engages (lazy-mount pattern).
const DesignDrawer = dynamic(() => import('@/components/folio/DesignDrawer'), { ssr: false });
const AttachmentPortal = dynamic(() => import('@/components/folio/AttachmentPortal'), { ssr: false });

function getPresetChips(tagName: string): string[] {
   const tag = tagName.toLowerCase();
   if (tag === 'button' || tag === 'a') return ['Make glowing SaaS style', 'Add hover animations', 'Modern gradient background', 'Make pill shape'];
   if (tag === 'section' || tag === 'div' || tag === 'article' || tag === 'main') return ['Convert to 3 columns grid', 'Add elegant glassmorphic card design', 'Make dark mode variant', 'Add warm radial halo background'];
   if (tag === 'img') return ['Add subtle shadow & border', 'Make rounded circular avatar', 'Add hover scale zoom effect', 'Modern aspect ratio container'];
   if (tag === 'p' || tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'span') return ['Make typography bold & elegant', 'Modern text gradient style', 'Improve font contrast and height', 'Add glow effect text shadow'];
   return ['Modernize this section style', 'Add micro-interactions', 'Convert to glassmorphic design'];
}

/** Confirm/alert dialog state (legacy editor alertDialog shape). */
interface AlertState {
  isOpen: boolean;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  variant?: 'default' | 'destructive';
}

export function FolioChatPanel() {
  // ── Store selectors (replaces the ~80 props) ──────────────────────────
  const project = useFolioStore((s) => s.project);
  const status = useFolioStore((s) => s.status);
  const error = useFolioStore((s) => s.error);
  const fetchProject = useFolioStore((s) => s.fetchProject);
  const chatDraft = useFolioStore((s) => s.chatDraft);
  const setChatDraft = useFolioStore((s) => s.setChatDraft);
  const chatScroll = useFolioStore((s) => s.chatScroll);
  const setChatScroll = useFolioStore((s) => s.setChatScroll);
  const isAiResponding = useFolioStore((s) => s.isAiResponding);
  const aiStreamStatus = useFolioStore((s) => s.aiStreamStatus);
  const aiStreamText = useFolioStore((s) => s.aiStreamText);
  const chatError = useFolioStore((s) => s.chatError);
  const activeFilename = useFolioStore((s) => s.activeFilename);
  const setActiveFilename = useFolioStore((s) => s.setActiveFilename);
  const isAutoApply = useFolioStore((s) => s.isAutoApply);
  const setIsAutoApply = useFolioStore((s) => s.setIsAutoApply);
  const targetedElement = useFolioStore((s) => s.targetedElement);
  const setTargetedElement = useFolioStore((s) => s.setTargetedElement);
  const attachedAsset = useFolioStore((s) => s.attachedAsset);
  const setAttachedAsset = useFolioStore((s) => s.setAttachedAsset);
  const selectedModel = useFolioStore((s) => s.selectedModel);
  const selectedTheme = useFolioStore((s) => s.selectedTheme);
  const selectedTypography = useFolioStore((s) => s.selectedTypography);
  const selectedColorPalette = useFolioStore((s) => s.selectedColorPalette);
  const selectedLibraries = useFolioStore((s) => s.selectedLibraries);
  const projectMode = useFolioStore((s) => s.projectMode);
  const syncAiConfigFromGlobal = useFolioStore((s) => s.syncAiConfigFromGlobal);
  const setDesignSystemPrefs = useFolioStore((s) => s.setDesignSystemPrefs);
  const sendPrompt = useFolioStore((s) => s.sendPrompt);
  const commitProposal = useFolioStore((s) => s.commitProposal);
  const executeToolCall = useFolioStore((s) => s.executeToolCall);
  const updateToolCallStatus = useFolioStore((s) => s.updateToolCallStatus);

  // ── Component-local UI state (not shared with the Editor tab) ─────────
  // Tools menu (the ➕ labeled menu) — open state + button anchor live in the
  // shared hook (identical in ChatHero).
  const { isToolsMenuOpen, setIsToolsMenuOpen, toolsBtnRef, toolsMenuPos, toggleToolsMenu } = useToolsMenu();
  const [chatScope, setChatScope] = React.useState<ChatScope>('Current Screen');
  const [isClearingChat] = React.useState(false);
  const [, setIsProcessingTools] = React.useState(false);
  const [isDesignDrawerOpen, setIsDesignDrawerOpen] = React.useState(false);
  // OSS: when no model is configured the model slot becomes the key-ask.
  const [keysPanelOpen, setKeysPanelOpen] = React.useState(false);
  // Attachment portal state now lives in `useAttachmentIntake` (below) —
  // shared with FolioView.

  const chatContainerRef = React.useRef<HTMLDivElement>(null);
  const chatEndRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const restoredScrollRef = React.useRef(false);

  const [alertDialog, setAlertDialog] = React.useState<AlertState>({
    isOpen: false,
    title: '',
    description: '',
  });

  const showAlert = (title: string, description: string) => {
    setAlertDialog({ isOpen: true, title, description, actionLabel: 'OK', onAction: () => {} });
  };

  const showConfirm = (title: string, description: string, onConfirm: () => void, variant: 'default' | 'destructive' = 'default') => {
    setAlertDialog({ isOpen: true, title, description, onAction: onConfirm, actionLabel: 'Confirm', variant });
  };

  const activeVersionObj = project?.versions.find((v) => v.versionId === project.versions[project.versions.length - 1]?.versionId);
  const activeFileList = activeVersionObj ? Object.keys(activeVersionObj.files) : [];
  const latestVersionFiles = project?.versions?.[project.versions.length - 1]?.files;
  const assetCount = latestVersionFiles
    ? Object.keys(latestVersionFiles).filter((k) => k.startsWith('assets/')).length
    : 0;

  // ── Model plumbing ────────────
  // The Ollama probe and the model list are shared with ChatHero through hooks
  // the options below are exactly where the two surfaces had drifted.

  // This panel's probe predates the `?host=` param: it calls /api/onboard bare
  // and lets the server default, and it has no in-flight flag.
  const { probeOllama } = useOllama();

  /** Cloud asks for `managed` here (the hero sends its own provider + keys);
   *  the OSS body is identical to the hero's. */
  const buildModelsPayload = React.useCallback(
    () =>
      isCloud
        ? {
            provider: 'managed',
            ollamaHost: localStorage.getItem('LiveFolio_ollama_host') || 'http://localhost:11434',
          }
        : {
            provider: 'all_oss',
            openaiKey: localStorage.getItem('LiveFolio_openai_api_key') || undefined,
            anthropicKey: localStorage.getItem('LiveFolio_anthropic_api_key') || undefined,
            geminiKey: localStorage.getItem('LiveFolio_gemini_api_key') || undefined,
            deepseekKey: localStorage.getItem('LiveFolio_deepseek_api_key') || undefined,
            ollamaHost: localStorage.getItem('LiveFolio_ollama_host') || 'http://localhost:11434',
          },
    []
  );

  // No model callbacks: this surface reads the model back out of the store
  // (`syncAiConfigFromGlobal`, fired after every attempt), where the hero
  // mirrors the resolved model into its own state.
  const { availableModels, isLoadingModels, fetchAvailableModels } = useAvailableModels({
    buildPayload: buildModelsPayload,
    selectedModel,
    onSettled: syncAiConfigFromGlobal,
    errorLog: 'Failed to fetch available models',
  });

  const { availableDesignSystems } = useDesignSystems();

  // OSS/cloud model sanitize (v1 syncSettings 1103–1142) + probes
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncSettings = () => {
      let savedModel = localStorage.getItem('LiveFolio_selected_model') || '';
      let savedProvider = localStorage.getItem('LiveFolio_api_provider') as string | null;

      if (isCloud) {
        if (!savedModel) savedModel = 'gemini-1.5-flash';
        if (!savedProvider) savedProvider = 'managed';
      } else {
        // OSS: sanitize legacy cloud defaults — the list is shared with
        // ChatHero via lib/ai/legacy-models.ts so the two surfaces can never
        // hand out different models.
        if (isLegacyModelId(savedModel)) {
          localStorage.removeItem('LiveFolio_selected_model');
          savedModel = '';
        }
        if (!savedProvider || savedProvider === 'managed') {
          savedProvider = 'byok';
          localStorage.setItem('LiveFolio_api_provider', 'byok');
        }
      }
      if (savedModel) localStorage.setItem('LiveFolio_selected_model', savedModel);
      syncAiConfigFromGlobal();
    };
    syncSettings();
    probeOllama();
    fetchAvailableModels();
    window.addEventListener('storage', syncSettings);
    return () => window.removeEventListener('storage', syncSettings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // OSS: no model configured → open the key ask automatically once probing
  // settles. Closing it stays closed until the model set changes.
  React.useEffect(() => {
    if (isOSS && !isLoadingModels && availableModels.length === 0) {
      setKeysPanelOpen(true);
    }
  }, [isLoadingModels, availableModels.length]);

  // ── Scroll: restore persisted offset once, then v1 auto-scroll ────────
  React.useEffect(() => {
    if (status !== 'ready' || restoredScrollRef.current) return;
    const el = chatContainerRef.current;
    if (el && chatScroll > 0) el.scrollTop = chatScroll;
    restoredScrollRef.current = true;
  }, [status, chatScroll]);

  React.useEffect(() => {
    if (!restoredScrollRef.current) return;
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [project?.chats?.length, isAiResponding]);

  const handleChatScroll = () => {
    const el = chatContainerRef.current;
    if (!el) return;
    setChatScroll(el.scrollTop);
  };

  // ── Send (v1 handleSendChatPrompt 1584–1806, now a store action) ──────
  const handleSendChatPrompt = (
    e?: React.FormEvent,
    overridePrompt?: string,
    overrideScope?: ChatScope
  ) => {
    if (e) e.preventDefault();
    const finalPrompt = overridePrompt ?? chatDraft;
    if (!finalPrompt.trim() || !project || isAiResponding) return;
    void sendPrompt(finalPrompt, overrideScope ?? chatScope);
  };

  // ── Restore version (v1 1912–1941) ────────────────────────────────────
  const handleRestoreVersion = (versionId: string) => {
    if (!project) return;
    showConfirm(
      'Restore Checkpoint',
      `Are you sure you want to restore the entire project to version ${versionId}? This will create a new history entry.`,
      async () => {
        try {
          const res = await fetch(`/api/files/${project.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              restoreVersionId: versionId,
              author: isCloud ? 'Talel' : 'OSS User',
            }),
          });
          if (res.ok) {
            await fetchProject();
          }
        } catch (err) {
          console.error('Failed to restore version:', err);
        }
      }
    );
  };

  // ── Design system (v1 handleUpdateDesignSystem 2566–2605) ─────────────
  const handleUpdateDesignSystem = async (
    updatedMode?: 'deck' | 'document' | 'spreadsheet' | 'dashboard' | 'infography',
    updatedTheme?: string,
    updatedTypography?: string,
    palette?: string,
    libs?: string[],
    shouldRegenerate: boolean = false
  ) => {
    if (!project) return;
    const nextPrefs = {
      theme: updatedTheme || selectedTheme,
      typography: updatedTypography || selectedTypography,
      palette: palette || selectedColorPalette,
      libraries: libs || selectedLibraries,
    };
    try {
      const res = await fetch(`/api/files/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectMode: updatedMode || projectMode,
          designPreferences: nextPrefs,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setDesignSystemPrefs({
            theme: nextPrefs.theme,
            typography: nextPrefs.typography,
            palette: nextPrefs.palette,
            libraries: nextPrefs.libraries,
            projectMode: updatedMode || projectMode,
          });
          await fetchProject();
          if (shouldRegenerate) {
            void sendPrompt(
              `Please re-generate the current page (${activeFilename}) using the new design system settings: ${nextPrefs.theme} theme.`
            );
          }
        }
      }
    } catch (err) {
      console.error('Error updating design system:', err);
    }
  };

  // ── Tool call handlers ────────────────────────────────────────────────
  const handleConfirmDeletePage = async (toolCallId: string, filename: string) => {
    setIsProcessingTools(true);
    updateToolCallStatus(toolCallId, 'executing', `Deleting ${filename}…`);
    try {
      const result = await executeToolCall(toolCallId, 'delete_page', { filename }, true);
      updateToolCallStatus(toolCallId, 'done', undefined, result);
      await fetchProject();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- store tool actions reject with errors of unknown shape; err.message is read
    } catch (err: any) {
      updateToolCallStatus(toolCallId, 'error', undefined, undefined, err.message);
    } finally {
      setIsProcessingTools(false);
    }
  };

  const handleCancelDeletePage = (toolCallId: string) => {
    updateToolCallStatus(toolCallId, 'done', undefined, {
      type: 'text',
      message: 'Deletion cancelled.',
    });
  };

  const handlePreviewToolResult = (files: { [filename: string]: string }) => {
    const changedFile = Object.keys(files)[0];
    if (changedFile && changedFile !== activeFilename) {
      setActiveFilename(changedFile);
    }
    void fetchProject();
  };

  const handleRetryToolCall = async (toolCallId: string) => {
    const msg = (project?.chats || []).find((m) =>
      m.toolCalls?.some((tc) => tc.id === toolCallId)
    );
    const tc = msg?.toolCalls?.find((t) => t.id === toolCallId);
    if (!tc) return;
    setIsProcessingTools(true);
    updateToolCallStatus(toolCallId, 'executing', 'Retrying…');
    try {
      const result = await executeToolCall(toolCallId, tc.name, tc.arguments, tc.name === 'delete_page');
      updateToolCallStatus(toolCallId, 'done', undefined, result);
      if (result?.files) await fetchProject();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- store tool actions reject with errors of unknown shape; err.message is read
    } catch (err: any) {
      updateToolCallStatus(toolCallId, 'error', undefined, undefined, err.message);
    } finally {
      setIsProcessingTools(false);
    }
  };

  // ── Attachment portal ─────────────────────
  // The whole intake pipeline now lives in the shared hook, so FolioView runs
  // the same code. readTextFile / readImageAsDataURL come from
  // @/lib/unpack-files. The save calls are deliberately NOT unified: the chat
  // panel keeps its own inline PUTs (and, on upload, the design-system save it
  // has always fired first) rather than FolioView's `handleSaveModifiedCode`.
  const {
    isAttachmentPortalOpen,
    setIsAttachmentPortalOpen,
    isUploadingAsset,
    selectedAttachmentFile,
    setSelectedAttachmentFile,
    extractedContextText,
    setExtractedContextText,
    isExtractingText,
    attachmentIntent,
    setAttachmentIntent,
    handleAttachmentFileChange,
    handleCommitAttachment,
    handleDeleteReferenceFile,
    handleDeleteVisualAsset,
  } = useAttachmentIntake({
    project,
    fetchProject,
    showAlert,
    showConfirm,
    setChatDraft,
    // Both callbacks are only ever invoked by the hook after its own
    // `if (!project ...) return` guard, so `project` is non-null here — the
    // assertion just restores the narrowing the inline copies got from that
    // same guard before the lift.
    commitVisualAsset: async (nextFilesMap, commitMessage) => {
      // Unchanged from the pre-lift copy: the design-system save fires first,
      // then the folio PUT, then a refetch.
      await handleUpdateDesignSystem(undefined, undefined, undefined, undefined, undefined, false);
      const res = await fetch(`/api/files/${project!.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: nextFilesMap, commitMessage }),
      });
      if (!res.ok) throw new Error('Failed to write the visual asset.');
      await fetchProject();
    },
    commitVisualAssetDeletion: async (nextFilesMap, commitMessage) => {
      const res = await fetch(`/api/files/${project!.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: nextFilesMap, commitMessage }),
      });
      if (!res.ok) throw new Error('Failed to delete the visual asset.');
      await fetchProject();
    },
    // The chat panel has always shown the static fallback, not err.message.
    describeReferenceDeleteError: (_err, fallback) => fallback,
  });

  // ── Provider fetch gates ──────────────────────────────────────────────
  if (status === 'loading' || status === 'idle') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center bg-[#F4F4F0] dark:bg-[#0F0F0D]">
        <div className="flex h-10 w-10 animate-pulse items-center justify-center rounded-xl bg-[var(--app-accent)]/10 text-[var(--app-accent)]">
          <MessageSquare className="h-5 w-5" />
        </div>
        <p className="text-xs font-medium tracking-tight text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">
          Loading folio…
        </p>
      </div>
    );
  }

  if (status === 'error' || !project) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center bg-[#F4F4F0] dark:bg-[#0F0F0D]">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--app-accent)]/10 text-[var(--app-accent)]">
          <MessageSquare className="h-5 w-5" />
        </div>
        <h2 className="text-base font-semibold tracking-tight text-[#0F0F0D] dark:text-[#F4F4F0]">
          Couldn&apos;t load this folio
        </h2>
        <p className="max-w-sm text-sm leading-relaxed text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60">{error || 'Unknown error.'}</p>
        <Button onClick={() => void fetchProject()} variant="outline" size="sm">
          <RefreshCw size={12} className="mr-1.5" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-1 min-h-0 flex-col overflow-hidden bg-[#F4F4F0] dark:bg-[#0F0F0D]">
      {/* No header bar — the shell tab bar owns view switching; the chat
          reads exactly like the /app hero (centered column, no chrome). */}

      <div ref={chatContainerRef} onScroll={handleChatScroll} className="flex-1 min-h-0 overflow-y-auto px-4 py-6 scrollbar-hide flex flex-col">
        {/* Centered column — same reading as the /app hero chat. */}
        <div className="mx-auto w-full max-w-2xl flex flex-col">
         {(project.chats || []).length > 0 ? (
           (project.chats || []).map((msg, idx) => (
             <div key={idx} className={cn("flex flex-col gap-2 animate-fade mb-1", msg.sender === 'user' ? 'items-end' : 'items-start')}>
                <div className="flex items-center gap-2 px-1">
                   {msg.sender !== 'user' ? <div className={cn("w-1.5 h-1.5 rounded-full", "bg-[var(--app-accent)] shadow-[0_0_6px_color-mix(in srgb, var(--app-accent) 60%, transparent)]")} /> : null}
                   <span className="text-xs font-extrabold text-zinc-400 tracking-tight font-sans">
                      {msg.sender === 'user' ? 'You' : 'LIVEFOLIO AI'}
                   </span>
                </div>
               <div className={cn(
                   "max-w-[95%] p-3 text-[13px] transition-all duration-300 relative group/msg",
                   msg.sender === 'user'
                     ? "bg-[#0F0F0D] dark:bg-[#F4F4F0] text-[#F4F4F0] dark:text-[#0F0F0D] font-medium rounded-xl shadow-sm ml-auto"
                     : "bg-white dark:bg-zinc-900 text-[#0F0F0D] dark:text-[#F4F4F0] rounded-xl border border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 shadow-sm"
                 )}>
                   {msg.sender === 'user' ? (
                      <p className="leading-relaxed font-semibold">{msg.text}</p>
                   ) : (
                      <ChatMessageRenderer text={msg.text} />
                   )}

                   {/* Rollback Link */}
                     {msg.sender === 'assistant' && msg.isProposal && msg.isApplied && (
                        <div className={cn(
                          "mt-3 pt-3 flex items-center justify-between",
                          "border-t border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10"
                        )}>
                           <span className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 tracking-tight flex items-center gap-1">
                              <CheckCircle size={10} className={cn("text-[var(--app-accent)]")} />
                              Changes Applied
                           </span>
                           <Button
                             variant="outline"
                             size="sm"
                             onClick={() => {
                               showConfirm(
                                 'Revert Changes',
                                 'Would you like to restore the project to the state before these changes were applied? This will create a new history entry.',
                                 () => {
                                   const commitMsgQuery = msg.text.slice(0, 30);
                                   let versionIdx = project.versions.findIndex((v) => v.commitMessage.includes(commitMsgQuery));
                                   if (versionIdx === -1) {
                                     versionIdx = project.versions.length - 1;
                                   }
                                   const targetIdx = versionIdx - 1;
                                   if (targetIdx >= 0) {
                                     handleRestoreVersion(project.versions[targetIdx].versionId);
                                   } else {
                                     showAlert('Cannot Revert', 'There is no previous version to revert to.');
                                   }
                                 }
                               );
                             }}
                             className={cn(
                               "h-7 px-3 text-xs font-semibold rounded-lg transition-colors cursor-pointer",
                               "bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 text-[var(--app-accent)] hover:bg-[var(--app-accent)]/10"
                             )}
                           >
                              <History size={10} className="mr-1" />
                              Revert
                           </Button>
                        </div>
                     )}
                   </div>

                   {/* AI Code Proposals */}
                   {msg.isProposal && msg.proposedFiles && !msg.isApplied && (
                     <div className="mt-3 space-y-2.5 animate-slideUp w-full max-w-[340px] text-left">
                        <div className="flex items-center gap-2 px-1">
                           <div className={cn("w-1 h-1 rounded-full", "bg-[var(--app-accent)] shadow-[0_0_6px_color-mix(in srgb, var(--app-accent) 60%, transparent)]")} />
                           <span className="text-xs font-bold tracking-tight text-zinc-400">Proposed Patch</span>
                        </div>
                        <div className={cn(
                          "p-4 space-y-4",
                          "bg-white dark:bg-zinc-900 ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 rounded-xl shadow-sm"
                        )}>
                           <div className="space-y-1.5">
                              <p className="text-xs font-semibold text-zinc-400 tracking-tight">Impacted Files:</p>
                              <div className="flex flex-wrap gap-1.5">
                                 {msg.proposedFiles.map((pf) => (
                                   <span key={pf.filename} className={cn(
                                     "px-2 py-0.5 text-xs font-semibold",
                                     "rounded-full bg-[var(--app-accent)]/10 text-[var(--app-accent)]"
                                   )}>{pf.filename}</span>
                                 ))}
                              </div>
                           </div>
                           <Button
                             onClick={() => void commitProposal(msg.id, msg.proposedFiles!, msg.proposedExplanation || '')}
                             disabled={isAiResponding}
                             className="w-full h-9 text-xs font-semibold rounded-lg bg-[var(--app-accent)] hover:bg-[var(--app-accent)]/90 text-white transition-colors"
                           >
                              {isAiResponding ? (
                                <><LoadingSpinner size="xs" className="mr-1.5" /> Applying…</>
                              ) : (
                                'Execute Patch'
                              )}
                           </Button>
                        </div>
                     </div>
                   )}

                   {/* Interactive Action Cards */}
                   {msg.interactiveCard && (
                     <div className="mt-3 space-y-2.5 animate-slideUp w-full max-w-[300px] text-left">
                        <div className="flex items-center gap-2 px-1">
                           <Wand2 size={10} className="text-zinc-400" />
                           <span className="text-xs font-bold tracking-tight text-zinc-400 ">{msg.interactiveCard.title}</span>
                        </div>
                        <div className={cn(
                          "p-4 space-y-4",
                          "bg-white dark:bg-zinc-900 ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 rounded-xl shadow-sm"
                        )}>
                           <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-normal font-medium">{msg.interactiveCard.description}</p>
                           <div className="flex flex-col gap-1">
                              {msg.interactiveCard.actions?.map((action, aIdx) => (
                                <button
                                  key={aIdx}
                                  onClick={() => handleSendChatPrompt(undefined, action.value)}
                                  className={cn(
                                    "text-xs text-left px-2.5 py-2 rounded-lg transition-colors font-medium cursor-pointer",
                                    "bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70 hover:bg-[var(--app-accent)]/10 hover:text-[var(--app-accent)]"
                                  )}
                                >
                                  {action.label}
                                </button>
                              ))}
                           </div>
                        </div>
                     </div>
                   )}

                   {/* Tool Call Cards */}
                   {msg.toolCalls?.map((tc) => (
                     <ToolCallCard
                       key={tc.id}
                       toolCall={tc}
                       onConfirm={(id) => {
                         const filename = tc.arguments?.filename;
                         if (filename) void handleConfirmDeletePage(id, filename);
                       }}
                       onCancel={(id) => handleCancelDeletePage(id)}
                       onPreview={(files) => handlePreviewToolResult(files)}
                       onRetry={(id) => void handleRetryToolCall(id)}
                     />
                   ))}
                 </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center flex-1 text-center px-6 py-4 space-y-4">
                  <span className="inline-block h-8 w-8 bg-[var(--app-accent)]" />
                  <div className="space-y-0.5">
                    <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">What should we change?</h3>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500 max-w-[260px] leading-relaxed">
                      Describe an edit to this screen — or point at an element and ask
                    </p>
                  </div>
                </div>
              )}
              {isAiResponding ? (
                 <div className="flex flex-col gap-2 items-start animate-fade">
                    <div className="flex items-center gap-2 px-1">
                       <div className={cn("w-1.5 h-1.5 rounded-full animate-pulse", "bg-[var(--app-accent)] shadow-[0_0_6px_color-mix(in srgb, var(--app-accent) 60%, transparent)]")} />
                       <span className="text-xs font-extrabold text-zinc-400 tracking-tight font-sans flex items-center gap-1.5">
                          LIVEFOLIO AI
                          {aiStreamStatus && (
                             <span className={cn("animate-pulse font-medium lowercase", "text-[var(--app-accent)] dark:text-[var(--app-accent)]")}>({aiStreamStatus})</span>
                          )}
                       </span>
                    </div>
                    <div className={cn(
                      "max-w-[95%] px-3 py-2 text-[13px] relative",
                      "rounded-xl bg-white dark:bg-zinc-900 text-[#0F0F0D] dark:text-[#F4F4F0] border border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 shadow-sm"
                    )}>
                       {aiStreamText ? (
                          <div className="relative">
                             <ChatMessageRenderer text={aiStreamText} />
                             <span className={cn("inline-block w-1 h-3.5 ml-0.5 animate-pulse align-middle", "bg-[var(--app-accent)]")} />
                          </div>
                       ) : (
                          <div className="flex items-center gap-0.5">
                             <div className={cn("w-1 h-1 animate-bounce", "bg-[var(--app-accent)]")} />
                             <div className={cn("w-1 h-1 animate-bounce [animation-delay:0.15s]", "bg-[var(--app-accent)]")} />
                             <div className={cn("w-1 h-1 animate-bounce [animation-delay:0.3s]", "bg-[var(--app-accent)]")} />
                          </div>
                       )}
                    </div>
                 </div>
              ) : null}
             <div ref={chatEndRef} />
          </div>
          </div>
          {/* Composer — SIBLING of the scroll area (never inside it, or it
              scrolls with the messages and floats near the top). */}
          <div className={cn(
            "px-4 pt-2 pb-4 space-y-2 z-20 shrink-0 bg-[#F4F4F0] dark:bg-[#0F0F0D]"
          )}>
              {/* Transient error bar (v1 showed these via showAlert) */}
              {chatError && (
                <div className={cn(
                  "px-3 py-2 flex items-center justify-between gap-2",
                  "bg-red-50 dark:bg-red-950/40 border border-red-600/60 text-red-700 dark:text-red-300 text-[11px] font-medium"
                )}>
                  <span className="leading-snug">{chatError}</span>
                  <button type="button" onClick={() => { /* cleared on next send */ }}
                    aria-label="Dismiss" className="shrink-0 opacity-60 hover:opacity-100 cursor-pointer">
                    <X size={11} />
                  </button>
                </div>
              )}

              {/* OSS: no model configured — the key ask lives in the chat,
                  not a Settings detour. Adding a key reloads the model list. */}
              {isOSS && availableModels.length === 0 && !isLoadingModels && keysPanelOpen && (
                <div className="mx-auto w-full max-w-2xl space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[12px] font-semibold text-ink">
                      Add your model key to chat
                    </p>
                    <button
                      type="button"
                      onClick={() => setKeysPanelOpen(false)}
                      className="p-0.5 text-ink/40 transition-colors hover:text-ink cursor-pointer"
                      aria-label="Close key setup"
                    >
                      <X size={13} />
                    </button>
                  </div>
                  <div className={cn(
                    "rounded-xl border border-[#0F0F0D]/10 bg-[#0F0F0D]/[0.02] p-3",
                    "dark:border-[#F4F4F0]/10 dark:bg-[#F4F4F0]/[0.03]"
                  )}>
                    <LocalModelKeys
                      dense
                      onChanged={(configured) => {
                        if (configured) {
                          setKeysPanelOpen(false);
                          void fetchAvailableModels();
                        }
                      }}
                    />
                  </div>
                </div>
              )}
              <form onSubmit={handleSendChatPrompt} className={cn(
                "relative w-full max-w-2xl mx-auto transition-all overflow-hidden rounded-xl",
                "border border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 bg-[#0F0F0D]/[0.03] dark:bg-[#F4F4F0]/[0.04] focus-within:border-[var(--app-accent)]/40"
              )}>
                   {/* Point & Polish: Targeted Element — compact banner */}
                   {targetedElement && (
                     <div className={cn(
                       "px-3 py-1.5 flex items-center gap-2 transition-all shrink-0",
                       "bg-[var(--app-accent)]/10 border-b border-[var(--app-accent)]/20"
                     )}>
                       <span className={cn(
                         "px-1.5 py-0.5  text-xs font-bold uppercase shrink-0",
                         "rounded-md bg-[var(--app-accent)] text-[#F4F4F0]"
                       )}>
                         {targetedElement.tagName}
                       </span>
                       <span className=" text-xs text-zinc-500 dark:text-zinc-400 truncate flex-1 min-w-0" title={targetedElement.selector}>
                         {targetedElement.selector}
                       </span>
                       <div className="flex gap-1 overflow-x-auto no-scrollbar shrink-0 max-w-[50%]">
                         {getPresetChips(targetedElement.tagName).slice(0, 3).map((chipText) => (
                           <button
                             key={chipText}
                             type="button"
                             onClick={() => setChatDraft(chipText)}
                             className={cn("px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0", "rounded-full bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70 hover:text-[var(--app-accent)]")}
                           >
                             {chipText}
                           </button>
                         ))}
                       </div>
                       <button
                         type="button"
                         onClick={() => setTargetedElement(null)}
                         className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer shrink-0"
                       >
                         <X size={11} />
                       </button>
                     </div>
                   )}

                    {attachedAsset && (() => {
                      const latestVersion = project?.versions?.[project.versions.length - 1];
                      if (!latestVersion) return null;
                      const base64Data = latestVersion.files[attachedAsset] || '';
                      const shortName = attachedAsset.replace('assets/', '');
                      return (
                        <div className={cn("px-3 py-1.5 flex items-center justify-between gap-2 shrink-0", "bg-[var(--app-accent)]/10 border-b border-[var(--app-accent)]/20")}>
                          <div className="flex items-center gap-2 min-w-0">
                            <div className={cn("w-6 h-6 overflow-hidden flex items-center justify-center shrink-0", "rounded-lg bg-white dark:bg-zinc-900 ring-1 ring-[#0F0F0D]/10 dark:ring-[#F4F4F0]/10")}>
                              <img src={base64Data} alt="Attached Preview" className="max-w-full max-h-full object-contain" />
                            </div>
                            <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 truncate">{shortName}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setAttachedAsset(null)}
                            className={cn("text-zinc-400 hover:text-rose-500 p-1 transition-colors cursor-pointer shrink-0", "rounded-xl hover:bg-[var(--app-accent)]/10")}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      );
                    })()}

                  {/* Tier 2: Center Textarea */}
                  <textarea
                    name="chat-prompt"
                    rows={2}
                    value={chatDraft}
                    onChange={(e) => setChatDraft(e.target.value)}
                    disabled={isAiResponding || isClearingChat || availableModels.length === 0}
                    placeholder={availableModels.length === 0 ? 'Add your model key to start chatting…' : 'Describe a change or new screen…'}
                    className="w-full bg-transparent border-0 px-4 py-2 text-[13px] text-zinc-900 dark:text-zinc-50 resize-none focus:outline-none focus:ring-0 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 leading-relaxed disabled:text-zinc-400 disabled:cursor-not-allowed"
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (availableModels.length > 0) handleSendChatPrompt(); } }}
                  />

                  {/* Bottom Toolbar — main row: ➕ [scope▾] [model▾] → */}
                  <div className="flex items-center justify-between px-3 pt-1 gap-1 pb-3">
                     <div className="flex items-center gap-0.5">
                        <button type="button" ref={toolsBtnRef}
                          onClick={toggleToolsMenu}
                          className={cn(
                            "h-7 w-7 flex items-center justify-center transition-colors cursor-pointer shrink-0 rounded-lg",
                            isToolsMenuOpen
                              ? "bg-[var(--app-accent)]/10 text-[var(--app-accent)]"
                              : "text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:text-[var(--app-accent)] hover:bg-[var(--app-accent)]/10"
                          )}
                          aria-label="Tools menu" title="Tools">
                          <Plus size={14} />
                        </button>
                     </div>

                     <div className="flex items-center gap-1 shrink-0">
                        <Dropdown
                          value={chatScope}
                          onChange={(v) => setChatScope(v as ChatScope)}
                          options={[
                            { value: 'Current Screen', label: 'Screen' },
                            { value: 'Whole Project', label: 'Project' },
                          ]}
                          title="AI Scope"
                          ariaLabel="AI Scope"
                          className="h-7 px-2 text-xs font-medium rounded-lg bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 border-0 text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70"
                        />
                        {/* Model selector — OSS only. In Cloud the model is auto-selected server-side. */}
                        {!isCloud && (
                        <div className="flex items-center gap-1 shrink-0">
                          {isLoadingModels || availableModels.length > 0 ? (
                            <>
                              <span className={cn("w-1.5 h-1.5 rounded-full animate-pulse shrink-0 ml-1", "bg-[var(--app-accent)]")} />
                              <Dropdown
                                value={selectedModel}
                                onChange={(val) => { localStorage.setItem('LiveFolio_selected_model', val); syncAiConfigFromGlobal(); }}
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
                                        const group = ({ managed: 'Managed', local: 'Ollama', gemini: 'Gemini', openai: 'OpenAI', anthropic: 'Claude', deepseek: 'DeepSeek' } as Record<string, string>)[m.provider];
                                        return { value, label: m.name, group };
                                      })
                                }
                              />
                            </>
                          ) : (
                            /* No model configured yet — the selector becomes
                               the shortcut to add a key (OSS BYOK). */
                            <button
                              type="button"
                              onClick={() => setKeysPanelOpen((v) => !v)}
                              className={cn(
                                'flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold transition-colors cursor-pointer',
                                keysPanelOpen
                                  ? 'bg-[var(--app-accent)]/10 text-[var(--app-accent)]'
                                  : 'bg-[#0F0F0D]/5 text-ink/60 hover:text-[var(--app-accent)] dark:bg-[#F4F4F0]/10'
                              )}
                              title={keysPanelOpen ? 'Hide key setup' : 'Add your model key to chat'}
                              aria-label="Add your model key"
                            >
                              <KeyRound size={12} />
                              {keysPanelOpen ? 'Close' : 'Add key'}
                            </button>
                          )}
                        </div>
                        )}
                        <button type="submit"
                          disabled={isAiResponding || isClearingChat || !chatDraft.trim() || availableModels.length === 0}
                          className={cn(
                            "w-7 h-7 flex items-center justify-center disabled:opacity-25 transition-colors cursor-pointer shrink-0",
                            "rounded-lg bg-[var(--app-accent)] text-white hover:bg-[var(--app-accent)]/90"
                          )}>
                          {isAiResponding ? <LoadingSpinner size="xs" /> : <Send size={12} />}
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
                          onClick={() => { setAttachmentIntent('enrich'); setIsAttachmentPortalOpen(true); setIsToolsMenuOpen(false); }}
                        />
                        <ToolsMenuRow
                          icon={Image}
                          label="Visual Assets"
                          hasIndicator={assetCount > 0}
                          onClick={() => { setAttachmentIntent('enrich'); setIsAttachmentPortalOpen(true); setIsToolsMenuOpen(false); }}
                        />
                        <div className="my-1 h-px bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10" />
                        <ToolsMenuRow
                          icon={Zap}
                          label={`Apply: ${selectedTheme}`}
                          disabled={availableModels.length === 0}
                          onClick={() => { setChatScope('Whole Project'); handleSendChatPrompt(undefined, `Please apply the "${selectedTheme}" theme and "${selectedTypography}" typography pair to all screens.`, 'Whole Project'); setIsToolsMenuOpen(false); }}
                        />
                        {activeFileList.filter((f) => f.endsWith('.html')).length > 1 && (
                          <ToolsMenuRow
                            icon={Network}
                            label="Link Pages"
                            disabled={availableModels.length === 0}
                            onClick={() => { setChatScope('Whole Project'); handleSendChatPrompt(undefined, 'Please analyze all pages to map out and fix navigation relationships between them using relative href links.', 'Whole Project'); setIsToolsMenuOpen(false); }}
                          />
                        )}
                        <ToolsMenuRow
                          icon={Search}
                          label="Audit UI"
                          disabled={availableModels.length === 0}
                          onClick={() => { handleSendChatPrompt(undefined, 'Audit the current screen for spacing, border radius, responsiveness, and color consistency. Reply with findings first, do not modify code yet.'); setIsToolsMenuOpen(false); }}
                        />
                        <div className="my-1 h-px bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10" />
                        <ToolsMenuRow
                          icon={RefreshCw}
                          label="Auto-Apply"
                          active={isAutoApply}
                          onClick={() => setIsAutoApply(!isAutoApply)}
                        />
                      </div>
                    </div>
                  )}

              </form>
          </div>

      {/* Hidden file input for the attachment portal */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.html,.css,.js,.json,.csv"
        onChange={handleAttachmentFileChange}
      />

      <AttachmentPortal
        isOpen={isAttachmentPortalOpen}
        project={project}
        selectedAttachmentFile={selectedAttachmentFile}
        extractedContextText={extractedContextText}
        isExtractingText={isExtractingText}
        isUploadingAsset={isUploadingAsset}
        attachmentIntent={attachmentIntent}
        onClose={() => {
          setIsAttachmentPortalOpen(false);
          setSelectedAttachmentFile(null);
          setExtractedContextText('');
        }}
        onFileSelect={() => fileInputRef.current?.click()}
        onRemoveFile={() => {
          setSelectedAttachmentFile(null);
          setExtractedContextText('');
        }}
        onSetIntent={(intent) => setAttachmentIntent(intent)}
        onCommit={() => void handleCommitAttachment()}
        onDeleteReference={(filename) => handleDeleteReferenceFile(filename)}
        onDeleteVisualAsset={(filename) => handleDeleteVisualAsset(filename)}
        onUseAsset={(assetName) => {
          setAttachedAsset(assetName);
          setIsAttachmentPortalOpen(false);
        }}
      />

      <DesignDrawer
        isOpen={isDesignDrawerOpen}
        onClose={() => setIsDesignDrawerOpen(false)}
        availableDesignSystems={availableDesignSystems}
        selectedTheme={selectedTheme}
        selectedTypography={selectedTypography}
        selectedColorPalette={selectedColorPalette}
        projectMode={projectMode}
        onSelectTheme={(themeName) => void handleUpdateDesignSystem(undefined, themeName)}
        onSelectTypography={(typographyName) => void handleUpdateDesignSystem(undefined, undefined, typographyName)}
        onSelectPalette={(paletteName) => void handleUpdateDesignSystem(undefined, undefined, undefined, paletteName)}
        selectedLibraries={selectedLibraries}
        onSelectMode={(mode) => void handleUpdateDesignSystem(mode)}
        onSelectLibraries={(libs) => void handleUpdateDesignSystem(undefined, undefined, undefined, undefined, libs)}
        onRegenerate={() => {
          void handleUpdateDesignSystem(undefined, undefined, undefined, undefined, undefined, true);
          setIsDesignDrawerOpen(false);
        }}
      />

      <AlertDialog
        isOpen={alertDialog.isOpen}
        title={alertDialog.title}
        description={alertDialog.description}
        actionLabel={alertDialog.actionLabel}
        onAction={alertDialog.onAction || (() => {})}
        onCancel={() => setAlertDialog({ ...alertDialog, isOpen: false })}
        variant={alertDialog.variant}
      />
    </div>
  );
}
