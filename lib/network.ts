/**
 * LiveFolio Network Boundaries Utility
 *
 * Used to identify if a request is local (localhost, private network, link-local)
 * or arriving via a public tunnel (Cloudflare Quick Tunnels, ngrok, etc.).
 */

/**
 * The PUBLIC origin a browser or AI client should be redirected to / given in
 * a link — e.g. "https://livefolio.cloud".
 *
 * NEVER derive this from request.url: behind the Render proxy a route
 * handler's request.url resolves to the server's internal bind address
 * (0.0.0.0:10000), so a redirect built from it sends users to a dead host.
 * Prefer NEXT_PUBLIC_APP_URL, then the forwarded headers (public), then the
 * Host header (already public on Render, and correct for local dev).
 */
export function getPublicOrigin(request?: { headers: Headers }): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
  if (base) return base;
  const proto = request?.headers.get('x-forwarded-proto') || 'http';
  const host = request?.headers.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

export function isLocalHost(host: string | null): boolean {
  if (!host) return false; // Fail closed: a missing Host header is NOT local

  const hostname = host.split(':')[0].toLowerCase();

  // 1. Loopback addresses
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '0.0.0.0'
  ) {
    return true;
  }

  // 2. Private IP networks (RFC 1918)
  // Class A: 10.0.0.0 - 10.255.255.255
  if (hostname.startsWith('10.')) {
    return true;
  }

  // Class B: 172.16.0.0 - 172.31.255.255
  if (hostname.startsWith('172.')) {
    const parts = hostname.split('.');
    if (parts.length >= 2) {
      const secondPart = parseInt(parts[1], 10);
      if (secondPart >= 16 && secondPart <= 31) {
        return true;
      }
    }
  }

  // Class C: 192.168.0.0 - 192.168.255.255
  if (hostname.startsWith('192.168.')) {
    return true;
  }

  // 3. Link-local addresses (RFC 3927)
  // 169.254.0.0 - 169.254.255.255
  if (hostname.startsWith('169.254.')) {
    return true;
  }

  return false;
}
