import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { isOSS } from '@/lib/env';

const SETTINGS_FILE = path.join(process.cwd(), 'settings.json');

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isOSS) return NextResponse.json({ error: 'Settings API only available in OSS mode' }, { status: 403 });

  try {
    const current = fs.existsSync(SETTINGS_FILE) ? JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) : {};
    return NextResponse.json({
      ...current,
      hasOpenaiEnv: !!process.env.OPENAI_API_KEY,
      hasGeminiEnv: !!process.env.GEMINI_API_KEY,
      hasAnthropicEnv: !!process.env.ANTHROPIC_API_KEY,
      hasDeepseekEnv: !!process.env.DEEPSEEK_API_KEY
    }, {
      headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=300' },
    });
  } catch {
    return NextResponse.json({
      mcpKey: '',
      hasOpenaiEnv: !!process.env.OPENAI_API_KEY,
      hasGeminiEnv: !!process.env.GEMINI_API_KEY,
      hasAnthropicEnv: !!process.env.ANTHROPIC_API_KEY,
      hasDeepseekEnv: !!process.env.DEEPSEEK_API_KEY
    });
  }
}

export async function POST(request: Request) {
  if (!isOSS) return NextResponse.json({ error: 'Settings API only available in OSS mode' }, { status: 403 });

  try {
    const body = await request.json();
    const current = fs.existsSync(SETTINGS_FILE) ? JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) : {};
    const updated = { ...current, ...body };
    
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2));
    return NextResponse.json({ success: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fs/JSON errors expose .message at runtime
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
