# Contributing to LiveFolio OSS

Thanks for your interest in contributing! LiveFolio is a local-first platform for hosting, versioning, and sharing AI-generated HTML documents.

## Development Setup

```bash
git clone https://github.com/LiveFolio-Cloud/LiveFolio-oss.git
cd LiveFolio-oss
npm install
npm run dev   # starts on http://localhost:3001
```

**Zero configuration required.** LiveFolio OSS uses a flat-file JSON database and runs entirely locally. No API keys, no Supabase, no cloud services needed.

### Prerequisites
- Node.js 20+
- npm 10+

### Optional: AI Provider Keys
LiveFolio works out of the box with Ollama (free, local). For cloud AI providers, set API keys in Settings → AI Keys (stored in localStorage, never sent to a server).

## Project Structure

```
app/              # Next.js App Router pages
  studio/[id]/    # AI-powered HTML editor
  share/[id]/     # Public folio viewer
  dashboard/      # Project management
  docs/           # Documentation browser
components/       # Shared React components
  studio/         # Studio sub-components
  ui/             # UI primitives (Button, Card, Input, etc.)
lib/              # Server utilities
  ai/             # Multi-provider AI factory
  db.ts           # Dual-mode database (flat-file + Supabase)
design-systems/   # 141 portable design system specs
```

## Code Style

- **TypeScript** in strict mode — `npx tsc --noEmit` must pass
- **ESLint** — `npm run lint` must be clean
- **Tailwind CSS v4** — use utility classes, avoid inline styles
- **React 19** with App Router — server components preferred, `'use client'` only when needed
- Use `cn()` from `@/lib/utils` for conditional class merging

## Before Submitting

```bash
npx tsc --noEmit   # type-check
npm run lint        # lint
npm run build       # production build check
```

## Pull Request Process

1. Fork the repo and create a branch from `main`
2. Make your changes, following the code style above
3. Run the build/lint checks
4. Open a PR with a clear description of what changed and why
5. PRs that add new features should include documentation updates

## Reporting Bugs

Use the [Bug Report](https://github.com/LiveFolio-Cloud/LiveFolio-oss/issues/new?template=bug_report.yml) template. Include:
- What happened vs what you expected
- Steps to reproduce
- Environment (OS, Node version, browser)

## Feature Requests

Use the [Feature Request](https://github.com/LiveFolio-Cloud/LiveFolio-oss/issues/new?template=feature_request.yml) template. Describe the problem you're solving, not just the solution.

## Getting Help

- **Documentation:** `/docs` in the running app
- **MCP/Agent Guide:** `/docs/mcp-agent` — for AI agents publishing to LiveFolio
- **Self-Hosting Guide:** `/docs/self-hosting` — deployment and configuration
