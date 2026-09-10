/**
 * Server-side tool execution logic (Epic #96).
 *
 * Each tool handler receives the project, current files, and tool arguments,
 * and returns structured result data.  Mutation handlers also return the
 * modified files map so callers can create a new version.
 *
 * IMPORTANT: `delete_page` is handled by the execute route directly — it
 * returns `confirmation_required` and only executes after re-invocation with
 * `confirmed: true`.  This module provides the pure execution function.
 */

import { HTMLFile } from '@/lib/db';

// ── Types ──────────────────────────────────────────────────────────

export interface ToolResult {
  type: 'text' | 'file' | 'files' | 'confirmation_required';
  message: string;
  files?: { [filename: string]: string };
  confirmationPrompt?: string;
  versionId?: string;
}

export interface ToolExecutionContext {
  project: HTMLFile;
  currentFiles: { [filename: string]: string };
  personaName: string;
}

// ── edit_element ───────────────────────────────────────────────────

export function executeEditElement(
  ctx: ToolExecutionContext,
  args: { filename: string; selector: string; new_html: string; explanation?: string }
): ToolResult {
  const { filename, selector, new_html, explanation } = args;
  const currentHtml = ctx.currentFiles[filename];

  if (!currentHtml) {
    return { type: 'text', message: `File "${filename}" not found in the current version.` };
  }

  if (!selector || !new_html) {
    return { type: 'text', message: 'Missing required parameters: selector and new_html.' };
  }

  // Replace the targeted element in the HTML.
  // We use a simple regex-free approach: find the selector's opening tag
  // position and replace the element.  For complex selectors we fall back
  // to a best-effort replacement.
  let updatedHtml = currentHtml;

  try {
    // Attempt to match by id selector (e.g. "#hero")
    if (selector.startsWith('#') && !selector.includes(' ') && !selector.includes('>')) {
      const id = selector.slice(1);
      // Match the element with this id, including its contents
      const regex = new RegExp(
        `<([a-zA-Z][a-zA-Z0-9]*)\\s[^>]*\\bid\\s*=\\s*["']${escapeRegex(id)}["'][^>]*>[\\s\\S]*?<\\/\\1>`,
        'i'
      );
      if (regex.test(updatedHtml)) {
        updatedHtml = updatedHtml.replace(regex, new_html);
      } else {
        // Try simpler: find the id attr and replace surrounding element
        const idRegex = new RegExp(
          `(<[a-zA-Z][a-zA-Z0-9]*\\s[^>]*\\bid\\s*=\\s*["']${escapeRegex(id)}["'][^>]*>)`,
          'i'
        );
        const match = idRegex.exec(updatedHtml);
        if (match) {
          // Find matching closing tag
          const tagName = (match[1].match(/^<(\w+)/) || [])[1];
          if (tagName) {
            const startIdx = match.index;
            const closeTag = `</${tagName}>`;
            let depth = 1;
            let searchIdx = startIdx + match[1].length;
            while (depth > 0 && searchIdx < updatedHtml.length) {
              const openIdx = updatedHtml.indexOf(`<${tagName}`, searchIdx);
              const closeIdx = updatedHtml.indexOf(closeTag, searchIdx);
              if (closeIdx === -1) break;
              if (openIdx !== -1 && openIdx < closeIdx) {
                depth++;
                searchIdx = openIdx + tagName.length + 1;
              } else {
                depth--;
                if (depth === 0) {
                  updatedHtml =
                    updatedHtml.slice(0, startIdx) +
                    new_html +
                    updatedHtml.slice(closeIdx + closeTag.length);
                  break;
                }
                searchIdx = closeIdx + closeTag.length;
              }
            }
          }
        }
      }
    } else {
      // Generic selector — replace first matching element (best-effort)
      // For class selectors like ".hero-section"
      if (selector.startsWith('.') && !selector.includes(' ') && !selector.includes('>')) {
        const className = selector.slice(1);
        const classRegex = new RegExp(
          `(<[a-zA-Z][a-zA-Z0-9]*\\s[^>]*\\bclass\\s*=\\s*["'][^"']*\\b${escapeRegex(className)}\\b[^"']*["'][^>]*>)`,
          'i'
        );
        const match = classRegex.exec(updatedHtml);
        if (match) {
          const tagName = (match[1].match(/^<(\w+)/) || [])[1];
          if (tagName) {
            const startIdx = match.index;
            const closeTag = `</${tagName}>`;
            let depth = 1;
            let searchIdx = startIdx + match[1].length;
            while (depth > 0 && searchIdx < updatedHtml.length) {
              const openIdx = updatedHtml.indexOf(`<${tagName}`, searchIdx);
              const closeIdx = updatedHtml.indexOf(closeTag, searchIdx);
              if (closeIdx === -1) break;
              if (openIdx !== -1 && openIdx < closeIdx) {
                depth++;
                searchIdx = openIdx + tagName.length + 1;
              } else {
                depth--;
                if (depth === 0) {
                  updatedHtml =
                    updatedHtml.slice(0, startIdx) +
                    new_html +
                    updatedHtml.slice(closeIdx + closeTag.length);
                  break;
                }
                searchIdx = closeIdx + closeTag.length;
              }
            }
          }
        }
      }
    }
  } catch {
    // If DOM manipulation fails, return the original
    return { type: 'text', message: `Could not apply edit to "${selector}" — selector not found or ambiguous.` };
  }

  const newFiles = { ...ctx.currentFiles, [filename]: updatedHtml };

  return {
    type: 'files',
    message: explanation || `Updated "${selector}" in ${filename}.`,
    files: newFiles,
  };
}

// ── apply_design_system ────────────────────────────────────────────

export function executeApplyDesignSystem(
  ctx: ToolExecutionContext,
  args: { theme: string; typography?: string; palette?: string; libraries?: string[] }
): ToolResult {
  const { theme, typography, palette, libraries } = args;

  // This tool updates the project's designPreferences.
  // The actual re-generation is triggered by the caller (the AI route
  // re-calls the provider with the updated preferences).
  return {
    type: 'text',
    message: `Design system updated to "${theme}". ${
      typography ? `Typography: ${typography}. ` : ''
    }${palette ? `Palette: ${palette}. ` : ''}${
      libraries?.length ? `Libraries: ${libraries.join(', ')}. ` : ''
    }The AI will now regenerate your folio with these settings.`,
  };
}

// ── add_page ───────────────────────────────────────────────────────

export function executeAddPage(
  ctx: ToolExecutionContext,
  args: { filename: string; initial_html: string; title?: string }
): ToolResult {
  const { filename, initial_html, title } = args;

  if (!filename.endsWith('.html')) {
    return { type: 'text', message: 'Filename must end with ".html".' };
  }

  if (ctx.currentFiles[filename]) {
    return { type: 'text', message: `A page named "${filename}" already exists. Choose a different name.` };
  }

  const newFiles = { ...ctx.currentFiles, [filename]: initial_html };

  return {
    type: 'files',
    message: title
      ? `Created new page "${title}" (${filename}).`
      : `Created new page "${filename}".`,
    files: newFiles,
  };
}

// ── delete_page ────────────────────────────────────────────────────

export function executeDeletePage(
  ctx: ToolExecutionContext,
  args: { filename: string }
): ToolResult {
  const { filename } = args;

  if (!ctx.currentFiles[filename]) {
    return { type: 'text', message: `Page "${filename}" not found.` };
  }

  // Don't allow deleting the last HTML file
  const htmlFiles = Object.keys(ctx.currentFiles).filter((k) => k.endsWith('.html'));
  if (htmlFiles.length <= 1) {
    return { type: 'text', message: `Cannot delete "${filename}" — it's the only page in the folio. A folio must have at least one HTML file.` };
  }

  const newFiles = { ...ctx.currentFiles };
  delete newFiles[filename];

  // Also clean up assets only referenced by this page (best effort)
  // For simplicity we just remove the file.

  return {
    type: 'files',
    message: `Deleted page "${filename}".`,
    files: newFiles,
  };
}

// ── export_folio ───────────────────────────────────────────────────

export function executeExportFolio(
  ctx: ToolExecutionContext,
  args: { format: string; filename?: string }
): ToolResult {
  const { format, filename } = args;

  if (format !== 'pdf') {
    return { type: 'text', message: `Export format "${format}" is not yet supported. Currently only "pdf" is available.` };
  }

  const targetFile = filename || 'index.html';
  const html = ctx.currentFiles[targetFile];

  if (!html) {
    return { type: 'text', message: `File "${targetFile}" not found for export.` };
  }

  // PDF export is deferred — the execute route will handle the actual
  // HTML→PDF conversion using a headless browser or cloud service.
  return {
    type: 'text',
    message: `Preparing PDF export of "${targetFile}". The download will begin shortly.`,
  };
}

// ── web_search (Firecrawl) ────────────────────────────────────────

const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v1';

export async function executeWebSearch(
  _ctx: ToolExecutionContext,
  args: { query: string; limit?: number }
): Promise<ToolResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return { type: 'text', message: 'Firecrawl API key is not configured. Web search is unavailable.' };
  }

  const limit = Math.min(args.limit || 5, 10);

  try {
    const res = await fetch(`${FIRECRAWL_BASE}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: args.query,
        limit,
        scrapeOptions: { formats: ['markdown'] },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Firecrawl search failed (${res.status}): ${errText}`);
    }

    const data = await res.json();

    if (!data.data?.length) {
      return { type: 'text', message: `No results found for "${args.query}".` };
    }

    // Format results as readable text for the AI
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- data comes from res.json() (any); annotation required under noImplicitAny
    const results = data.data.map((r: any, i: number) =>
      `${i + 1}. **${r.title || 'Untitled'}**\n   URL: ${r.url}\n   ${r.description || (r.markdown ? r.markdown.slice(0, 200) + '…' : 'No description')}`
    ).join('\n\n');

    return {
      type: 'text',
      message: `Search results for "${args.query}":\n\n${results}`,
    };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fetch errors are untyped; .message is read uniformly below
  } catch (err: any) {
    console.error('Firecrawl search error:', err);
    return { type: 'text', message: `Web search failed: ${err.message}` };
  }
}

// ── web_fetch (Firecrawl) ─────────────────────────────────────────

/**
 * Reject URLs pointing at local/private/internal hosts. web_fetch must not
 * be usable to probe the internal network (SSRF-lite) or abuse non-http
 * schemes (file://, javascript://, …).
 */
function isSafePublicUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: 'Invalid URL' };
  }

  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { ok: false, reason: 'Only http(s) URLs are supported' };
  }

  const hostname = u.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return { ok: false, reason: 'Local hosts are not allowed' };
  }

  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = parseInt(ipv4[1], 10);
    const b = parseInt(ipv4[2], 10);
    const c = parseInt(ipv4[3], 10);
    const isPrivate =
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224;
    if (isPrivate) {
      return { ok: false, reason: 'Private/loopback addresses are not allowed' };
    }
  }

  return { ok: true, url: u };
}

export async function executeWebFetch(
  _ctx: ToolExecutionContext,
  args: { url: string }
): Promise<ToolResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return { type: 'text', message: 'Firecrawl API key is not configured. Web fetching is unavailable.' };
  }

  // Validate the URL before sending it anywhere (scheme + private-IP block).
  const check = isSafePublicUrl(args.url);
  if (!check.ok) {
    return { type: 'text', message: `URL rejected: ${check.reason}. Only public http(s) URLs can be fetched.` };
  }
  const url = check.url.toString();

  try {
    const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Firecrawl scrape failed (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const markdown = data.data?.markdown;

    if (!markdown || markdown.trim().length === 0) {
      return { type: 'text', message: `Fetched ${url} but no readable content was extracted.` };
    }

    // Truncate very long content to avoid blowing up the AI context
    const maxLength = 8000;
    const truncated = markdown.length > maxLength
      ? markdown.slice(0, maxLength) + `\n\n…(truncated at ${maxLength} chars, original was ${markdown.length} chars)`
      : markdown;

    return {
      type: 'text',
      message: `Content from ${url}:\n\n${truncated}`,
    };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fetch errors are untyped; .message is read uniformly below
  } catch (err: any) {
    console.error('Firecrawl fetch error:', err);
    return { type: 'text', message: `Web fetch failed: ${err.message}` };
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
