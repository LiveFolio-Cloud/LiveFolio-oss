import { createServer, IncomingMessage, ServerResponse } from 'http';
import { parse } from 'url';
import next from 'next';
import fs from 'fs';
import path from 'path';

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

// Next.js in standalone mode (production build) loads config from the
// baked .next/required-server-files.json via __NEXT_PRIVATE_STANDALONE_CONFIG.
// Our custom server.ts must replicate the auto-generated server.js behavior,
// otherwise proxyClientMaxBodySize (and other runtime config) is silently
// ignored, clamping every request body to the 10 MB default.
const standaloneConfigPath = path.join(process.cwd(), '.next', 'required-server-files.json');
let standaloneConfig: Record<string, unknown> | null = null;
try {
  if (!dev && fs.existsSync(standaloneConfigPath)) {
    standaloneConfig = JSON.parse(fs.readFileSync(standaloneConfigPath, 'utf8'));
    if (standaloneConfig?.config) {
      // Override the body size limit at runtime — the build warns about
      // proxyClientMaxBodySize being unrecognized in 15.1 but the runtime
      // still respects the baked config value.
      (standaloneConfig.config as Record<string, unknown>).experimental = {
        ...((standaloneConfig.config as any)?.experimental || {}),
        proxyClientMaxBodySize: '50mb',
      };
      process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(standaloneConfig.config);
      console.log('[server] Injected proxyClientMaxBodySize: 50mb into standalone config');
    }
  }
} catch { /* config injection is best-effort; fall back to defaults */ }

const app = next({ dev, hostname, port, conf: standaloneConfig?.config as any });
const handle = app.getRequestHandler();

// Increase MaxListeners to accommodate concurrent lock-file signal handlers in dev mode
process.setMaxListeners(20);

// Guard against excessively large request bodies (global ceiling)
const MAX_BODY_SIZE = 40 * 1024 * 1024; // 40 MB

app.prepare().then(() => {
  createServer((req: IncomingMessage, res: ServerResponse) => {
    try {
      const contentLength = parseInt(req.headers['content-length'] || '0', 10);
      if (contentLength > MAX_BODY_SIZE) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'FOLIO_TOO_LARGE',
          message: `Request body is ${(contentLength / 1_000_000).toFixed(1)} MB. Maximum is ${MAX_BODY_SIZE / 1_000_000} MB.`,
        }));
        return;
      }

      const parsedUrl = parse(req.url || '', true);
      handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  })
    .once('error', (err: Error) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
    });
}).catch((err) => {
  console.error('Failed to prepare Next.js app:', err);
  process.exit(1);
});
