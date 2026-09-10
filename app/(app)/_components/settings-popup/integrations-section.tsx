'use client';

/**
 * Settings popup — Integrations section (both modes). The /connections
 * page's content ported in compact form: the MCP server block (URL + API
 * key + copy + public tunnel), a Connectors group (chat platforms Slack/
 * Discord + the inbound push webhook), the AI-agent "how to connect"
 * instructions for MCP/OpenAPI clients, and the tool list. The API key
 * source matches the mode: Cloud reads the workspace API key (/api/keys,
 * the API Key section); OSS reads the master key (/api/settings, Sharing &
 * Tunnel). No links back to the old pages.
 */
import { useEffect, useState } from 'react';
import { Cable, Check, ChevronDown, Copy, ExternalLink, Globe, Plug, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isCloud } from '@/lib/env';
import { SectionShell } from './section-shell';

/** The MCP tool surface, flagged per mode so the list matches tools/list exactly. */
const MCP_TOOLS = [
  { name: 'list_projects', description: 'List all folios with ids, titles, file/version counts, open comment counts. Call this first to discover what exists.' },
  { name: 'get_project', description: 'Full folio details: source files, open feedback comments, visibility state, analytics, version history.' },
  { name: 'create_project', description: 'Create a folio (deck, document, spreadsheet, dashboard, infography) with initial HTML, design prefs, and reference files.' },
  { name: 'update_project', description: 'Update files (versioned merge) or title/description/thumbnail.' },
  { name: 'delete_project', description: 'Permanently delete a folio — requires confirmed: true.' },
  { name: 'duplicate_project', description: 'Copy a folio into your account (grant-aware for paid folios).', cloudOnly: true },
  { name: 'get_curated_brief', description: 'All open feedback pins and comments compiled into a structured markdown design brief.' },
  { name: 'get_active_design_system', description: 'Current styling patterns, fonts, palette tokens, and LiveFolio aesthetic guidelines.' },
  { name: 'add_comment', description: 'Add a review comment or canvas pin with coordinates.' },
  { name: 'moderate_comment', description: 'Resolve, reopen, or delete a comment/pin.' },
  { name: 'add_reaction', description: 'Increment an aggregate emoji reaction (👍 ❤️ 💡 🔥).' },
  { name: 'manage_sharing', description: 'Read/change publish status, privacy, access key, comments, presentation mode.' },
  { name: 'manage_paid_access', description: 'Read/change the paid-access gate: price, preview, allowCopy.', cloudOnly: true },
  { name: 'manage_listing', description: 'Read/change the Explore listing + license; read mode reports eligibility.', cloudOnly: true },
  { name: 'search_marketplace', description: 'Browse the public Explore marketplace.', cloudOnly: true },
  { name: 'buy_project', description: 'Start a purchase — returns a checkout URL to relay to the user.', cloudOnly: true },
  { name: 'get_purchases', description: 'Poll a checkout grant or read the purchase history.', cloudOnly: true },
  { name: 'manage_seller_account', description: 'Stripe Connect status or onboarding URL.', cloudOnly: true },
  { name: 'list_workspaces', description: 'List the workspace folders that organize folios.', cloudOnly: true },
  { name: 'manage_workspace', description: 'Create, update, delete (detaches folios), or add_folio to workspace folders.', cloudOnly: true },
  { name: 'manage_member', description: 'List, invite, change role, or remove workspace members.', cloudOnly: true },
  { name: 'manage_profile', description: 'Read or update the acting profile.', cloudOnly: true },
  { name: 'claim_handle', description: 'Claim a @username (no username = suggestions).', cloudOnly: true },
  { name: 'follow_profile', description: 'Follow/unfollow a creator by @username.', cloudOnly: true },
  { name: 'get_public_profile', description: 'Read a creator\'s public profile + catalog: bio, stats, folios, workspaces.', cloudOnly: true },
  { name: 'get_sharing_status', description: 'Global public tunnel state and live URL.', ossOnly: true },
  { name: 'toggle_sharing_tunnel', description: 'Start/stop the Cloudflare public sharing tunnel.', ossOnly: true },
  { name: 'set_folio_public_access', description: 'Enable/disable public web access for one folio over the tunnel.', ossOnly: true },
];

/** Per-mode filter — the in-app list matches tools/list exactly (no cross-leak). */
const toolsForMode = (list: typeof MCP_TOOLS) => (isCloud ? list.filter((t) => !t.ossOnly) : list.filter((t) => !t.cloudOnly));

interface Platform {
  id: string;
  name: string;
  domain: string;
  type: string;
  status: string;
  oauth?: boolean;
  steps: string[];
  snippet?: string;
  snippetLabel?: string;
}

export function IntegrationsSection() {
  const [apiKey, setApiKey] = useState('');
  const [, setKeySource] = useState<'oss' | 'cloud'>('oss');
  const [copied, setCopied] = useState(false);
  const [tunnelActive, setTunnelActive] = useState(false);
  const [tunnelUrl, setTunnelUrl] = useState('');
  const [isTogglingTunnel, setIsTogglingTunnel] = useState(false);
  const [slackConnected, setSlackConnected] = useState(false);
  const [slackWorkspace, setSlackWorkspace] = useState('');
  const [discordConnected, setDiscordConnected] = useState(false);
  const [discordServer, setDiscordServer] = useState('');
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [showTools, setShowTools] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);

  // The MCP endpoint agents hit must be reachable FROM their machines: on a
  // localhost dev shell that still points at the cloud project, advertise the
  // public https origin (NEXT_PUBLIC_APP_URL) instead of http://localhost.
  const mcpOrigin = (() => {
    if (typeof window === 'undefined') return '';
    const origin = window.location.origin;
    if (isCloud && /^(localhost|127\.0\.0\.1)/.test(window.location.hostname)) {
      return (process.env.NEXT_PUBLIC_APP_URL || 'https://livefolio.cloud').replace(/\/$/, '');
    }
    return origin;
  })();
  const mcpUrl = mcpOrigin ? `${mcpOrigin}/api/mcp` : '/api/mcp';
  const tools = toolsForMode(MCP_TOOLS);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // API key: Cloud -> workspace key (/api/keys, API Key section); OSS -> master key (/api/settings, Sharing & Tunnel)
      try {
        if (isCloud) {
          const res = await fetch('/api/keys');
          if (res.ok && !cancelled) {
            const data = await res.json();
            if (data.apiKey) {
              setApiKey(data.apiKey);
              setKeySource('cloud');
            }
          }
        } else {
          const res = await fetch('/api/settings');
          if (res.ok && !cancelled) {
            const data = await res.json();
            if (data.mcpKey) {
              setApiKey(data.mcpKey);
              setKeySource('oss');
            }
          }
        }
      } catch {
        // key unavailable — the copy row explains where it lives
      }
      // Public share tunnel — OSS-only concept (untun/Cloudflare Quick
      // Tunnel). Cloud folios are publicly hosted; never probe /api/tunnel
      // here or every Cloud mount logs a 403.
      if (!isCloud) {
        try {
          const res = await fetch('/api/tunnel');
          if (res.ok && !cancelled) {
            const data = await res.json();
            setTunnelActive(data.active);
            setTunnelUrl(data.url || '');
          }
        } catch {
          // tunnel probe failed
        }
      }
      // Connector status is Cloud-only (the /api/integrations API is
      // excluded from the OSS sync) — never probe it locally or every OSS
      // settings mount logs a 404.
      if (isCloud) {
        try {
          const res = await fetch('/api/integrations/status');
          if (res.ok && !cancelled) {
            const data = await res.json();
            setSlackConnected(data.slack?.connected || false);
            setSlackWorkspace(data.slack?.workspaceName || '');
            setDiscordConnected(data.discord?.connected || false);
            setDiscordServer(data.discord?.serverName || '');
          }
        } catch {
          // integrations unavailable
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleTunnel = async () => {
    setIsTogglingTunnel(true);
    try {
      const action = tunnelActive ? 'stop' : 'start';
      const res = await fetch('/api/tunnel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const data = await res.json();
        if (action === 'start') {
          setTunnelActive(true);
          setTunnelUrl(data.url || '');
        } else {
          setTunnelActive(false);
          setTunnelUrl('');
        }
      }
    } catch (err) {
      console.error('Failed to toggle tunnel:', err);
    } finally {
      setIsTogglingTunnel(false);
    }
  };

  const disconnect = async (platform: 'slack' | 'discord') => {
    setDisconnecting(platform);
    try {
      const res = await fetch(`/api/integrations/disconnect?platform=${platform}`);
      if (res.ok) {
        if (platform === 'slack') {
          setSlackConnected(false);
          setSlackWorkspace('');
        } else {
          setDiscordConnected(false);
          setDiscordServer('');
        }
      }
    } catch (err) {
      console.error('Disconnect failed:', err);
    } finally {
      setDisconnecting(null);
    }
  };

  const openApiUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/openapi` : '/api/openapi';
  const configSnippet = `{
  "mcpServers": {
    "LiveFolio": {
      "type": "http",
      "url": "${mcpUrl}",
      "headers": {
        "Authorization": "Bearer ${apiKey || 'YOUR_API_KEY'}"
      }
    }
  }
}`;
  const cursorSnippet = `["-y", "@modelcontextprotocol/server-http", "--url", "${mcpUrl}", "--header", "Authorization: Bearer ${apiKey || 'YOUR_API_KEY'}"]`;
  const antigravitySnippet = `${mcpUrl}?key=${apiKey || 'YOUR_API_KEY'}`;

  // ── Connectors ────────────────────────────────────────────────────────
  // Chat platforms (Slack/Discord) + the automation bridge (inbound
  // webhook). The webhook authenticates with the same key shown in the MCP
  // block above — Cloud: workspace API key; OSS: master key (settings.json
  // mcpKey). Its remote target follows the tunnel when one is live.
  const webhookUrl = `${mcpOrigin}/api/webhooks/inbound`;
  const webhookTarget =
    !isCloud && tunnelActive && tunnelUrl ? tunnelUrl.replace(/\/$/, '') : webhookUrl;
  const webhookStatus = !isCloud
    ? apiKey
      ? tunnelActive
        ? 'Live — pushes over the public tunnel'
        : 'Key ready — start the tunnel for remote pushes'
      : 'No key — configure one in Sharing / Tunnel'
    : apiKey
      ? 'Ready — push with the workspace API key'
      : 'Needs an API key — see the API Key section';
  const webhookSnippet = `curl -X POST "${webhookTarget}/api/webhooks/inbound" \\
  -H "Authorization: Bearer ${apiKey || 'YOUR_API_KEY'}" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Pushed from automation","initial_html":"<h1>Hello from my tool</h1>"}'`;

  const connectors: Platform[] = [
    {
      id: 'slack',
      name: 'Slack',
      domain: 'slack.com',
      type: 'Connector',
      status: !isCloud
        ? 'Cloud only'
        : slackConnected
          ? `Connected: ${slackWorkspace || 'Active'}`
          : 'Not connected',
      oauth: true,
      steps: ['Connect your workspace via OAuth.'],
    },
    {
      id: 'discord',
      name: 'Discord',
      domain: 'discord.com',
      type: 'Connector',
      status: !isCloud
        ? 'Cloud only'
        : discordConnected
          ? `Connected: ${discordServer || 'Active'}`
          : 'Not connected',
      oauth: true,
      steps: ['Connect your server via OAuth.'],
    },
    {
      id: 'inbound-webhook',
      name: 'Inbound Webhook',
      domain: 'livefolio.cloud',
      type: 'Automation',
      status: webhookStatus,
      steps: [
        isCloud
          ? 'Grab the workspace API key from the API Key section (OSS: the master key in Sharing / Tunnel).'
          : 'Grab the master key from the Sharing / Tunnel section.',
        'Send a POST to the endpoint below with a JSON body: { "title": "...", "initial_html": "<html>…</html>" }',
        'Every call returns { project_id, share_url } — wire it into n8n, Zapier, Make, or any script.',
      ],
      snippet: webhookSnippet,
      snippetLabel: 'Terminal — curl',
    },
  ];

  // ── AI agents (MCP/OpenAPI clients of the LiveFolio endpoint) ─────────
  const platforms: Platform[] = [
    {
      id: 'claude',
      name: 'Claude Desktop',
      domain: 'claude.ai',
      type: 'MCP Server',
      status: 'Configured with key + URL',
      steps: [
        'Open your local claude_desktop_config.json (Claude Desktop → Settings → Developer).',
        'Add the LiveFolio mcpServers block below.',
        'Restart Claude Desktop — the LiveFolio tools appear automatically.',
      ],
      snippet: configSnippet,
      snippetLabel: 'claude_desktop_config.json',
    },
    {
      id: 'cursor',
      name: 'Cursor IDE',
      domain: 'cursor.com',
      type: 'MCP Server',
      status: 'Configured with key + URL',
      steps: [
        'Open Cursor → Settings → MCP.',
        'Click "Add new MCP server", pick Type "HTTP", and paste the server URL.',
        'Set the Authorization header to "Bearer <your API key>".',
      ],
      snippet: cursorSnippet,
      snippetLabel: 'Cursor MCP server args',
    },
    {
      id: 'antigravity',
      name: 'Antigravity',
      domain: 'antigravity.com',
      type: 'MCP Server',
      status: 'Configured with key + URL',
      steps: [
        'Open Antigravity → Settings → MCP servers.',
        'Add a new server with the URL below and Bearer authentication.',
      ],
      snippet: antigravitySnippet,
      snippetLabel: 'Server URL (key inline)',
    },
    {
      id: 'chatgpt',
      name: 'ChatGPT Custom Action',
      domain: 'chatgpt.com',
      type: 'MCP Server',
      status: isCloud ? 'Ready' : 'Cloud only',
      steps: [
        'ChatGPT → Explore GPTs → Configure → Actions → Create new action.',
        'Import via URL: paste the OpenAPI schema URL below.',
        'Set Authentication to "API Key", type "Bearer", and enter your key.',
      ],
      snippet: openApiUrl,
      snippetLabel: 'OpenAPI schema URL',
    },
    {
      id: 'ms-copilot',
      name: 'Microsoft Copilot',
      domain: 'copilot.cloud.microsoft',
      type: 'MCP Server',
      status: isCloud ? 'Ready' : 'Cloud only',
      steps: [
        'Copilot Studio → Settings → Connectors → "Create from OpenAPI".',
        'Paste the OpenAPI schema URL below.',
        'Set Authentication to "API Key" and enter the Bearer credential.',
      ],
      snippet: openApiUrl,
      snippetLabel: 'OpenAPI schema URL',
    },
    {
      id: 'gemini',
      name: 'Gemini',
      domain: 'gemini.google.com',
      type: 'MCP Server',
      status: isCloud ? 'Ready' : 'Cloud only',
      steps: [
        'Google AI Studio → Custom OpenAPI Tools.',
        'Import the OpenAPI schema URL below and authenticate with your key.',
      ],
      snippet: openApiUrl,
      snippetLabel: 'OpenAPI schema URL',
    },
    {
      id: 'deepseek',
      name: 'DeepSeek',
      domain: 'chat.deepseek.com',
      type: 'MCP Server',
      status: isCloud ? 'Ready' : 'Cloud only',
      steps: [
        'DeepSeek → Custom OpenAPI Tools.',
        'Import the OpenAPI schema URL below and authenticate with your key.',
      ],
      snippet: openApiUrl,
      snippetLabel: 'OpenAPI schema URL',
    },
  ];

  /** Row renderer shared by the Connectors and AI agents sections. */
  const connectorRow = (p: Platform) => (
    <div key={p.id} className="border-b border-[#0F0F0D]/5 dark:border-[#F4F4F0]/10 py-1 last:border-0">
      <div className="flex items-center justify-between gap-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-black/5 text-ink/60">
            <ExternalLink size={12} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-ink">{p.name}</p>
            <p className="truncate text-xs text-ink/60">{p.status}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {p.oauth && !isCloud ? (
            <span className="text-xs text-ink/50">Cloud only</span>
          ) : p.id === 'slack' || p.id === 'discord' ? (
            p.id === 'slack' ? (
              slackConnected ? (
                <button
                  type="button"
                  onClick={() => disconnect('slack')}
                  disabled={disconnecting === 'slack'}
                  className="h-7 rounded-lg px-3 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                >
                  Disconnect
                </button>
              ) : (
                <a
                  href="/api/integrations/oauth?platform=slack"
                  className="inline-flex h-7 items-center rounded-lg bg-[var(--app-accent)] px-3 text-xs font-semibold text-white transition-colors hover:bg-[var(--app-accent)]/90"
                >
                  Connect
                </a>
              )
            ) : discordConnected ? (
              <button
                type="button"
                onClick={() => disconnect('discord')}
                disabled={disconnecting === 'discord'}
                className="h-7 rounded-lg px-3 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
              >
                Disconnect
              </button>
            ) : (
              <a
                href="/api/integrations/oauth?platform=discord"
                className="inline-flex h-7 items-center rounded-lg bg-[var(--app-accent)] px-3 text-xs font-semibold text-white transition-colors hover:bg-[var(--app-accent)]/90"
              >
                Connect
              </a>
            )
          ) : (
            <button
              type="button"
              onClick={() => setExpanded(expanded === p.id ? null : p.id)}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink/60 transition-colors hover:bg-black/5 hover:text-ink"
            >
              How to connect
              <ChevronDown
                size={12}
                className={cn('transition-transform', expanded === p.id && 'rotate-180')}
              />
            </button>
          )}
        </div>
      </div>
      {expanded === p.id && (
        <div className="space-y-1.5 pb-2 pl-9.5">
          {p.steps.map((step, i) => (
            <p key={i} className="flex gap-2 text-[13px] leading-relaxed text-ink/70">
              <span className="shrink-0 font-semibold text-[var(--app-accent)]">{i + 1}.</span>
              {step}
            </p>
          ))}
          {p.snippet && (
            <div className="mt-2 rounded-lg bg-black/[0.04]">
              <div className="flex items-center justify-between px-2.5 pt-1.5">
                <span className="text-xs font-medium text-ink/50">{p.snippetLabel}</span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(p.snippet || '');
                    setCopiedSnippet(p.id);
                    setTimeout(() => setCopiedSnippet(null), 1500);
                  }}
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-[var(--app-accent)] transition-colors hover:bg-[var(--app-accent)]/10"
                >
                  {copiedSnippet === p.id ? (
                    <>
                      <Check size={11} /> Copied
                    </>
                  ) : (
                    <>
                      <Copy size={11} /> Copy
                    </>
                  )}
                </button>
              </div>
              <pre className="overflow-x-auto p-2.5 pt-1 text-xs leading-relaxed text-ink/80">
                {p.snippet}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      <SectionShell icon={Plug} title="MCP Server">
        <div className="space-y-2.5">
          <div>
            <label className="text-xs font-medium text-ink/60">Server URL</label>
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{mcpUrl}</span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(mcpUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink/50 transition-colors hover:bg-black/5 hover:text-ink"
                aria-label="Copy server URL"
              >
                {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-ink/60">API key (Bearer)</label>
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                {apiKey ? `${apiKey.slice(0, 8)}••••••••` : `No key configured — see the ${isCloud ? 'API Key' : 'Sharing & Tunnel'} section`}
              </span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(apiKey);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                disabled={!apiKey}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink/50 transition-colors hover:bg-black/5 hover:text-ink disabled:opacity-40"
                aria-label="Copy API key"
              >
                <Copy size={13} />
              </button>
            </div>
          </div>
          {!isCloud && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-[13px] text-ink/60">
                Public tunnel: {tunnelActive ? 'live' : 'off'}
              </span>
              <button
                type="button"
                onClick={toggleTunnel}
                disabled={isTogglingTunnel}
                className={cn(
                  'h-7 rounded-full px-3 text-xs font-semibold transition-colors disabled:opacity-50',
                  tunnelActive
                    ? 'bg-black/5 text-ink hover:bg-black/10'
                    : 'bg-[var(--app-accent)] text-white hover:bg-[var(--app-accent)]/90'
                )}
              >
                {isTogglingTunnel ? '…' : tunnelActive ? 'Disconnect' : 'Go live'}
              </button>
            </div>
          )}
          {tunnelActive && tunnelUrl && (
            <p className="truncate text-xs text-ink/60">{tunnelUrl}</p>
          )}
        </div>
      </SectionShell>

      <SectionShell icon={Cable} title="Connectors">
        <div className="space-y-0.5">{connectors.map(connectorRow)}</div>
      </SectionShell>

      <SectionShell icon={Globe} title="AI agents">
        <div className="space-y-0.5">{platforms.map(connectorRow)}</div>
      </SectionShell>

      <SectionShell icon={Wrench} title="Agent tools">
        <button
          type="button"
          onClick={() => setShowTools(!showTools)}
          className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--app-accent)] transition-colors hover:underline"
        >
          <ChevronDown size={12} className={cn('transition-transform', showTools && 'rotate-180')} />
          {showTools ? 'Hide' : 'Show'} the {tools.length} MCP tools
        </button>
        {showTools && (
          <div className="space-y-2">
            {tools.map((t) => (
              <div key={t.name}>
                <p className="text-[13px] font-medium text-ink">{t.name}</p>
                <p className="text-xs leading-relaxed text-ink/60">{t.description}</p>
              </div>
            ))}
          </div>
        )}
      </SectionShell>
    </>
  );
}
