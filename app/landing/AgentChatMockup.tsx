'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sparkles,
  ExternalLink,
  Eye,
  Bot,
  User,
} from 'lucide-react';
import { SlackMark } from './BrandIcons';

/* ------------------------------------------------------------------ */
/*  Conversation data - natural, brief, authentic                      */
/* ------------------------------------------------------------------ */

interface Message {
  role: 'user' | 'agent' | 'system';
  content: string;
  delay: number;
}

interface AgentTab {
  id: string;
  label: string;
  agentName: string;
  agentIcon: React.ReactNode;
  conversation: Message[];
  previewTitle: string;
  previewDesc: string;
}

const AGENT_TABS: AgentTab[] = [
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    agentName: 'ChatGPT',
    agentIcon: <Sparkles className="w-3 h-3" />,
    conversation: [
      {
        role: 'user',
        content:
          'I built an interactive Q3 financial dashboard locally. Publish it to a live URL I can share with my team.',
        delay: 800,
      },
      {
        role: 'agent',
        content:
          'I can publish that through LiveFolio. I\'ve started the registration. Check your email for a 6-digit code and paste it here.',
        delay: 2200,
      },
      {
        role: 'user',
        content: '847291',
        delay: 3600,
      },
      {
        role: 'agent',
        content:
          'Done. Your dashboard is live at **livefolio.cloud/share/q3-financial-dashboard**. Interactive sliders, live conversion calculator, responsive charts. Anyone with the link can view it and pin comments directly on elements.',
        delay: 5200,
      },
    ],
    previewTitle: 'Q3 Financial Dashboard',
    previewDesc: 'Interactive revenue model with live sliders and responsive chart widgets.',
  },
  {
    id: 'claude',
    label: 'Claude',
    agentName: 'Claude',
    agentIcon: <Bot className="w-3 h-3" />,
    conversation: [
      {
        role: 'user',
        content:
          'Take my Q3 pitch deck and publish it to livefolio.cloud as a responsive presentation. Dark theme, Space Grotesk.',
        delay: 700,
      },
      {
        role: 'agent',
        content:
          'Connected to the LiveFolio MCP server. Publishing your deck in deck mode with the dark theme now.',
        delay: 2000,
      },
      {
        role: 'agent',
        content:
          'Published: **livefolio.cloud/share/q3-pitch-deck**. 12 responsive slides with embedded metrics and smooth transitions. I can update any slide or pull in your team\'s feedback whenever you want.',
        delay: 4000,
      },
    ],
    previewTitle: 'Q3 Pitch Deck',
    previewDesc: '12-slide responsive presentation with embedded metrics and dark theme.',
  },
  {
    id: 'slack',
    label: 'Slack',
    agentName: 'LiveFolio Bot',
    agentIcon: <SlackMark className="w-3 h-3" />,
    conversation: [
      {
        role: 'user',
        content: '/livefolio create api-gateway-spec',
        delay: 600,
      },
      {
        role: 'agent',
        content:
          '**API Gateway Interface Spec** deployed.\n:link: livefolio.cloud/share/api-gateway-spec\n:eye: 842 views  :speech_balloon: 8 comments  :package: 14 versions',
        delay: 2000,
      },
      {
        role: 'user',
        content: '/livefolio list',
        delay: 4000,
      },
      {
        role: 'agent',
        content:
          ':file_folder: Recent in #design-reviews:\n1. **api-gateway-spec** - 8 comments, 14 versions\n2. **onboarding-flow-v2** - 3 comments, 7 versions\n3. **pricing-page-redesign** - 12 comments, 22 versions',
        delay: 5400,
      },
    ],
    previewTitle: 'API Gateway Interface Spec',
    previewDesc: 'Annotated technical specification with pinned comments and version history.',
  },
];

/* ------------------------------------------------------------------ */
/*  Preview pane - simulates a published folio                         */
/* ------------------------------------------------------------------ */

function LivePreview({ activeTab }: { activeTab: string }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className="flex-1 flex flex-col justify-center p-6"
      >
        <div className="rounded-lg overflow-hidden border border-zinc-200/60 dark:border-zinc-700/60 shadow-lg bg-white dark:bg-zinc-900">
          {/* Browser bar */}
          <div className="h-8 bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-200/60 dark:border-zinc-700/60 flex items-center px-3 gap-1.5">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-rose-400/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
            </div>
            <div className="flex-1 mx-3 h-5 rounded bg-zinc-200/60 dark:bg-zinc-700/60 flex items-center px-2">
              <span className="text-[8px] font-mono text-zinc-400 truncate">
                livefolio.cloud/share/
                {activeTab === 'chatgpt'
                  ? 'q3-financial-dashboard'
                  : activeTab === 'claude'
                    ? 'q3-pitch-deck'
                    : 'api-gateway-spec'}
              </span>
            </div>
          </div>

          {/* Preview content */}
          <div className="aspect-[16/10] bg-white dark:bg-zinc-950 p-5 flex flex-col justify-center">
            {activeTab === 'chatgpt' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-heading font-extrabold text-lg text-zinc-900 dark:text-white">
                    Q3 Financial Model
                  </h3>
                  <span className="text-[9px] font-mono text-emerald-500 bg-emerald-500/5 px-1.5 py-0.5 rounded border border-emerald-500/20">
                    Live
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-900">
                    <span className="text-[9px] font-mono text-zinc-400">Monthly Traffic</span>
                    <p className="font-heading font-bold text-base text-zinc-900 dark:text-white mt-0.5">48,500</p>
                  </div>
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-900">
                    <span className="text-[9px] font-mono text-zinc-400">Revenue (est.)</span>
                    <p className="font-heading font-bold text-base text-zinc-900 dark:text-white mt-0.5">$98,940</p>
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-900">
                  <div className="flex justify-between text-[9px] font-mono text-zinc-500 mb-1.5">
                    <span>Conversion Rate</span>
                    <span className="text-indigo-500 font-bold">2.4%</span>
                  </div>
                  <div className="h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full w-[24%] bg-indigo-500 rounded-full" />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'claude' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-heading font-extrabold text-lg text-zinc-900 dark:text-white">
                    Market Validation
                  </h3>
                  <span className="text-[9px] font-mono text-zinc-400">4 / 12</span>
                </div>
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  Interactive document platforms solve structural information loss. Sharing pure
                  HTML is faster, responsive, and version-controlled.
                </p>
                <div className="grid grid-cols-3 gap-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                  <div>
                    <p className="font-heading font-bold text-sm text-zinc-900 dark:text-white">100%</p>
                    <p className="text-[8px] font-mono text-zinc-400">Responsive</p>
                  </div>
                  <div>
                    <p className="font-heading font-bold text-sm text-zinc-900 dark:text-white">64ms</p>
                    <p className="text-[8px] font-mono text-zinc-400">Render</p>
                  </div>
                  <div>
                    <p className="font-heading font-bold text-sm text-zinc-900 dark:text-white">Zero</p>
                    <p className="text-[8px] font-mono text-zinc-400">PDF Attachments</p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'slack' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-heading font-extrabold text-lg text-zinc-900 dark:text-white">
                    API Gateway Spec
                  </h3>
                  <span className="text-[9px] font-mono text-zinc-400">v14</span>
                </div>
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  Header-only verification endpoints bound to the organization gateway client.
                </p>
                <div className="relative border border-zinc-200 dark:border-zinc-800 rounded p-3 bg-zinc-50 dark:bg-zinc-900">
                  <div className="absolute -top-2 -left-2 w-5 h-5 rounded-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white flex items-center justify-center font-bold text-[9px] shadow-sm">
                    1
                  </div>
                  <p className="text-[9px] text-zinc-500 dark:text-zinc-400 italic pl-3">
                    &quot;Shift secondary button accents to match the new design tokens.&quot;
                  </p>
                  <div className="mt-1.5 pl-3 flex justify-between text-[8px] font-mono text-zinc-400">
                    <span>Pinned by Sarah D.</span>
                    <span className="text-indigo-400">Open</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
/*  Main AgentChatMockup                                               */
/* ------------------------------------------------------------------ */

export default function AgentChatMockup({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const [activeTab, setActiveTab] = useState('chatgpt');
  const [visibleMessages, setVisibleMessages] = useState<Record<string, number>>({
    chatgpt: 1,
    claude: 1,
    slack: 1,
  });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const activeAgent = AGENT_TABS.find((t) => t.id === activeTab)!;
  const visibleCount = visibleMessages[activeTab] || 1;
  const messages = activeAgent.conversation.slice(0, visibleCount);
  const allRevealed = visibleCount >= activeAgent.conversation.length;

  // Auto-reveal messages
  useEffect(() => {
    if (allRevealed) return;
    const nextMsg = activeAgent.conversation[visibleCount];
    if (!nextMsg) return;
    const prevDelay = visibleCount > 0 ? activeAgent.conversation[visibleCount - 1].delay : 0;
    const gap = nextMsg.delay - prevDelay;

    timerRef.current = setTimeout(() => {
      setVisibleMessages((prev) => ({
        ...prev,
        [activeTab]: Math.min((prev[activeTab] || 1) + 1, activeAgent.conversation.length),
      }));
    }, Math.max(gap, 600));

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [activeTab, visibleCount, allRevealed, activeAgent.conversation]);

  const handleTabSwitch = (tabId: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setActiveTab(tabId);
  };

  const containerClasses = embedded
    ? 'w-full max-w-[560px] mx-auto lg:mx-0'
    : 'w-full max-w-6xl mx-auto';

  const cardClasses = embedded
    ? 'rounded-2xl border border-zinc-200/60 dark:border-zinc-700/60 bg-white/70 dark:bg-zinc-900/70 backdrop-blur-xl shadow-2xl shadow-zinc-200/30 dark:shadow-black/30 overflow-hidden'
    : 'rounded-2xl border border-zinc-200/60 dark:border-zinc-800/60 bg-white/60 dark:bg-zinc-950/60 backdrop-blur-xl shadow-2xl overflow-hidden';

  return (
    <div className={containerClasses}>
      <div className={cardClasses}>
        {/* Tab bar */}
        <div className="flex border-b border-zinc-200/50 dark:border-zinc-800/50 bg-zinc-50/50 dark:bg-zinc-950/50">
          {AGENT_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabSwitch(tab.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-[10px] font-bold font-mono uppercase tracking-wider transition-all ${
                activeTab === tab.id
                  ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white border-b-2 border-indigo-500'
                  : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300'
              }`}
            >
              {tab.agentIcon}
              <span className={embedded ? 'hidden sm:inline' : ''}>{tab.label}</span>
            </button>
          ))}
        </div>

        {embedded ? (
          /* Compact variant (hero) */
          <div className="p-4 space-y-3 min-h-[240px] max-h-[320px] overflow-y-auto">
            <AnimatePresence mode="popLayout">
              {messages.map((msg, i) => (
                <motion.div
                  key={`${activeTab}-${i}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                  className={`flex gap-2.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.role !== 'user' && (
                    <div className="shrink-0 w-6 h-6 rounded-full bg-indigo-500/10 text-indigo-500 flex items-center justify-center text-[9px] font-bold">
                      {activeAgent.agentIcon}
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] rounded-xl px-3 py-2 text-[10px] leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200/50 dark:border-zinc-700/50'
                    }`}
                  >
                    <span className="whitespace-pre-wrap">{msg.content}</span>
                  </div>
                  {msg.role === 'user' && (
                    <div className="shrink-0 w-6 h-6 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-[9px] font-bold text-zinc-500">
                      <User className="w-3 h-3" />
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>

            {!allRevealed && (
              <div className="flex gap-2.5 items-center">
                <div className="w-6 h-6 bg-indigo-500/10 flex items-center justify-center">
                  {activeAgent.agentIcon}
                </div>
                <div className="flex gap-1 px-3 py-2">
                  <span className="w-1.5 h-1.5 bg-[#FF3B00] animate-pulse" />
                  <span className="w-1.5 h-1.5 bg-[#FF3B00] animate-pulse" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-[#FF3B00] animate-pulse" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}

            {allRevealed && (
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onClick={() => setVisibleMessages((prev) => ({ ...prev, [activeTab]: 1 }))}
                className="w-full text-center text-[9px] font-mono text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors py-1"
              >
                Replay
              </motion.button>
            )}

            <div className="border-t border-zinc-200/50 dark:border-zinc-800/50 pt-2 flex items-center justify-between text-[9px] font-mono text-zinc-400">
              <span className="flex items-center gap-1">
                <ExternalLink className="w-2.5 h-2.5" />{activeAgent.previewTitle}
              </span>
              <span className="flex items-center gap-1">
                <Eye className="w-2.5 h-2.5" />Live preview
              </span>
            </div>
          </div>
        ) : (
          /* Full variant (demo section) */
          <div className="flex flex-col lg:flex-row">
            {/* Conversation */}
            <div className="lg:w-[45%] p-5 space-y-3 min-h-[320px] border-r border-zinc-200/50 dark:border-zinc-800/50 bg-zinc-50/30 dark:bg-zinc-950/30">
              <AnimatePresence mode="popLayout">
                {messages.map((msg, i) => (
                  <motion.div
                    key={`full-${activeTab}-${i}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                    className={`flex gap-2.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {msg.role !== 'user' && (
                      <div className="shrink-0 w-7 h-7 rounded-full bg-indigo-500/10 text-indigo-500 flex items-center justify-center text-[10px] font-bold">
                        {activeAgent.agentIcon}
                      </div>
                    )}
                    <div
                      className={`max-w-[82%] rounded-xl px-3.5 py-2.5 text-[11px] leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                          : 'bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border border-zinc-200/60 dark:border-zinc-700/60 shadow-sm'
                      }`}
                    >
                      <span className="whitespace-pre-wrap">{msg.content}</span>
                    </div>
                    {msg.role === 'user' && (
                      <div className="shrink-0 w-7 h-7 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-[10px] font-bold text-zinc-500">
                        <User className="w-3.5 h-3.5" />
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
              {!allRevealed && (
                <div className="flex gap-2.5 items-center">
                  <div className="w-7 h-7 bg-indigo-500/10 flex items-center justify-center">
                    {activeAgent.agentIcon}
                  </div>
                  <div className="flex gap-1 px-3.5 py-2.5">
                    <span className="w-1.5 h-1.5 bg-[#FF3B00] animate-pulse" />
                    <span className="w-1.5 h-1.5 bg-[#FF3B00] animate-pulse" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-[#FF3B00] animate-pulse" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}
              {allRevealed && (
                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  onClick={() => setVisibleMessages((prev) => ({ ...prev, [activeTab]: 1 }))}
                  className="w-full text-center text-[10px] font-mono text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors py-1.5"
                >
                  Replay
                </motion.button>
              )}
            </div>

            {/* Preview */}
            <div className="lg:w-[55%] bg-white dark:bg-zinc-950 flex flex-col">
              <div className="px-4 py-2 border-b border-zinc-200/50 dark:border-zinc-800/50 flex items-center justify-between text-[10px] font-mono text-zinc-400">
                <span>Live Preview</span>
                <span className="flex items-center gap-1">
                  <Eye className="w-3 h-3" />{activeAgent.previewTitle}
                </span>
              </div>
              <LivePreview activeTab={activeTab} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export { AGENT_TABS };
