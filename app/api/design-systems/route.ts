import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

// XML character escaping helper to prevent malformed SVG XML parses (e.g. from '&' in names/categories)
function escapeXml(unsafe: string): string {
  if (!unsafe) return '';
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

// Dynamic premium SVG gradient thumbnail generator (Fully compatible with all strict browser image decoders inside img tags)
function generateSvgThumbnail(id: string, name: string, category: string) {
  const cleanName = escapeXml(name);
  const cleanCategory = escapeXml(category || 'SYSTEM DESIGN');

  // Create an extremely safe alphanumeric ID for SVG refs and gradients (must start with letter, no symbols)
  const safeId = 'ds_' + id.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

  // Hash the ID to get unique but consistent colors
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h1 = Math.abs(hash) % 360;
  const h2 = (h1 + 60) % 360;
  const s1 = 75 + (Math.abs(hash >> 1) % 15); // 75-90%
  const s2 = 80 + (Math.abs(hash >> 2) % 15); // 80-95%
  const l1 = 45 + (Math.abs(hash >> 3) % 10); // 45-55%
  const l2 = 25 + (Math.abs(hash >> 4) % 15); // 25-40%

  // Build a spectacular modern SVG thumbnail inline without complex CSS filters (e.g. feGaussianBlur)
  // to ensure 100% reliable rendering in all browsers (Safari/Chrome/Firefox) when loaded inside <img> tags.
  // Ambient glow is achieved beautifully using highly compatible radial gradients with opacity stops.
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200" width="300" height="200">
      <defs>
        <!-- Linear gradient for UI card wireframe accents -->
        <linearGradient id="g_${safeId}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="hsl(${h1}, ${s1}%, ${l1}%)" />
          <stop offset="100%" stop-color="hsl(${h2}, ${s2}%, ${l2}%)" />
        </linearGradient>
        <!-- Radial gradient simulating soft blurred glow background - 100% compatible with <img> tags -->
        <radialGradient id="glow_${safeId}" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="hsl(${h1}, ${s1}%, ${l1}%)" stop-opacity="0.65" />
          <stop offset="100%" stop-color="hsl(${h2}, ${s2}%, ${l2}%)" stop-opacity="0" />
        </radialGradient>
      </defs>
      
      <!-- Deep luxury dark backdrop -->
      <rect width="100%" height="100%" fill="#090a10" />
      
      <!-- Glow ambient background sphere (perfect blur simulation) -->
      <circle cx="150" cy="100" r="110" fill="url(#glow_${safeId})" />
      
      <!-- Tech grid decoration -->
      <g opacity="0.06">
        <line x1="0" y1="40" x2="300" y2="40" stroke="#ffffff" stroke-width="0.5" />
        <line x1="0" y1="80" x2="300" y2="80" stroke="#ffffff" stroke-width="0.5" />
        <line x1="0" y1="120" x2="300" y2="120" stroke="#ffffff" stroke-width="0.5" />
        <line x1="0" y1="160" x2="300" y2="160" stroke="#ffffff" stroke-width="0.5" />
        <line x1="60" y1="0" x2="60" y2="200" stroke="#ffffff" stroke-width="0.5" />
        <line x1="120" y1="0" x2="120" y2="200" stroke="#ffffff" stroke-width="0.5" />
        <line x1="180" y1="0" x2="180" y2="200" stroke="#ffffff" stroke-width="0.5" />
        <line x1="240" y1="0" x2="240" y2="200" stroke="#ffffff" stroke-width="0.5" />
      </g>
      
      <!-- Sleek outer floating card bounds -->
      <rect x="12" y="12" width="276" height="176" rx="16" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="1.5" />
      
      <!-- Inner frosted card surface -->
      <rect x="24" y="24" width="252" height="152" rx="12" fill="#0c0d14" fill-opacity="0.65" stroke="#ffffff" stroke-opacity="0.04" stroke-width="1" />
      
      <!-- Visual elements simulating a dashboard/wireframe UI -->
      <rect x="42" y="42" width="32" height="32" rx="8" fill="url(#g_${safeId})" opacity="0.9" />
      <circle cx="236" cy="58" r="12" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.15" stroke-width="1" />
      <rect x="86" y="46" width="120" height="9" rx="4.5" fill="#ffffff" fill-opacity="0.9" />
      <rect x="86" y="62" width="70" height="6.5" rx="3" fill="#ffffff" fill-opacity="0.45" />
      
      <!-- Subtle premium separator -->
      <line x1="42" y1="94" x2="258" y2="94" stroke="#ffffff" stroke-opacity="0.08" stroke-width="1" />
      
      <!-- Title & Category typography elements -->
      <text x="42" y="132" font-family="-apple-system, system-ui, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="14" font-weight="900" fill="#ffffff" letter-spacing="-0.02em">${cleanName}</text>
      <text x="42" y="152" font-family="-apple-system, system-ui, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="8.5" font-weight="800" fill="#ffffff" fill-opacity="0.45" letter-spacing="0.08em" text-transform="uppercase">${cleanCategory}</text>
    </svg>
  `.trim().replace(/\s+/g, ' ');

  const base64 = Buffer.from(svg).toString('base64');
  return `data:image/svg+xml;base64,${base64}`;
}

export async function GET() {
  try {
    const dsPath = path.join(process.cwd(), 'design-systems');
    
    if (!fs.existsSync(dsPath)) {
      return NextResponse.json([]);
    }

    const folders = fs.readdirSync(dsPath);
    const systems = [];

    for (const folder of folders) {
      if (folder === '.DS_Store' || folder === 'README.md') continue;
      
      const folderPath = path.join(dsPath, folder);
      if (!fs.statSync(folderPath).isDirectory()) continue;

      const metadataPath = path.join(folderPath, 'metadata.json');
      const designMdPath = path.join(folderPath, 'DESIGN.md');

      if (fs.existsSync(metadataPath)) {
        // Option 1: metadata.json exists (pre-existing local styles)
        try {
          const content = fs.readFileSync(metadataPath, 'utf-8');
          const data = JSON.parse(content);
          if (data.thumbnail && (data.thumbnail.startsWith('https://images.unsplash.com') || data.thumbnail.includes('unsplash.com'))) {
            data.thumbnail = generateSvgThumbnail(data.id || folder, data.name, data.category);
          }
          systems.push(data);
        } catch (err) {
          console.error(`Error parsing metadata for ${folder}:`, err);
        }
      } else if (fs.existsSync(designMdPath)) {
        // Option 2: No metadata.json, but DESIGN.md exists (copied OpenDesign systems)
        try {
          const content = fs.readFileSync(designMdPath, 'utf-8');
          const lines = content.split('\n');
          
          // 1. Parse Title
          const titleLine = lines.find(l => l.startsWith('# '));
          let name = titleLine ? titleLine.replace('# ', '').trim() : folder;
          
          // Clean boilerplate brand names
          if (name.startsWith('Design System Inspired by ')) {
            name = name.replace('Design System Inspired by ', '').trim();
          }

          // 2. Parse Category
          const categoryLine = lines.find(l => l.includes('Category: '));
          let category = 'General';
          if (categoryLine) {
            const match = categoryLine.match(/Category:\s*([^\n\>]+)/);
            if (match && match[1]) {
              category = match[1].trim();
            }
          }

          // 3. Parse Description
          // Look for any blockquote line (> ) that isn't category or empty, to build a description
          const descLines = lines
            .filter(l => l.startsWith('>') && !l.includes('Category:'))
            .map(l => l.replace('>', '').trim())
            .filter(l => l.length > 0);
          
          const description = descLines.length > 0 
            ? descLines.join(' ') 
            : `Professional premium design guidelines tailored for ${name} styling and UX structures.`;

          const id = folder;
          const tags = [category, 'Premium', 'Clean'];
          const thumbnail = generateSvgThumbnail(id, name, category);

          systems.push({
            id,
            name,
            description,
            category,
            tags,
            thumbnail
          });
        } catch (err) {
          console.error(`Error parsing DESIGN.md for ${folder}:`, err);
        }
      }
    }

    // Sort systems: custom starters first, then others alphabetically
    systems.sort((a, b) => {
      const aIsStarter = a.category === 'Starter' || a.category === 'Creative' || a.category === 'Enterprise';
      const bIsStarter = b.category === 'Starter' || b.category === 'Creative' || b.category === 'Enterprise';
      
      if (aIsStarter && !bIsStarter) return -1;
      if (!aIsStarter && bIsStarter) return 1;
      
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json(systems, {
      headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- filesystem error shape is dynamic (err.message read below)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
