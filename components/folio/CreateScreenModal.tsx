'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { LoadingSpinner } from '@/components/LoadingSpinner';

interface CreateScreenModalProps {
  isOpen: boolean;
  newFileNameInput: string;
  setNewFileNameInput: (name: string) => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  isCreatingPage?: boolean;
}

const SUGGESTIONS = ['landing-page', 'pricing', 'analytics', 'contact-us', 'sign-in', 'user-settings'];

export default function CreateScreenModal({
  isOpen,
  newFileNameInput,
  setNewFileNameInput,
  onClose,
  onSubmit,
  isCreatingPage = false,
}: CreateScreenModalProps) {
  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="New Folio Screen" description="Add a new high-fidelity HTML screen to your local library."
      footer={
        <div className="flex gap-3 w-full">
          <Button type="button" variant="outline" onClick={onClose} className={cn(
            "flex-1 h-10 cursor-pointer transition-all",
            "rounded-lg bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70 text-xs font-semibold hover:bg-[#0F0F0D]/10 dark:hover:bg-[#F4F4F0]/15"
          )}>Cancel</Button>
          <Button type="submit" form="create-screen-form" disabled={isCreatingPage} className={cn(
            "flex-1 h-10 transition-all active:scale-[0.98] cursor-pointer",
            "rounded-lg bg-[#FF3B00] text-white text-xs font-semibold hover:bg-[#0F0F0D] dark:hover:bg-[#F4F4F0] dark:hover:text-[#0F0F0D]"
          )}>
            {isCreatingPage ? (
              <><LoadingSpinner size="xs" className="mr-1.5" /> Creating…</>
            ) : (
              'Build Screen'
            )}
          </Button>
        </div>
      }
    >
      <form id="create-screen-form" onSubmit={onSubmit} className="space-y-5">
        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40 ml-1">Filename</label>
          <div className="relative group/input">
            <Input autoFocus required placeholder="e.g. pricing-table, saas-hero, dashboard" value={newFileNameInput} onChange={(e) => setNewFileNameInput(e.target.value)} className={cn(
              "h-10 pr-16 text-sm font-semibold transition-all duration-300",
              "rounded-xl bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 border-0 px-3.5 text-[#0F0F0D] dark:text-[#F4F4F0] placeholder:text-[#0F0F0D]/40 focus:outline-none focus:ring-2 focus:ring-[#FF3B00]/40"
            )} />
            <span className={cn(
              "absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold px-2 py-0.5",
              "text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40 bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 rounded-lg"
            )}>.html</span>
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40 ml-1 block">Try these popular screen layouts:</label>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map(suggestion => (
              <button key={suggestion} type="button" onClick={() => setNewFileNameInput(suggestion)} className={cn(
                "px-2.5 py-1 text-xs font-semibold cursor-pointer transition-all active:scale-95",
                "rounded-lg bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70 hover:bg-[#0F0F0D]/10 dark:hover:bg-[#F4F4F0]/15 hover:text-[var(--app-accent)]"
              )}>
                {suggestion}
              </button>
            ))}
          </div>
        </div>
        <div className={cn(
          "text-xs font-semibold leading-relaxed p-3",
          "text-[#0F0F0D]/70 dark:text-[#F4F4F0]/70 bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 rounded-xl"
        )}>
          💡 <span className="font-bold text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50">Pro-tip:</span> You can type any name you want to explore. Our real-time co-pilot will automatically adapt any style you prompt.
        </div>
      </form>
    </BottomSheet>
  );
}
