import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { isCloud } from '@/lib/env';
import { resolveManagedModel } from '@/lib/ai/resolve-managed-model';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: Request) {
  try {
    const { provider, openaiKey, anthropicKey, geminiKey, deepseekKey, ollamaHost } = await request.json();

    const models: { id: string; name: string; provider: string }[] = [];

    // 1. Managed list - only returned in Cloud mode and if provider is explicitly 'managed'
    if (isCloud && provider === 'managed') {
      if (process.env.GEMINI_API_KEY) {
        models.push(
          { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'managed' },
          { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'managed' }
        );
      }
      if (process.env.OPENAI_API_KEY) {
        models.push(
          { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'managed' },
          { id: 'gpt-4o', name: 'GPT-4o', provider: 'managed' }
        );
      }
      if (process.env.ANTHROPIC_API_KEY) {
        models.push(
          { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'managed' },
          { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'managed' }
        );
      }
      if (process.env.DEEPSEEK_API_KEY) {
        models.push(
          { id: 'deepseek-chat', name: 'DeepSeek V3', provider: 'managed' },
          { id: 'deepseek-reasoner', name: 'DeepSeek R1', provider: 'managed' }
        );
      }
    }

    // 2. Local Ollama Models (returned in local, all_oss, or in OSS mode generally)
    if (!isCloud || provider === 'local' || provider === 'all_oss') {
      const host = ollamaHost || 'http://localhost:11434';
      try {
        const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.models)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Ollama /api/tags model entries are untyped JSON
            data.models.forEach((m: any) => {
              models.push({ id: m.name, name: m.name, provider: 'local' });
            });
          }
        }
      } catch (err) {
        // Only log if 'local' was explicitly requested, to avoid noise in 'all_oss' compile mode
        if (provider === 'local') {
          console.error('Ollama list models connection error:', err);
        }
      }
    }

    // 3. BYOK Models (returned in byok, all_oss, or in OSS mode generally)
    if (!isCloud || provider === 'byok' || provider === 'all_oss') {
      // OpenAI Models
      const finalOpenaiKey = openaiKey?.trim() || (!isCloud ? process.env.OPENAI_API_KEY : '');
      if (finalOpenaiKey && finalOpenaiKey.trim()) {
        try {
          const res = await fetch('https://api.openai.com/v1/models', {
            headers: {
              'Authorization': `Bearer ${finalOpenaiKey.trim()}`
            },
            signal: AbortSignal.timeout(5000)
          });
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data.data)) {
              data.data
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenAI /v1/models entries are untyped JSON
                .filter((m: any) => m.id.startsWith('gpt-') || m.id.startsWith('o1-') || m.id.startsWith('o3-'))
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenAI /v1/models entries are untyped JSON
                .forEach((m: any) => {
                  models.push({ id: m.id, name: m.id, provider: 'openai' });
                });
            }
          }
        } catch (err) {
          console.error('OpenAI list models error:', err);
        }
      }

      // Gemini Models
      const finalGeminiKey = geminiKey?.trim() || (!isCloud ? process.env.GEMINI_API_KEY : '');
      if (finalGeminiKey && finalGeminiKey.trim()) {
        try {
          const ai = new GoogleGenAI({ apiKey: finalGeminiKey.trim() });
          const response = await ai.models.list();
          
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GoogleGenAI list() returns heterogeneous untyped response shapes
          let modelList: any[] = [];
          if (Array.isArray(response)) {
            modelList = response;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response shape from GoogleGenAI is dynamic (page access below)
          } else if (response && Array.isArray((response as any).page)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response shape from GoogleGenAI is dynamic (page access below)
            modelList = (response as any).page;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response shape from GoogleGenAI is dynamic (async-iterator probe below)
          } else if (response && (Symbol.asyncIterator in response || (response as any)[Symbol.asyncIterator])) {
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- iterating a dynamic GoogleGenAI async response
              for await (const m of (response as any)) {
                modelList.push(m);
              }
            } catch (iterErr) {
              console.error('Failed to iterate Gemini response asyncIterator:', iterErr);
            }
          }

          if (modelList.length === 0 && response && typeof response === 'object') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response shape from GoogleGenAI is dynamic (models/data fallback below)
            const possibleArray = (response as any).models || (response as any).data;
            if (Array.isArray(possibleArray)) {
              modelList = possibleArray;
            }
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Gemini model descriptors are untyped response entries
          modelList.forEach((m: any) => {
            if (m && m.name) {
              const cleanId = m.name.startsWith('models/') ? m.name.substring(7) : m.name;
              const supportsGenerate = !m.supportedActions || m.supportedActions.includes('generateContent');
              const isUtility = cleanId.includes('embedding') || 
                               cleanId.includes('aqa') || 
                               cleanId.includes('classifier') || 
                               cleanId.includes('retrieval') || 
                               cleanId.includes('bidi') || 
                               cleanId.includes('verification');
              if (cleanId.includes('gemini') && supportsGenerate && !isUtility) {
                models.push({ id: cleanId, name: m.displayName || cleanId, provider: 'gemini' });
              }
            }
          });
        } catch (err) {
          console.error('Gemini list models error:', err);
        }
      }

      // Anthropic Models (Static fallback list as Anthropic has no public models API endpoint)
      const finalAnthropicKey = anthropicKey?.trim() || (!isCloud ? process.env.ANTHROPIC_API_KEY : '');
      if (finalAnthropicKey && finalAnthropicKey.trim()) {
        models.push(
          { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'anthropic' },
          { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic' },
          { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', provider: 'anthropic' }
        );
      }

      // DeepSeek Models (BYOK)
      const finalDeepseekKey = deepseekKey?.trim() || (!isCloud ? process.env.DEEPSEEK_API_KEY : '');
      if (finalDeepseekKey && finalDeepseekKey.trim()) {
        models.push(
          { id: 'deepseek-chat', name: 'DeepSeek V3', provider: 'deepseek' },
          { id: 'deepseek-reasoner', name: 'DeepSeek R1', provider: 'deepseek' }
        );
      }
    }

    return NextResponse.json({ success: true, models, defaultModel: isCloud ? (resolveManagedModel()?.model ?? null) : null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- thrown error shape is dynamic (err.message read below)
  } catch (err: any) {
    console.error('Model listing route error:', err);
    return NextResponse.json({ error: err.message || 'Failed to list models.' }, { status: 500 });
  }
}
