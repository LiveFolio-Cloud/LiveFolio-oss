'use client';

import React from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HTMLComment } from '@/lib/db';

interface PinsViewProps {
  comments: HTMLComment[];
  onDeleteComment: (id: string) => void;
  onToggleResolve: (id: string, resolved: boolean) => void;
  onSendToAI: (prompt: string) => void;
  onNavigate: (comment: HTMLComment) => void;
}

export default function PinsView({
  comments,
  onDeleteComment,
  onToggleResolve,
  onSendToAI,
  onNavigate,
}: PinsViewProps) {
  const [filter, setFilter] = React.useState<'all' | 'active' | 'resolved'>('active');

  // Only show spatial pins (not general discussion comments)
  const pins = React.useMemo(
    () => comments.filter((c) => !c.type || c.type === 'pin'),
    [comments]
  );

  const filtered = React.useMemo(() => {
    if (filter === 'active') return pins.filter(c => !c.resolved);
    if (filter === 'resolved') return pins.filter(c => c.resolved);
    return pins;
  }, [pins, filter]);

  return (
    <div className="w-full h-full max-w-4xl animate-fade overflow-y-auto pr-2 text-left">
      {/* Filter tabs */}
      <div className="flex items-center gap-0.5 mb-4 p-0.5 w-fit rounded-lg bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10">
        {(['active', 'resolved', 'all'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap",
              filter === f
                ? "bg-white dark:bg-[#0F0F0D] text-[#0F0F0D] dark:text-[#F4F4F0] shadow-sm"
                : "text-[#0F0F0D]/55 dark:text-[#F4F4F0]/55 hover:text-[#0F0F0D] dark:hover:text-[#F4F4F0]"
            )}
          >
            {f === 'active' ? `Active (${pins.filter(c => !c.resolved).length})` :
             f === 'resolved' ? `Resolved (${pins.filter(c => c.resolved).length})` :
             `All (${pins.length})`}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-12">
        {filtered.map(c => (
          <Card key={c.id} className={cn(
            "transition-all duration-300 hover:-translate-y-0.5 p-5 text-left group/pin cursor-pointer",
            c.resolved
              ? "opacity-50 bg-white/50 dark:bg-[#171714]/50"
              : "bg-white dark:bg-[#171714] shadow-sm hover:shadow-md",
            "ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 rounded-xl"
          )} onClick={() => onNavigate(c)}>
            <div className="flex justify-between items-start mb-3 text-left">
              <div className="space-y-0.5 text-left">
                <span className="text-[11px] font-semibold text-[#0F0F0D] dark:text-[#F4F4F0]">{c.author}</span>
                <p className="text-[10px] font-medium text-[#0F0F0D]/45 dark:text-[#F4F4F0]/45">{c.filename} &bull; v{c.versionId}</p>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg transition-colors text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50 hover:text-[#FF3B00] hover:bg-[#FF3B00]/10 dark:hover:bg-[#FF3B00]/10" onClick={() => onDeleteComment(c.id)}><Trash2 size={12}/></Button>
            </div>
            <p className="text-[13px] font-medium leading-relaxed italic text-left text-[#0F0F0D] dark:text-[#F4F4F0]">&ldquo;{c.text}&rdquo;</p>
            <div className="pt-3 mt-3 flex justify-between items-center gap-3 border-t border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10">
              {/* min-w-0 lets the selector line truncate instead of stretching
                  the flex row and shoving the action buttons out of the card */}
              <span className="min-w-0 flex-1 text-[10px] font-medium text-[#0F0F0D]/45 dark:text-[#F4F4F0]/45">Pos: {Math.round(c.x || 0)}%, {Math.round(c.y || 0)}%
              {c.selector && (
                <span className="block text-[9px] font-mono truncate mt-0.5 text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40" title={c.selector}>
                  {c.selector.length > 50 ? c.selector.slice(0, 47) + '...' : c.selector}
                </span>
              )}</span>
              <div className="flex gap-2 shrink-0">
                <Button variant="ghost" size="sm" className="h-7 px-3 text-[11px] font-semibold rounded-lg bg-[#FF3B00]/10 text-[#FF3B00] hover:bg-[#FF3B00] hover:text-white transition-colors" onClick={() => onSendToAI(`Please address this feedback: "${c.text}" on ${c.filename}`)}>Send to AI</Button>
                <Button variant="secondary" size="sm" className="h-7 px-3 text-[11px] font-semibold rounded-lg bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 hover:bg-[#0F0F0D]/10 dark:hover:bg-[#F4F4F0]/15 text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70 transition-colors" onClick={() => onToggleResolve(c.id, c.resolved || false)}>{c.resolved ? 'Re-open' : 'Resolve'}</Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
