'use client';

import React, { useEffect, useState } from 'react';
import { FolderUp, FileCode, Archive, CheckCircle2, Loader2 } from 'lucide-react';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { cn } from '@/lib/utils';

interface ImportRepoModalProps {
  isOpen: boolean;
  isImporting: boolean;
  importPhase?: ImportPhase;
  importCount?: number;
  onClose: () => void;
  onImportSingle: () => void;
  onImportFolder: () => void;
  onImportZip: () => void;
}

export type ImportPhase = 'reading' | 'transforming' | 'saving' | 'finalizing' | null;

const PHASES: { phase: ImportPhase; label: string; sub: string }[] = [
  { phase: 'reading', label: 'Reading your files', sub: 'Scanning every page and asset in your project…' },
  { phase: 'transforming', label: 'Transforming images', sub: 'Converting embedded assets into optimized bundles…' },
  { phase: 'saving', label: 'Baking into a folio', sub: 'Compiling everything into a LiveFolio workspace…' },
  { phase: 'finalizing', label: 'Almost ready', sub: 'Wrapping up — your studio opens in a moment…' },
];

const DISPLAY_FONT = '"Cabinet Grotesk", "Space Grotesk", sans-serif';

export default function ImportRepoModal({
  isOpen,
  isImporting,
  importPhase,
  importCount,
  onClose,
  onImportSingle,
  onImportFolder,
  onImportZip,
}: ImportRepoModalProps) {
  const [phaseIndex, setPhaseIndex] = useState(0);

  useEffect(() => {
    if (!isImporting || !importPhase) return;
    const idx = PHASES.findIndex((p) => p.phase === importPhase);
    if (idx >= 0) setPhaseIndex(idx);
  }, [isImporting, importPhase]);

  return (
    <BottomSheet isOpen={isOpen} onClose={isImporting ? () => {} : onClose} title="Import Code Repository" description="Populate your folio with an existing HTML project or static site folder.">
      {isImporting ? (
        <div className="flex flex-col items-center justify-center py-10 gap-5">
          {/* Phase timeline */}
          <div className="w-full max-w-[280px] space-y-3">
            {PHASES.map((p, i) => {
              const isCurrent = i === phaseIndex;
              const isPast = i < phaseIndex;
              const isFuture = i > phaseIndex;

              return (
                <div key={p.phase} className="flex items-start gap-3">
                  {/* Phase indicator */}
                  <div className="relative flex flex-col items-center shrink-0 pt-0.5">
                    <div className={cn(
                      'h-5 w-5 flex items-center justify-center rounded-lg border transition-all',
                      isPast && 'border-[#22c55e] bg-[#22c55e] text-[#F4F4F0]',
                      isCurrent && 'border-[var(--app-accent)] bg-[var(--app-accent)]/10 text-[var(--app-accent)]',
                      isFuture && 'border-[#0F0F0D]/20 text-transparent',
                    )}>
                      {isPast ? (
                        <CheckCircle2 size={12} />
                      ) : isCurrent ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <div className="h-1.5 w-1.5 rounded-full bg-[#0F0F0D]/20" />
                      )}
                    </div>
                    {/* Connector line */}
                    {i < PHASES.length - 1 && (
                      <div className={cn(
                        'w-0.5 flex-1 min-h-[12px]',
                        isPast ? 'bg-[#22c55e]' : 'bg-[#0F0F0D]/10',
                      )} />
                    )}
                  </div>

                  {/* Phase label */}
                  <div className="flex-1 min-w-0 pb-3">
                    <p className={cn(
                      'text-sm font-bold font-sans uppercase tracking-tight transition-colors',
                      isPast && 'text-[#22c55e]',
                      isCurrent && 'text-[var(--app-accent)]',
                      isFuture && 'text-[#0F0F0D]/30',
                    )}>
                      {p.label}
                    </p>
                    {isCurrent && (
                      <p className="text-xs text-[#0F0F0D]/50 mt-0.5 leading-relaxed">
                        {p.sub}
                      </p>
                    )}
                    {isCurrent && importCount != null && importCount > 0 && p.phase === 'reading' && (
                      <p className="text-xs font-bold text-[var(--app-accent)] mt-0.5">
                        {importCount} file{importCount !== 1 ? 's' : ''} found so far…
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3">
            <button
              type="button"
              onClick={onImportSingle}
              className={cn(
                "flex items-center gap-4 p-4 transition-all active:scale-[0.98] cursor-pointer text-left group/btn min-h-[44px]",
                "rounded-xl border border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 hover:bg-[#0F0F0D]/10 dark:hover:bg-[#F4F4F0]/15 hover:border-[var(--app-accent)]"
              )}
            >
              <div
                className={cn(
                  "w-10 h-10 flex items-center justify-center group-hover/btn:scale-105 transition-transform shrink-0",
                  "rounded-xl bg-[var(--app-accent)]/10 dark:bg-[var(--app-accent)]/20"
                )}
              >
                <FileCode
                  size={18}
                  className={cn(
                    "text-[var(--app-accent)]"
                  )}
                />
              </div>
              <div>
                <span
                  className={cn(
                    "text-sm font-black block tracking-tighter",
                    "text-[#0F0F0D] dark:text-[#F4F4F0]"
                  )}
                  style={{ fontFamily: DISPLAY_FONT }}
                >
                  Single HTML File
                </span>
                <p
                  className={cn(
                    "text-xs font-semibold",
                    "text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60"
                  )}
                >
                  Upload a single .html file into the workspace.
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={onImportFolder}
              className={cn(
                "flex items-center gap-4 p-4 transition-all active:scale-[0.98] cursor-pointer text-left group/btn min-h-[44px]",
                "rounded-xl border border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 hover:bg-[#0F0F0D]/10 dark:hover:bg-[#F4F4F0]/15 hover:border-[var(--app-accent)]"
              )}
            >
              <div
                className={cn(
                  "w-10 h-10 flex items-center justify-center group-hover/btn:scale-105 transition-transform shrink-0",
                  "rounded-xl bg-[var(--app-accent)]/10 dark:bg-[var(--app-accent)]/20"
                )}
              >
                <FolderUp
                  size={18}
                  className={cn(
                    "text-[var(--app-accent)]"
                  )}
                />
              </div>
              <div>
                <span
                  className={cn(
                    "text-sm font-black block tracking-tighter",
                    "text-[#0F0F0D] dark:text-[#F4F4F0]"
                  )}
                  style={{ fontFamily: DISPLAY_FONT }}
                >
                  Folder Directory
                </span>
                <p
                  className={cn(
                    "text-xs font-semibold",
                    "text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60"
                  )}
                >
                  Import an entire local project folder.
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={onImportZip}
              className={cn(
                "flex items-center gap-4 p-4 transition-all active:scale-[0.98] cursor-pointer text-left group/btn min-h-[44px]",
                "rounded-xl border border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 hover:bg-[#0F0F0D]/10 dark:hover:bg-[#F4F4F0]/15 hover:border-[var(--app-accent)]"
              )}
            >
              <div
                className={cn(
                  "w-10 h-10 flex items-center justify-center group-hover/btn:scale-105 transition-transform shrink-0",
                  "rounded-xl bg-[var(--app-accent)]/10 dark:bg-[var(--app-accent)]/20"
                )}
              >
                <Archive
                  size={18}
                  className={cn(
                    "text-[var(--app-accent)]"
                  )}
                />
              </div>
              <div>
                <span
                  className={cn(
                    "text-sm font-black block tracking-tighter",
                    "text-[#0F0F0D] dark:text-[#F4F4F0]"
                  )}
                  style={{ fontFamily: DISPLAY_FONT }}
                >
                  ZIP Bundle
                </span>
                <p
                  className={cn(
                    "text-xs font-semibold",
                    "text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60"
                  )}
                >
                  Import a zipped project archive.
                </p>
              </div>
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className={cn(
              "w-full text-xs font-bold tracking-tight transition-colors py-2 cursor-pointer min-h-[44px]",
              "text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:text-[#0F0F0D] dark:hover:text-[#F4F4F0]"
            )}
          >
            Cancel
          </button>
        </div>
      )}
    </BottomSheet>
  );
}
