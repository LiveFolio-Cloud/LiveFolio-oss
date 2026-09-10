'use client';

import React from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Trash2, MessageCircle, CornerDownRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HTMLComment } from '@/lib/db';

interface CommentsViewProps {
  /** All comments — we filter to type='comment' internally */
  comments: HTMLComment[];
  onDeleteComment: (id: string) => void;
  onToggleResolve: (id: string, resolved: boolean) => void;
  onSendToAI: (prompt: string) => void;
}

export default function CommentsView({
  comments,
  onDeleteComment,
  onToggleResolve,
  onSendToAI,
}: CommentsViewProps) {
  const [filter, setFilter] = React.useState<'all' | 'active' | 'resolved'>('active');

  // Filter to general discussion comments only (not spatial pins)
  const discussionComments = React.useMemo(
    () => comments.filter((c) => c.type === 'comment'),
    [comments]
  );

  const filtered = React.useMemo(() => {
    if (filter === 'active') return discussionComments.filter((c) => !c.resolved);
    if (filter === 'resolved') return discussionComments.filter((c) => c.resolved);
    return discussionComments;
  }, [discussionComments, filter]);

  // Build threading: top-level comments and their replies
  const topLevelIds = new Set(
    discussionComments.filter((c) => !c.parentId).map((c) => c.id)
  );

  const getReplies = (parentId: string) =>
    discussionComments.filter((c) => c.parentId === parentId);

  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHrs = Math.floor(diffMins / 60);
      if (diffHrs < 24) return `${diffHrs}h ago`;
      const diffDays = Math.floor(diffHrs / 24);
      if (diffDays < 7) return `${diffDays}d ago`;
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  // Only show top-level comments (no parentId) and filter by active/resolved
  const displayComments = filtered.filter((c) => !c.parentId || topLevelIds.has(c.id));

  return (
    <div className="w-full h-full max-w-4xl animate-fade overflow-y-auto pr-2 text-left">
      {/* Filter tabs */}
      <div className="flex items-center gap-0.5 mb-4 p-0.5 w-fit rounded-lg bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10">
        {(['active', 'resolved', 'all'] as const).map((f) => (
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
            {f === 'active'
              ? `Active (${discussionComments.filter((c) => !c.resolved && !c.parentId).length})`
              : f === 'resolved'
                ? `Resolved (${discussionComments.filter((c) => c.resolved && !c.parentId).length})`
                : `All (${discussionComments.filter((c) => !c.parentId).length})`}
          </button>
        ))}
      </div>

      {discussionComments.length === 0 ? (
        <div className={cn(
          "text-center py-16",
          "text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50"
        )}>
          <MessageCircle size={28} className="mx-auto mb-3 text-[#0F0F0D]/25 dark:text-[#F4F4F0]/25" />
          <p className="text-xs font-semibold tracking-tight text-[#0F0F0D]/45 dark:text-[#F4F4F0]/45">
            No discussion yet
          </p>
          <p className="text-[11px] font-medium mt-1 max-w-xs mx-auto leading-relaxed text-[#0F0F0D]/35 dark:text-[#F4F4F0]/35">
            General comments appear here. Unlike Pins, they are not anchored to specific elements — they are for broader conversation about this folio.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-12">
          {displayComments.map((c) => {
            const replies = getReplies(c.id);
            return (
              <Card
                key={c.id}
                className={cn(
                  "transition-all duration-200 p-5 text-left group/comment",
                  c.resolved
                    ? "opacity-50 bg-white/50 dark:bg-[#171714]/50"
                    : "bg-white dark:bg-[#171714] shadow-sm hover:shadow-md",
                  "ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 rounded-xl"
                )}
              >
                {/* Header with author badge */}
                <div className="flex justify-between items-start mb-3 text-left">
                  <div className="space-y-0.5 text-left">
                    <div className="flex items-center gap-1.5">
                      <MessageCircle size={10} className="text-[#FF3B00] shrink-0" />
                      <span className="text-[11px] font-semibold text-[#0F0F0D] dark:text-[#F4F4F0]">
                        {c.author}
                      </span>
                    </div>
                    <p className="text-[10px] font-medium text-[#0F0F0D]/45 dark:text-[#F4F4F0]/45">
                      {c.filename} &bull; v{c.versionId} &bull; {formatTime(c.createdAt)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-lg transition-colors text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50 hover:text-[#FF3B00] hover:bg-[#FF3B00]/10 dark:hover:bg-[#FF3B00]/10"
                    onClick={() => onDeleteComment(c.id)}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>

                {/* Comment text */}
                <p className={cn(
                  "text-xs font-medium leading-relaxed text-left",
                  "text-[#0F0F0D] dark:text-[#F4F4F0]"
                )}>
                  &ldquo;{c.text}&rdquo;
                </p>

                {/* Replies */}
                {replies.length > 0 && (
                  <div className="mt-3 ml-2 pl-3 border-l border-[#FF3B00]/20 space-y-2">
                    {replies.map((reply) => (
                      <div key={reply.id} className="text-left">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <CornerDownRight size={9} className="text-[#FF3B00]/60 shrink-0" />
                          <span className="text-[10px] font-semibold text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60">
                            {reply.author}
                          </span>
                          <span className="text-[9px] font-medium text-[#0F0F0D]/30 dark:text-[#F4F4F0]/30">
                            {formatTime(reply.createdAt)}
                          </span>
                        </div>
                        <p className="text-[11px] font-medium leading-relaxed ml-4 text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60">
                          {reply.text}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Footer actions */}
                <div className="pt-3 mt-3 flex justify-between items-center border-t border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10">
                  <span className="text-[10px] font-medium flex items-center gap-1 text-[#0F0F0D]/45 dark:text-[#F4F4F0]/45">
                    <MessageCircle size={9} />
                    Discussion
                    {replies.length > 0 && (
                      <span className="text-[#FF3B00]">({replies.length + 1})</span>
                    )}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-3 text-[11px] font-semibold rounded-lg bg-[#FF3B00]/10 text-[#FF3B00] hover:bg-[#FF3B00] hover:text-white transition-colors"
                      onClick={() => onSendToAI(`Please address this feedback: "${c.text}" on ${c.filename}`)}
                    >
                      Send to AI
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-7 px-3 text-[11px] font-semibold rounded-lg bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 hover:bg-[#0F0F0D]/10 dark:hover:bg-[#F4F4F0]/15 text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70 transition-colors"
                      onClick={() => onToggleResolve(c.id, c.resolved || false)}
                    >
                      {c.resolved ? 'Re-open' : 'Resolve'}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
