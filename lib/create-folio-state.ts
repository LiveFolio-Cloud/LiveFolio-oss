'use client';

/**
 * Shared folio-creation state — extracted from DashboardChat.tsx.
 *
 * Consumed by:
 * - components/dashboard/CreateFolioModal.tsx (mode picker, design prefs,
 *   attachments) via WorkspaceSidebar's "+ New folio"
 * - app/(app)/_components/chat-view/ChatHero.tsx (types + option lists only;
 *   the hero keeps its own design defaults, see lib/design-options.ts)
 *
 * OSS-safe: only react + lucide-react + the local design-options constants;
 * ships verbatim to the self-hosted build (lib/ ships whole). This
 * module is also the single source of truth for the PendingMode union — fixing
 * the historical drift between DashboardChat.tsx and its self-hosted variant.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Presentation, FileText, Table2, LayoutDashboard, PieChart } from 'lucide-react';
import { CREATE_MODAL_DESIGN_DEFAULTS } from '@/lib/design-options';

export type PendingMode = 'deck' | 'document' | 'spreadsheet' | 'dashboard' | 'infography' | null;

export interface StagedFile {
  name: string;
  dataUrl: string;
  type: string; // 'image' | 'document' | 'other'
}

export const TEMPLATE_OPTIONS: {
  mode: 'deck' | 'document' | 'spreadsheet' | 'dashboard' | 'infography';
  label: string;
  icon: React.ElementType;
}[] = [
  { mode: 'deck', label: 'Presentation', icon: Presentation },
  { mode: 'document', label: 'Document', icon: FileText },
  { mode: 'spreadsheet', label: 'Spreadsheet', icon: Table2 },
  { mode: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { mode: 'infography', label: 'Infography', icon: PieChart },
];

export const MODE_LABELS: Record<string, string> = {
  deck: 'Presentation',
  document: 'Document',
  spreadsheet: 'Spreadsheet',
  dashboard: 'Dashboard',
  infography: 'Infography',
};

// localStorage keys — persona keys mirror the pre-existing DashboardChat keys
// so users keep their saved persona; design keys are new (prefs previously
// reset on every page load).
const LS_KEYS = {
  personaName: 'LiveFolio_dash_persona_name',
  personaRole: 'LiveFolio_dash_persona_role',
  designTheme: 'LiveFolio_design_theme',
  designTypography: 'LiveFolio_design_typography',
  designPalette: 'LiveFolio_design_palette',
  designLibraries: 'LiveFolio_design_libraries',
} as const;

function readLS(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writeLS(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage unavailable (private mode / SSR) — state stays in-memory
  }
}

/**
 * Shared creation-surface state: pending mode chip, staged attachments,
 * AI persona, auto-create toggle, and design preferences (localStorage-backed).
 *
 * One instance per page — the dashboard page owns it and passes values to the
 * chat and the CreateFolioModal via props/hook (no context needed).
 */
export function useCreateFolioState() {
  const [pendingMode, setPendingMode] = useState<PendingMode>(null);
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [isAutoCreate, setIsAutoCreate] = useState(true);

  // Persona
  const [personaName, setPersonaNameState] = useState('');
  const [personaRole, setPersonaRoleState] = useState('');

  // Design preferences
  const [designTheme, setDesignThemeState] = useState<string>(CREATE_MODAL_DESIGN_DEFAULTS.theme);
  const [designTypography, setDesignTypographyState] = useState<string>(CREATE_MODAL_DESIGN_DEFAULTS.typography);
  const [designPalette, setDesignPaletteState] = useState<string>(CREATE_MODAL_DESIGN_DEFAULTS.palette);
  const [designLibraries, setDesignLibrariesState] = useState<string[]>([...CREATE_MODAL_DESIGN_DEFAULTS.libraries]);

  // Hydrate from localStorage after mount (SSR-safe — mirrors the persona
  // pattern previously in DashboardChat.tsx).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setPersonaNameState(readLS(LS_KEYS.personaName, ''));
    setPersonaRoleState(readLS(LS_KEYS.personaRole, ''));
    setDesignThemeState(readLS(LS_KEYS.designTheme, CREATE_MODAL_DESIGN_DEFAULTS.theme));
    setDesignTypographyState(readLS(LS_KEYS.designTypography, CREATE_MODAL_DESIGN_DEFAULTS.typography));
    setDesignPaletteState(readLS(LS_KEYS.designPalette, CREATE_MODAL_DESIGN_DEFAULTS.palette));
    try {
      const rawLibs = localStorage.getItem(LS_KEYS.designLibraries);
      if (rawLibs) {
        const parsed = JSON.parse(rawLibs);
        if (Array.isArray(parsed)) setDesignLibrariesState(parsed.filter((l) => typeof l === 'string'));
      }
    } catch {
      // keep defaults on parse failure
    }
  }, []);

  // Write-through setters (persist on change)
  const setPersonaName = useCallback((v: string) => {
    setPersonaNameState(v);
    writeLS(LS_KEYS.personaName, v);
  }, []);

  const setPersonaRole = useCallback((v: string) => {
    setPersonaRoleState(v);
    writeLS(LS_KEYS.personaRole, v);
  }, []);

  const setDesignTheme = useCallback((v: string) => {
    setDesignThemeState(v);
    writeLS(LS_KEYS.designTheme, v);
  }, []);

  const setDesignTypography = useCallback((v: string) => {
    setDesignTypographyState(v);
    writeLS(LS_KEYS.designTypography, v);
  }, []);

  const setDesignPalette = useCallback((v: string) => {
    setDesignPaletteState(v);
    writeLS(LS_KEYS.designPalette, v);
  }, []);

  const setDesignLibraries = useCallback((v: string[]) => {
    setDesignLibrariesState(v);
    writeLS(LS_KEYS.designLibraries, JSON.stringify(v));
  }, []);

  /** Toggle a mode chip — clicking the active one deselects it. */
  const handleTemplateClick = useCallback((mode: 'deck' | 'document' | 'spreadsheet' | 'dashboard' | 'infography') => {
    setPendingMode((prev) => (prev === mode ? null : mode));
  }, []);

  /** FileReader → data URL staging for attachments (from DashboardChat). */
  const handleFilePick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const mime = file.type;
        const type = mime.startsWith('image/')
          ? 'image'
          : mime.includes('pdf') || mime.includes('text') || mime.includes('md')
          ? 'document'
          : 'other';
        setStagedFiles((prev) => [...prev, { name: file.name, dataUrl, type }]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  }, []);

  const removeStagedFile = useCallback((name: string) => {
    setStagedFiles((prev) => prev.filter((f) => f.name !== name));
  }, []);

  return {
    pendingMode,
    setPendingMode,
    handleTemplateClick,
    stagedFiles,
    handleFilePick,
    removeStagedFile,
    personaName,
    personaRole,
    setPersonaName,
    setPersonaRole,
    isAutoCreate,
    setIsAutoCreate,
    designTheme,
    designTypography,
    designPalette,
    designLibraries,
    setDesignTheme,
    setDesignTypography,
    setDesignPalette,
    setDesignLibraries,
  };
}
