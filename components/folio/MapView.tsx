'use client';

import React from 'react';
import { Network, Layout, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MapViewProps {
  activeVersionFiles: { [filename: string]: string } | undefined;
  activeFilename: string;
  activeFileList: string[];
  onSelectFile: (filename: string) => void;
  onRenamePage: (oldName: string) => void;
  onDeletePage: (filename: string) => void;
  onNewScreen: () => void;
}

function extractLinks(html: string, activeFileList: string[], activeFilename: string): Set<string> {
  const links = new Set<string>();
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const anchors = doc.querySelectorAll('a[href]');
    anchors.forEach(a => {
      const href = (a.getAttribute('href') || '').trim();
      if (!href || href.startsWith('http://') || href.startsWith('https://') ||
          href.startsWith('#') || href.startsWith('mailto:') ||
          href.startsWith('tel:') || href.startsWith('javascript:') ||
          href.startsWith('data:') || href.startsWith('//')) return;
      // Strip leading ./ and ../, query strings, and fragments
      const clean = href.replace(/^\.\.?\//, '').split('?')[0].split('#')[0];
      // Extract just the filename from any path
      const filename = clean.replace(/^.*[\\/]/, '');
      if (filename && (filename.endsWith('.html') || filename.endsWith('.htm') ||
          activeFileList.includes(filename))) {
        links.add(filename);
      }
    });
  } catch {
    for (const other of activeFileList) {
      if (activeFilename !== other && html.includes(other)) {
        links.add(other);
      }
    }
  }
  return links;
}

export default function MapView({
  activeVersionFiles,
  activeFilename,
  activeFileList,
  onSelectFile,
  onRenamePage,
  onDeletePage,
  onNewScreen,
}: MapViewProps) {
  const currentCode = activeVersionFiles?.[activeFilename] || '';
  const linkedFiles = extractLinks(currentCode, activeFileList, activeFilename);
  const outgoingLinks = activeFileList.filter(other => activeFilename !== other && linkedFiles.has(other));
  const incomingLinks = activeFileList.filter(other => {
    if (activeFilename === other) return false;
    const code = activeVersionFiles?.[other] || '';
    const links = extractLinks(code, activeFileList, other);
    return links.has(activeFilename);
  });

  return (
    <div className={cn(
      "w-full h-full max-w-6xl animate-fade overflow-hidden p-8 flex flex-col relative",
      "bg-[#F4F4F0] dark:bg-[#0F0F0D]"
    )}>
      <div className="absolute top-8 left-8">
        <h3 className="text-sm font-bold tracking-tight flex items-center gap-2 text-[#0F0F0D] dark:text-[#F4F4F0]">
          <Network size={16} className="text-[#FF3B00]" />
          <span>Interactive Sitemaps</span>
        </h3>
        <p className="text-xs mt-1 font-medium text-[#0F0F0D]/45 dark:text-[#F4F4F0]/45">Visualize navigational relationships between screens.</p>
      </div>

      {/* Sitemap graph — takes the remaining space and always stays vertically centered */}
      <div className="flex-1 flex w-full items-center justify-center gap-16 relative mt-12 min-h-0">
        {/* Incoming Links */}
        <div className="flex flex-col gap-4 justify-center w-56 z-10 max-h-full overflow-y-auto">
          {incomingLinks.length === 0 ? <div className="text-[11px] font-medium text-right pr-4 text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">Add more screens to visualize your sitemap. Create a new screen or ask the AI to generate linked pages.</div> : null}
          {incomingLinks.map(f => (
            <button onClick={() => onSelectFile(f)} key={f} className={cn(
              "p-4 transition-colors text-right relative group cursor-pointer",
              "bg-white dark:bg-[#171714] rounded-xl ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 shadow-sm hover:shadow-md"
            )}>
              <span className="text-[11px] font-bold tracking-tight font-mono text-[#0F0F0D] dark:text-[#F4F4F0] group-hover:text-[#FF3B00] dark:group-hover:text-[#FF3B00]">{f}</span>
              <div className={cn(
                "absolute top-1/2 -right-16 w-16 h-px transition-colors",
                "bg-[#0F0F0D]/30 dark:bg-[#F4F4F0]/30 group-hover:bg-[#FF3B00] dark:group-hover:bg-[#FF3B00]"
              )} />
            </button>
          ))}
        </div>

        {/* Current Active Focus */}
        <div className="flex flex-col justify-center w-72 z-10 relative">
          <div className={cn(
            "text-center relative z-20",
            "p-8 bg-white dark:bg-[#171714] rounded-2xl ring-1 ring-[#FF3B00]/25 shadow-md"
          )}>
            <div className={cn(
              "flex items-center justify-center mx-auto mb-4",
              "w-12 h-12 bg-[#FF3B00]/10 rounded-xl"
            )}>
              <Layout size={20} className="text-[#FF3B00]" />
            </div>
            <span className="text-sm font-bold tracking-tight font-mono block text-center truncate px-2 text-[#0F0F0D] dark:text-[#F4F4F0]">{activeFilename}</span>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] mt-2 text-[#FF3B00]">Active Focus</p>
          </div>
          <div className={cn(
            "absolute left-1/2 top-0 -translate-x-1/2 h-full w-px -z-10",
            "bg-[#0F0F0D]/30 dark:bg-[#F4F4F0]/30"
          )} />
        </div>

        {/* Outgoing Links */}
        <div className="flex flex-col gap-4 justify-center w-56 z-10 max-h-full overflow-y-auto">
          {outgoingLinks.length === 0 ? <div className="text-[11px] font-medium text-left pl-4 text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">Link to other pages with &lt;a href&gt; tags to see them here</div> : null}
          {outgoingLinks.map(f => (
            <button onClick={() => onSelectFile(f)} key={f} className={cn(
              "p-4 transition-colors text-left relative group cursor-pointer",
              "bg-white dark:bg-[#171714] rounded-xl ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 shadow-sm hover:shadow-md"
            )}>
              <div className={cn(
                "absolute top-1/2 -left-16 w-16 h-px transition-colors",
                "bg-[#0F0F0D]/30 dark:bg-[#F4F4F0]/30 group-hover:bg-[#FF3B00] dark:group-hover:bg-[#FF3B00]"
              )} />
              <div className={cn(
                "absolute top-1/2 -left-2 w-1.5 h-1.5 rounded-full -translate-y-1/2 transition-colors",
                "bg-[#0F0F0D]/40 dark:bg-[#F4F4F0]/40 group-hover:bg-[#FF3B00] dark:group-hover:bg-[#FF3B00]"
              )} />
              <span className="text-[11px] font-bold tracking-tight font-mono text-[#0F0F0D] dark:text-[#F4F4F0] group-hover:text-[#FF3B00] dark:group-hover:text-[#FF3B00]">{f}</span>
            </button>
          ))}
        </div>
      </div>

      {/* File directory — capped height, scrolls internally so the sitemap stays centered */}
      <div className={cn(
        "mt-8 w-full max-w-4xl text-left p-6 shrink-0 max-h-[45%] overflow-y-auto",
        "bg-white dark:bg-[#171714] rounded-xl ring-1 ring-[#0F0F0D]/5 dark:ring-[#F4F4F0]/10 shadow-sm"
      )}>
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] block mb-4 text-[#0F0F0D]/40 dark:text-[#F4F4F0]/40">All Folio Pages Directory</span>
        <div className="flex flex-wrap gap-2">
          {activeFileList.map(f => (
            <div
              key={f}
              onClick={() => onSelectFile(f)}
              className={cn(
                cn(
                  "flex items-center gap-1.5 pl-4 pr-2.5 py-1.5 rounded-full text-[11px] font-semibold transition-all relative group/page cursor-pointer select-none font-mono",
                  activeFilename === f
                    ? "bg-[#FF3B00]/10 text-[#FF3B00] ring-1 ring-[#FF3B00]/25"
                    : "bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10 hover:bg-[#0F0F0D]/10 dark:hover:bg-[#F4F4F0]/15 text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:text-[#0F0F0D] dark:hover:text-[#F4F4F0]"
                )
              )}
            >
              <span>{f}</span>
              {f === 'index.html' ? <span className="text-[9px] font-bold px-1.5 py-px rounded-full ml-0.5 text-[#0F0F0D]/50 dark:text-[#F4F4F0]/50 bg-[#0F0F0D]/5 dark:bg-[#F4F4F0]/10">HOME</span> : f !== 'index.html' && (
                <div className="flex items-center gap-0.5 opacity-0 group-hover/page:opacity-100 transition-opacity ml-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); onRenamePage(f); }}
                    className={cn(
                      "p-1 rounded transition-colors cursor-pointer",
                      activeFilename === f
                        ? cn(
                            "text-[#FF3B00]/60 hover:text-[#FF3B00] hover:bg-[#FF3B00]/10"
                          )
                        : cn(
                            "text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:text-[#FF3B00] dark:hover:text-[#FF3B00] hover:bg-[#0F0F0D]/10 dark:hover:bg-[#F4F4F0]/10"
                          )
                    )}
                    title="Rename"
                  >
                    <Pencil size={11} />
                  </button>
                  {(() => {
                    const htmlCount = activeFileList.filter(k => k.endsWith('.html')).length;
                    const isLastHtml = f.endsWith('.html') && htmlCount <= 1;
                    return (
                      <button
                        onClick={(e) => { e.stopPropagation(); if (!isLastHtml) onDeletePage(f); }}
                        disabled={isLastHtml}
                        className={cn(
                          "p-1 rounded transition-colors",
                          isLastHtml
                            ? "opacity-25 cursor-not-allowed"
                            : "cursor-pointer",
                          activeFilename === f
                            ? cn(
                                "text-[#FF3B00]/60 hover:text-[#FF3B00] dark:hover:text-[#FF3B00] hover:bg-[#FF3B00]/10"
                              )
                            : cn(
                                "text-[#0F0F0D]/60 dark:text-[#F4F4F0]/60 hover:text-[#FF3B00] dark:hover:text-[#FF3B00] hover:bg-[#0F0F0D]/10 dark:hover:bg-[#F4F4F0]/10"
                              )
                        )}
                        title={isLastHtml ? 'Cannot delete the last HTML page' : 'Delete'}
                      >
                        <Trash2 size={11} />
                      </button>
                    );
                  })()}
                </div>
              )}
            </div>
          ))}
          <button
            onClick={(e) => { e.stopPropagation(); onNewScreen(); }}
            className={cn(
              "flex items-center gap-1.5 pl-4 pr-3 py-1.5 text-xs font-semibold border border-dashed transition-colors cursor-pointer",
              "rounded-full border-[#FF3B00]/40 text-[#FF3B00] hover:bg-[#FF3B00]/10 dark:hover:bg-[#FF3B00]/10 hover:border-[#FF3B00]"
            )}
          >
            <PlusIcon />
            <span>New Screen</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
