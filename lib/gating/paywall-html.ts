import { PaidAccessConfig } from './types';

const DEFAULT_ACCENT = '#FF3B00';

export function priceLabel(config: PaidAccessConfig): string {
  const amount = (config.amountCents / 100).toFixed(2).replace(/\.00$/, '');
  const symbol = config.currency === 'usd' ? '$' : config.currency === 'eur' ? '€' : '£';
  if (config.priceType === 'rental') {
    const day = config.rentalDays === 1 ? 'day' : 'days';
    return `${symbol}${amount} for ${config.rentalDays} ${day}`;
  }
  if (config.priceType === 'subscription') {
    return `${symbol}${amount}/${config.interval === 'year' ? 'year' : 'month'}`;
  }
  return `One-time ${symbol}${amount}`;
}

/**
 * Full-bleed lock page for direct raw-route hits by non-paying visitors
 * (crawlers, curl, the iframe before the parent paywall swaps in).
 * Self-contained: inline styles only, no external assets.
 */
export function paywall403Html(config: PaidAccessConfig, accent?: string): string {
  const a = accent || DEFAULT_ACCENT;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Paid folio</title>
<style>
  body { margin: 0; background: #F4F4F0; color: #0F0F0D; font-family: system-ui, -apple-system, sans-serif;
         display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .box { max-width: 420px; padding: 40px 36px; text-align: center; }
  .lock { width: 44px; height: 44px; border-radius: 12px; background: ${a}; display: inline-flex;
          align-items: center; justify-content: center; }
  .lock svg { width: 22px; height: 22px; }
  h1 { font-size: 22px; letter-spacing: -0.02em; margin: 20px 0 8px; }
  .price { display: inline-block; font-size: 15px; font-weight: 600; padding: 6px 14px;
           border: 1.5px solid ${a}; border-radius: 999px; margin-top: 4px; }
  p { font-size: 13px; color: #6b7280; line-height: 1.5; margin-top: 16px; }
</style>
</head>
<body>
<div class="box">
  <span class="lock"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></span>
  <h1>This folio is paid</h1>
  <span class="price">${priceLabel(config)}</span>
  <p>Open the share link in your browser to purchase access.<br>Already purchased? Sign in with the account you used.</p>
</div>
</body>
</html>`;
}

/**
 * First-page preview clip for long single-page folios: freeze scrolling and
 * pin an unlock banner at the bottom. Injected server-side (same precedent as
 * the free-plan watermark). The PARENT viewer renders the real CTA — the
 * sandboxed iframe cannot navigate top.
 */
export function injectFirstPageClip(html: string, config: PaidAccessConfig, accent?: string): string {
  const a = accent || DEFAULT_ACCENT;
  const clip = `<style id="lf-preview-clip">body{overflow:hidden !important;height:100vh !important;} #lf-unlock-banner{position:fixed;left:0;right:0;bottom:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;gap:8px;padding:14px 16px;background:rgba(15,15,13,.92);color:#fff;font-family:system-ui,-apple-system,sans-serif;font-size:14px;backdrop-filter:blur(6px);} #lf-unlock-banner .lf-badge{background:${a};border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600;}</style>
<div id="lf-unlock-banner" aria-hidden="true"><span class="lf-badge">PREVIEW</span><span>Unlock the full folio — ${priceLabel(config)}</span></div>`;

  if (html.includes('</body>')) {
    return html.replace('</body>', `${clip}
</body>`);
  }
  return html + clip;
}

