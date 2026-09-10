'use client';

/**
 * CreateFolioModal — the single folio-creation surface for all dashboard
 * entry points (Epic #135, GitHub #138).
 *
 * Tab 1 "Blank"   — title/description, mode picker, design prefs, sharing
 *                   section → POST /api/files → redirect to /studio/{id}.
 * Tab 2 "With AI" — skeleton only in this phase; P3-T00 fills it in.
 *                   Gated at runtime in OSS (/api/files/ai-create is
 *                   stripped from the OSS build — spike Q4).
 *
 * OSS-safe by design: react, lucide-react, next/navigation, lib/utils,
 * lib/env, lib/create-folio-state, lib/template-html only.
 * Importable without side effects — renders nothing until `isOpen`.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, ChevronDown, Palette, Share2, Upload, FileText, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dropdown } from '@/components/ui/dropdown';
import { TEMPLATE_OPTIONS, useCreateFolioState } from '@/lib/create-folio-state';
import { getTemplateHTML } from '@/lib/template-html';
import { unpackZip, unpackFileList, type UnpackResult } from '@/lib/unpack-files';

type FolioMode = 'deck' | 'document' | 'spreadsheet' | 'dashboard' | 'infography';
interface CreateFolioModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the new folio id after a successful create (before redirect). */
  onCreated?: (projectId: string) => void;
}

// Design preference choices — mirrors components/studio/DesignDrawer.tsx
// (PALETTES / TYPOGRAPHY_PAIRINGS) plus common design-systems/ themes.
const THEME_OPTIONS = [
  'Night Emerald',
  'Minimalist',
  'Brutalism',
  'Bento',
  'Editorial',
  'Glassmorphism',
];

const TYPOGRAPHY_OPTIONS = [
  'Cabinet Grotesk & Inter',
  'Lora & Inter',
  'Playfair & Source',
  'Space Grotesk & DM Sans',
  'JetBrains Mono & Inter',
  'Crimson Text & Nunito',
];

const PALETTE_OPTIONS = [
  'Cobalt Ocean',
  'Honey Amber',
  'Quartz Rose',
  'Sage Forest',
  'Clay Canyon',
  'Night Emerald',
];

const LIBRARY_OPTIONS = ['Tailwind CSS Core', 'Lucide Icons', 'Chart.js', 'GSAP'];

const inputClass = cn(
  'w-full h-9 px-3 text-[13px] font-medium rounded-xl',
  'bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 border-0 text-[#0F0F0D] dark:text-[#F4F4F0]',
  'placeholder:text-[#0F0F0D]/40 dark:placeholder:text-[#F4F4F0]/40 focus:outline-none focus:ring-2 focus:ring-[var(--app-accent)]/40',
  'disabled:opacity-40 disabled:cursor-not-allowed',
);

const sectionLabelClass = 'text-xs font-medium text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60';

export default function CreateFolioModal({ isOpen, onClose, onCreated }: CreateFolioModalProps) {
  const router = useRouter();
  const {
    designTheme, designTypography, designPalette, designLibraries,
    setDesignTheme, setDesignTypography, setDesignPalette, setDesignLibraries,
  } = useCreateFolioState();

  // Blank tab state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<FolioMode>('deck');

  // Upload state (P3-T02)
  const [uploadedResult, setUploadedResult] = useState<UnpackResult | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Collapsible sections
  const [showDesignPrefs, setShowDesignPrefs] = useState(false);
  const [showSharing, setShowSharing] = useState(false);

  // Sharing state
  const [isPrivate, setIsPrivate] = useState(false);
  const [accessKey, setAccessKey] = useState('');
  const [allowComments, setAllowComments] = useState(true);
  const [presentationModeOnly, setPresentationModeOnly] = useState(false);
  const [status, setStatus] = useState<'draft' | 'published'>('draft');

  const [submissionPhase, setSubmissionPhase] = useState<'idle' | 'creating' | 'redirecting'>('idle');
  const [error, setError] = useState<string | null>(null);
  const isSubmitting = submissionPhase !== 'idle';

  const titleRef = useRef<HTMLInputElement>(null);

  // Autofocus title + clear stale errors on every open
  useEffect(() => {
    if (isOpen) {
      setError(null);
      // Defer so the input exists after the conditional render
      const t = setTimeout(() => titleRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  // ESC dismissal
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  const toggleLibrary = useCallback(
    (lib: string) => {
      setDesignLibraries(
        designLibraries.includes(lib)
          ? designLibraries.filter((l) => l !== lib)
          : [...designLibraries, lib],
      );
    },
    [designLibraries, setDesignLibraries],
  );

  // ── Upload handlers (P3-T02) ───────────────────────────────────────
  const handleUpload = useCallback(async (file: File) => {
    setUploadError(null);
    try {
      let result: UnpackResult;
      const name = file.name.toLowerCase();
      if (name.endsWith('.zip')) {
        result = await unpackZip(file);
      } else if (name.endsWith('.html')) {
        const text = await file.text();
        result = { files: { 'index.html': text }, firstHtml: 'index.html', importCount: 1 };
      } else {
        throw new Error('Unsupported file type. Please use .html or .zip.');
      }
      setUploadedResult(result);
      if (!title.trim()) {
        const base = file.name.replace(/\.\w+$/, '').replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
        if (base) setTitle(base.charAt(0).toUpperCase() + base.slice(1));
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Could not unpack this file.');
    }
  }, [title]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleUpload(file);
  }, [handleUpload]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    e.target.value = '';
  }, [handleUpload]);

  const handleFolderSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploadError(null);
    try {
      const result = await unpackFileList(files);
      setUploadedResult(result);
      if (!title.trim() && result.firstHtml) {
        const base = result.firstHtml.replace(/\.html$/, '').replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
        if (base) setTitle(base.charAt(0).toUpperCase() + base.slice(1));
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Could not read folder contents.');
    }
    e.target.value = '';
  }, [title]);

  const clearUpload = useCallback(() => {
    setUploadedResult(null);
    setUploadError(null);
  }, []);

  // ── Blank tab submit ───────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle || isSubmitting) return;

    setSubmissionPhase('creating');
    setError(null);
    try {
      const cleanDescription = description.trim();
      const defaultFiles = uploadedResult
        ? uploadedResult.files
        : { 'index.html': getTemplateHTML(cleanTitle, cleanDescription, mode) };

      const res = await fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: cleanTitle,
          description: cleanDescription || undefined,
          projectMode: mode,
          designPreferences: {
            theme: designTheme,
            typography: designTypography,
            palette: designPalette,
            libraries: designLibraries,
          },
          isPrivate,
          accessKey: isPrivate && accessKey ? accessKey : undefined,
          allowComments,
          presentationModeOnly,
          status,
          defaultFiles,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 402) {
          throw new Error(data.message || 'Storage limit exceeded. Upgrade your plan to create more folios.');
        }
        if (res.status === 413) {
          throw new Error(data.message || 'This folio is too large to create.');
        }
        throw new Error(data.error || 'Failed to create folio.');
      }

      const projectId: string | undefined = data.project?.id;
      if (!projectId) throw new Error('Folio was created but no id was returned.');

      setSubmissionPhase('redirecting');
      onCreated?.(projectId);
      // Brief pause so the user sees the success animation before redirect
      await new Promise((r) => setTimeout(r, 800));
      onClose();
      router.push(`/app/${projectId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create folio.');
      setSubmissionPhase('idle');
    }
  };

;

  if (!isOpen) return null;

  // Inline sharing section reused by both tabs
  const SharingSection = (
    <div className="space-y-2.5 border-t border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 px-3 pb-2.5 pt-2">
      <label className="flex cursor-pointer select-none items-center gap-2.5">
        <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)}
          className="h-4 w-4 rounded accent-[var(--app-accent)] cursor-pointer" />
        <span className="text-[13px] font-medium text-[#0F0F0D] dark:text-[#F4F4F0]">Private folio</span>
        <span className="text-xs text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50">viewers need an access key</span>
      </label>
      <div className="space-y-1">
        <label htmlFor="cfm-access-key" className={sectionLabelClass}>Access Key</label>
        <input id="cfm-access-key" type="text" value={accessKey} onChange={(e) => setAccessKey(e.target.value)}
          disabled={!isPrivate} placeholder={isPrivate ? 'Enter an access key' : 'Enable "Private folio" first'} className={inputClass} />
      </div>
      <label className="flex cursor-pointer select-none items-center gap-2.5">
        <input type="checkbox" checked={allowComments} onChange={(e) => setAllowComments(e.target.checked)}
          className="h-4 w-4 rounded accent-[var(--app-accent)] cursor-pointer" />
        <span className="text-[13px] font-medium text-[#0F0F0D] dark:text-[#F4F4F0]">Allow comments</span>
      </label>
      <label className="flex cursor-pointer select-none items-center gap-2.5">
        <input type="checkbox" checked={presentationModeOnly} onChange={(e) => setPresentationModeOnly(e.target.checked)}
          className="h-4 w-4 rounded accent-[var(--app-accent)] cursor-pointer" />
        <span className="text-[13px] font-medium text-[#0F0F0D] dark:text-[#F4F4F0]">Presentation mode only</span>
      </label>
      <div className="space-y-1">
        <span className={sectionLabelClass}>Status</span>
        <div className="flex items-center gap-4">
          {(['draft', 'published'] as const).map((s) => (
            <label key={s} className="flex cursor-pointer select-none items-center gap-1.5">
              <input type="radio" name="cfm-status" checked={status === s} onChange={() => setStatus(s)}
                className="h-3.5 w-3.5 accent-[var(--app-accent)] cursor-pointer" />
              <span className="text-[13px] font-medium capitalize text-[#0F0F0D] dark:text-[#F4F4F0]">{s}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm max-sm:items-end max-sm:p-0"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Create a new folio"
    >
      <div
        className="w-full max-w-lg max-h-[calc(100dvh-2.5rem)] flex flex-col overflow-hidden rounded-2xl bg-white dark:bg-[#171714] shadow-2xl ring-1 ring-black/5 dark:ring-white/10 max-sm:max-h-[85dvh] max-sm:rounded-b-none max-sm:rounded-t-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header + tabs */}
        <div className="flex items-center justify-between px-5 pt-4 pb-0 shrink-0">
          <h2 className="text-base font-semibold tracking-tight text-[#0F0F0D] dark:text-[#F4F4F0]">New Folio</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50 transition-colors cursor-pointer hover:bg-black/5 hover:text-[#0F0F0D] dark:hover:text-[#F4F4F0]"
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>



        {/* Body */}
        {isSubmitting ? (
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-5 py-10 gap-6">
            {/* Pulsing folio icon */}
            <div className="relative">
              <div className={cn(
                'flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--app-accent)] bg-[var(--app-accent)]/5',
                submissionPhase === 'redirecting' ? 'animate-none' : 'animate-pulse',
              )}>
                {submissionPhase === 'creating' ? (
                  <Loader2 size={28} className="text-[var(--app-accent)] animate-spin" />
                ) : (
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--app-accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
              {/* Expanding rings when creating */}
              {submissionPhase === 'creating' && (
                <>
                  <div className="absolute inset-0 animate-ping rounded-2xl border border-[var(--app-accent)]/30" />
                  <div className="absolute -inset-3 animate-ping rounded-3xl border border-[var(--app-accent)]/20" style={{ animationDelay: '0.3s' }} />
                </>
              )}
            </div>

            {/* Status text */}
            <div className="text-center space-y-2">
              <p className="text-sm font-semibold tracking-tight text-[#0F0F0D] dark:text-[#F4F4F0]">
                {submissionPhase === 'creating' ? 'Creating your folio' : 'Folio ready'}
              </p>
              {submissionPhase === 'creating' && (
                <p className="text-xs text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50">
                  <span className="inline-flex gap-0.5">
                    Building<span className="animate-pulse" style={{ animationDelay: '0s' }}>.</span>
                    <span className="animate-pulse" style={{ animationDelay: '0.2s' }}>.</span>
                    <span className="animate-pulse" style={{ animationDelay: '0.4s' }}>.</span>
                  </span>
                </p>
              )}
              {submissionPhase === 'redirecting' && (
                <p className="text-xs text-[var(--app-accent)]">Opening studio…</p>
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex-1 min-h-0 overflow-y-auto px-5 py-3.5 space-y-3.5">
            {/* Title */}
            <div className="space-y-1.5">
              <label htmlFor="cfm-title" className={sectionLabelClass}>
                Title <span className="text-[var(--app-accent)]">*</span>
              </label>
              <input
                id="cfm-title"
                ref={titleRef}
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="My Folio"
                className={inputClass}
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label htmlFor="cfm-description" className={sectionLabelClass}>
                Description
              </label>
              <textarea
                id="cfm-description"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this folio about? (optional)"
                className={cn(inputClass, 'resize-none leading-relaxed')}
              />
            </div>

            {/* Mode picker */}
            <div className="space-y-1.5">
              <span className={sectionLabelClass}>Mode</span>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                {TEMPLATE_OPTIONS.map(({ mode: m, label, icon: Icon }) => {
                  const isActive = mode === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      aria-pressed={isActive}
                      className={cn(
                        'flex flex-col items-center gap-1 rounded-xl px-1 py-2 transition-colors cursor-pointer',
                        isActive
                          ? 'bg-[var(--app-accent)]/10 text-[var(--app-accent)]'
                          : 'text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:bg-[#0F0F0D]/5 dark:hover:bg-[#F4F4F0]/10 hover:text-[#0F0F0D] dark:hover:text-[#F4F4F0]',
                      )}
                    >
                      <Icon size={14} />
                      <span className="text-[11px] font-medium tracking-tight">{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Upload zone (P3-T02) */}
            {uploadedResult ? (
              <div className="flex items-center gap-2 rounded-xl bg-[#0F0F0D]/[0.03] dark:bg-[#F4F4F0]/[0.05] px-3 py-2.5">
                <FileText size={14} className="text-[var(--app-accent)] shrink-0" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#0F0F0D] dark:text-[#F4F4F0]">
                  📁 {uploadedResult.importCount} file{uploadedResult.importCount !== 1 ? 's' : ''} ready
                  {uploadedResult.firstHtml ? ` • ${uploadedResult.firstHtml}` : ''}
                </span>
                <button type="button" onClick={clearUpload} className="shrink-0 cursor-pointer text-xs font-medium text-[var(--app-accent)] hover:underline">Remove</button>
              </div>
            ) : (
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                className={cn(
                  'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[#0F0F0D]/15 dark:border-[#F4F4F0]/20 px-3 py-5 transition-colors',
                  isDragOver ? 'border-[var(--app-accent)] bg-[var(--app-accent)]/5' : 'hover:border-[#0F0F0D]/35 dark:hover:border-[#F4F4F0]/40',
                )}
              >
                <input type="file" accept=".html,.zip" onChange={handleFileSelect} className="hidden" id="cfm-upload" />
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- webkitdirectory is a non-standard attribute absent from React's input typings */}
                <input type="file" {...{ webkitdirectory: '' } as any} onChange={handleFolderSelect} className="hidden" id="cfm-folder-upload" />
                <div className="flex flex-col items-center gap-2">
                  <Upload size={18} className={cn('transition-colors', isDragOver ? 'text-[var(--app-accent)]' : 'text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40')} />
                  <span className="text-center text-[13px] font-medium leading-relaxed text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60">
                    Drop HTML, ZIP, or folder here
                  </span>
                  <div className="flex gap-2 mt-1">
                    <label htmlFor="cfm-upload" className="cursor-pointer rounded-lg bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 px-2.5 py-1 text-xs font-medium text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 transition-colors hover:bg-[#0F0F0D]/10 dark:hover:bg-[#F4F4F0]/15 hover:text-[#0F0F0D] dark:hover:text-[#F4F4F0]">
                      File
                    </label>
                    <label htmlFor="cfm-folder-upload" className="cursor-pointer rounded-lg bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 px-2.5 py-1 text-xs font-medium text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 transition-colors hover:bg-[#0F0F0D]/10 dark:hover:bg-[#F4F4F0]/15 hover:text-[#0F0F0D] dark:hover:text-[#F4F4F0]">
                      Folder
                    </label>
                  </div>
                </div>
              </div>
            )}
            {uploadError && (
              <p role="alert" className="text-xs font-medium text-red-600">{uploadError}</p>
            )}

            {/* Design prefs accordion */}
            <div className="rounded-xl ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10">
              <button
                type="button"
                onClick={() => setShowDesignPrefs(!showDesignPrefs)}
                aria-expanded={showDesignPrefs}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 transition-colors rounded-xl hover:bg-[#0F0F0D]/5 dark:hover:bg-[#F4F4F0]/10"
              >
                <Palette size={12} className="text-[var(--app-accent)]" />
                <span className={sectionLabelClass}>Design Preferences</span>
                <ChevronDown
                  size={13}
                  className={cn('ml-auto text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50 transition-transform', showDesignPrefs && 'rotate-180')}
                />
              </button>
              {showDesignPrefs && (
                <div className="px-3 pb-3 pt-1 space-y-3 border-t border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className={sectionLabelClass}>Theme</label>
                      <Dropdown
                        value={designTheme}
                        onChange={setDesignTheme}
                        options={
                          THEME_OPTIONS.includes(designTheme)
                            ? THEME_OPTIONS
                            : [designTheme, ...THEME_OPTIONS]
                        }
                        ariaLabel="Theme"
                        menuClassName="max-w-[min(20rem,calc(100vw-2rem))]"
                        className={cn(inputClass)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className={sectionLabelClass}>Typography</label>
                      <Dropdown
                        value={designTypography}
                        onChange={setDesignTypography}
                        options={
                          TYPOGRAPHY_OPTIONS.includes(designTypography)
                            ? TYPOGRAPHY_OPTIONS
                            : [designTypography, ...TYPOGRAPHY_OPTIONS]
                        }
                        ariaLabel="Typography"
                        menuClassName="max-w-[min(20rem,calc(100vw-2rem))]"
                        className={cn(inputClass)}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className={sectionLabelClass}>Color Palette</label>
                    <Dropdown
                      value={designPalette}
                      onChange={setDesignPalette}
                      options={
                        PALETTE_OPTIONS.includes(designPalette)
                          ? PALETTE_OPTIONS
                          : [designPalette, ...PALETTE_OPTIONS]
                      }
                      ariaLabel="Color Palette"
                      menuClassName="max-w-[min(20rem,calc(100vw-2rem))]"
                      className={cn(inputClass)}
                    />
                  </div>
                  <div className="space-y-1">
                    <span className={sectionLabelClass}>Libraries</span>
                    <div className="flex flex-wrap gap-1.5">
                      {LIBRARY_OPTIONS.map((lib) => {
                        const isActive = designLibraries.includes(lib);
                        return (
                          <button
                            key={lib}
                            type="button"
                            onClick={() => toggleLibrary(lib)}
                            aria-pressed={isActive}
                            className={cn(
                              'cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                              isActive
                                ? 'border-[var(--app-accent)] bg-[var(--app-accent)]/10 text-[var(--app-accent)]'
                                : 'border-[#0F0F0D]/10 dark:border-[#F4F4F0]/10 text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:border-[#0F0F0D]/30 dark:hover:border-[#F4F4F0]/30 hover:text-[#0F0F0D] dark:hover:text-[#F4F4F0]',
                            )}
                          >
                            {lib}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Sharing accordion */}
            <div className="rounded-xl ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10">
              <button
                type="button"
                onClick={() => setShowSharing(!showSharing)}
                aria-expanded={showSharing}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 transition-colors rounded-xl hover:bg-[#0F0F0D]/5 dark:hover:bg-[#F4F4F0]/10"
              >
                <Share2 size={12} className="text-[var(--app-accent)]" />
                <span className={sectionLabelClass}>Sharing</span>
                <ChevronDown
                  size={13}
                  className={cn('ml-auto text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50 transition-transform', showSharing && 'rotate-180')}
                />
              </button>
              {showSharing && SharingSection}
            </div>

            {/* Error */}
            {error && (
              <p role="alert" className="text-xs font-medium text-red-600">
                {error}
              </p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting || !title.trim()}
              className={cn(
                'flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg',
                'bg-[var(--app-accent)] text-white',
                'text-xs font-semibold',
                'transition-colors hover:bg-[var(--app-accent)]/90',
                'disabled:cursor-not-allowed disabled:opacity-40',
              )}
            >
              {isSubmitting ? 'Creating…' : 'Create Folio'}
            </button>

            <div className="pt-1 text-center">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  router.push('/app');
                }}
                className="cursor-pointer text-xs font-medium text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50 transition-colors hover:text-[var(--app-accent)]"
              >
                Prefer AI? Create with the AI chat →
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
