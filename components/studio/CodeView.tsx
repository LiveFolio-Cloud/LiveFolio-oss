'use client';

import React, { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { cn } from '@/lib/utils';

interface CodeViewProps {
  editorCode: string;
  setEditorCode: (code: string) => void;
  editorCommitMessage: string;
  setEditorCommitMessage: (msg: string) => void;
  onCommit: (e: React.FormEvent) => void;
  isCommitting?: boolean;
}

export default function CodeView({
  editorCode,
  setEditorCode,
  editorCommitMessage,
  setEditorCommitMessage,
  onCommit,
  isCommitting = false,
}: CodeViewProps) {
  // Auto-save draft to localStorage on each change
  React.useEffect(() => {
    if (editorCode) {
      try { localStorage.setItem('livefolio_code_draft', editorCode); } catch {}
    }
  }, [editorCode]);

  // Restore draft on mount
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem('livefolio_code_draft');
      if (saved && !editorCode) setEditorCode(saved);
    } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const lineCount = useMemo(() => editorCode.split('\n').length, [editorCode]);

  return (
    <div className={cn(
      "w-full h-full overflow-hidden flex flex-col animate-fade",
      "rounded-xl ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10",
      "bg-[#F4F4F0] dark:bg-[#0F0F0D]"
    )}>
      <form onSubmit={onCommit} className="flex-1 flex flex-col min-h-0">
        {/* Editor area — line numbers + textarea */}
        <div className="flex-1 flex overflow-hidden">
          {/* Line numbers gutter */}
          <div className={cn(
            "shrink-0 py-4 pl-4 pr-2 select-none overflow-hidden",
            "bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/5",
            "border-r border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10"
          )}>
            {Array.from({ length: lineCount }, (_, i) => (
              <div
                key={i}
                className="text-[12px] font-mono leading-relaxed text-right text-[#0F0F0D]/30 dark:text-[#F4F4F0]/30 tabular-nums"
                style={{ lineHeight: '1.75' }}
              >
                {i + 1}
              </div>
            ))}
          </div>

          {/* Code textarea */}
          <textarea
            value={editorCode}
            onChange={(e) => setEditorCode(e.target.value)}
            className={cn(
              // select-text: the shell root is select-none, which on iOS
              // blocks caret/focus inside inputs — re-enable for editing.
              "flex-1 w-full h-full bg-transparent p-4 select-text",
              "text-[13px] font-mono leading-relaxed resize-none",
              "focus:outline-none focus:ring-0",
              "text-[#0F0F0D] dark:text-[#F4F4F0]",
              "placeholder:text-[#0F0F0D]/30 dark:placeholder:text-[#F4F4F0]/30",
              "selection:bg-[#FF3B00]/30"
            )}
            spellCheck={false}
            style={{ lineHeight: '1.75', tabSize: 2 }}
          />
        </div>

        {/* Commit bar */}
        <div className={cn(
          "p-4 flex items-center gap-3 shrink-0",
          "border-t border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10",
          "bg-[#F4F4F0] dark:bg-[#0F0F0D]"
        )}>
          <input
            required
            value={editorCommitMessage}
            onChange={(e) => setEditorCommitMessage(e.target.value)}
            placeholder="Describe your changes..."
            className={cn(
              "flex-1 px-4 py-2.5 text-[13px] font-medium focus:outline-none transition-all duration-300",
              "rounded-xl bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 border-0",
              "text-[#0F0F0D] dark:text-[#F4F4F0]",
              "placeholder:text-[#0F0F0D]/40 dark:placeholder:text-[#F4F4F0]/40",
              "focus:ring-2 focus:ring-[#FF3B00]/40"
            )}
          />
          <Button type="submit" size="sm" disabled={isCommitting} className={cn(
            "h-9 text-xs font-semibold px-6 rounded-lg bg-[#FF3B00] text-white hover:bg-[#0F0F0D] dark:hover:bg-[#F4F4F0] dark:hover:text-[#0F0F0D] transition-colors"
          )}>
            {isCommitting ? (
              <><LoadingSpinner size="xs" className="mr-1.5" /> Committing…</>
            ) : (
              'Commit'
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
