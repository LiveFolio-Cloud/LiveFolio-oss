'use client';

import React from 'react';
import { Paperclip, Eye, FileText, Trash2, CheckCircle, HardDrive, Sparkles, Check, Image, Plus } from 'lucide-react';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { HTMLFile } from '@/lib/db';

interface AttachmentPortalProps {
  isOpen: boolean;
  project: HTMLFile;
  selectedAttachmentFile: File | null;
  extractedContextText: string;
  isExtractingText: boolean;
  isUploadingAsset: boolean;
  attachmentIntent: 'enrich' | 'convert';
  onClose: () => void;
  onFileSelect: () => void;
  onRemoveFile: () => void;
  onSetIntent: (intent: 'enrich' | 'convert') => void;
  onCommit: () => void;
  onDeleteReference: (filename: string) => void;
  onDeleteVisualAsset: (filename: string) => void;
  onUseAsset?: (assetName: string) => void;
}

export default function AttachmentPortal({
  isOpen,
  project,
  selectedAttachmentFile,
  extractedContextText,
  isExtractingText,
  isUploadingAsset,
  attachmentIntent,
  onClose,
  onFileSelect,
  onRemoveFile,
  onSetIntent,
  onCommit,
  onDeleteReference,
  onDeleteVisualAsset,
  onUseAsset,
}: AttachmentPortalProps) {
  const latestVersion = project?.versions?.[project.versions.length - 1];
  const visualAssetCount = latestVersion
    ? Object.keys(latestVersion.files).filter(k => k.startsWith('assets/')).length
    : 0;
  const visualAssets = latestVersion
    ? Object.keys(latestVersion.files).filter(k => k.startsWith('assets/'))
    : [];

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title="Assets & Documents"
      description="Upload documents for AI context or images for the folio's asset library."
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">

        {/* LEFT COLUMN: Upload & File Handling */}
        <div className="space-y-4">
          <h4 className="text-[10px] font-bold uppercase tracking-[0.14em] ml-1 text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">Upload New Document or Asset</h4>

          {!selectedAttachmentFile ? (
            <button
              type="button"
              onClick={onFileSelect}
              className={cn(
                "w-full border border-dashed p-8 flex flex-col items-center justify-center text-center gap-3 cursor-pointer transition-colors group/dropzone min-h-[44px]",
                "border-[#0F0F0D]/20 dark:border-[#F4F4F0]/20 rounded-xl hover:border-[#FF3B00] hover:bg-[#FF3B00]/5 dark:hover:bg-[#FF3B00]/10"
              )}
            >
              <div className={cn(
                "p-3 transition-colors",
                "rounded-xl bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 group-hover/dropzone:text-[#FF3B00] group-hover/dropzone:bg-[#FF3B00]/10 dark:group-hover/dropzone:bg-[#FF3B00]/10"
              )}>
                <Paperclip size={20} />
              </div>
              <div>
                <p className={cn(
                  "text-xs font-bold",
                  "text-[#0F0F0D] dark:text-[#F4F4F0]"
                )}>Choose a file</p>
                <p className={cn(
                  "text-[10px] mt-1 leading-relaxed",
                  "text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60"
                )}>Supports PDF, PNG, JPG, WEBP, TXT, MD, CSV</p>
              </div>
            </button>
          ) : (
            <div className={cn(
              "p-5 space-y-4",
              "bg-white dark:bg-[#171714] rounded-xl ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 shadow-sm"
            )}>
              <div className={cn(
                "flex items-start justify-between gap-2 pb-3 border-b",
                "border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10"
              )}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={cn(
                    "p-2 shrink-0",
                    "rounded-lg bg-[#FF3B00]/10 text-[#FF3B00]"
                  )}>
                    {selectedAttachmentFile.type.startsWith('image/') ? <Eye size={16} /> : <FileText size={16} />}
                  </div>
                  <div className="min-w-0">
                    <p className={cn(
                      "text-xs font-bold truncate",
                      "text-[#0F0F0D] dark:text-[#F4F4F0] font-mono"
                    )}>{selectedAttachmentFile.name}</p>
                    <p className={cn(
                      "text-[10px] mt-0.5",
                      "text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60"
                    )}>
                      {(selectedAttachmentFile.size / 1024).toFixed(1)} KB &bull; {selectedAttachmentFile.type.split('/')[1] || 'unknown'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={onRemoveFile}
                  className={cn(
                    "p-1 transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center",
                    "text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50 hover:text-[#FF3B00] rounded-lg hover:bg-[#FF3B00]/10"
                  )}
                  title="Remove selection"
                >
                  <Trash2 size={12} />
                </button>
              </div>

              {isExtractingText ? (
                <div className="py-6 flex flex-col items-center justify-center gap-2 text-center">
                  <LoadingSpinner size="sm" />
                  <p className={cn(
                    "text-[10px] font-bold uppercase tracking-[0.14em] animate-pulse",
                    "text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40"
                  )}>Extracting File Contents...</p>
                </div>
              ) : (
                <>
                  {selectedAttachmentFile.type.startsWith('image/') ? (
                    <div className="space-y-3">
                      <p className={cn(
                        "text-[10px] font-bold uppercase tracking-[0.14em] flex items-center gap-1.5",
                        "text-[#FF3B00]"
                      )}>
                        <CheckCircle size={10} />
                        <span>Visual asset</span>
                      </p>
                      <div className={cn(
                        "relative aspect-video w-full overflow-hidden flex items-center justify-center",
                        "rounded-xl ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/5"
                      )}>
                        <img src={extractedContextText} alt="Preview" className="max-h-full max-w-full object-contain p-2" />
                      </div>
                      <p className={cn(
                        "text-[10px] leading-relaxed italic px-1",
                        "text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60"
                      )}>
                        Saved to the folio's asset library.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <p className={cn(
                        "text-[10px] font-bold uppercase tracking-[0.14em]",
                        "text-[#FF3B00]"
                      )}>How should the AI use this?</p>

                      <div className="grid grid-cols-1 gap-3">
                        <button
                          type="button"
                          onClick={() => onSetIntent('enrich')}
                          className={cn(
                            "w-full text-left p-3.5 transition-colors flex items-start gap-3 cursor-pointer min-h-[44px] rounded-xl ring-1",
                            attachmentIntent === 'enrich'
                              ? "bg-[#FF3B00]/10 ring-[#FF3B00]/30"
                              : "bg-white dark:bg-[#171714] ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 hover:ring-[#FF3B00]/40"
                          )}
                        >
                          <div className={cn(
                            "p-1.5 shrink-0 rounded-lg",
                            attachmentIntent === 'enrich'
                              ? "bg-[#FF3B00] text-white"
                              : "bg-[#0F0F0D]/10 dark:bg-[#F4F4F0]/10 text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60"
                          )}>
                            <HardDrive size={12} />
                          </div>
                          <div className="min-w-0">
                            <p className={cn(
                              "text-xs font-bold",
                              attachmentIntent === 'enrich' ? "text-[#0F0F0D] dark:text-[#F4F4F0]" : "text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60"
                            )}>Add to AI context</p>
                            <p className={cn(
                              "text-[10px] mt-0.5 leading-relaxed",
                              "text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60"
                            )}>The AI reads this document in all future chats.</p>
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => onSetIntent('convert')}
                          className={cn(
                            "w-full text-left p-3.5 transition-colors flex items-start gap-3 cursor-pointer min-h-[44px] rounded-xl ring-1",
                            attachmentIntent === 'convert'
                              ? "bg-[#FF3B00]/10 ring-[#FF3B00]/30"
                              : "bg-white dark:bg-[#171714] ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 hover:ring-[#FF3B00]/40"
                          )}
                        >
                          <div className={cn(
                            "p-1.5 shrink-0 rounded-lg",
                            attachmentIntent === 'convert'
                              ? "bg-[#FF3B00] text-white"
                              : "bg-[#0F0F0D]/10 dark:bg-[#F4F4F0]/10 text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60"
                          )}>
                            <Sparkles size={12} />
                          </div>
                          <div className="min-w-0">
                            <p className={cn(
                              "text-xs font-bold",
                              attachmentIntent === 'convert' ? "text-[#0F0F0D] dark:text-[#F4F4F0]" : "text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60"
                            )}>Convert to a screen</p>
                            <p className={cn(
                              "text-[10px] mt-0.5 leading-relaxed",
                              "text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60"
                            )}>Builds a new page from this document's structure.</p>
                          </div>
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2.5 pt-1.5">
                    <Button
                      disabled={isUploadingAsset}
                      onClick={onCommit}
                      className={cn(
                        "flex-1 h-9 cursor-pointer transition-colors flex items-center justify-center gap-1.5 border-none min-h-[44px]",
                        "rounded-lg bg-[#FF3B00] text-white text-xs font-semibold hover:bg-[#0F0F0D] dark:hover:bg-[#F4F4F0] dark:hover:text-[#0F0F0D]"
                      )}
                    >
                      {isUploadingAsset ? (
                        <>
                          <LoadingSpinner size="xs" />
                          <span>Uploading...</span>
                        </>
                      ) : (
                        <>
                          <Check size={12} />
                          <span>{selectedAttachmentFile.type.startsWith('image/') ? 'Save Visual Asset' : attachmentIntent === 'enrich' ? 'Add to context' : 'Load into prompt'}</span>
                        </>
                      )}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: Active Library */}
        <div className="space-y-4 flex flex-col min-h-[300px]">
          <h4 className="text-[10px] font-bold uppercase tracking-[0.14em] ml-1 text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">Current Folio Asset Library</h4>

          <div className={cn(
            "flex-1 p-4 flex flex-col gap-4 overflow-hidden min-h-[250px]",
            "bg-white dark:bg-[#171714] rounded-xl ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 shadow-sm"
          )}>

            {/* Tab Section 1: Documents */}
            <div className="flex-1 flex flex-col min-h-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] mb-2 flex items-center gap-1 text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">
                <HardDrive size={10} />
                <span>Documents ({(project?.referenceFiles || []).length})</span>
              </p>
              <div className="flex-1 overflow-y-auto min-h-0 space-y-1.5 pr-1 scrollbar-thin scrollbar-thumb-zinc-200 dark:scrollbar-thumb-zinc-800">
                {!(project?.referenceFiles?.length) ? (
                  <p className="text-[10px] italic py-2 text-center text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60">No documents yet</p>
                ) : (
                  project.referenceFiles.map((f, i) => (
                    <div key={i} className={cn(
                      "flex items-center justify-between p-2 min-w-0 gap-2",
                      "rounded-lg ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 hover:ring-[#FF3B00]/40"
                    )}>
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText size={12} className={cn("shrink-0", "text-[#FF3B00]")} />
                        <span className={cn(
                          "text-[11px] truncate",
                          "font-mono text-[#0F0F0D] dark:text-[#F4F4F0]"
                        )} title={f.filename}>{f.filename}</span>
                      </div>
                      <button
                        onClick={() => onDeleteReference(f.filename)}
                        className={cn(
                          "p-1 shrink-0 transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center",
                          "text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50 hover:text-[#FF3B00] rounded-lg hover:bg-[#FF3B00]/10"
                        )}
                        title="Delete file"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Tab Section 2: Visual Assets */}
            <div className={cn(
              "flex-1 flex flex-col min-h-0 pt-2 border-t",
              "border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10"
            )}>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] mb-2 flex items-center gap-1 text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">
                {/* eslint-disable-next-line jsx-a11y/alt-text -- lucide <Image> renders a decorative SVG icon, not an <img> */}
                <Image size={10} />
                <span>Visual Assets ({visualAssetCount})</span>
              </p>
              <div className="flex-1 overflow-y-auto min-h-0 space-y-1.5 pr-1 scrollbar-thin scrollbar-thumb-zinc-200 dark:scrollbar-thumb-zinc-800">
                {visualAssetCount === 0 ? (
                  <p className="text-[10px] italic py-2 text-center text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60">No images yet</p>
                ) : (
                  visualAssets.map((assetName, i) => {
                    const base64Data = latestVersion?.files[assetName] || '';
                    return (
                      <div key={i} className={cn(
                        "flex items-center justify-between p-1.5 min-w-0 gap-2",
                        "rounded-lg ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 hover:ring-[#FF3B00]/40"
                      )}>
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={cn(
                            "w-8 h-8 overflow-hidden flex items-center justify-center shrink-0",
                            "rounded-lg ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10"
                          )}>
                            <img src={base64Data} alt="Preview" className="max-w-full max-h-full object-contain" />
                          </div>
                          <span className={cn(
                            "text-[11px] truncate",
                            "font-mono text-[#0F0F0D] dark:text-[#F4F4F0]"
                          )} title={assetName}>{assetName.replace('assets/', '')}</span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {onUseAsset && (
                            <button
                              onClick={() => onUseAsset(assetName)}
                              className="rounded-lg px-2 py-1 text-[11px] font-semibold bg-[#FF3B00]/10 text-[#FF3B00] hover:bg-[#FF3B00] hover:text-white transition-colors cursor-pointer shrink-0 inline-flex items-center justify-center"
                              title="Use asset"
                            >
                              <Plus size={11} />
                            </button>
                          )}
                          <button
                            onClick={() => onDeleteVisualAsset(assetName)}
                            className={cn(
                              "p-1 shrink-0 transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center",
                              "text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50 hover:text-[#FF3B00] rounded-lg hover:bg-[#FF3B00]/10"
                            )}
                            title="Delete asset"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

          </div>
        </div>

      </div>
    </BottomSheet>
  );
}
