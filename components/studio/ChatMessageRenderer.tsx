'use client';

import React from 'react';
import { cn } from '@/lib/utils';

/** Parse inline **bold** markdown */
export function parseInlineMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={idx} className="font-bold text-zinc-950 dark:text-zinc-50">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

interface ChatMessageRendererProps {
  text: string;
  isUser?: boolean;
}

/** Custom renderer for AI chat messages with high-fidelity Zinc typography */
export default function ChatMessageRenderer({ text, isUser }: ChatMessageRendererProps) {
  const lines = text.split('\n');
  return (
    <div className={cn(
      "space-y-3 text-[13px] leading-relaxed font-medium",
      isUser
        ? "text-[#FF3B00]"
        : "text-[#0F0F0D] dark:text-[#F4F4F0]"
    )}>
      {lines.map((line, idx) => {
        if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
          const listItems = line.split('\n').filter(l => l.trim().startsWith('- ') || l.trim().startsWith('* '));
          return (
            <ul key={idx} className={cn(
              "space-y-2 ml-1 pl-4 py-1 my-2",
              "border-l-2 border-[#FF3B00]"
            )}>
              {listItems.map((li, lIdx) => {
                const cleanedLine = li.trim().replace(/^[-*]\s+/, '');
                if (!cleanedLine) return null;
                return (
                  <li key={lIdx} className="flex gap-2">
                    <span className={cn("font-bold", "text-[#FF3B00]")}>•</span>
                    <span className={cn("text-[#0F0F0D] dark:text-[#F4F4F0]")}>{parseInlineMarkdown(cleanedLine)}</span>
                  </li>
                );
              })}
            </ul>
          );
        }

        if (line.trim().match(/^\d+\.\s/)) {
          return (
            <div key={idx} className="pl-1 flex gap-2 my-1">
              <span className={cn("font-bold", "font-mono text-[#FF3B00]")}>{line.trim().split('.')[0]}.</span>
              <span className={cn("text-[#0F0F0D] dark:text-[#F4F4F0]")}>{parseInlineMarkdown(line.replace(/^\d+\.\s/, ''))}</span>
            </div>
          );
        }

        return (
          <p key={idx} className={cn(line.trim() === '' ? 'h-2' : '', "text-[#0F0F0D] dark:text-[#F4F4F0]")}>
            {parseInlineMarkdown(line)}
          </p>
        );
      })}
    </div>
  );
}
