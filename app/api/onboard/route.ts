import { NextResponse } from 'next/server';

/**
 * GET /api/onboard
 *
 * Detects a local Ollama installation for model onboarding.
 * The host is intentionally restricted to localhost/loopback — accepting an
 * arbitrary host would make this an unauthenticated SSRF primitive that
 * probes internal services.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawHost = searchParams.get('host') || 'http://localhost:11434';

  let host: URL;
  try {
    host = new URL(rawHost);
  } catch {
    return NextResponse.json({ running: false, models: [], reason: 'Invalid Ollama host.' });
  }

  // Only loopback hosts are allowed (Ollama runs on the same machine).
  const hostname = host.hostname.toLowerCase();
  const isLoopback =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1';
  if (!isLoopback || (host.protocol !== 'http:' && host.protocol !== 'https:')) {
    return NextResponse.json({ running: false, models: [], reason: 'Only localhost Ollama hosts are supported.' });
  }

  try {
    const res = await fetch(`${host.toString().replace(/\/$/, '')}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000), // 2-second timeout
    });

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json({
        running: true,
        models: data.models || [],
      });
    }

    return NextResponse.json({ running: false, models: [], reason: `Ollama returned status ${res.status}` });
  } catch {
    return NextResponse.json({
      running: false,
      models: [],
      reason: `Could not reach Ollama at ${host.toString()}.`,
    });
  }
}
