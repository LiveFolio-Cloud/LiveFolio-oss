'use client';

import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { FolderKanban, Globe, Lock, Loader2, X, Trash2, ExternalLink } from 'lucide-react';
import { isCloud } from '@/lib/env';
import type { PaidAccessConfig } from '@/lib/gating/types';
import { sanitizePaidAccess } from '@/lib/gating/config';
import { GateConfig } from '@/app/(app)/_components/tabs/gate-config';

interface ProjectData {
  id: string;
  name: string;
  slug?: string;
  description?: string | null;
  is_public?: boolean;
  /** Workspace gate default (paid_access JSONB) — undefined when not loaded. */
  paid_access?: PaidAccessConfig | null;
  /** Custom thumbnail (public storage URL) — undefined when not loaded. */
  thumbnail_url?: string | null;
  organization_id?: string | null;
}

interface ProjectSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectData | null;
  profileUsername?: string | null;
  onSaved: () => void;
}

export default function ProjectSettingsDialog({
  isOpen,
  onClose,
  project,
  profileUsername,
  onSaved,
}: ProjectSettingsDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  // `undefined` = project didn't carry the field (skip on save); `null` =
  // no workspace gate (inherit semantics don't apply at the project level).
  const [paidAccess, setPaidAccess] = useState<PaidAccessConfig | null | undefined>(undefined);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null | undefined>(undefined);
  const [accessError, setAccessError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (isOpen && project) {
      setName(project.name || '');
      setDescription(project.description || '');
      setIsPublic(project.is_public || false);
      setPaidAccess(project.paid_access === undefined ? undefined : (project.paid_access ?? null));
      setThumbnailUrl(project.thumbnail_url === undefined ? undefined : (project.thumbnail_url ?? null));
      setAccessError('');
    }
  }, [isOpen, project]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen || !project) return null;

  const handleSave = async () => {
    if (!name.trim() || isSaving) return;
    const body: Record<string, unknown> = {
      name: name.trim(),
      description: description.trim() || null,
      is_public: isPublic,
    };
    // Gate config must pass the same sanitizer the server runs — a config
    // the UI can emit is always valid, but guard anyway (defense in depth).
    if (paidAccess !== undefined) {
      if (paidAccess === null) {
        body.paid_access = null;
      } else {
        const sanitized = sanitizePaidAccess(paidAccess);
        if (!sanitized) {
          setAccessError('That price isn’t valid — check the amount, duration, and preview settings.');
          return;
        }
        body.paid_access = sanitized;
      }
    }
    if (thumbnailUrl !== undefined) {
      body.thumbnail_url = thumbnailUrl ?? null;
    }
    setIsSaving(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAccessError(data.error || 'Failed to save project settings.');
        return;
      }
      onSaved();
      onClose();
    } catch {
      setAccessError('Network error — please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (isDeleting) return;
    if (!window.confirm(`Delete project "${name}"? Folios inside will move to Unfiled.`)) return;
    setIsDeleting(true);
    try {
      await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
      onSaved();
      onClose();
    } catch {} finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-[#0F0F0D]/40 dark:bg-[#0F0F0D]/60 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="flex max-h-[min(calc(100dvh-2rem),42rem)] w-full max-w-sm flex-col rounded-2xl bg-white dark:bg-[#171714] shadow-2xl ring-1 ring-black/5 dark:ring-white/10 animate-in zoom-in-95 duration-150 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 flex shrink-0 items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderKanban size={14} className="text-[#FF3B00]" />
            <span className="text-[12px] font-bold font-mono text-[#0F0F0D] dark:text-[#F4F4F0]">Project settings</span>
          </div>
          <button onClick={onClose} className="p-1 text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40 hover:text-[#0F0F0D] dark:hover:text-[#F4F4F0] rounded-full transition-colors cursor-pointer">
            <X size={14} />
          </button>
        </div>

        {/* Scrollable body — the workspace gate-config block can exceed short viewports */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 space-y-3.5">
          {/* Name */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40 block">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-9 px-3 text-[11px] font-medium rounded-lg border border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 bg-transparent font-mono text-[#0F0F0D] dark:text-[#F4F4F0] focus:outline-none focus:border-[#FF3B00]/40"
            />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40 block">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What is this project about?"
              className="w-full px-3 py-2 text-[11px] font-medium rounded-lg border border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 bg-transparent font-mono text-[#0F0F0D] dark:text-[#F4F4F0] placeholder:text-[#0F0F0D]/25 dark:placeholder:text-[#F4F4F0]/25 focus:outline-none focus:border-[#FF3B00]/40 resize-none"
            />
          </div>

          {/* Visibility toggle — the key privacy control */}
          <button
            onClick={() => setIsPublic(!isPublic)}
            className={cn(
              'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border transition-colors text-left cursor-pointer',
              isPublic
                ? 'border-[#FF3B00]/30 bg-[#FF3B00]/5'
                : 'border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 bg-transparent'
            )}
          >
            {isPublic ? (
              <Globe size={14} className="shrink-0 text-[#FF3B00]" />
            ) : (
              <Lock size={14} className="shrink-0 text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40" />
            )}
            <span className="flex-1 min-w-0">
              <span className={cn(
                'block text-[11px] font-bold font-mono',
                isPublic ? 'text-[#FF3B00]' : 'text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70'
              )}>
                {isPublic ? 'Public on profile' : 'Private'}
              </span>
              <span className="block text-[9px] font-medium text-[#0F0F0D]/30 dark:text-[#F4F4F0]/30 font-mono mt-0.5">
                {isPublic
                  ? 'Anyone visiting your profile can see this project and its folios.'
                  : 'Only you can see this project. Folios stay reachable via direct links.'}
              </span>
            </span>
            <span className={cn(
              'h-5 w-9 rounded-full transition-colors relative shrink-0',
              isPublic ? 'bg-[#FF3B00]' : 'bg-[#0F0F0D]/15 dark:bg-[#F4F4F0]/15'
            )}>
              <span className={cn(
                'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all',
                isPublic ? 'left-[18px]' : 'left-0.5'
              )} />
            </span>
          </button>

          {/* Workspace access — paid-gating default (cloud only) */}
          {isCloud && (
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40 block">
                Workspace access
              </label>
              <div className="rounded-lg border border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 p-2.5">
                <GateConfig
                  value={paidAccess}
                  onChange={setPaidAccess}
                  disabled={isSaving}
                  sellLabel="Sell this workspace"
                  thumbnailValue={thumbnailUrl}
                  onThumbnailChange={(url) => setThumbnailUrl(url)}
                  scopeId={project.id}
                  organizationId={project.organization_id}
                />
              </div>
              <p className="text-[10px] font-medium text-[#0F0F0D]/30 dark:text-[#F4F4F0]/30 font-mono">
                Price and preview apply to every folio without its own Access
                config — set one per folio via the $ Access icon to override.
              </p>
              {accessError && (
                <p className="text-[10px] font-semibold text-red-600 font-mono">{accessError}</p>
              )}
            </div>
          )}

          {/* Public URL preview */}
          {isPublic && profileUsername && (
            <p className="flex items-center gap-1.5 text-[10px] font-medium text-[#0F0F0D]/30 dark:text-[#F4F4F0]/30 font-mono px-1">
              <ExternalLink size={10} />
              livefolio.cloud/@{profileUsername} — appears as a section
            </p>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="h-9 px-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider font-mono text-[#FF3B00] hover:bg-[#FF3B00]/5 rounded-lg transition-colors cursor-pointer"
            >
              {isDeleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
              Delete
            </button>
            <div className="flex-1" />
            <button
              onClick={onClose}
              className="h-9 px-4 text-[10px] font-bold uppercase tracking-wider font-mono text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50 hover:text-[#0F0F0D] dark:hover:text-[#F4F4F0] rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || !name.trim()}
              className="h-9 px-4 text-[10px] font-bold uppercase tracking-wider font-mono bg-[#FF3B00] text-[#F4F4F0] hover:bg-[#0F0F0D] dark:hover:bg-[#F4F4F0] dark:hover:text-[#0F0F0D] disabled:opacity-30 rounded-lg transition-colors cursor-pointer"
            >
              {isSaving ? <Loader2 size={11} className="animate-spin" /> : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
