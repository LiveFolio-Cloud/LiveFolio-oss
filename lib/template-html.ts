// Shared HTML template generator for instant folio creation.
// Extracted here so webpack caches the strings once (not duplicated in
// dashboard + library bundles) and to keep the components lean.

const HTML_HEAD = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<script src="https://cdn.tailwindcss.com"><\/script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>body{font-family:Inter,sans-serif;background:#fafafa;color:#09090b;margin:0}</style>
</head>
<body class="min-h-screen">`;

const HTML_FOOT = '\n</body>\n</html>';

function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

function wrap(title: string, body: string): string {
  return HTML_HEAD.replace('<title></title>', `<title>${title}</title>`) + body + HTML_FOOT;
}

export function getTemplateHTML(
  title: string,
  description: string,
  mode: 'deck' | 'document' | 'spreadsheet' | 'dashboard' | 'infography'
): string {
  // Escape user-controlled values before interpolation (stored-XSS hygiene).
  title = escapeHtml(title);
  description = escapeHtml(description);
  switch (mode) {
    case 'deck':
      return wrap(title, `
<div class="snap-y snap-mandatory h-screen overflow-y-scroll">
  <section class="snap-start h-screen flex items-center justify-center bg-white"><div class="text-center"><h1 class="text-5xl font-bold">${title}</h1><p class="text-lg text-zinc-500 mt-4">${description}</p></div></section>
</div>`);

    case 'document':
      return wrap(title, `
<article class="max-w-3xl mx-auto px-6 py-16 space-y-8">
  <h1 class="text-4xl font-bold">${title}</h1>
  <p class="text-lg text-zinc-500">${description}</p>
</article>`);

    case 'spreadsheet':
      return wrap(title, `
<div class="max-w-5xl mx-auto p-6">
  <h1 class="text-2xl font-bold">${title}</h1>
  <p class="text-zinc-500">${description}</p>
  <table class="w-full border mt-4">
    <tr class="bg-zinc-100"><th class="p-2 border">#</th><th class="p-2 border">Item</th><th class="p-2 border">Value</th></tr>
    <tr><td class="p-2 border">1</td><td class="p-2 border">Sample</td><td class="p-2 border">$100</td></tr>
  </table>
</div>`);

    case 'dashboard':
      return wrap(title, `
<div class="max-w-6xl mx-auto p-6">
  <h1 class="text-2xl font-bold">${title}</h1>
  <div class="grid grid-cols-3 gap-4 mt-4">
    <div class="bg-white border p-4"><p class="text-sm text-zinc-400">Revenue</p><p class="text-2xl font-bold">$12.4k</p></div>
    <div class="bg-white border p-4"><p class="text-sm text-zinc-400">Users</p><p class="text-2xl font-bold">2,847</p></div>
    <div class="bg-white border p-4"><p class="text-sm text-zinc-400">Conv</p><p class="text-2xl font-bold">3.2%</p></div>
  </div>
</div>`);

    case 'infography':
      return wrap(title, `
<div class="max-w-5xl mx-auto">
  <!-- Hero masthead — data-journalism editorial style -->
  <section class="bg-[#1a1a1a] text-[#f0ece4] px-8 py-20">
    <p class="text-xs font-mono text-[#d4956a] uppercase tracking-[0.25em] mb-6">Data Story</p>
    <h1 class="text-5xl font-extrabold tracking-tight leading-tight max-w-2xl">${title}</h1>
    <p class="text-lg text-[#a8a49a] mt-4 max-w-xl leading-relaxed">${description}</p>
    <div class="flex gap-14 mt-12">
      <div><p class="text-4xl font-bold text-[#f0ece4]">87<span class="text-[#d4956a]">%</span></p><p class="text-xs text-[#706c64] uppercase tracking-widest mt-1">Adoption</p></div>
      <div><p class="text-4xl font-bold text-[#f0ece4]">3.2<span class="text-[#d4956a]">×</span></p><p class="text-xs text-[#706c64] uppercase tracking-widest mt-1">Growth</p></div>
      <div><p class="text-4xl font-bold text-[#f0ece4]">$2.4<span class="text-[#d4956a]">M</span></p><p class="text-xs text-[#706c64] uppercase tracking-widest mt-1">Revenue</p></div>
    </div>
  </section>
  <!-- Stat spotlight row -->
  <section class="grid grid-cols-1 md:grid-cols-3 px-6 py-16 gap-8">
    <div class="text-center">
      <p class="text-5xl font-extrabold text-[#1a1a1a]">+42<span class="text-[#d4956a]">%</span></p>
      <div class="w-12 h-[3px] bg-[#d4956a] mx-auto my-4"></div>
      <p class="text-sm text-zinc-500 leading-relaxed">Engagement uplift over baseline with the redesigned onboarding flow</p>
    </div>
    <div class="text-center">
      <p class="text-5xl font-extrabold text-[#1a1a1a]">120<span class="text-[#8b9d83]">ms</span></p>
      <div class="w-12 h-[3px] bg-[#8b9d83] mx-auto my-4"></div>
      <p class="text-sm text-zinc-500 leading-relaxed">Median response time across all API endpoints</p>
    </div>
    <div class="text-center">
      <p class="text-5xl font-extrabold text-[#1a1a1a]">14.8<span class="text-[#5b7fa5]">k</span></p>
      <div class="w-12 h-[3px] bg-[#5b7fa5] mx-auto my-4"></div>
      <p class="text-sm text-zinc-500 leading-relaxed">Active weekly contributors across the ecosystem</p>
    </div>
  </section>
  <!-- Timeline strip — dot + connector pattern -->
  <section class="bg-[#f7f5f0] px-6 py-16">
    <h2 class="text-center text-xs font-mono text-[#d4956a] uppercase tracking-[0.25em] mb-12">Key Milestones</h2>
    <div class="flex flex-col md:flex-row justify-center gap-0 max-w-3xl mx-auto">
      <div class="flex-1 text-center px-4 pb-8 relative">
        <div class="w-3 h-3 rounded-full bg-[#d4956a] mx-auto mb-4"></div>
        <p class="text-xs text-zinc-400 font-mono">Q1</p>
        <p class="font-bold text-[#1a1a1a] mt-1">Beta Launch</p>
        <p class="text-sm text-zinc-500 mt-2 leading-relaxed">Shipped closed beta to 200 design partners</p>
      </div>
      <div class="flex-1 text-center px-4 pb-8 relative">
        <div class="w-3 h-3 rounded-full bg-[#8b9d83] mx-auto mb-4"></div>
        <p class="text-xs text-zinc-400 font-mono">Q2</p>
        <p class="font-bold text-[#1a1a1a] mt-1">Public GA</p>
        <p class="text-sm text-zinc-500 mt-2 leading-relaxed">Opened to general availability with full feature set</p>
      </div>
      <div class="flex-1 text-center px-4 pb-8 relative">
        <div class="w-3 h-3 rounded-full bg-[#5b7fa5] mx-auto mb-4"></div>
        <p class="text-xs text-zinc-400 font-mono">Q3</p>
        <p class="font-bold text-[#1a1a1a] mt-1">Enterprise Tier</p>
        <p class="text-sm text-zinc-500 mt-2 leading-relaxed">Launched SSO, audit logs, and priority support</p>
      </div>
    </div>
  </section>
  <!-- Before/After — split panel without purple -->
  <section class="grid grid-cols-1 md:grid-cols-2 px-6 py-16">
    <div class="p-10 text-center bg-[#f7f5f0]">
      <p class="text-xs font-mono text-zinc-400 uppercase tracking-[0.2em]">Before</p>
      <p class="text-5xl font-extrabold text-zinc-300 mt-4">2.1<span class="text-base text-zinc-300">%</span></p>
      <p class="text-sm text-zinc-400 mt-3 leading-relaxed">Conversion rate with legacy checkout flow</p>
    </div>
    <div class="p-10 text-center bg-[#1a1a1a]">
      <p class="text-xs font-mono text-[#d4956a] uppercase tracking-[0.2em]">After</p>
      <p class="text-5xl font-extrabold text-[#f0ece4] mt-4">5.8<span class="text-base text-[#d4956a]">%</span></p>
      <p class="text-sm text-[#a8a49a] mt-3 leading-relaxed">Conversion rate with redesigned one-click checkout</p>
    </div>
  </section>
</div>`);

    default:
      return wrap(title, `<div class="min-h-screen flex items-center justify-center"><h1>${title}</h1></div>`);
  }
}
