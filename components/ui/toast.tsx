'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { CheckCircle, AlertCircle, Info, XCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────
type ToastVariant = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
  duration?: number; // ms — defaults to 4000
}

interface ToastContextType {
  toast: (toast: Omit<Toast, 'id'>) => void;
  dismiss: (id: string) => void;
}

// ── Context ───────────────────────────────────────────────────
const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback for code that calls toast outside provider — logs but doesn't crash
    return {
      toast: (t: Omit<Toast, 'id'>) => {
        if (t.variant === 'error') {
          console.error(`[Toast] ${t.title}${t.description ? ': ' + t.description : ''}`);
        } else {
          console.log(`[Toast] ${t.title}${t.description ? ': ' + t.description : ''}`);
        }
      },
      dismiss: () => {},
    };
  }
  return ctx;
}

// ── Provider ──────────────────────────────────────────────────
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const duration = t.duration ?? 4000;
      setToasts((prev) => [...prev, { ...t, id, duration }]);

      if (duration > 0) {
        setTimeout(() => dismiss(id), duration);
      }
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ toast: addToast, dismiss }}>
      {children}
      <Toaster toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

// ── Toaster (rendered by provider) ────────────────────────────
function Toaster({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-relevant="additions removals"
      className="fixed bottom-6 right-6 z-[200] flex flex-col-reverse gap-2 pointer-events-none"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

// ── Single Toast ──────────────────────────────────────────────
const ICON_MAP: Record<ToastVariant, React.ElementType> = {
  success: CheckCircle,
  error: XCircle,
  info: Info,
  warning: AlertCircle,
};

const VARIANT_STYLES: Record<ToastVariant, string> = {
  success: 'border-emerald-500/30 bg-[#F4F4F0] dark:bg-[#0F0F0D] text-[#0F0F0D] dark:text-[#F4F4F0]',
  error: 'border-rose-500/30 bg-[#F4F4F0] dark:bg-[#0F0F0D] text-[#0F0F0D] dark:text-[#F4F4F0]',
  info: 'border-[#FF3B00]/30 bg-[#F4F4F0] dark:bg-[#0F0F0D] text-[#0F0F0D] dark:text-[#F4F4F0]',
  warning: 'border-amber-500/30 bg-[#F4F4F0] dark:bg-[#0F0F0D] text-[#0F0F0D] dark:text-[#F4F4F0]',
};

const ICON_COLORS: Record<ToastVariant, string> = {
  success: 'text-emerald-500',
  error: 'text-rose-500',
  info: 'text-[#FF3B00]',
  warning: 'text-amber-500',
};

function ToastItem({ toast: t, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [exiting, setExiting] = useState(false);
  const Icon = ICON_MAP[t.variant];

  // Trigger exit animation before dismiss
  const handleDismiss = () => {
    setExiting(true);
    setTimeout(onDismiss, 200); // match animation duration
  };

  // Auto-dismiss handled by timeout in provider — this triggers the exit animation
  useEffect(() => {
    if (t.duration && t.duration > 0) {
      const exitStart = t.duration - 200;
      if (exitStart < 0) return;
      const timer = setTimeout(() => setExiting(true), exitStart);
      return () => clearTimeout(timer);
    }
  }, [t.duration]);

  return (
    <div
      role="alert"
      className={cn(
        'pointer-events-auto flex items-start gap-3 w-80 p-4 transition-all duration-200',
        'rounded-xl bg-white dark:bg-[#171714] shadow-lg ring-1 ring-black/5 dark:ring-white/10',
        VARIANT_STYLES[t.variant],
        exiting
          ? 'opacity-0 translate-x-4 scale-95'
          : 'animate-in slide-in-from-right fade-in duration-200'
      )}
    >
      <Icon size={16} className={cn('shrink-0 mt-0.5', ICON_COLORS[t.variant])} />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-[#0F0F0D] dark:text-[#F4F4F0] leading-tight">
          {t.title}
        </p>
        {t.description && (
          <p className="text-xs text-[#0F0F0D]/65 dark:text-[#F4F4F0]/60 mt-0.5 leading-relaxed">
            {t.description}
          </p>
        )}
      </div>
      <button
        onClick={handleDismiss}
        aria-label="Dismiss notification"
        className="shrink-0 p-1 rounded-lg text-[#0F0F0D]/40 hover:text-[#0F0F0D] dark:text-[#F4F4F0]/40 dark:hover:text-[#F4F4F0] hover:bg-black/5 dark:hover:bg-white/10 transition-colors focus-visible:ring-2 focus-visible:ring-[#FF3B00]/40 focus-visible:outline-none cursor-pointer"
      >
        <X size={12} />
      </button>
    </div>
  );
}

