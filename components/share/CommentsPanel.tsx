'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { HTMLComment } from '@/lib/db';
import { cn } from '@/lib/utils';
import { MessageSquare, X, CornerDownRight, Send, Loader2, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isCloud } from '@/lib/env';

interface CommentsPanelProps {
  projectId: string;
  /** All comments (we filter type='comment' internally) */
  comments: HTMLComment[];
  currentVersionId: string;
  activeFilename: string;
  onCommentsChange: () => void;
  isOpen: boolean;
  onClose: () => void;
}

interface AuthUser {
  email: string;
  name?: string;
}

export default function CommentsPanel({
  projectId,
  comments,
  currentVersionId,
  activeFilename,
  onCommentsChange,
  isOpen,
  onClose,
}: CommentsPanelProps) {
  // Auth state
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);

  // Comment input
  const [newCommentText, setNewCommentText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reply state
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const replyInputRef = useRef<HTMLInputElement>(null);

  // Check auth on mount
  useEffect(() => {
    if (!isOpen) return;
    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- checkAuth is declared below and is stable; re-checking only when the panel opens is intended
  }, [isOpen]);

  const checkAuth = useCallback(async () => {
    setAuthLoading(true);
    try {
      // In Cloud mode, try to get the current session
      if (isCloud) {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          if (data.user) {
            setAuthUser({ email: data.user.email, name: data.user.name });
            setShowLoginPrompt(false);
            setAuthLoading(false);
            return;
          }
        }
      }
      // Not authenticated
      setAuthUser(null);
      setShowLoginPrompt(true);
    } catch {
      setAuthUser(null);
      setShowLoginPrompt(true);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  // Filter to general comments only (type='comment'), not pins
  const generalComments = comments.filter(
    (c) => c.type === 'comment' && c.filename === activeFilename
  );

  // Build thread structure
  const topLevelComments = generalComments.filter((c) => !c.parentId);
  const getReplies = (parentId: string) =>
    generalComments.filter((c) => c.parentId === parentId);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && inputRef.current && authUser) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [isOpen, authUser]);

  // Focus reply input when replying
  useEffect(() => {
    if (replyToId && replyInputRef.current) {
      setTimeout(() => replyInputRef.current?.focus(), 100);
    }
  }, [replyToId]);

  const getAuthorDisplay = (author: string) => {
    // If it's an email, take the part before @
    if (author.includes('@')) return author.split('@')[0];
    return author;
  };

  const getInitial = (author: string) => {
    const display = getAuthorDisplay(author);
    return display.charAt(0).toUpperCase();
  };

  // Deterministic color from author string
  const getAvatarColor = (author: string) => {
    const colors = [
      'bg-[#FF3B00]', 'bg-[#0F0F0D]', 'bg-[#6366F1]',
      'bg-[#059669]', 'bg-[#D97706]', 'bg-[#7C3AED]',
      'bg-[#DB2777]', 'bg-[#0284C7]',
    ];
    let hash = 0;
    for (let i = 0; i < author.length; i++) {
      hash = author.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCommentText.trim() || !authUser) return;

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/files/${projectId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          author: authUser.email,
          text: newCommentText.trim(),
          versionId: currentVersionId,
          filename: activeFilename,
          type: 'comment',
        }),
      });
      if (res.ok) {
        setNewCommentText('');
        onCommentsChange();
      }
    } catch {
      // silently fail
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitReply = async (parentId: string) => {
    if (!replyText.trim() || !authUser) return;

    setIsSubmittingReply(true);
    try {
      const res = await fetch(`/api/files/${projectId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          author: authUser.email,
          text: replyText.trim(),
          versionId: currentVersionId,
          filename: activeFilename,
          type: 'comment',
          parentId,
        }),
      });
      if (res.ok) {
        setReplyText('');
        setReplyToId(null);
        onCommentsChange();
      }
    } catch {
      // silently fail
    } finally {
      setIsSubmittingReply(false);
    }
  };

  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'now';
      if (diffMins < 60) return `${diffMins}m`;
      const diffHrs = Math.floor(diffMins / 60);
      if (diffHrs < 24) return `${diffHrs}h`;
      const diffDays = Math.floor(diffHrs / 24);
      if (diffDays < 7) return `${diffDays}d`;
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-40',
          'bg-[#0F0F0D]/30',
          'animate-in fade-in duration-200'
        )}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className={cn(
          'fixed z-50 flex flex-col',
          // Mobile: full-width bottom sheet
          'max-sm:inset-x-0 max-sm:bottom-0 max-sm:max-h-[75dvh]',
          // Desktop: floating panel, wider for readability
          'sm:right-6 sm:bottom-24 sm:w-[340px] sm:max-h-[65vh]',
          'bg-white',
          'shadow-xl ring-1 ring-black/5',
          'rounded-2xl',
          'animate-in slide-in-from-bottom duration-300'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={cn(
            'flex items-center justify-between shrink-0 px-4 py-3',
            'border-b border-[#0F0F0D]/5'
          )}
        >
          <span className="text-sm font-bold tracking-tight flex items-center gap-1.5 text-[#0F0F0D]">
            <MessageSquare size={14} className="text-[#FF3B00]" />
            Discussion
            {topLevelComments.length > 0 && (
              <span className="text-xs font-medium text-[#0F0F0D]/35">
                {topLevelComments.length}
              </span>
            )}
          </span>
          <button
            onClick={onClose}
            aria-label="Close discussion"
            className="p-1.5 rounded-lg transition-colors cursor-pointer text-[#0F0F0D]/40 hover:text-[#0F0F0D]:text-[#F4F4F0] hover:bg-black/5:bg-white/10"
          >
            <X size={14} />
          </button>
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto">
          {topLevelComments.length === 0 ? (
            <div className="text-center py-12 px-4">
              <div className="w-8 h-8 mx-auto mb-3 flex items-center justify-center rounded-full bg-[#0F0F0D]/5">
                <MessageSquare size={14} className="text-[#0F0F0D]/25" />
              </div>
              <p className="text-xs font-semibold tracking-tight text-[#0F0F0D]/45">
                No messages yet
              </p>
              <p className="text-[11px] font-medium mt-1 text-[#0F0F0D]/30">
                Start the conversation
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#0F0F0D]/5">
              {topLevelComments.map((comment) => {
                const replies = getReplies(comment.id);
                const isOwn =
                  authUser &&
                  (comment.author === authUser.email ||
                    comment.author === getAuthorDisplay(authUser.email));
                return (
                  <div key={comment.id}>
                    {/* Top-level message */}
                    <div className={cn(
                      'px-4 py-3',
                      isOwn && 'bg-[#FF3B00]/[0.03]'
                    )}>
                      <div className="flex items-start gap-2.5">
                        {/* Avatar */}
                        <div
                          className={cn(
                            'w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5',
                            getAvatarColor(comment.author),
                            'text-white text-[10px] font-semibold leading-none'
                          )}
                        >
                          {getInitial(comment.author)}
                        </div>
                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className="text-[11px] font-semibold text-[#0F0F0D] truncate">
                              {getAuthorDisplay(comment.author)}
                            </span>
                            <span className="text-[10px] font-medium text-[#0F0F0D]/30 shrink-0">
                              {formatTime(comment.createdAt)}
                            </span>
                          </div>
                          <p className="text-[13px] leading-relaxed mt-0.5 text-[#0F0F0D]/75 break-words">
                            {comment.text}
                          </p>
                          {/* Reply button */}
                          {authUser && (
                            <button
                              onClick={() => {
                                setReplyToId(replyToId === comment.id ? null : comment.id);
                                setReplyText('');
                              }}
                              className="mt-1.5 text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer text-[#0F0F0D]/35 hover:text-[#FF3B00]"
                            >
                              <CornerDownRight size={10} />
                              Reply
                              {replies.length > 0 && ` (${replies.length})`}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Replies — lighter, indented */}
                    {replies.length > 0 && (
                      <div className="ml-8 border-l border-[#FF3B00]/20">
                        {replies.map((reply) => {
                          const isOwnReply =
                            authUser &&
                            (reply.author === authUser.email ||
                              reply.author === getAuthorDisplay(authUser.email));
                          return (
                            <div
                              key={reply.id}
                              className={cn(
                                'px-3 py-2',
                                isOwnReply && 'bg-[#FF3B00]/[0.02]'
                              )}
                            >
                              <div className="flex items-start gap-2">
                                <div
                                  className={cn(
                                    'w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5',
                                    getAvatarColor(reply.author),
                                    'text-white text-[9px] font-semibold leading-none'
                                  )}
                                >
                                  {getInitial(reply.author)}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-baseline gap-1.5 flex-wrap">
                                    <span className="text-[10px] font-semibold text-[#0F0F0D]/60">
                                      {getAuthorDisplay(reply.author)}
                                    </span>
                                    <span className="text-[9px] font-medium text-[#0F0F0D]/25">
                                      {formatTime(reply.createdAt)}
                                    </span>
                                  </div>
                                  <p className="text-[11px] leading-relaxed mt-0.5 text-[#0F0F0D]/60 break-words">
                                    {reply.text}
                                  </p>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Inline reply input */}
                    {replyToId === comment.id && authUser && (
                      <div className="ml-8 pl-3 pr-4 py-2 border-l border-[#FF3B00]/20 bg-[#0F0F0D]/[0.02]">
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            handleSubmitReply(comment.id);
                          }}
                          className="flex gap-1.5"
                        >
                          <input
                            ref={replyInputRef}
                            required
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            placeholder={`Reply as ${getAuthorDisplay(authUser.email)}…`}
                            className="flex-1 h-8 text-[13px] font-medium px-2.5 focus:outline-none rounded-lg bg-[#0F0F0D]/5 border-0 text-[#0F0F0D] focus:ring-2 focus:ring-[#FF3B00]/40 placeholder:text-[#0F0F0D]/25:text-[#F4F4F0]/25"
                          />
                          <button
                            type="submit"
                            disabled={isSubmittingReply || !replyText.trim()}
                            className="h-8 w-9 flex items-center justify-center shrink-0 cursor-pointer transition-colors rounded-lg bg-[#FF3B00]/10 text-[#FF3B00] hover:bg-[#FF3B00] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                            aria-label="Send reply"
                          >
                            {isSubmittingReply ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : (
                              <Send size={11} />
                            )}
                          </button>
                        </form>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Input area */}
        <div
          className={cn(
            'shrink-0 border-t border-[#0F0F0D]/15'
          )}
        >
          {authLoading ? (
            <div className="px-4 py-4 text-center">
              <Loader2 size={12} className="animate-spin mx-auto text-[#0F0F0D]/20" />
            </div>
          ) : showLoginPrompt ? (
            <div className="px-4 py-4 space-y-2.5">
              <p className="text-[13px] font-medium text-[#0F0F0D]/55 text-center">
                Sign in to join the discussion
              </p>
              <a
                href={`/login?redirect=${encodeURIComponent(typeof window !== 'undefined' ? window.location.href : '/')}`}
                className="w-full h-9 flex items-center justify-center gap-2 cursor-pointer rounded-xl bg-[#FF3B00] text-white text-xs font-semibold hover:bg-[#0F0F0D]:bg-[#F4F4F0]:text-[#0F0F0D] transition-colors"
              >
                <LogIn size={11} />
                Sign in to comment
              </a>
            </div>
          ) : (
            <form onSubmit={handleSubmitComment} className="px-4 py-3 space-y-2.5">
              <textarea
                ref={inputRef}
                required
                value={newCommentText}
                onChange={(e) => setNewCommentText(e.target.value)}
                placeholder={`Comment as ${getAuthorDisplay(authUser?.email || '')}…`}
                rows={2}
                className="w-full text-[13px] font-medium p-2.5 focus:outline-none resize-none rounded-xl bg-[#0F0F0D]/5 border-0 text-[#0F0F0D] focus:ring-2 focus:ring-[#FF3B00]/40 placeholder:text-[#0F0F0D]/30:text-[#F4F4F0]/30"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    // Guard against double-submit via ⌘+Enter racing the button click
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- KeyboardEvent structurally matches FormEvent for preventDefault()/submit handling
                    if (newCommentText.trim() && !isSubmitting) handleSubmitComment(e as any);
                  }
                }}
              />
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-[#0F0F0D]/25 hidden sm:inline">
                  ⌘+Enter
                </span>
                <Button
                  type="submit"
                  disabled={isSubmitting || !newCommentText.trim()}
                  className="h-8 px-4 text-xs font-semibold ml-auto cursor-pointer rounded-lg bg-[#FF3B00] text-white hover:bg-[#0F0F0D]:bg-[#F4F4F0]:text-[#0F0F0D] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {isSubmitting ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    'Send'
                  )}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
