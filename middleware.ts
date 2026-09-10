import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isLocalHost } from '@/lib/network';

/**
 * LiveFolio Security and Auth Middleware
 * 
 * Functions:
 * 1. Air-Gapped Firewall: If the request is via a public tunnel (not local),
 *    restrict access to ONLY the public share and raw rendering routes.
 * 2. Simulation Identity (Cloud Mode): Implements high-fidelity dev headers.
 */
// Minimal HTML escaping for the air-gap shield page (reflected pathname).
const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));

export function middleware(request: NextRequest) {
  const host = request.headers.get('host');
  const pathname = request.nextUrl.pathname;
  const isCloud = process.env.NEXT_PUBLIC_APP_ENV === 'cloud';

  // 1. Air-Gapped Firewall for OSS public tunnels
  if (!isLocalHost(host)) {
    // List of regex patterns for allowed public resources
    const isAllowedPublicPath = 
      pathname.startsWith('/share/') ||
      pathname.startsWith('/api/raw/') ||
      pathname === '/api/mcp' ||
      pathname === '/api/files/' + pathname.split('/')[3] + '/public' || // matches /api/files/[id]/public
      pathname === '/api/files/' + pathname.split('/')[3] + '/comments' || // matches /api/files/[id]/comments
      pathname === '/api/files/' + pathname.split('/')[3] + '/reactions' || // matches /api/files/[id]/reactions
      pathname === '/api/files/' + pathname.split('/')[3] + '/analytics'; // matches /api/files/[id]/analytics

    if (!isAllowedPublicPath) {
      // API requests: Return clean JSON error
      if (pathname.startsWith('/api/')) {
        return new NextResponse(
          JSON.stringify({ 
            error: 'Access Denied: Administrative and system modification APIs are restricted to local access only.',
            security: 'ADMIN_AIR_GAP_ACTIVE'
          }),
          { 
            status: 403, 
            headers: { 'Content-Type': 'application/json' } 
          }
        );
      }

      // Page requests: Return a premium glassmorphic error page
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LiveFolio | Access Restricted</title>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Outfit:wght@700;800&display=swap" rel="stylesheet">
    <style>
        body {
            background-color: #09090b;
            color: #f4f4f5;
            font-family: 'Plus Jakarta Sans', sans-serif;
            min-height: 100vh;
            margin: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            position: relative;
        }
        /* Gradient light halos */
        .ambient-glow {
            position: absolute;
            top: -200px;
            left: 50%;
            transform: translateX(-50%);
            width: 600px;
            height: 600px;
            border-radius: 50%;
            background: radial-gradient(circle, rgba(99,102,241,0.15) 0%, rgba(139,92,246,0.05) 50%, transparent 100%);
            filter: blur(80px);
            pointer-events: none;
            z-index: 1;
        }
        .card {
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 24px;
            padding: 40px;
            max-width: 440px;
            width: 100%;
            text-align: center;
            backdrop-filter: blur(16px);
            box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
            z-index: 10;
            margin: 20px;
            box-sizing: border-box;
        }
        .shield-icon {
            width: 64px;
            height: 64px;
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.2);
            color: #ef4444;
            border-radius: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 24px auto;
            box-shadow: inset 0 2px 4px rgba(239,68,68,0.1);
        }
        h1 {
            font-family: 'Outfit', sans-serif;
            font-size: 22px;
            font-weight: 800;
            margin: 0 0 12px 0;
            letter-spacing: -0.02em;
            text-transform: uppercase;
            background: linear-gradient(135deg, #ffffff 0%, #a1a1aa 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        p {
            font-size: 13px;
            line-height: 1.6;
            color: #a1a1aa;
            margin: 0 0 24px 0;
            font-weight: 500;
        }
        .meta-box {
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.04);
            border-radius: 12px;
            padding: 14px 18px;
            text-align: left;
            font-family: monospace;
            font-size: 11px;
            color: #71717a;
            margin-bottom: 24px;
        }
        .meta-line {
            display: flex;
            justify-content: space-between;
            margin-bottom: 4px;
        }
        .meta-line:last-child {
            margin-bottom: 0;
        }
        .meta-label {
            color: #52525b;
        }
        .meta-value {
            color: #a1a1aa;
            word-break: break-all;
        }
        .footer-brand {
            font-size: 10px;
            font-weight: 800;
            color: #3f3f46;
            text-transform: uppercase;
            letter-spacing: 0.15em;
        }
    </style>
</head>
<body>
    <div class="ambient-glow"></div>
    <div class="card">
        <div class="shield-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        </div>
        <h1>Admin Shield Active</h1>
        <p>This public sharing tunnel is isolated. Editor dashboards, system settings, and local control panels cannot be accessed from the public internet.</p>
        <div class="meta-box">
            <div class="meta-line">
                <span class="meta-label">PATH</span>
                <span class="meta-value">${esc(pathname)}</span>
            </div>
            <div class="meta-line">
                <span class="meta-label">SOURCE</span>
                <span class="meta-value">${esc(host || 'unknown')}</span>
            </div>
            <div class="meta-line">
                <span class="meta-label">SECURITY</span>
                <span class="meta-value">ADMIN_AIR_GAP_ACTIVE</span>
            </div>
        </div>
        <div class="footer-brand">LiveFolio</div>
    </div>
</body>
</html>`;

      return new NextResponse(html, {
        status: 403,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
  }


  if (!isCloud) {
    return NextResponse.next();
  }

  // Only apply simulation to API routes and Studio/Dashboard (Cloud Mode)
  if (
    pathname.startsWith('/api') ||
    pathname.startsWith('/studio') ||
    pathname.startsWith('/dashboard')
  ) {
    const requestHeaders = new Headers(request.headers);

    // Simulate high-fidelity mock identity
    requestHeaders.set('x-user-id', 'dev-user-123');
    requestHeaders.set('x-user-email', 'architect@LiveFolio.app');
    requestHeaders.set('x-organization-id', '00000000-0000-0000-0000-000000000000');
    requestHeaders.set('x-user-role', 'Owner');

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (e.g. svg, png, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.png|.*\\.jpg|.*\\.svg|.*\\.css|.*\\.js).*)',
  ],
};
