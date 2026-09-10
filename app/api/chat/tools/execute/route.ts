/**
 * POST /api/chat/tools/execute
 *
 * Executes a validated tool call server-side (Epic #96).  Supports both
 * standard JSON responses and SSE streaming for long-running operations.
 *
 * delete_page requires `confirmed: true` — without it, the route returns
 * `confirmation_required` so the frontend can prompt the user.
 */

import { NextResponse } from 'next/server';
import { runTransaction, HTMLVersion } from '@/lib/db';
import { getAuthContext } from '@/lib/auth';
import { isCloud } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase';
import { isKnownTool } from '@/lib/ai/tools/folio-tools';
import {
  executeEditElement,
  executeAddPage,
  executeDeletePage,
  executeApplyDesignSystem,
  executeExportFolio,
  executeWebSearch,
  executeWebFetch,
  ToolExecutionContext,
  ToolResult,
} from '@/lib/ai/tools/tool-executor';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { orgId } = await getAuthContext();
    const body = await request.json();
    const { projectId, toolName, toolArguments, confirmed, stream } = body;

    if (!projectId || !toolName || !toolArguments) {
      return NextResponse.json(
        { success: false, message: 'Missing required fields: projectId, toolName, toolArguments' },
        { status: 400 }
      );
    }

    if (!isKnownTool(toolName)) {
      return NextResponse.json(
        { success: false, message: `Unknown tool: "${toolName}"` },
        { status: 400 }
      );
    }

    // Plan gating: web_search and web_fetch require Team or higher (Epic #96 web tools).
    // Fail CLOSED: if the org context or plan lookup fails, the tools are
    // denied rather than silently granted to Free users.
    const WEB_TOOLS = ['web_search', 'web_fetch'];
    if (WEB_TOOLS.includes(toolName) && isCloud) {
      if (!orgId) {
        return NextResponse.json({
          success: false,
          message: 'Web search and browsing require an authenticated workspace.',
        }, { status: 401 });
      }
      const { data: orgData, error: orgErr } = await supabaseAdmin
        .from('organizations')
        .select('plan')
        .eq('id', orgId)
        .single();
      if (orgErr || !orgData || orgData.plan === 'Free') {
        return NextResponse.json({
          success: false,
          message: 'Web search and browsing require the Team plan or higher. Please upgrade to access these features.',
        }, { status: 402 });
      }
    }

    // delete_page requires confirmation
    if (toolName === 'delete_page' && !confirmed) {
      return NextResponse.json({
        success: true,
        result: {
          type: 'confirmation_required',
          message: `Are you sure you want to delete "${toolArguments.filename}"? This cannot be undone.`,
          confirmationPrompt: `Delete page "${toolArguments.filename}"? This page and its content will be permanently removed.`,
        },
      });
    }

    // Web tools run outside the transaction — they don't modify the project
    if (toolName === 'web_search' || toolName === 'web_fetch') {
      try {
        let toolResult: ToolResult;
        if (toolName === 'web_search') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- web tools ignore ctx; no project is loaded yet in this branch
          toolResult = await executeWebSearch({ project: {} as any, currentFiles: {}, personaName: '' }, toolArguments);
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- web tools ignore ctx; no project is loaded yet in this branch
          toolResult = await executeWebFetch({ project: {} as any, currentFiles: {}, personaName: '' }, toolArguments);
        }
        return NextResponse.json({ success: true, result: toolResult });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool error shape is dynamic (err.message read below)
      } catch (err: any) {
        return NextResponse.json({ success: false, message: err.message }, { status: 500 });
      }
    }

    // Load project and execute
    const result = await runTransaction(async (db) => {
      const pIndex = db.findIndex((p) => p.id === projectId);
      if (pIndex === -1) throw new Error('Project not found');
      const project = { ...db[pIndex] };

      const latestVersion = project.versions?.[project.versions.length - 1];
      const currentFiles = latestVersion?.files || {};

      const cleanProjTitle = (project.title || 'Project')
        .replace(/(?:landing\s+page|website|app|concept|page|ui|mobile|portal|system|folio|presentation)/gi, '')
        .trim();
      const personaName = project.aiPersona?.name || (cleanProjTitle ? `${cleanProjTitle} Co-pilot` : 'LiveFolio Co-pilot');

      const ctx: ToolExecutionContext = {
        project,
        currentFiles,
        personaName,
      };

      let toolResult: ToolResult;

      switch (toolName) {
        case 'edit_element':
          toolResult = executeEditElement(ctx, toolArguments);
          break;
        case 'apply_design_system': {
          toolResult = executeApplyDesignSystem(ctx, toolArguments);
          // Update designPreferences in the project
          const { theme, typography, palette, libraries } = toolArguments;
          project.designPreferences = {
            ...project.designPreferences,
            theme: theme || project.designPreferences?.theme || 'Minimal Zinc',
            ...(typography && { typography }),
            ...(palette && { palette }),
            ...(libraries && { libraries }),
          };
          break;
        }
        case 'add_page':
          toolResult = executeAddPage(ctx, toolArguments);
          break;
        case 'delete_page':
          toolResult = executeDeletePage(ctx, toolArguments);
          break;
        case 'export_folio':
          toolResult = executeExportFolio(ctx, toolArguments);
          break;
        default:
          throw new Error(`Unhandled tool: "${toolName}"`);
      }

      // If the tool produced a new files map, create a new version
      if (toolResult.files && toolResult.type === 'files') {
        const parentVersionCount = project.versions.length;
        const nextVersionId = `v${parentVersionCount + 1}`;

        const newVersion: HTMLVersion = {
          versionId: nextVersionId,
          commitMessage: `AI Tool: ${toolName} — ${toolResult.message.slice(0, 50)}`,
          createdAt: new Date().toISOString(),
          author: `${personaName} AI`,
          files: toolResult.files,
        };

        project.versions = [...project.versions, newVersion];
        toolResult.versionId = nextVersionId;
      }

      project.updatedAt = new Date().toISOString();
      db[pIndex] = project;

      return { toolResult, project };
    });

    // For SSE streaming, set up a TransformStream
    // (Long-running operations like export_folio PDF conversion would stream here)
    if (stream && toolName === 'export_folio') {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const send = (data: unknown) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          };
          send({ type: 'status', message: 'Starting PDF export…' });
          send({ type: 'status', message: 'Rendering HTML to PDF…' });
          send({ type: 'done', success: true, result: result.toolResult });
          controller.close();
        },
      });
      return new NextResponse(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }

    // Standard JSON response
    return NextResponse.json({
      success: true,
      result: result.toolResult,
      project: result.project,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- thrown error shape is dynamic (err.message read below)
  } catch (err: any) {
    console.error('Tool execution error:', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Tool execution failed' },
      { status: 500 }
    );
  }
}
