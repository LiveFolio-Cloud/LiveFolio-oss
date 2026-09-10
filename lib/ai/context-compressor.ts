/**
 * Context Compressor — keeps AI prompts from exceeding model context windows.
 *
 * The AI route sends currentFiles + chatHistory + system prompt + design system
 * in every request.  When a folio has large files or a long conversation, this
 * can easily cross 1M tokens and no provider can handle it.
 *
 * This module provides token estimation, chat-history summarization, and file
 * pruning so the prompt stays within budget regardless of how long the session
 * runs or how many files the folio has.
 */

// ── Token estimation ───────────────────────────────────────────────────

/** Rough estimate: ~4 characters per token for English text.  Conservative
 *  multiplier (0.3 tokens/char) gives us a safety margin. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length * 0.3);
}

/** Sum token estimate across multiple text segments. */
export function estimateTotalTokens(segments: Record<string, string>): number {
  let total = 0;
  for (const v of Object.values(segments)) {
    total += estimateTokens(v);
  }
  return total;
}

// ── Model context windows (conservative — leaves room for response) ────

const MODEL_MAX_TOKENS: Record<string, number> = {
  'deepseek-chat': 900_000,
  'deepseek-reasoner': 900_000,
  'gemini-2.5-flash': 900_000,
  'gemini-2.5-pro': 1_800_000,
  'gemini-3.5-flash': 900_000,
  'claude-3-5-sonnet-20241022': 180_000,
  'claude-sonnet-4-6': 180_000,
  'claude-opus-4-8': 180_000,
  'claude-fable-5': 180_000,
  'gpt-4o': 110_000,
  'gpt-4o-mini': 110_000,
};

/** Get the safe max input tokens for a model (leaves 20% headroom for response). */
export function getModelMaxInputTokens(model: string): number {
  const cleaned = model.trim().toLowerCase();
  for (const [prefix, max] of Object.entries(MODEL_MAX_TOKENS)) {
    if (cleaned.startsWith(prefix) || cleaned === prefix) {
      return Math.floor(max * 0.8); // 80% for input, 20% for output
    }
  }
  // Unknown model — assume 100K (conservative)
  return 80_000;
}

// ── Chat history summarization ─────────────────────────────────────────

interface ChatTurn {
  sender: string;
  text: string;
  createdAt?: string;
  interactiveCard?: unknown;
  toolCalls?: unknown[];
  isProposal?: boolean;
}

/**
 * Summarize chat history so it fits within `maxTokens`.
 *
 * Strategy:
 *   1. If the full history fits, return it verbatim.
 *   2. Otherwise, keep the most recent N messages verbatim and summarise
 *      everything before them into a single compressed paragraph.
 *
 * Returns the formatted text + whether truncation occurred.
 */
export function compressChatHistory(
  history: ChatTurn[],
  maxTokens: number
): { text: string; truncated: boolean; truncatedCount: number } {
  if (!history || history.length === 0) {
    return { text: '', truncated: false, truncatedCount: 0 };
  }

  // Quick check: does the full history fit?
  const fullText = formatHistory(history);
  if (estimateTokens(fullText) <= maxTokens) {
    return { text: fullText, truncated: false, truncatedCount: 0 };
  }

  // Keep the most recent messages (walk backwards until we hit budget)
  const recent: ChatTurn[] = [];
  let recentTokens = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const msgText = `[${history[i].sender === 'user' ? 'User' : 'Assistant'}]: ${history[i].text}`;
    const msgTokens = estimateTokens(msgText);
    if (recentTokens + msgTokens > maxTokens * 0.7) break; // leave 30% for summary
    recent.unshift(history[i]);
    recentTokens += msgTokens;
  }

  const olderCount = history.length - recent.length;
  if (olderCount <= 0) {
    // Even the most recent messages barely fit — just keep last N
    const text = 'Preceding Conversation History (older messages omitted to fit context window):\n' +
      formatHistory(recent) + '\n\n';
    return { text, truncated: true, truncatedCount: olderCount };
  }

  // Build a summary of older messages
  const olderMessages = history.slice(0, olderCount);
  const summary = summarizeTurns(olderMessages);

  const text =
    `Preceding Conversation History (${olderCount} older messages summarized):\n` +
    `[Summary of earlier conversation]: ${summary}\n\n` +
    `Recent messages:\n` +
    formatHistory(recent) + '\n\n';

  return { text, truncated: true, truncatedCount: olderCount };
}

/** Format chat turns as plain text. */
function formatHistory(turns: ChatTurn[]): string {
  return turns
    .map((c) => `[${c.sender === 'user' ? 'User' : 'Assistant'}]: ${c.text}`)
    .join('\n');
}

/**
 * Produce a one-paragraph summary of older chat turns.
 * This is a rule-based condensation — fast, deterministic, no extra API call.
 */
function summarizeTurns(turns: ChatTurn[]): string {
  const userMessages = turns.filter((t) => t.sender === 'user');
  const topics = new Set<string>();

  // Extract likely topic keywords from user messages
  for (const msg of userMessages) {
    const words = msg.text.toLowerCase().split(/\s+/);
    const keywords = words.filter((w) =>
      ['color', 'theme', 'font', 'layout', 'style', 'design', 'change',
        'update', 'add', 'remove', 'delete', 'fix', 'page', 'header',
        'footer', 'button', 'card', 'chart', 'image', 'text', 'title',
        'background', 'border', 'shadow', 'animation', 'slide', 'deck',
        'dashboard', 'report', 'pitch', 'proposal', 'dark', 'light',
        'vermillion', 'ink', 'bone', 'brand', 'logo', 'nav', 'grid',
      ].includes(w)
    );
    keywords.forEach((k) => topics.add(k));
  }

  const topicStr = topics.size > 0
    ? `Topics discussed: ${Array.from(topics).join(', ')}. `
    : '';

  return (
    `${topicStr}The user and assistant worked on the folio across ` +
    `${turns.length} messages. The user made ${userMessages.length} requests ` +
    `related to design, layout, and content changes.`
  );
}

// ── File context pruning ───────────────────────────────────────────────

/**
 * Prune the file map so total token count stays within `maxTokens`.
 *
 * Strategy:
 *   1. The active file (the one the user is viewing) is always included in full.
 *   2. Other HTML files get truncated to a name listing if we need budget.
 *   3. Non-HTML assets (CSS, JS) are kept since they're usually small.
 *
 * Returns the pruned file map + list of filenames that were truncated.
 */
export function pruneFileContext(
  files: Record<string, string>,
  activeFilename: string,
  maxTokens: number
): { files: Record<string, string>; truncated: string[] } {
  const entries = Object.entries(files);
  const totalEstimate = estimateTotalTokens(files);

  if (totalEstimate <= maxTokens) {
    return { files, truncated: [] };
  }

  // Priority order: active file > non-HTML assets > other HTML files
  const active: [string, string][] = [];
  const assets: [string, string][] = [];
  const otherHtml: [string, string][] = [];

  for (const [name, content] of entries) {
    if (name === activeFilename) {
      active.push([name, content]);
    } else if (!name.endsWith('.html') && !name.endsWith('.htm')) {
      assets.push([name, content]);
    } else {
      otherHtml.push([name, content]);
    }
  }

  const result: Record<string, string> = {};
  const truncated: string[] = [];
  let used = 0;

  // Always include active file
  for (const [name, content] of active) {
    result[name] = content;
    used += estimateTokens(content);
  }

  // Include assets as long as budget allows
  for (const [name, content] of assets) {
    const t = estimateTokens(content);
    if (used + t <= maxTokens) {
      result[name] = content;
      used += t;
    } else {
      truncated.push(name);
    }
  }

  // Include other HTML files — if they don't fit, include just a stub
  for (const [name, content] of otherHtml) {
    const t = estimateTokens(content);
    if (used + t <= maxTokens) {
      result[name] = content;
      used += t;
    } else {
      // Stub: just mention the file exists and its size
      const stub = `[File "${name}" — ${content.length.toLocaleString()} chars — omitted from context to stay within token budget. Use get_project or switch to this file to view/edit it.]`;
      result[name] = stub;
      truncated.push(name);
    }
  }

  return { files: result, truncated };
}
