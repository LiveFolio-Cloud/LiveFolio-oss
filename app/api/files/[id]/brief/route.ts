import { NextResponse } from 'next/server';
import { readDB, HTMLFile } from '@/lib/db';
import { isOSS } from '@/lib/env';
import { supabaseAdmin, transformFolioRecord, FolioRecord } from '@/lib/supabase';
import { getAuthContext } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Collapse + escape folio-authored section labels for safe markdown use. */
function sanitizeBriefText(s?: string): string {
  if (!s) return '';
  return s.replace(/[\r\n]+/g, ' ').replace(/([|*_`])/g, '\\$1').slice(0, 80);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { orgId } = await getAuthContext();

    let project: HTMLFile | undefined;

    if (isOSS) {
      const db = await readDB();
      project = db.find((p) => p.id === id);
    } else {
      if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      const { data } = await supabaseAdmin
        .from('folios')
        .select('*')
        .eq('id', id)
        .eq('organization_id', orgId)
        .single();
      if (data) project = transformFolioRecord(data as FolioRecord);
    }

    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    const comments = project.comments || [];
    const openComments = comments.filter(c => !c.resolved);

    // Synthesize a structured design brief in markdown format
    let brief = `# LiveFolio Design Brief: ${project.title}\n\n`;
    brief += `**Description**: ${project.description}\n`;
    brief += `**Project ID**: \`${project.id}\`\n`;
    brief += `**Project Intent Mode**: \`${project.projectMode || 'document'}\`\n\n`;

    brief += `## 🎨 Current Open Feedback & Visual Annotations\n`;
    if (openComments.length === 0) {
      brief += `No unresolved pinpoint comments at the moment. General layout improvements can still be done.\n`;
    } else {
      brief += `Please resolve the following visual design annotations left by reviewers on the live canvas:\n\n`;

      // Sort comments by slide index, then position (mirrors the MCP brief)
      const sortedComments = [...openComments].sort((a, b) => {
        if ((a.slideIndex ?? -1) !== (b.slideIndex ?? -1)) {
          return (a.slideIndex ?? -1) - (b.slideIndex ?? -1);
        }
        return (a.y ?? 0) - (b.y ?? 0);
      });

      sortedComments.forEach((c, index) => {
        const slideInfo = c.slideIndex !== undefined
          ? `Slide Index: **${c.slideIndex}**${c.sectionLabel ? ` — ${sanitizeBriefText(c.sectionLabel)}` : ''}`
          : 'Whole Page / Global';
        brief += `### Pin #${index + 1}: ${c.text}\n`;
        brief += `- **Author**: *${c.author}*\n`;
        brief += `- **File Target**: \`${c.filename}\`\n`;
        brief += `- **Context/Slide**: ${slideInfo}\n`;
        brief += `- **Canvas Position**: X: \`${c.x ? c.x.toFixed(1) + '%' : '0%'}\`, Y: \`${c.y ? c.y.toFixed(1) + '%' : '0%'}\`\n`;
        if (c.selector) {
          brief += `- **Target DOM Selector**: \`${c.selector}\`\n`;
        }
        if (c.elementHtml) {
          brief += `- **Target Element Snippet**:\n\`\`\`html\n${c.elementHtml}\n\`\`\`\n`;
        }
        brief += `\n`;
      });
    }

    const latestVersion = project.versions[project.versions.length - 1];
    brief += `## 📂 Existing Sandbox Files\n`;
    brief += `The project has the following active files:\n`;
    Object.keys(latestVersion.files).forEach(f => {
      brief += `- \`${f}\` (${latestVersion.files[f].length} characters)\n`;
    });

    return NextResponse.json({
      title: project.title,
      description: project.description,
      brief,
      openComments
    });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: err may be any thrown value; err.message is read
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
