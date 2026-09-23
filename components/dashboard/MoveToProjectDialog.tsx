'use client';

import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { FolderKanban, Check, Plus, Loader2, X } from 'lucide-react';

interface ProjectOption {
  id: string;
  name: string;
}

interface MoveToProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  folioId: string;
  folioTitle?: string;
  currentProjectId?: string | null;
  projects: ProjectOption[];
  onMoved: () => void;
  onProjectsChange: () => void;
}

export default function MoveToProjectDialog({
  isOpen,
  onClose,
  folioId,
  folioTitle,
  currentProjectId,
  projects,
  onMoved,
  onProjectsChange,
}: MoveToProjectDialogProps) {
  const [moving, setMoving] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMoving(null);
      setIsCreating(false);
      setNewName('');
    }
  }, [isOpen]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleMove = async (projectId: string | null) => {
    setMoving(projectId);
    try {
      if (projectId) {
        await fetch(`/api/projects/${projectId}/folios`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folioId }),
        });
      } else {
        await fetch(`/api/files/${folioId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: null }),
        });
      }
      onMoved();
      onClose();
    } catch {
      setMoving(null);
    }
  };

  const handleCreateAndMove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || isSaving) return;
    setIsSaving(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        onProjectsChange();
        await handleMove(data.project?.id);
      }
    } catch {} finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-[#0F0F0D]/40 dark:bg-[#0F0F0D]/60 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#171714] shadow-2xl ring-1 ring-black/5 dark:ring-white/10 animate-in zoom-in-95 duration-150 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderKanban size={14} className="text-[#FF3B00]" />
            <span className="text-[12px] font-bold font-mono text-[#0F0F0D] dark:text-[#F4F4F0]">
              Move to project
            </span>
          </div>
          <button onClick={onClose} className="p-1 text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40 hover:text-[#0F0F0D] dark:hover:text-[#F4F4F0] rounded-full transition-colors cursor-pointer">
            <X size={14} />
          </button>
        </div>
        {folioTitle && (
          <p className="px-4 pb-2 text-[10px] font-medium text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40 font-mono truncate">
            "{folioTitle}"
          </p>
        )}

        {/* Project list */}
        <div className="px-2 pb-1 max-h-64 overflow-y-auto">
          {/* Unfiled */}
          <button
            onClick={() => handleMove(null)}
            disabled={moving !== null}
            className={cn(
              'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[11px] font-medium transition-colors font-mono text-left',
              currentProjectId === null || !currentProjectId
                ? 'bg-[#FF3B00]/5 text-[#FF3B00]'
                : 'text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:bg-[#0F0F0D]/5 dark:hover:bg-[#F4F4F0]/5'
            )}
          >
            <FolderKanban size={13} className="shrink-0 opacity-50" />
            <span className="truncate">Unfiled</span>
            {(currentProjectId === null || !currentProjectId) && (
              <Check size={12} className="ml-auto shrink-0 text-[#FF3B00]" />
            )}
          </button>

          {/* Existing projects */}
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => handleMove(p.id)}
              disabled={moving !== null}
              className={cn(
                'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[11px] font-medium transition-colors font-mono text-left',
                currentProjectId === p.id
                  ? 'bg-[#FF3B00]/5 text-[#FF3B00]'
                  : 'text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:bg-[#0F0F0D]/5 dark:hover:bg-[#F4F4F0]/5'
              )}
            >
              <FolderKanban size={13} className="shrink-0 opacity-50" />
              <span className="truncate">{p.name}</span>
              {moving === p.id ? (
                <Loader2 size={12} className="ml-auto shrink-0 animate-spin text-[#FF3B00]" />
              ) : currentProjectId === p.id ? (
                <Check size={12} className="ml-auto shrink-0 text-[#FF3B00]" />
              ) : null}
            </button>
          ))}
        </div>

        {/* Create new project inline */}
        <div className="px-2 pb-2 border-t border-[#0F0F0D]/5 dark:border-[#F4F4F0]/5 pt-1.5">
          {isCreating ? (
            <form onSubmit={handleCreateAndMove} className="flex gap-1.5 px-1 py-1">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Project name…"
                className="flex-1 h-8 px-2.5 text-[11px] font-medium rounded-lg border border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 bg-transparent font-mono text-[#0F0F0D] dark:text-[#F4F4F0] placeholder:text-[#0F0F0D]/25 dark:placeholder:text-[#F4F4F0]/25 focus:outline-none focus:border-[#FF3B00]/40"
              />
              <button
                type="submit"
                disabled={isSaving || !newName.trim()}
                className="h-8 px-3 text-[10px] font-bold uppercase tracking-wider font-mono bg-[#FF3B00] text-[#F4F4F0] hover:bg-[#0F0F0D] dark:hover:bg-[#F4F4F0] dark:hover:text-[#0F0F0D] disabled:opacity-30 rounded-lg transition-colors cursor-pointer"
              >
                {isSaving ? <Loader2 size={10} className="animate-spin" /> : 'Create'}
              </button>
            </form>
          ) : (
            <button
              onClick={() => setIsCreating(true)}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[11px] font-medium text-[#FF3B00] hover:bg-[#FF3B00]/5 transition-colors font-mono text-left cursor-pointer"
            >
              <Plus size={13} className="shrink-0" />
              New project
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
