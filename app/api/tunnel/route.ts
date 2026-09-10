import { NextResponse } from 'next/server';
import { startTunnel, type Tunnel } from 'untun';
import fs from 'fs';
import path from 'path';
import { isOSS } from '@/lib/env';

const SETTINGS_FILE = path.join(process.cwd(), 'settings.json');

// Next.js hot reloads delete local global variables in development. Using globalThis prevents starting duplicate tunnels.
const globalWithTunnel = global as typeof globalThis & {
  activeTunnel?: Tunnel;
  activeUrl?: string | null;
};

export const dynamic = 'force-dynamic';

function getCustomTunnelUrl(): string {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      return data.customTunnelUrl || '';
    }
  } catch (err) {
    console.error('Error reading customTunnelUrl from settings:', err);
  }
  return '';
}

export async function GET() {
  if (!isOSS) {
    return NextResponse.json({ error: 'Tunnel API only available in OSS mode' }, { status: 403 });
  }

  return NextResponse.json({
    active: !!globalWithTunnel.activeTunnel,
    url: globalWithTunnel.activeUrl || null,
    customTunnelUrl: getCustomTunnelUrl(),
  });
}

export async function POST(request: Request) {
  if (!isOSS) {
    return NextResponse.json({ error: 'Tunnel API only available in OSS mode' }, { status: 403 });
  }

  try {
    const { action, customTunnelUrl } = await request.json();

    if (action === 'start') {
      if (globalWithTunnel.activeTunnel) {
        return NextResponse.json({ 
          success: true, 
          url: globalWithTunnel.activeUrl,
          message: 'Tunnel already running'
        });
      }

      // Dynamically extract host port to support cases where 3000 is occupied
      const host = request.headers.get('host') || 'localhost:3000';
      const portString = host.split(':')[1] || '3000';
      const localPort = parseInt(portString, 10) || 3000;

      // Start new untun tunnel targeting our active local port, auto-accepting Cloudflare terms
      const tunnel = await startTunnel({ port: localPort, acceptCloudflareNotice: true });
      if (!tunnel) {
        throw new Error('Failed to establish tunnel');
      }
      const url = await tunnel.getURL();

      globalWithTunnel.activeTunnel = tunnel;
      globalWithTunnel.activeUrl = url;

      return NextResponse.json({
        success: true,
        url: url
      });
    }

    if (action === 'stop') {
      if (globalWithTunnel.activeTunnel) {
        await globalWithTunnel.activeTunnel.close();
        globalWithTunnel.activeTunnel = undefined;
        globalWithTunnel.activeUrl = undefined;
      }
      return NextResponse.json({ success: true });
    }

    if (action === 'save_custom') {
      const current = fs.existsSync(SETTINGS_FILE) ? JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) : {};
      const updated = { ...current, customTunnelUrl: customTunnelUrl || '' };
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2));

      return NextResponse.json({ success: true, customTunnelUrl: updated.customTunnelUrl });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- request parsing and tunnel setup may throw non-Error values; .message is read defensively
  } catch (err: any) {
    console.error('Tunnel API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
