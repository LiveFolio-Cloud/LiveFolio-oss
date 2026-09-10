'use client';

import React from 'react';
import {
  Send, Zap, Wand2, Palette, Image, Paperclip, FileText, Plus, X, CheckCircle, Check,
  Search, RefreshCw, History, Network,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { Dropdown } from '@/components/ui/dropdown';
import { Card } from '@/components/ui/card';
import ChatMessageRenderer from '@/components/studio/ChatMessageRenderer';
import ToolCallCard from '@/components/studio/ToolCallCard';
import { HTMLFile, HTMLVersion } from '@/lib/db';
import { isCloud } from '@/lib/env';

/** v1 send-handler shape (direct + ref mirror). */
type SendPromptHandler = (
  e?: React.FormEvent,
  overridePrompt?: string,
  overrideScope?: 'Whole Project' | 'Current Screen'
) => Promise<void>;

/** v1 design-system update shape. */
type UpdateDesignSystemHandler = (
  mode?: 'deck' | 'document' | 'spreadsheet' | 'dashboard' | 'infography',
  theme?: string,
  typography?: string,
  palette?: string,
  libs?: string[],
  regenerate?: boolean
) => Promise<void>;

function getPresetChips(tagName: string): string[] {
   const tag = tagName.toLowerCase();
   if (tag === 'button' || tag === 'a') return ['Make glowing SaaS style', 'Add hover animations', 'Modern gradient background', 'Make pill shape'];
   if (tag === 'section' || tag === 'div' || tag === 'article' || tag === 'main') return ['Convert to 3 columns grid', 'Add elegant glassmorphic card design', 'Make dark mode variant', 'Add warm radial halo background'];
   if (tag === 'img') return ['Add subtle shadow & border', 'Make rounded circular avatar', 'Add hover scale zoom effect', 'Modern aspect ratio container'];
   if (tag === 'p' || tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'span') return ['Make typography bold & elegant', 'Modern text gradient style', 'Improve font contrast and height', 'Add glow effect text shadow'];
   return ['Modernize this section style', 'Add micro-interactions', 'Convert to glassmorphic design'];
}

interface ChatPanelProps {
  project: HTMLFile;
  activeVersionObj: HTMLVersion | undefined;
  activeFilename: string;
  activeFileList: string[];
  leftSidebarWidth: number;
  isSidebarCollapsed: boolean;
  setIsSidebarCollapsed: (v: boolean) => void;
  setIsResizingLeft: (v: boolean) => void;
  mobilePanel: 'canvas' | 'chat';
  setMobilePanel: (v: 'canvas' | 'chat') => void;
  chatContainerRef: { current: HTMLDivElement | null };
  showScrollButton: boolean;
  handleChatScroll: () => void;
  scrollChatToBottom: () => void;
  aiPrompt: string;
  setAiPrompt: (v: string) => void;
  chatScope: 'Whole Project' | 'Current Screen';
  setChatScope: (v: 'Whole Project' | 'Current Screen') => void;
  isAutoApply: boolean;
  setIsAutoApply: (v: boolean) => void;
  isAiResponding: boolean;
  aiStreamStatus: string;
  isClearingChat: boolean;
  handleSendChatPrompt: SendPromptHandler;
  handleSendChatPromptRef: { current: SendPromptHandler | null };
  handleClearChat: () => void;
  selectedModel: string;
  setSelectedModel: (v: string) => void;
  availableModels: { id: string; name: string; provider: string }[];
  isLoadingModels: boolean;
  aiProvider: string;
  setAiProvider: (v: string) => void;
  openaiKey: string;
  setOpenaiKey: (v: string) => void;
  anthropicKey: string;
  setAnthropicKey: (v: string) => void;
  geminiKey: string;
  setGeminiKey: (v: string) => void;
  deepseekKey: string;
  setDeepseekKey: (v: string) => void;
  ollamaModels: string[];
  ollamaRunning: boolean;
  selectedTheme: string;
  selectedTypography: string;
  selectedColorPalette: string;
  isDesignDrawerOpen: boolean;
  setIsDesignDrawerOpen: (v: boolean) => void;
  onOpenDesignDrawer: () => void;
  onOpenAttachmentPortal: (intent: 'enrich' | 'convert') => void;
  isAttachmentPortalOpen: boolean;
  setIsAttachmentPortalOpen: (v: boolean) => void;
  setAttachmentIntent: (v: 'enrich' | 'convert') => void;
  attachedAsset: string | null;
  setAttachedAsset: (v: string | null) => void;
  targetedElement: { selector: string; outerHTML: string; tagName: string } | null;
  setTargetedElement: (v: { selector: string; outerHTML: string; tagName: string } | null) => void;
  aiStreamText: string;
  chatEndRef: { current: HTMLDivElement | null };
  personaName: string;
  setPersonaName: (v: string) => void;
  personaRole: string;
  setPersonaRole: (v: string) => void;
  personaInstruction: string;
  handleUpdatePersona: (name: string, role: string, instruction: string) => Promise<void>;
  showConfirm: (title: string, description: string, onConfirm: () => void, variant?: 'default' | 'destructive') => void;
  showAlert: (title: string, description: string) => void;
  handleCommitProposal: (msgId: string, files: { filename: string; code: string }[], explanation: string) => Promise<void>;
  handleRestoreVersion: (versionId: string) => Promise<void>;
  handleUpdateDesignSystem: UpdateDesignSystemHandler;
  setSelectedTheme: (theme: string) => void;
  // Epic #96 — tool call handling
  isProcessingTools: boolean;
  onConfirmDeletePage: (toolCallId: string, filename: string) => void;
  onCancelDeletePage: (toolCallId: string) => void;
  onPreviewToolResult: (files: { [filename: string]: string }) => void;
  onRetryToolCall: (toolCallId: string) => void;
}

export default function ChatPanel({
  project, activeFileList,
  isSidebarCollapsed,
  mobilePanel, chatContainerRef,
  aiPrompt, setAiPrompt, chatScope, setChatScope,
  isAutoApply, setIsAutoApply, isAiResponding, aiStreamStatus, isClearingChat,
  handleSendChatPrompt, handleSendChatPromptRef,
  selectedModel, setSelectedModel, availableModels, isLoadingModels,
  selectedTheme, selectedTypography,
  onOpenDesignDrawer, onOpenAttachmentPortal,
  attachedAsset, setAttachedAsset,
  targetedElement, setTargetedElement,
  aiStreamText, chatEndRef, showConfirm, showAlert,
  handleCommitProposal, handleRestoreVersion,
  // Epic #96
  onConfirmDeletePage, onCancelDeletePage,
  onPreviewToolResult, onRetryToolCall,
}: ChatPanelProps) {
  const [isToolsMenuOpen, setIsToolsMenuOpen] = React.useState(false);
  const toolsBtnRef = React.useRef<HTMLButtonElement>(null);
  const [toolsMenuPos, setToolsMenuPos] = React.useState({ bottom: 0, left: 0 });

  // Anchor the tools menu to the ➕ button (fixed positioning needs real
  // coordinates — absolute inside a fixed backdrop would hit the viewport edge).
  const toggleToolsMenu = () => {
    if (!isToolsMenuOpen && toolsBtnRef.current) {
      const rect = toolsBtnRef.current.getBoundingClientRect();
      setToolsMenuPos({ bottom: window.innerHeight - rect.bottom + 8, left: rect.left });
    }
    setIsToolsMenuOpen(!isToolsMenuOpen);
  };

  React.useEffect(() => {
    handleSendChatPromptRef.current = handleSendChatPrompt;
  }, [handleSendChatPrompt, handleSendChatPromptRef]);

  return (
    <aside
      className={cn(
        // absolute inset-0 pins the panel to its relative wrapper — unlike
        // h-full, this never depends on the parent's height resolving.
        "absolute inset-0 flex flex-col overflow-hidden z-30 transition-all duration-300 ease-in-out",
        "bg-[#F4F4F0] dark:bg-[#0F0F0D]",
        isSidebarCollapsed
          ? "opacity-0 pointer-events-none border-r-0"
          : "border-r border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10",
        mobilePanel === 'chat' ? 'flex' : 'hidden lg:flex'
      )}
    >

                <div ref={chatContainerRef} className="flex-1 min-h-0 overflow-y-auto p-4 scrollbar-hide bg-white dark:bg-zinc-950 flex flex-col">
                   {(project.chats || []).length > 0 ? (
                     (project.chats || []).map((msg, idx) => (
                       <div key={idx} className={cn("flex flex-col gap-2 animate-fade mb-1", msg.sender === 'user' ? 'items-end' : 'items-start')}>
                          <div className="flex items-center gap-2 px-1">
                             {msg.sender !== 'user' ? <div className={cn("w-1.5 h-1.5 rounded-full", "bg-[#FF3B00] shadow-[0_0_6px_rgba(255,59,0,0.6)]")} /> : null}
                             <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">
                                {msg.sender === 'user' ? 'You' : 'LIVEFOLIO AI'}
                             </span>
                          </div>
                         <div className={cn(
                             "max-w-[95%] p-4 text-[13px] transition-all duration-300 relative group/msg",
                             msg.sender === 'user'
                               ? "bg-[#0F0F0D] dark:bg-[#F4F4F0] text-[#F4F4F0] dark:text-[#0F0F0D] font-medium rounded-2xl shadow-sm"
                               : "bg-[#F4F4F0] dark:bg-[#0F0F0D] text-[#0F0F0D] dark:text-[#F4F4F0] rounded-2xl ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 shadow-sm"
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
                                   <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40 flex items-center gap-1">
                                      <CheckCircle size={10} className={cn("text-[#FF3B00]")} />
                                      Changes Applied
                                   </span>
                                   <Button 
                                     variant="outline"
                                     size="sm"
                                     onClick={() => {
                                       showConfirm(
                                         "Revert Changes",
                                         "Would you like to restore the project to the state before these changes were applied? This will create a new history entry.",
                                         () => {
                                           const commitMsgQuery = msg.text.slice(0, 30);
                                           let versionIdx = project.versions.findIndex(v => v.commitMessage.includes(commitMsgQuery));
                                           if (versionIdx === -1) {
                                             versionIdx = project.versions.length - 1;
                                           }
                                           const targetIdx = versionIdx - 1;
                                           if (targetIdx >= 0) {
                                             handleRestoreVersion(project.versions[targetIdx].versionId);
                                           } else {
                                             showAlert("Cannot Revert", "There is no previous version to revert to.");
                                           }
                                         }
                                       );
                                     }}
                                     className={cn(
                                       "h-7 px-3 text-[10px] font-bold uppercase tracking-[0.14em] transition-colors cursor-pointer rounded-lg",
                                       "bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70 hover:bg-[#0F0F0D]/10 dark:hover:bg-[#F4F4F0]/15 hover:text-[#FF3B00]"
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
                                 <div className={cn("w-1 h-1 rounded-full", "bg-[#FF3B00] shadow-[0_0_6px_rgba(255,59,0,0.6)]")} />
                                 <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">Proposed Patch</span>
                              </div>
                              <Card className={cn(
                                "p-4 space-y-4",
                                "bg-[#F4F4F0] dark:bg-[#171714] ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 rounded-xl shadow-sm"
                              )}>
                                 <div className="space-y-1.5">
                                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">Impacted Files:</p>
                                    <div className="flex flex-wrap gap-1.5">
                                       {msg.proposedFiles.map(pf => (
                                         <span key={pf.filename} className={cn(
                                           "px-2 py-0.5 text-[10px] font-mono font-bold",
                                           "rounded-full bg-[#FF3B00]/10 text-[#FF3B00]"
                                         )}>{pf.filename}</span>
                                       ))}
                                    </div>
                                 </div>
                                 <Button
                                   onClick={() => handleCommitProposal(msg.id, msg.proposedFiles!, msg.proposedExplanation || '')}
                                   disabled={isAiResponding}
                                   className={cn(
                                     "w-full font-bold uppercase text-[10px] tracking-[0.14em] h-9 transition-colors rounded-lg",
                                     "bg-[#FF3B00] text-white hover:bg-[#0F0F0D] dark:hover:bg-[#F4F4F0] dark:hover:text-[#0F0F0D]"
                                   )}
                                 >
                                    {isAiResponding ? (
                                      <><LoadingSpinner size="xs" className="mr-1.5" /> Applying…</>
                                    ) : (
                                      'Execute Patch'
                                    )}
                                 </Button>
                              </Card>
                           </div>
                         )}

                         {/* Interactive Action Cards */}
                         {msg.interactiveCard && (
                           <div className="mt-3 space-y-2.5 animate-slideUp w-full max-w-[300px] text-left">
                              <div className="flex items-center gap-2 px-1">
                                 <Wand2 size={10} className="text-zinc-400" />
                                 <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">{msg.interactiveCard.title}</span>
                              </div>
                              <Card className={cn(
                                "p-4 space-y-4",
                                "bg-[#F4F4F0] dark:bg-[#171714] ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 rounded-xl shadow-sm"
                              )}>
                                 <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-normal font-medium">{msg.interactiveCard.description}</p>
                                 <div className="flex flex-col gap-1">
                                    {msg.interactiveCard.actions?.map((action, aIdx) => (
                                      <button
                                        key={aIdx}
                                        onClick={() => handleSendChatPrompt(undefined, action.value)}
                                        className={cn(
                                          "text-[10px] text-left px-2.5 py-2 transition-colors font-semibold cursor-pointer",
                                          "rounded-lg bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70 hover:bg-[#0F0F0D]/10 dark:hover:bg-[#F4F4F0]/15 hover:text-[#FF3B00]"
                                        )}
                                      >
                                        {action.label}
                                      </button>
                                    ))}
                                 </div>
                              </Card>
                           </div>
                         )}

                         {/* Epic #96: Tool Call Cards */}
                         {msg.toolCalls?.map((tc) => (
                           <ToolCallCard
                             key={tc.id}
                             toolCall={tc}
                             onConfirm={(id) => {
                               const filename = tc.arguments?.filename;
                               if (filename) onConfirmDeletePage(id, filename);
                             }}
                             onCancel={(id) => onCancelDeletePage(id)}
                             onPreview={(files) => onPreviewToolResult(files)}
                             onRetry={(id) => onRetryToolCall(id)}
                           />
                         ))}
                       </div>
                      ))
                    ) : (
                      <div className="flex flex-col items-center justify-center flex-1 text-center px-6 py-4 space-y-4">
                        <span className="inline-block h-8 w-8 rounded-lg bg-[#FF3B00]" />
                        <div className="space-y-0.5">
                          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Start a conversation</h3>
                          <p className="text-xs text-zinc-400 dark:text-zinc-500 max-w-[260px] leading-relaxed">
                            Describe your design or attach a file to begin
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={onOpenDesignDrawer}
                            className={cn(
                            "flex items-center gap-2 px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                            "rounded-lg bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70 hover:bg-[#0F0F0D]/10 dark:hover:bg-[#F4F4F0]/15"
                          )}
                          >
                            <Palette size={12} />
                            Browse Design Library
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenAttachmentPortal('convert')}
                            className={cn(
                            "flex items-center gap-2 px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                            "rounded-lg bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70 hover:bg-[#0F0F0D]/10 dark:hover:bg-[#F4F4F0]/15"
                          )}
                          >
                            <FileText size={12} />
                            Convert a Document
                          </button>
                        </div>
                      </div>
                    )}
                    {isAiResponding ? (
                       <div className="flex flex-col gap-2 items-start animate-fade">
                          <div className="flex items-center gap-2 px-1">
                             <div className={cn("w-1.5 h-1.5 rounded-full animate-pulse", "bg-[#FF3B00] shadow-[0_0_6px_rgba(255,59,0,0.6)]")} />
                             <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40 flex items-center gap-1.5">
                                LIVEFOLIO AI
                                {aiStreamStatus && (
                                   <span className={cn("animate-pulse font-medium lowercase", "text-[#FF3B00] dark:text-[#FF3B00]")}>({aiStreamStatus})</span>
                                )}
                             </span>
                          </div>
                          <div className={cn(
                            "max-w-[95%] px-3 py-2 text-[13px] relative",
                            "rounded-2xl bg-[#F4F4F0] dark:bg-[#0F0F0D] text-[#0F0F0D] dark:text-[#F4F4F0] ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 shadow-sm"
                          )}>
                             {aiStreamText ? (
                                <div className="relative">
                                   <ChatMessageRenderer text={aiStreamText} />
                                   <span className={cn("inline-block w-1 h-3.5 ml-0.5 animate-pulse align-middle", "bg-[#FF3B00]")} />
                                </div>
                             ) : (
                                <div className="flex items-center gap-0.5">
                                   <div className={cn("w-1 h-1 animate-bounce", "bg-[#FF3B00]")} />
                                   <div className={cn("w-1 h-1 animate-bounce [animation-delay:0.15s]", "bg-[#FF3B00]")} />
                                   <div className={cn("w-1 h-1 animate-bounce [animation-delay:0.3s]", "bg-[#FF3B00]")} />
                                </div>
                             )}
                          </div>
                       </div>
                    ) : null}
                   <div ref={chatEndRef} />
                </div>
                <div className={cn(
                  "shrink-0 px-4 pt-3 pb-4 space-y-2 z-20",
                  "bg-[#F4F4F0] dark:bg-[#0F0F0D] border-t border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10"
                )}>
                    <form onSubmit={handleSendChatPrompt} className={cn(
                      "relative w-full transition-all overflow-hidden",
                      "rounded-xl bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 border-0 focus-within:ring-2 focus-within:ring-[#FF3B00]/40"
                    )}>
                         {/* Point & Polish: Targeted Element — compact banner */}
                         {targetedElement && (
                           <div className={cn(
                             "px-3 py-1.5 flex items-center gap-2 transition-all shrink-0",
                             "bg-[#FF3B00]/10 border-b border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10"
                           )}>
                             <span className={cn(
                               "px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase shrink-0",
                               "rounded-full bg-[#FF3B00]/10 text-[#FF3B00]"
                             )}>
                               {targetedElement.tagName}
                             </span>
                             <span className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400 truncate flex-1 min-w-0" title={targetedElement.selector}>
                               {targetedElement.selector}
                             </span>
                             {/* Compact chip row — horizontally scrollable */}
                             <div className="flex gap-1 overflow-x-auto no-scrollbar shrink-0 max-w-[50%]">
                               {getPresetChips(targetedElement.tagName).slice(0, 3).map((chipText) => (
                                 <button
                                   key={chipText}
                                   type="button"
                                   onClick={() => setAiPrompt(chipText)}
                                   className={cn("px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0", "rounded-lg bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70 hover:bg-[#0F0F0D]/10 dark:hover:bg-[#F4F4F0]/15 hover:text-[#FF3B00]")}
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
                              <div className={cn("px-3 py-1.5 flex items-center justify-between gap-2 shrink-0", "bg-[#FF3B00]/10 border-b border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10")}>
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className={cn("w-6 h-6 overflow-hidden flex items-center justify-center shrink-0", "rounded-lg bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10")}>
                                    <img src={base64Data} alt="Attached Preview" className="max-w-full max-h-full object-contain" />
                                  </div>
                                  <span className="text-[10px] font-semibold text-zinc-600 dark:text-zinc-400 truncate">{shortName}</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setAttachedAsset(null)}
                                  className={cn("text-zinc-400 hover:text-rose-500 p-1 transition-colors cursor-pointer shrink-0", "rounded-lg hover:bg-[#FF3B00]/10")}
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
                          value={aiPrompt}
                          onChange={(e) => setAiPrompt(e.target.value)}
                          disabled={isAiResponding || isClearingChat || availableModels.length === 0}
                          placeholder={availableModels.length === 0 ? "Please configure an API key in Settings or start Ollama to chat…" : "Describe a change or new screen…"}
                          className="w-full bg-transparent border-0 px-4 py-2 text-[13px] text-zinc-900 dark:text-zinc-50 resize-none focus:outline-none focus:ring-0 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 leading-relaxed disabled:text-zinc-400 disabled:cursor-not-allowed"
                          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (availableModels.length > 0) handleSendChatPrompt(); }}}
                        />

                        {/* Bottom Toolbar — main row: ➕ 🎨 📎 | [Project▾] [Model▾] → */}
                        <div className="flex items-center justify-between px-3 pt-1 gap-1 pb-3">
                           {/* Left: core icons — only 3 visible, rest behind ➕ */}
                           <div className="flex items-center gap-0.5">
                              {/* ➕ Expand more tools */}
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

                           {/* Right: scope, model, send */}
                           <div className="flex items-center gap-1 shrink-0">
                              <Dropdown
                                value={chatScope}
                                onChange={(v) => setChatScope(v as 'Whole Project' | 'Current Screen')}
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
                                <span className={cn("w-1.5 h-1.5 rounded-full animate-pulse shrink-0 ml-1", "bg-[#FF3B00]")} />
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
                                          const group = ({ managed: 'Managed', local: 'Ollama', gemini: 'Gemini', openai: 'OpenAI', anthropic: 'Claude', deepseek: 'DeepSeek' } as Record<string, string>)[m.provider];
                                          return { value, label: m.name, group };
                                        })
                                  }
                                />
                              </div>
                              )}
                              <button type="submit"
                                disabled={isAiResponding || isClearingChat || !aiPrompt.trim() || availableModels.length === 0}
                                className={cn(
                                  "w-7 h-7 flex items-center justify-center disabled:opacity-25 transition-all cursor-pointer shrink-0",
                                  "rounded-lg bg-[#FF3B00] text-white hover:bg-[#0F0F0D] dark:hover:bg-[#F4F4F0] dark:hover:text-[#0F0F0D]"
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
                                onClick={() => { onOpenDesignDrawer(); setIsToolsMenuOpen(false); }}
                              />
                              <ToolsMenuRow
                                icon={Paperclip}
                                label="Attach File"
                                onClick={() => { onOpenAttachmentPortal('enrich'); setIsToolsMenuOpen(false); }}
                              />
                              <ToolsMenuRow
                                icon={Image}
                                label="Visual Assets"
                                hasIndicator={!!(project?.versions?.[project.versions.length - 1] && Object.keys(project.versions[project.versions.length - 1].files).filter(k => k.startsWith('assets/')).length > 0)}
                                onClick={() => { onOpenAttachmentPortal('enrich'); setIsToolsMenuOpen(false); }}
                              />
                              <div className="my-1 h-px bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10" />
                              <ToolsMenuRow
                                icon={Zap}
                                label={`Apply: ${selectedTheme}`}
                                disabled={availableModels.length === 0}
                                onClick={() => { setChatScope('Whole Project'); handleSendChatPrompt(undefined, `Please apply the "${selectedTheme}" theme and "${selectedTypography}" typography pair to all screens.`, 'Whole Project'); setIsToolsMenuOpen(false); }}
                              />
                              {activeFileList.filter(f => f.endsWith('.html')).length > 1 && (
                                <ToolsMenuRow
                                  icon={Network}
                                  label="Link Pages"
                                  disabled={availableModels.length === 0}
                                  onClick={() => { setChatScope('Whole Project'); handleSendChatPrompt(undefined, `Please analyze all pages to map out and fix navigation relationships between them using relative href links.`, 'Whole Project'); setIsToolsMenuOpen(false); }}
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
    </aside>
  );
}

/** Labeled row for the composer's tools menu (Apple-style, borderless). */
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
