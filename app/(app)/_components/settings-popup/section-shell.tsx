'use client';

/**
 * Settings popup — flat section shell. One simple block per section: an
 * icon + title row, then the content. No card boxes, no nested containers,
 * no shadows — the popup reads as one smooth surface.
 */
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export function SectionShell({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="px-5 py-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon size={14} className="text-[var(--app-accent)]" strokeWidth={2.5} />
        <h3 className="text-sm font-semibold tracking-tight text-ink">{title}</h3>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}
