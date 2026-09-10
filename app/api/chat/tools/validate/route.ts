/**
 * POST /api/chat/tools/validate
 *
 * Validates tool parameters against project state before execution (Epic #96).
 * Lightweight — no DB writes, just reads and validates.
 */

import { NextResponse } from 'next/server';
import { readDB, HTMLFile } from '@/lib/db';
import { getAuthContext } from '@/lib/auth';
import { isOSS } from '@/lib/env';
import { supabaseAdmin, transformFolioRecord, FolioRecord } from '@/lib/supabase';
import { isKnownTool } from '@/lib/ai/tools/folio-tools';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { orgId } = await getAuthContext();
    const body = await request.json();
    const { projectId, toolName, toolArguments } = body;

    if (!projectId || !toolName || !toolArguments) {
      return NextResponse.json(
        { valid: false, errors: [{ field: 'root', message: 'Missing required fields: projectId, toolName, toolArguments' }] },
        { status: 400 }
      );
    }

    // Check tool is registered
    if (!isKnownTool(toolName)) {
      return NextResponse.json({
        valid: false,
        errors: [{ field: 'toolName', message: `Unknown tool: "${toolName}"` }],
      });
    }

    // Load project
    let project: HTMLFile | null | undefined = null;
    if (isOSS) {
      const db = await readDB();
      project = db.find((p) => p.id === projectId);
    } else {
      if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      const { data, error } = await supabaseAdmin
        .from('folios')
        .select('*')
        .eq('id', projectId)
        .eq('organization_id', orgId)
        .single();
      if (error || !data) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      project = transformFolioRecord(data as FolioRecord);
    }

    if (!project) {
      return NextResponse.json({ valid: false, errors: [{ field: 'projectId', message: 'Project not found' }] }, { status: 404 });
    }

    const latestVersion = project.versions?.[project.versions.length - 1];
    const currentFiles = latestVersion?.files || {};
    const errors: { field: string; message: string }[] = [];
    const warnings: string[] = [];

    // Per-tool validation
    switch (toolName) {
      case 'edit_element': {
        const { filename, selector, new_html } = toolArguments;
        if (!filename) errors.push({ field: 'filename', message: 'filename is required' });
        else if (!currentFiles[filename]) errors.push({ field: 'filename', message: `File "${filename}" not found in project` });
        if (!selector) errors.push({ field: 'selector', message: 'selector is required' });
        if (!new_html) errors.push({ field: 'new_html', message: 'new_html is required' });
        if (selector && !currentFiles[filename]?.includes(selector.replace(/^[.#]/, ''))) {
          warnings.push(`Selector "${selector}" may not match any element in "${filename}".`);
        }
        break;
      }

      case 'apply_design_system': {
        const { theme } = toolArguments;
        if (!theme) errors.push({ field: 'theme', message: 'theme is required' });
        break;
      }

      case 'add_page': {
        const { filename, initial_html } = toolArguments;
        if (!filename) errors.push({ field: 'filename', message: 'filename is required' });
        else if (!filename.endsWith('.html')) errors.push({ field: 'filename', message: 'filename must end with .html' });
        else if (currentFiles[filename]) errors.push({ field: 'filename', message: `File "${filename}" already exists` });
        if (!initial_html) errors.push({ field: 'initial_html', message: 'initial_html is required' });
        break;
      }

      case 'delete_page': {
        const { filename } = toolArguments;
        if (!filename) errors.push({ field: 'filename', message: 'filename is required' });
        else if (!currentFiles[filename]) errors.push({ field: 'filename', message: `File "${filename}" not found` });
        else {
          const htmlCount = Object.keys(currentFiles).filter((k) => k.endsWith('.html')).length;
          if (htmlCount <= 1) {
            errors.push({ field: 'filename', message: `Cannot delete "${filename}" — it's the only page in the folio` });
          }
        }
        break;
      }

      case 'export_folio': {
        const { format } = toolArguments;
        if (!format) errors.push({ field: 'format', message: 'format is required' });
        else if (format !== 'pdf') errors.push({ field: 'format', message: 'Only "pdf" format is currently supported' });
        break;
      }

      case 'web_search': {
        const { query } = toolArguments;
        if (!query || typeof query !== 'string' || query.trim().length === 0)
          errors.push({ field: 'query', message: 'A search query string is required' });
        break;
      }

      case 'web_fetch': {
        const { url } = toolArguments;
        if (!url) errors.push({ field: 'url', message: 'url is required' });
        else {
          try { new URL(url); } catch { errors.push({ field: 'url', message: 'Invalid URL format' }); }
        }
        break;
      }

      default:
        errors.push({ field: 'toolName', message: `Unknown tool: "${toolName}"` });
    }

    return NextResponse.json({
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- thrown error shape is dynamic (err.message read below)
  } catch (err: any) {
    console.error('Tool validation error:', err);
    return NextResponse.json({ valid: false, errors: [{ field: 'root', message: err.message || 'Validation failed' }] }, { status: 500 });
  }
}
