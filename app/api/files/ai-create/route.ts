import { NextResponse } from 'next/server';
import { AIFactory } from '@/lib/ai/factory';
import { AIPromptContext } from '@/lib/ai/provider.interface';
import { getAuthContext } from '@/lib/auth';
import { isCloud, isOSS } from '@/lib/env';
import { resolveManagedModel } from '@/lib/ai/resolve-managed-model';
import { runTransaction, HTMLFile } from '@/lib/db';
import { supabaseAdmin, transformFolioRecord, transformToFolioRecord } from '@/lib/supabase';
import { assertStorageQuota } from '@/ee/middleware/usageCapping';
import { sanitizePaidAccess } from '@/lib/gating/config';
import type { PaidAccessConfig } from '@/lib/gating/types';
import { sanitizeListing, listingWriteGuard } from '@/lib/listing/config';
import type { ListingMetadata } from '@/lib/listing/types';
import { slugifyFolioTitle } from '@/lib/folio-slug';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const VALID_PROJECT_MODES = ['deck', 'document', 'spreadsheet', 'dashboard', 'infography'] as const;

const FOLIO_CREATION_SYSTEM_PROMPT = `You are a folio creation assistant. Given a user's description, you must:

1. Determine the best project mode:
   - "deck": presentation slides with snap-scroll sections, slide controls (Next/Prev), and punchy visual layouts
   - "document": long-form article/report with editorial layout, sticky navigation, and comfortable reading margins
   - "spreadsheet": data tables, calculators, grids with interactive inputs and live calculations
   - "dashboard": metric cards, charts, analytics panels with KPI summary badges and trend indicators
   - "infography": visual data stories with continuous-scroll canvas, oversized stat numerals, annotated charts, timeline strips, and before/after comparison panels — high information density with a restrained editorial palette

2. Generate a short, descriptive title (max 50 chars) that captures the essence of the folio.

3. Write a one-line description (max 120 chars) summarizing what the folio contains.

4. Generate a COMPLETE, production-ready index.html that:
   - Uses Tailwind CSS CDN: <script src="https://cdn.tailwindcss.com"></script>
   - Uses Inter font from Google Fonts: <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
   - Uses Lucide Icons CDN where appropriate: <script src="https://cdn.jsdelivr.net/npm/lucide/dist/umd/lucide.min.js"></script>
   - For Mermaid diagrams (flowcharts, sequences, ER, gantt, pie, etc.): include <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>, wrap code in <pre class="mermaid"> blocks, and call mermaid.initialize({ startOnLoad: true, theme: 'default' }) on load
   - Is responsive (mobile-first)
   - Is beautiful and polished — use realistic sample data, never placeholder text
   - Matches the user's described intent exactly
   - Follows a clean, modern aesthetic: generous whitespace, refined typography, a restrained palette (one accent color), subtle shadows, and elegant spacing. Avoid heavy borders, harsh offsets, or raw/unfinished styling unless the user explicitly requests them
   - Is self-contained (no external dependencies beyond the CDNs listed above)
   - Has proper <style> block setting font-family: 'Inter', sans-serif on body

Return ONLY valid JSON in this EXACT format — no markdown wrappers, no extra text:

{
  "explanation": "TITLE: Short Title Here\\nMODE: document\\nDESC: One-line description here.\\n\\nBrief summary of what you created.",
  "updatedFiles": [
    {
      "filename": "_meta.json",
      "code": "{\\"title\\":\\"Short Title\\",\\"projectMode\\":\\"document\\",\\"description\\":\\"One-line description\\"}"
    },
    {
      "filename": "index.html",
      "code": "<!DOCTYPE html>\\n<html lang=\\"en\\">\\n...complete HTML with all CDN links, styles, and content...\\n</html>"
    }
  ]
}

CRITICAL RULES:
- The explanation MUST start with "TITLE:", "MODE:", and "DESC:" lines before any other text. This is a hard requirement for metadata extraction.
- The _meta.json code field MUST contain a valid JSON object with exactly the keys: title, projectMode, description.
- The index.html code field MUST contain the complete, valid HTML document. No truncation. No placeholders.
- projectMode MUST be exactly one of: deck, document, spreadsheet, dashboard, infography.
- Do NOT wrap the JSON response in markdown code blocks. Return raw JSON only.`;

/**
 * Fallback extraction of folio metadata from the AI explanation text.
 * Used when the _meta.json file is missing or unparseable.
 */
function extractMetaFromExplanation(
  explanation: string,
  fallbackPrompt: string
): { title: string; projectMode: string; description: string } {
  const titleMatch = explanation.match(/TITLE:\s*(.+)/i);
  const modeMatch = explanation.match(/MODE:\s*(.+)/i);
  const descMatch = explanation.match(/DESC(?:RIPTION)?:\s*(.+)/i);

  const extractedMode = modeMatch?.[1]?.trim()?.toLowerCase() || '';
  const projectMode = VALID_PROJECT_MODES.includes(extractedMode as (typeof VALID_PROJECT_MODES)[number])
    ? extractedMode
    : 'document';

  return {
    title: titleMatch?.[1]?.trim() || fallbackPrompt.slice(0, 50),
    projectMode,
    description: descMatch?.[1]?.trim() || fallbackPrompt.slice(0, 120),
  };
}

/**
 * POST /api/files/ai-create
 *
 * Creates a new folio from a natural language prompt using AI.
 * The AI classifies the project mode, generates a title/description,
 * and produces a complete production-ready index.html.
 *
 * Cloud mode: uses managed AI provider (auto-resolved server-side).
 * OSS mode: user provides provider/model/apiKey (or uses env defaults).
 */
export async function POST(request: Request) {
  // Both modes are supported: Cloud resolves a managed model server-side,
  // OSS uses the caller's own key (BYOK) and persists to the flat file. The
  // OSS branch below has always existed — this endpoint was gated to Cloud
  // only while creation was a Cloud differentiator.

  try {
    const { orgId, email, userId } = await getAuthContext();
    const body = await request.json();
    const {
      prompt,
      model: reqModel,
      apiKey: reqApiKey,
      designPreferences,
      title: callerTitle,
      isPrivate,
      accessKey,
      allowComments,
      presentationModeOnly,
      referenceFiles,
      paidAccess,
      listing,
      projectId,
    } = body;

    // ── 1. Validate prompt ──────────────────────────────────────────

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return NextResponse.json(
        { error: 'A non-empty prompt is required.' },
        { status: 400 }
      );
    }

    // Paid access: validate at write time via the single shared sanitizer
    // (invalid → 400; omitted → free/inherit).
    let sanitizedPaidAccess: PaidAccessConfig | null = null;
    if (paidAccess !== undefined && paidAccess !== null) {
      sanitizedPaidAccess = sanitizePaidAccess(paidAccess);
      if (!sanitizedPaidAccess) {
        return NextResponse.json(
          { error: 'INVALID_PAID_ACCESS' },
          { status: 400 }
        );
      }
    }

    // Marketplace listing metadata (optional) — strict validation + standing
    // guard (owner Seller-Terms acceptance, per-listing rights affirmation).
    let sanitizedListing: ListingMetadata | null = null;
    if (listing !== undefined && listing !== null) {
      sanitizedListing = sanitizeListing(listing);
      if (!sanitizedListing) {
        return NextResponse.json({ error: 'INVALID_LISTING' }, { status: 400 });
      }
      if (sanitizedListing.listed) {
        const guardCode = await listingWriteGuard({
          orgId,
          listed: true,
          rightsAttestedAt: sanitizedListing.rightsAttestedAt,
          existingAttested: false,
        });
        if (guardCode === 'LISTING_NEEDS_SELLER_AGREEMENT' || guardCode === 'LISTING_SELLER_SUSPENDED') {
          return NextResponse.json({ error: guardCode }, { status: 403 });
        }
        if (guardCode === 'LISTING_NEEDS_RIGHTS_ATTESTATION') {
          return NextResponse.json({ error: guardCode }, { status: 400 });
        }
      }
    }

    // ── 2. Resolve AI provider ──────────────────────────────────────

    let effectiveModel: string;
    let clientApiKey: string | undefined;

    if (isCloud) {
      const managed = resolveManagedModel();
      if (!managed) {
        return NextResponse.json(
          {
            error:
              'AI is not configured for this workspace. Please configure at least one AI provider API key (DEEPSEEK_API_KEY, GEMINI_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY).',
          },
          { status: 500 }
        );
      }
      effectiveModel = managed.model;
      // Cloud manages its own API keys via environment variables
    } else {
      // OSS: user brings own keys, or falls back to env defaults
      effectiveModel = reqModel || 'gemini-2.5-flash';
      clientApiKey = reqApiKey;
    }

    if (!effectiveModel) {
      return NextResponse.json(
        { error: 'No AI model configured. Provide a model in the request or configure an AI provider.' },
        { status: 400 }
      );
    }

    // ── 3. Build AI prompt context ──────────────────────────────────

    const userPrompt = prompt.trim();

    // Build design preference guidance text
    let designPrefText = '';
    if (designPreferences) {
      const prefs: {
        theme?: string;
        typography?: string;
        palette?: string;
        libraries?: string[];
        customColors?: { primary?: string; secondary?: string; accent?: string };
        customGuidelines?: string;
      } = designPreferences;
      const parts: string[] = [];
      if (prefs.theme) parts.push(`Theme: ${prefs.theme}`);
      if (prefs.typography) parts.push(`Typography: ${prefs.typography}`);
      if (prefs.palette) parts.push(`Color Palette: ${prefs.palette}`);
      if (prefs.libraries?.length) parts.push(`Libraries: ${prefs.libraries.join(', ')}`);
      if (prefs.customColors?.primary) parts.push(`Primary Color: ${prefs.customColors.primary}`);
      if (prefs.customColors?.secondary) parts.push(`Secondary Color: ${prefs.customColors.secondary}`);
      if (prefs.customColors?.accent) parts.push(`Accent Color: ${prefs.customColors.accent}`);
      if (prefs.customGuidelines) parts.push(`Custom Guidelines: ${prefs.customGuidelines}`);

      if (parts.length > 0) {
        designPrefText = `\n\nDESIGN PREFERENCES (apply these to the generated folio):\n${parts.map((p) => `- ${p}`).join('\n')}`;
      }
    }

    const context: AIPromptContext = {
      projectTitle: 'New Folio',
      projectDescription: userPrompt.slice(0, 120),
      pageContext: 'New Folio Creation',
      currentFiles: {}, // Empty — this is a brand-new folio
      systemInstruction:
        FOLIO_CREATION_SYSTEM_PROMPT + designPrefText,
      chatHistoryText: '',
      attachmentsText: '',
      apiKey: clientApiKey,
    };

    // ── 4. Call AI ──────────────────────────────────────────────────

    const provider = AIFactory.getProvider(effectiveModel);
    const aiResponse = await provider.generateCompletion(userPrompt, context);

    const updatedFiles = aiResponse.updatedFiles || [];

    // ── 5. Parse AI response ────────────────────────────────────────

    // Extract metadata from _meta.json file (primary path)
    const metaFile = updatedFiles.find((f) => f.filename === '_meta.json');
    let meta: { title: string; projectMode: string; description: string };

    if (metaFile?.code) {
      try {
        const parsed = JSON.parse(metaFile.code.trim());
        meta = {
          title: parsed.title || '',
          projectMode: parsed.projectMode || '',
          description: parsed.description || '',
        };
      } catch {
        // _meta.json existed but was unparseable — fall back to explanation
        console.warn(
          'ai-create: _meta.json parse failed, falling back to explanation extraction'
        );
        meta = extractMetaFromExplanation(aiResponse.explanation, userPrompt);
      }
    } else {
      // No _meta.json file — extract from explanation
      meta = extractMetaFromExplanation(aiResponse.explanation, userPrompt);
    }

    // Extract HTML from index.html file
    const indexFile = updatedFiles.find((f) => f.filename === 'index.html');
    const htmlContent = (indexFile?.code || '').trim();

    if (!htmlContent) {
      return NextResponse.json(
        { error: 'AI failed to generate HTML content. Please try again with a more specific prompt.' },
        { status: 500 }
      );
    }

    // Validate and sanitize metadata
    // Caller-provided title wins over AI extraction
    const title = (callerTitle && typeof callerTitle === 'string' && callerTitle.trim())
      || meta.title?.trim()
      || userPrompt.slice(0, 50);
    const projectMode = (
      VALID_PROJECT_MODES.includes(meta.projectMode as (typeof VALID_PROJECT_MODES)[number])
        ? meta.projectMode
        : 'document'
    ) as HTMLFile['projectMode'];
    const description = meta.description?.trim() || userPrompt.slice(0, 120);

    // ── 6. Create the folio ─────────────────────────────────────────

    const cleanId = Math.random().toString(36).substring(2, 9);

    // Storage quota enforcement (Cloud only)
    if (!isOSS && userId && orgId) {
      const estimatedBytes = Buffer.byteLength(htmlContent, 'utf8');
      const { allowed } = await assertStorageQuota(userId, estimatedBytes, orgId);
      if (!allowed) {
        return NextResponse.json(
          {
            error: 'STORAGE_EXCEEDED',
            message:
              'You have exceeded your storage limit. Upgrade your plan to continue creating folios.',
          },
          { status: 402 }
        );
      }
    }

    const slug = slugifyFolioTitle(title);
    const newProject: HTMLFile = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cloud inserts omit id so Postgres gen_random_uuid fills it
      id: isOSS ? cleanId : (undefined as any), // DB gen_random_uuid in cloud
      title: title,
      slug,
      description: description,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isPrivate: isPrivate ?? false,
      accessKey: accessKey || undefined,
      allowComments: allowComments ?? true,
      presentationModeOnly: presentationModeOnly ?? false,
      collaborators: [],
      comments: [],
      status: body.status || 'draft',
      projectMode,
      designPreferences: designPreferences || undefined,
      referenceFiles: referenceFiles || [],
      paidAccess: paidAccess !== undefined && paidAccess !== null ? sanitizedPaidAccess : undefined,
      listing: sanitizedListing ?? undefined,
      projectId: projectId || null,
      versions: [
        {
          versionId: 'v1',
          commitMessage: `AI-generated ${projectMode}: ${title}`,
          createdAt: new Date().toISOString(),
          author: email || 'LiveFolio AI',
          files: { 'index.html': htmlContent },
        },
      ],
    };

    if (isOSS) {
      await runTransaction(async (db) => {
        db.push(newProject);
      });

      return NextResponse.json(
        {
          project: {
            id: newProject.id,
            title,
            description,
            projectMode,
            createdAt: newProject.createdAt,
          },
        },
        { status: 201 }
      );
    }

    // Cloud Mode

    if (!supabaseAdmin) {
      return NextResponse.json(
        {
          error: 'Supabase client is not initialized.',
          message:
            'Please make sure that NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in your local .env file when running in cloud/SaaS mode.',
        },
        { status: 500 }
      );
    }

    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dbRecord = transformToFolioRecord(newProject, orgId);
    delete dbRecord.id; // Let Postgres generate UUID

    // Attribute folio to the creating user for per-user storage accounting
    if (userId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- created_by column is not part of Partial<FolioRecord> but is set server-side for usage attribution
      (dbRecord as any).created_by = userId;
    }

    const { data, error } = await supabaseAdmin
      .from('folios')
      .insert(dbRecord)
      .select()
      .single();

    if (error) throw error;

    const created = transformFolioRecord(data);

    return NextResponse.json(
      {
        project: {
          id: created.id,
          title,
          description,
          projectMode,
          createdAt: created.createdAt,
        },
      },
      { status: 201 }
    );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catch-all handler: err may be any thrown value; only logged
  } catch (err: any) {
    console.error('AI folio creation error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
