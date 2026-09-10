'use client';

import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, Plus, Minus, FileText } from 'lucide-react';
import { HTMLVersion } from '@/lib/db';
import { cn } from '@/lib/utils';

interface HistoryViewProps {
  versions: HTMLVersion[];
  onRestore: (versionId: string) => void;
}

/** Simple line diff between two strings — returns array of {type, text} */
function computeLineDiff(oldText: string, newText: string): { type: 'same' | 'added' | 'removed'; text: string }[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result: { type: 'same' | 'added' | 'removed'; text: string }[] = [];

  // Simple LCS-based diff for small files
  const maxLen = Math.max(oldLines.length, newLines.length);
  if (maxLen > 500) {
    // Too large — just show summary
    result.push({ type: 'same', text: `(${oldLines.length} lines → ${newLines.length} lines)` });
    return result;
  }

  // Build LCS table
  const dp: number[][] = Array.from({ length: oldLines.length + 1 }, () => new Array(newLines.length + 1).fill(0));
  for (let i = 1; i <= oldLines.length; i++) {
    for (let j = 1; j <= newLines.length; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff
  const diff: { type: 'same' | 'added' | 'removed'; text: string }[] = [];
  let i = oldLines.length, j = newLines.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      diff.unshift({ type: 'same', text: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diff.unshift({ type: 'added', text: newLines[j - 1] });
      j--;
    } else {
      diff.unshift({ type: 'removed', text: oldLines[i - 1] });
      i--;
    }
  }

  // Collapse long runs of unchanged lines
  const collapsed: typeof diff = [];
  let sameCount = 0;
  for (const d of diff) {
    if (d.type === 'same') {
      sameCount++;
      if (sameCount <= 3) collapsed.push(d);
      else if (sameCount === 4) collapsed.push({ type: 'same', text: '...' });
    } else {
      sameCount = 0;
      collapsed.push(d);
    }
  }

  return collapsed;
}

export default function HistoryView({ versions, onRestore }: HistoryViewProps) {
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);
  const reversed = versions.slice().reverse();

  return (
    <div className={cn(
      "w-full h-full max-w-3xl animate-fade overflow-y-auto pr-2 text-left",
      "space-y-0"
    )}>
      {reversed.map((v) => {
        const isExpanded = expandedVersion === v.versionId;
        // Find previous version (the one this is based on)
        const prevIdx = versions.findIndex(ver => ver.versionId === v.versionId);
        const prevVersion = prevIdx > 0 ? versions[prevIdx - 1] : null;

        // Compute file changes
        const currentFiles = Object.keys(v.files);
        const prevFiles = prevVersion ? Object.keys(prevVersion.files) : [];
        const addedFiles = currentFiles.filter(f => !prevFiles.includes(f));
        const removedFiles = prevFiles.filter(f => !currentFiles.includes(f));
        const modifiedFiles = currentFiles.filter(f => {
          return prevFiles.includes(f) && v.files[f] !== prevVersion!.files[f];
        });
        const totalChanges = addedFiles.length + removedFiles.length + modifiedFiles.length;

        return (
          <Card key={v.versionId} className={cn(
            "transition-all duration-300 overflow-hidden",
            "bg-white dark:bg-[#171714] rounded-xl ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 shadow-sm hover:shadow-md"
          )}>
            <div className="p-4 flex items-center justify-between">
              <button
                onClick={() => setExpandedVersion(isExpanded ? null : v.versionId)}
                className="flex items-center gap-4 text-left flex-1 min-w-0 cursor-pointer"
              >
                <div className={cn(
                  "w-8 h-8 flex items-center justify-center text-[10px] font-bold shrink-0 font-mono",
                  "rounded-lg bg-[#FF3B00]/10 text-[#FF3B00]"
                )}>{v.versionId}</div>
                <div className="space-y-0.5 min-w-0 flex-1">
                  <p className="text-sm font-bold text-zinc-950 dark:text-zinc-50 leading-tight truncate">&ldquo;{v.commitMessage}&rdquo;</p>
                  <p className="text-[10px] font-medium text-[#0F0F0D]/45 dark:text-[#F4F4F0]/45">
                    {v.author} &bull; {new Date(v.createdAt).toLocaleDateString()}
                    {totalChanges > 0 && (
                      <span className="ml-2 text-[#FF3B00] font-semibold">{totalChanges} file{totalChanges !== 1 ? 's' : ''} changed</span>
                    )}
                  </p>
                </div>
                {isExpanded ? <ChevronDown size={14} className={cn("shrink-0", "text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60")} /> : <ChevronRight size={14} className={cn("shrink-0", "text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60")} />}
              </button>
              <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); onRestore(v.versionId); }} className={cn(
                "h-8 text-xs font-semibold px-4 ml-3 shrink-0 transition-colors",
                "rounded-lg bg-[#FF3B00]/10 text-[#FF3B00] hover:bg-[#FF3B00] hover:text-white focus-visible:ring-2 focus-visible:ring-[#FF3B00]"
              )}>Restore</Button>
            </div>

            {/* Expandable version snapshot */}
            {isExpanded && (
              <div className={cn(
                "px-4 py-3 animate-in slide-in-from-top-2 duration-200",
                "border-t border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10 space-y-4"
              )}>
                {/* Full file listing — every file in this version, changed ones flagged */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">
                      Files in this version
                    </span>
                    <span className="text-[10px] font-medium text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">
                      {currentFiles.length} file{currentFiles.length !== 1 ? 's' : ''}
                      {totalChanges > 0 && ` · +${addedFiles.length}/~${modifiedFiles.length}/-${removedFiles.length}`}
                    </span>
                  </div>
                  <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
                    {[...currentFiles, ...removedFiles].sort().map(f => {
                      const isAdded = addedFiles.includes(f);
                      const isModified = modifiedFiles.includes(f);
                      const isRemoved = removedFiles.includes(f);
                      return (
                        <div key={f} className={cn(
                          "flex items-center gap-2 px-2 py-1 text-[10px] font-mono truncate",
                          "border-l bg-[#0F0F0D]/[0.02] dark:bg-[#F4F4F0]/[0.02]",
                          isAdded && "border-emerald-500 text-emerald-600 dark:text-emerald-400",
                          isModified && "border-[#FF3B00] text-[#0F0F0D] dark:text-[#F4F4F0]",
                          isRemoved && "border-rose-500 text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40 line-through",
                          !isAdded && !isModified && !isRemoved && "border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50"
                        )}>
                          {isAdded ? <Plus size={10} className="shrink-0" />
                            : isRemoved ? <Minus size={10} className="shrink-0" />
                            : isModified ? <FileText size={10} className="shrink-0" />
                            : <span className="w-2.5 shrink-0" />}
                          <span className="truncate">{f}</span>
                          {isAdded && <span className="ml-auto shrink-0 text-[9px] font-bold uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-400">new</span>}
                          {isModified && <span className="ml-auto shrink-0 text-[9px] font-bold uppercase tracking-[0.14em] text-[#FF3B00]">edited</span>}
                          {isRemoved && <span className="ml-auto shrink-0 text-[9px] font-bold uppercase tracking-[0.14em] text-rose-500">deleted</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Per-file line diffs (show first 3 modified files) */}
                {modifiedFiles.slice(0, 3).map(filename => {
                  const oldCode = prevVersion?.files[filename] || '';
                  const newCode = v.files[filename] || '';
                  const diff = computeLineDiff(oldCode, newCode);
                  const changeCount = diff.filter(d => d.type !== 'same').length;

                  return (
                    <div key={filename} className="space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-[0.14em] font-mono text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">{filename} ({changeCount} changes)</span>
                      <div className={cn(
                        "p-3 overflow-x-auto text-[11px] font-mono leading-relaxed max-h-[200px] overflow-y-auto",
                        "bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 rounded-xl ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 text-[#0F0F0D] dark:text-[#F4F4F0]"
                      )}>
                        {diff.map((line, li) => (
                          <div
                            key={li}
                            className={cn(
                              "whitespace-pre",
                              line.type === 'added' && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                              line.type === 'removed' && "bg-rose-500/10 text-rose-600 dark:text-rose-400",
                              line.type === 'same' && "text-zinc-500 dark:text-zinc-500"
                            )}
                          >
                            <span className="select-none mr-3 text-zinc-600">
                              {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                            </span>
                            {line.text}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                {modifiedFiles.length > 3 && (
                  <p className="text-[10px] italic text-[#0F0F0D]/45 dark:text-[#F4F4F0]/45">+ {modifiedFiles.length - 3} more modified files...</p>
                )}
                {totalChanges === 0 && (
                  <p className="text-[11px] italic text-[#0F0F0D]/45 dark:text-[#F4F4F0]/45">No file changes detected in this version.</p>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
