#!/usr/bin/env node
/**
 * P3-T00 — Standalone release build (workstream B: one-command OSS install).
 *
 * Builds the app with the ENV-GATED standalone output (`LIVEFOLIO_STANDALONE=1`,
 * see next.config.mjs) and assembles:
 *
 *   dist/livefolio-standalone-<version>.tar.gz
 *
 * containing:
 *   .next/standalone/   traced server + node_modules (boot with `node server.js`)
 *   .next/static/       build-time static assets (copied into standalone at boot)
 *   public/             public assets (copied into standalone at boot)
 *   start.sh            one-command boot (LIVEFOLIO_DATA_DIR default ./data, PORT default 3000)
 *
 * The default build (cloud/Render, verify_local, `npm run build`) is untouched:
 * the gate in next.config.mjs only activates when this script sets the env var.
 *
 * Usage:
 *   node bin/package-standalone.js                # version from package.json
 *   LIVEFOLIO_VERSION=0.1.0 node bin/package-standalone.js   # override tag version
 */

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS CLI script; require() is the runtime module system here */
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = process.env.LIVEFOLIO_VERSION || pkg.version;

const TARBALL = path.join(OUT_DIR, `livefolio-standalone-${VERSION}.tar.gz`);

// P3-T04 — request-body clamp. Next's auto-generated standalone server bakes
// the default 10 MB proxyClientMaxBodySize into its runtime config; the dev
// server.ts overrides to 50 MB at boot (server.ts:27) but the standalone
// server.js cannot. We patch the staged copy at package time (see §2.6) and
// re-verify the tarball below. 10485760 = 10 MiB, 52428800 = 50 MiB.
const CLAMP_10MB = '"proxyClientMaxBodySize":10485760';
const CLAMP_50MB = '"proxyClientMaxBodySize":52428800';

function fail(msg) {
  console.error(`[package-standalone] ERROR: ${msg}`);
  process.exit(1);
}

function run(cmd, env = {}) {
  console.log(`[package-standalone] $ ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isSymbolicLink()) {
      fs.symlinkSync(fs.readlinkSync(s), d);
    } else fs.copyFileSync(s, d);
  }
}

console.log(`[package-standalone] LiveFolio standalone packaging v${VERSION}`);
console.log(`[package-standalone] root: ${ROOT}`);

// ---------------------------------------------------------------------------
// 1. Standalone build (env-gated in next.config.mjs)
// ---------------------------------------------------------------------------
// Build env policy for the OSS release tarball:
//   - LIVEFOLIO_STANDALONE=1            activates the standalone output gate
//   - NEXT_PUBLIC_APP_ENV=oss           the app defaults to CLOUD in production
//                                       (middleware.ts: isCloud = rawEnv ? rawEnv==='cloud'
//                                       : NODE_ENV==='production'); the OSS install must
//                                       explicitly opt in, at build AND runtime
//   - all other NEXT_PUBLIC_* blanked   the repo .env carries real cloud keys
//                                       (NEXT_PUBLIC_SUPABASE_URL/ANON_KEY, PostHog,
//                                       GA…); NEXT_PUBLIC_* are inlined at build time,
//                                       so blanking prevents them from leaking into the
//                                       tarball. Server-side keys are never inlined and
//                                       are pruned from the payload (.env).
const buildEnv = {
  LIVEFOLIO_STANDALONE: '1',
  NEXT_PUBLIC_APP_ENV: 'oss',
};
for (const key of Object.keys(process.env)) {
  if (key.startsWith('NEXT_PUBLIC_') && !(key in buildEnv)) buildEnv[key] = '';
}
// P3-T04 — stale-.next guard: a default `next build` before a packager run can
// leave a stale trace that fails the packager mid-stage ("missing
// status/page.js", P3-T03 flake). Always build from a clean .next/.
const nextDir = path.join(ROOT, '.next');
if (fs.existsSync(nextDir)) {
  console.log('[package-standalone] clearing stale .next/ before build (stale-trace guard)');
  fs.rmSync(nextDir, { recursive: true, force: true });
}
run('npx next build', buildEnv);

const STANDALONE_DIR = path.join(ROOT, '.next', 'standalone');
const STATIC_DIR = path.join(ROOT, '.next', 'static');
const PUBLIC_DIR = path.join(ROOT, 'public');

for (const [label, p] of [['.next/standalone', STANDALONE_DIR], ['.next/static', STATIC_DIR], ['public', PUBLIC_DIR]]) {
  if (!fs.existsSync(p)) fail(`missing required build output: ${label} (${p})`);
}
if (!fs.existsSync(path.join(STANDALONE_DIR, 'server.js'))) {
  fail('standalone server missing: .next/standalone/server.js');
}

// ---------------------------------------------------------------------------
// 2. Stage the payload
// ---------------------------------------------------------------------------
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'livefolio-standalone-'));
console.log(`[package-standalone] staging in ${stage}`);
try {
  copyDir(STANDALONE_DIR, path.join(stage, '.next', 'standalone'));
  copyDir(STATIC_DIR, path.join(stage, '.next', 'static'));
  if (fs.existsSync(PUBLIC_DIR)) copyDir(PUBLIC_DIR, path.join(stage, 'public'));

  // -------------------------------------------------------------------------
  // 2.5 Prune tracer junk — Next's output tracing over-includes files that are
  // read dynamically from process.cwd() (lib/db.ts, app/api/*, dotenv). The
  // staged standalone would otherwise ship LOCAL SECRETS AND USER DATA:
  //   - .env*                      real API keys (GEMINI_API_KEY, LIVEFOLIO_API_KEY…)
  //   - database*.json (+ locks)   local flat-file DB contents
  //   - settings.json              runtime secrets (MCP keys, tunnel config)
  //   - localhost.har              network capture
  // Only entries that are demonstrably NOT read by runtime app code are pruned
  // (verified: the only cwd-based dir reads at runtime are design-systems/ and
  // content/docs, both kept). Everything else the tracer included stays.
  // -------------------------------------------------------------------------
  const PRUNE_PATTERNS = [
    /^\.env($|\.)/, // any dotenv variant
    /^database.*\.json(\.lock)?$/, // local flat-file DBs + locks
    /^settings\.json$/, // runtime secrets
    /^localhost\.har$/, // network capture
    /^ghostty$/, // local terminal config
    /^recovered_.*\.txt$/, // crash recovery scratch
    /^tsconfig\.tsbuildinfo$/,
    /^package-lock\.json$/,
    /^out$/, // stale static-export dir
    /^dist$/, // previous tarballs (self-referential bloat if re-packaging)
  ];
  const standaloneStage = path.join(stage, '.next', 'standalone');
  let pruned = 0;
  for (const entry of fs.readdirSync(standaloneStage)) {
    if (PRUNE_PATTERNS.some((re) => re.test(entry))) {
      fs.rmSync(path.join(standaloneStage, entry), { recursive: true, force: true });
      console.log(`[package-standalone] pruned traced junk: ${entry}`);
      pruned++;
    }
  }
  if (pruned === 0) {
    console.log('[package-standalone] note: no traced junk to prune');
  }

  // -------------------------------------------------------------------------
  // 2.6 50 MB body clamp — Next's auto-generated standalone server bakes the
  // default 10 MB proxyClientMaxBodySize into its runtime config. The dev
  // server.ts overrides to 50 MB at boot (server.ts:27); the standalone
  // server.js cannot. Live-confirmed (P3-T01 report): an 11 MB folio create →
  // HTTP 500 "Unterminated string in JSON at position 10485760"; an 11.5 MB
  // upload-batch → 500. Patch the staged copy so every installed tarball
  // matches the 50 MB dev limit. Hard-fail if the clamp moved, rather than
  // silently shipping a 10 MB ceiling.
  // -------------------------------------------------------------------------
  const stagedServerJs = path.join(standaloneStage, 'server.js');
  const stagedServerSrc = fs.readFileSync(stagedServerJs, 'utf8');
  if (!stagedServerSrc.includes(CLAMP_10MB)) {
    fail(`unexpected standalone server.js: 10 MB clamp (${CLAMP_10MB}) not found — cannot patch to 50 MB`);
  }
  fs.writeFileSync(stagedServerJs, stagedServerSrc.split(CLAMP_10MB).join(CLAMP_50MB));
  console.log('[package-standalone] patched staged server.js: proxyClientMaxBodySize 10 MB -> 50 MB');

  // -------------------------------------------------------------------------
  // 3. start.sh — one-command boot
  // -------------------------------------------------------------------------
  const startSh = `#!/usr/bin/env bash
# LiveFolio standalone boot (P3-T00 — one-command OSS install).
#
# Environment:
#   LIVEFOLIO_DATA_DIR  where database.json + folio assets live (default: ./data)
#   PORT                HTTP port (default: 3000)
#   LIVEFOLIO_HOSTNAME  bind address (default: 0.0.0.0)
#
# Note: lib/db.ts resolves database.json as <process.cwd()>/database.json.
# The server is launched with the data dir as the working directory so the
# flat-file DB and asset store land there; if the standalone server re-chdirs
# to its own directory, the files fall back to .next/standalone/ (see report).
set -euo pipefail

APP_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="\${LIVEFOLIO_DATA_DIR:-$APP_DIR/data}"
PORT="\${PORT:-3000}"
# macOS/bash pre-set \$HOSTNAME (e.g. "MacBookAir.lan") in interactive shells —
# never bind to that; use 0.0.0.0 unless the user explicitly opts in.
HOSTNAME="\${LIVEFOLIO_HOSTNAME:-0.0.0.0}"

mkdir -p "$DATA_DIR"
mkdir -p "$APP_DIR/.next/standalone/.next" "$APP_DIR/.next/standalone/public"

# Make build-time static + public assets servable by the standalone server.
cp -Rf "$APP_DIR/.next/static/." "$APP_DIR/.next/standalone/.next/static/" 2>/dev/null || true
cp -Rf "$APP_DIR/public/." "$APP_DIR/.next/standalone/public/" 2>/dev/null || true

echo "[livefolio] data dir: $DATA_DIR"
echo "[livefolio] http:     http://$HOSTNAME:$PORT"
echo "[livefolio] mcp:      http://$HOSTNAME:$PORT/api/mcp"

# The edge middleware reads NEXT_PUBLIC_APP_ENV at runtime and defaults to CLOUD
# in production (middleware.ts). Force OSS unless the user opts into cloud.
export NEXT_PUBLIC_APP_ENV="\${NEXT_PUBLIC_APP_ENV:-oss}"
export PORT HOSTNAME
cd "$DATA_DIR"
exec node "$APP_DIR/.next/standalone/server.js"
`;
  fs.writeFileSync(path.join(stage, 'start.sh'), startSh, { mode: 0o755 });

  // -------------------------------------------------------------------------
  // 4. Tar it up
  // -------------------------------------------------------------------------
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (fs.existsSync(TARBALL)) fs.rmSync(TARBALL);
  run(`tar -czf "${TARBALL}" -C "${stage}" .next public start.sh`);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}

const sizeMb = (fs.statSync(TARBALL).size / 1024 / 1024).toFixed(1);
console.log(`[package-standalone] wrote ${TARBALL} (${sizeMb} MB)`);
console.log('[package-standalone] contents (first 12):');
execSync(`tar -tzf "${TARBALL}" | head -12`, { stdio: 'inherit' });

// Sanity gate: no secrets / local data may ship inside the tarball.
const listing = execSync(`tar -tzf "${TARBALL}"`, { encoding: 'utf8' });
const junk = listing
  .split('\n')
  .filter((line) => /(^|\/)\.env($|\.)|database.*\.json|settings\.json|localhost\.har/.test(line));
if (junk.length) {
  console.error(`[package-standalone] FAIL: tarball contains traced junk:\n${junk.join('\n')}`);
  process.exit(1);
}
console.log('[package-standalone] tarball clean: no .env / database*.json / settings.json / localhost.har');

// P3-T04 — verify the 50 MB body clamp actually shipped inside the tarball
// (guards against a future Next version relocating or renaming the key).
const tarballServerJs = execSync(`tar -xzOf "${TARBALL}" .next/standalone/server.js`, { encoding: 'utf8' });
if (!tarballServerJs.includes(CLAMP_50MB) || tarballServerJs.includes(CLAMP_10MB)) {
  console.error('[package-standalone] FAIL: tarball server.js missing the 50 MB body clamp (52428800)');
  process.exit(1);
}
console.log('[package-standalone] tarball server.js: proxyClientMaxBodySize = 52428800 (50 MB) — clamp verified');
console.log('[package-standalone] done.');
