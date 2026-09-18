'use client';

import React from 'react';
import { X, Check, Zap, PaintBucket, Type, Layout, Library, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface DesignSystemItem {
  id: string;
  name: string;
  description: string;
  thumbnail: string;
  category?: string;
  tags?: string[];
}

interface DesignDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  availableDesignSystems: DesignSystemItem[];
  selectedTheme: string;
  selectedTypography: string;
  selectedColorPalette: string;
  projectMode: 'deck' | 'document' | 'spreadsheet' | 'dashboard' | 'infography';
  selectedLibraries: string[];
  onSelectTheme: (themeName: string) => void;
  onSelectTypography: (typographyName: string) => void;
  onSelectPalette: (paletteName: string) => void;
  onSelectMode: (mode: 'deck' | 'document' | 'spreadsheet' | 'dashboard' | 'infography') => void;
  onSelectLibraries: (libs: string[]) => void;
  onRegenerate: () => void;
}

const PALETTES = [
  { name: 'Honey Amber', colors: ['#FAF8F5', '#D97706', '#1C1917'], ring: 'ring-amber-500/20' },
  { name: 'Cobalt Ocean', colors: ['#F8FAFC', '#1D4ED8', '#0F172A'], ring: 'ring-blue-500/20' },
  { name: 'Quartz Rose', colors: ['#FFFDFB', '#BE185D', '#2D1C22'], ring: 'ring-rose-500/20' },
  { name: 'Sage Forest', colors: ['#F4F6F2', '#15803D', '#1E251E'], ring: 'ring-emerald-500/20' },
  { name: 'Clay Canyon', colors: ['#FCFAF7', '#C2410C', '#292524'], ring: 'ring-orange-500/20' },
  { name: 'Night Emerald', colors: ['#090D16', '#10B981', '#F1F5F9'], ring: 'ring-emerald-500/30' },
];

const TYPOGRAPHY_PAIRINGS = [
  { name: 'Lora & Inter', heading: 'Lora', body: 'Inter' },
  { name: 'Playfair & Source', heading: 'Playfair Display', body: 'Source Sans 3' },
  { name: 'Space Grotesk & DM Sans', heading: 'Space Grotesk', body: 'DM Sans' },
  { name: 'JetBrains Mono & Inter', heading: 'JetBrains Mono', body: 'Inter' },
  { name: 'Crimson Text & Nunito', heading: 'Crimson Text', body: 'Nunito' },
  { name: 'Cabinet Grotesk & Inter', heading: 'Cabinet Grotesk', body: 'Inter' },
];

const LAYOUT_MODES = [
  { id: 'deck' as const, label: 'Deck', desc: 'Slide-based presentation flow' },
  { id: 'document' as const, label: 'Document', desc: 'Long-form scrollable pages' },
  { id: 'spreadsheet' as const, label: 'Spreadsheet', desc: 'Data tables & dashboards' },
  { id: 'dashboard' as const, label: 'Dashboard', desc: 'Grid-based analytic panels' },
];

export default function DesignDrawer({
  isOpen,
  onClose,
  availableDesignSystems,
  selectedTheme,
  selectedTypography,
  selectedColorPalette,
  projectMode,
  selectedLibraries,
  onSelectTheme,
  onSelectTypography,
  onSelectPalette,
  onSelectMode,
  onSelectLibraries,
  onRegenerate,
}: DesignDrawerProps) {
  const [searchQuery, setSearchQuery] = React.useState('');
  // ESC key dismissal
  React.useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // Lock body scroll when open
  React.useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-[100] transition-all duration-300",
          isOpen
            ? "bg-zinc-900/20 dark:bg-zinc-950/40 backdrop-blur-sm pointer-events-auto"
            : "bg-transparent backdrop-blur-none pointer-events-none"
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer Panel — slides from right */}
      <div
        className={cn(
          "fixed top-0 right-0 h-full w-[420px] max-w-[92vw] z-[101]",
          "flex flex-col",
          "transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
          "bg-[#F4F4F0] dark:bg-[#0F0F0D] border-l border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10 shadow-2xl",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Luminous top border bar */}
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-[var(--app-accent)]" />

        {/* Header — just the close cross (the sections label themselves) */}
        <div className="shrink-0 flex justify-end px-6 pt-2.5 pb-1.5">
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40 hover:text-[#0F0F0D] dark:hover:text-[#F4F4F0] hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer shrink-0"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 pt-1.5 pb-5 space-y-6">
          {/* SECTION: Design Library Browser */}
          {availableDesignSystems && availableDesignSystems.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Library size={13} className="text-[#0F0F0D]/35 dark:text-[#F4F4F0]/35" />
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">
                  Design Library
                </span>
                <span className="text-[10px] font-semibold px-2 py-0.5 ml-auto rounded-full bg-[var(--app-accent)]/10 text-[var(--app-accent)]">
                  {availableDesignSystems.length} Systems
                </span>
              </div>

              {/* Search */}
              <div className="relative mb-2">
                <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#0F0F0D]/35 dark:text-[#F4F4F0]/35" />
                <input
                  type="text"
                  placeholder="Search design systems..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-[13px] font-medium focus:outline-none transition-all rounded-lg bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 border-0 text-[#0F0F0D] dark:text-[#F4F4F0] placeholder:text-[#0F0F0D]/40 dark:placeholder:text-[#F4F4F0]/40 focus:ring-2 focus:ring-[var(--app-accent)]/40"
                />
              </div>

              {/* Grid of design system cards */}
              <div className="grid grid-cols-2 gap-2 max-h-[240px] overflow-y-auto pr-1 scrollbar-thin">
                {availableDesignSystems
                  .filter(sys => {
                    const q = searchQuery.toLowerCase();
                    return !q || sys.name?.toLowerCase().includes(q) || sys.description?.toLowerCase().includes(q);
                  })
                  .map(sys => {
                    const isSelected = selectedTheme === sys.name;
                    return (
                      <button
                        key={sys.id}
                        type="button"
                        onClick={() => onSelectTheme(sys.name)}
                        className={cn(
                          "text-left rounded-xl transition-all duration-200 overflow-hidden cursor-pointer ring-1",
                          isSelected
                            ? "bg-[var(--app-accent)]/10 ring-[var(--app-accent)]/30"
                            : "bg-white dark:bg-[#171714] ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 hover:ring-[#0F0F0D]/15 dark:hover:ring-[#F4F4F0]/20"
                        )}
                      >
                        <div className="h-12 bg-zinc-50 dark:bg-zinc-950 overflow-hidden">
                          <img src={sys.thumbnail} alt={sys.name} className="w-full h-full object-cover" />
                        </div>
                        <div className="p-2.5">
                          <span className={cn(
                            "text-[11px] font-semibold block truncate",
                            isSelected ? "text-[var(--app-accent)]" : "text-[#0F0F0D]/80 dark:text-[#F4F4F0]/80"
                          )}>
                            {sys.name}
                          </span>
                          <span className="text-[9px] font-medium text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">
                            {sys.category || 'General'}
                          </span>
                        </div>
                      </button>
                    );
                  })}
              </div>
            </section>
          )}

          {/* SECTION: Color Palette */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <PaintBucket size={13} className="text-[#0F0F0D]/35 dark:text-[#F4F4F0]/35" />
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">
                Color Palette
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {PALETTES.map(p => {
                const isSelected = selectedColorPalette === p.name;
                return (
                  <button
                    type="button"
                    key={p.name}
                    onClick={() => onSelectPalette(p.name)}
                    className={cn(
                      "group flex items-center gap-3 p-3 rounded-xl transition-all duration-200 text-left cursor-pointer ring-1",
                      isSelected
                        ? "bg-[var(--app-accent)]/10 ring-[var(--app-accent)]/30"
                        : "bg-white dark:bg-[#171714] ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 hover:ring-[#0F0F0D]/15 dark:hover:ring-[#F4F4F0]/20"
                    )}
                  >
                    <div className="flex gap-1 shrink-0">
                      {p.colors.map((c, ci) => (
                        <div
                          key={ci}
                          className="w-4 h-4 rounded-full ring-1 ring-black/5 shadow-sm"
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                    <div className="min-w-0">
                      <span className={cn(
                        "text-xs font-medium block truncate",
                        isSelected ? "text-[var(--app-accent)]" : "text-[#0F0F0D]/75 dark:text-[#F4F4F0]/75"
                      )}>
                        {p.name}
                      </span>
                    </div>
                    {isSelected && (
                      <Check size={12} className="text-[var(--app-accent)] shrink-0 ml-auto" strokeWidth={3} />
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* SECTION: Typography */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Type size={13} className="text-[#0F0F0D]/35 dark:text-[#F4F4F0]/35" />
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">
                Typography
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {TYPOGRAPHY_PAIRINGS.map(t => {
                const isSelected = selectedTypography === t.name;
                return (
                  <button
                    type="button"
                    key={t.name}
                    onClick={() => onSelectTypography(t.name)}
                    className={cn(
                      "p-3 rounded-xl transition-all duration-200 text-left cursor-pointer ring-1",
                      isSelected
                        ? "bg-[var(--app-accent)]/10 ring-[var(--app-accent)]/30"
                        : "bg-white dark:bg-[#171714] ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 hover:ring-[#0F0F0D]/15 dark:hover:ring-[#F4F4F0]/20"
                    )}
                  >
                    <div className="space-y-0.5 mb-1">
                      <span className="text-[14px] font-bold leading-tight block text-[#0F0F0D] dark:text-[#F4F4F0]" style={{ fontFamily: t.heading }}>
                        {t.heading}
                      </span>
                      <span className="text-[10px] leading-tight block text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40" style={{ fontFamily: t.body }}>
                        + {t.body}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-medium text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50 truncate">
                        {t.name.split('&')[0].trim()}
                      </span>
                      {isSelected && (
                        <Check size={11} className="shrink-0 text-[var(--app-accent)]" strokeWidth={3} />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* SECTION: Layout Profile */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Layout size={13} className="text-[#0F0F0D]/35 dark:text-[#F4F4F0]/35" />
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">
                Layout Profile
              </span>
            </div>
            <div className="space-y-1.5">
              {LAYOUT_MODES.map(mode => {
                const isSelected = projectMode === mode.id;
                return (
                  <button
                    type="button"
                    key={mode.id}
                    onClick={() => onSelectMode(mode.id)}
                    className={cn(
                      "w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 text-left cursor-pointer ring-1",
                      isSelected
                        ? "bg-[var(--app-accent)]/10 ring-[var(--app-accent)]/30"
                        : "bg-white dark:bg-[#171714] ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 hover:ring-[#0F0F0D]/15 dark:hover:ring-[#F4F4F0]/20"
                    )}
                  >
                    <span className={cn(
                      "text-xs font-medium w-24 shrink-0",
                      isSelected ? "text-[var(--app-accent)]" : "text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70"
                    )}>
                      {mode.label}
                    </span>
                    <span className="text-[11px] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40 font-medium truncate">
                      {mode.desc}
                    </span>
                    {isSelected && (
                      <Check size={12} className="text-[var(--app-accent)] shrink-0 ml-auto" strokeWidth={3} />
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* SECTION: Libraries */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Library size={13} className="text-[#0F0F0D]/35 dark:text-[#F4F4F0]/35" />
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">
                Libraries
              </span>
            </div>
            <div className="space-y-1">
              {['Tailwind CSS Core', 'Lucide Icons'].map(lib => {
                const isChecked = selectedLibraries.includes(lib);
                return (
                  <label
                    key={lib}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-xl transition-all duration-200 cursor-pointer ring-1",
                      isChecked
                        ? "bg-[var(--app-accent)]/10 ring-[var(--app-accent)]/30"
                        : "bg-white dark:bg-[#171714] ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 hover:ring-[#0F0F0D]/15 dark:hover:ring-[#F4F4F0]/20"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {
                        const next = isChecked
                          ? selectedLibraries.filter(l => l !== lib)
                          : [...selectedLibraries, lib];
                        onSelectLibraries(next);
                      }}
                      className="rounded accent-[var(--app-accent)] shrink-0"
                    />
                    <span className="text-[13px] font-medium text-[#0F0F0D]/75 dark:text-[#F4F4F0]/75">{lib}</span>
                  </label>
                );
              })}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className={cn(
          "shrink-0 px-6 py-4 space-y-3",
          "border-t border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10 bg-[#F4F4F0] dark:bg-[#0F0F0D]"
        )}>
          <div className="flex gap-2.5">
            <Button
              type="button"
              onClick={onClose}
              className="flex-1 h-11 text-xs font-semibold rounded-lg bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70 hover:bg-[#0F0F0D]/10 dark:hover:bg-[#F4F4F0]/15 transition-colors cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => { onRegenerate(); onClose(); }}
              className="flex-[2.5] h-11 text-xs font-semibold flex items-center justify-center gap-2 rounded-lg bg-[var(--app-accent)] hover:bg-[var(--app-accent)]/90 text-white transition-colors cursor-pointer shadow-sm"
            >
              <Zap size={13} className="fill-current" />
              <span>Regenerate Screen</span>
            </Button>
          </div>
          <p className="text-[10px] text-center text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40 font-medium leading-normal">
            Triggers an AI cycle to restyle the current preview with these design settings.
          </p>
        </div>
      </div>
    </>
  );
}
