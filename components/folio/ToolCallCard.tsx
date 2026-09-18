'use client';

/**
 * ToolCallCard — renders a single AI-initiated tool call in the chat stream.
 *
 * States:
 *  - pending:    pulsing dot, tool name dimmed
 *  - executing:  spinning indicator + live status message from SSE
 *  - done:       green checkmark + result summary + optional Preview button
 *  - error:      red xmark + error message + Retry button
 *  - awaiting_confirmation:  amber warning + Confirm / Cancel buttons
 */

import React from 'react';
import { CheckCircle, XCircle, AlertTriangle, Eye, RefreshCw, Trash2 } from 'lucide-react';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { cn } from '@/lib/utils';
import { ToolCallState } from '@/lib/db';

interface ToolCallCardProps {
  toolCall: ToolCallState;
  onConfirm?: (toolCallId: string) => void;
  onCancel?: (toolCallId: string) => void;
  onPreview?: (files: { [filename: string]: string }) => void;
  onRetry?: (toolCallId: string) => void;
}

/** Human-readable label for each tool name */
const TOOL_LABELS: Record<string, string> = {
  edit_element: 'Edit Element',
  apply_design_system: 'Apply Design System',
  add_page: 'Add Page',
  delete_page: 'Delete Page',
  export_folio: 'Export Folio',
};

export default function ToolCallCard({
  toolCall,
  onConfirm,
  onCancel,
  onPreview,
  onRetry,
}: ToolCallCardProps) {
  const label = TOOL_LABELS[toolCall.name] || toolCall.name;
  const { status, statusMessage, result, error } = toolCall;

  return (
    <div
      className={cn(
        'mt-2 space-y-2 animate-slideUp w-full max-w-[340px] text-left',
        'p-3',
        'bg-white dark:bg-[#171714] rounded-xl ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 shadow-sm',
        status === 'executing' && 'ring-amber-500/40 dark:ring-amber-400/40',
        status === 'done' && 'ring-emerald-500/40 dark:ring-emerald-400/40',
        status === 'error' && 'ring-red-500/40 dark:ring-red-400/40',
        status === 'awaiting_confirmation' && 'ring-amber-500/40 dark:ring-amber-400/40',
      )}
    >
      {/* Header row */}
      <div className="flex items-center gap-2">
        {/* Status icon */}
        {status === 'pending' && (
          <div className="w-3 h-3 rounded-full bg-zinc-400 animate-pulse" />
        )}
        {status === 'executing' && (
          <LoadingSpinner size="sm" />
        )}
        {status === 'done' && (
          <CheckCircle size={14} className="text-green-600 dark:text-green-500" />
        )}
        {status === 'error' && (
          <XCircle size={14} className="text-red-600 dark:text-red-500" />
        )}
        {status === 'awaiting_confirmation' && (
          <AlertTriangle size={14} className="text-amber-500 dark:text-amber-400" />
        )}

        <span
          className={cn(
            'text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40',
            status === 'done' && 'text-emerald-600 dark:text-emerald-400',
            status === 'error' && 'text-red-500 dark:text-red-400',
            status === 'awaiting_confirmation' && 'text-amber-600 dark:text-amber-400',
          )}
        >
          {label}
        </span>

        {/* Status badge */}
        {status === 'executing' && statusMessage && (
          <span className="text-[9px] text-zinc-400 italic truncate ml-auto max-w-[140px]">
            {statusMessage}
          </span>
        )}
      </div>

      {/* Result text — internal tools (web_search, web_fetch) show minimal status */}
      {(status === 'done' || status === 'error') && (
        <p
          className={cn(
            'text-[11px] leading-relaxed font-medium',
            status === 'done' && 'text-zinc-700 dark:text-zinc-300',
            status === 'error' && 'text-red-600 dark:text-red-400',
          )}
        >
          {status === 'error'
            ? error || 'Unknown error'
            : toolCall.name === 'web_search' || toolCall.name === 'web_fetch'
              ? 'Completed'
              : result?.message}
        </p>
      )}

      {/* Done: Preview button */}
      {status === 'done' && result?.files && (
        <button
          onClick={() => onPreview?.(result.files!)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer',
            'rounded-lg bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70 hover:bg-[#0F0F0D]/10 dark:hover:bg-[#F4F4F0]/15',
          )}
        >
          <Eye size={10} />
          Preview Changes
        </button>
      )}

      {/* Error: Retry button */}
      {status === 'error' && (
        <button
          onClick={() => onRetry?.(toolCall.id)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer',
            'rounded-lg bg-[#FF3B00] text-white hover:bg-[#0F0F0D] dark:hover:bg-[#F4F4F0] dark:hover:text-[#0F0F0D]',
          )}
        >
          <RefreshCw size={10} />
          Retry
        </button>
      )}

      {/* Awaiting confirmation: Confirm / Cancel */}
      {status === 'awaiting_confirmation' && (
        <div className="space-y-2">
          <p className="text-[11px] text-amber-700 dark:text-amber-300 font-medium">
            {result?.confirmationPrompt || 'Are you sure?'}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => onConfirm?.(toolCall.id)}
              className={cn(
                'flex-1 px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer',
                'rounded-lg bg-[#FF3B00] text-white hover:bg-[#0F0F0D] dark:hover:bg-[#F4F4F0] dark:hover:text-[#0F0F0D]',
              )}
            >
              <Trash2 size={10} className="inline mr-1" />
              Confirm Delete
            </button>
            <button
              onClick={() => onCancel?.(toolCall.id)}
              className={cn(
                'flex-1 px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer',
                'rounded-lg bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70 hover:bg-[#0F0F0D]/10 dark:hover:bg-[#F4F4F0]/15',
              )}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
