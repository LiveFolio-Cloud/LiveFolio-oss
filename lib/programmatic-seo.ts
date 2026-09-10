/* -------------------------------------------------------------------------- */
/* Programmatic SEO Pages                                                      */
/*                                                                              */
/* Generate SEO-optimized pages at scale using templates and data:             */
/*   /templates/[slug]     — template showcase pages                          */
/*   /integrations/[slug]  — integration detail pages                         */
/*                                                                              */
/* Pages include JSON-LD structured data and auto-generated sitemaps.        */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export interface SEOPage {
  slug: string;
  title: string;
  description: string;
  heading: string;
  /** Template-specific content */
  body: string;
  /** JSON-LD structured data */
  structuredData: Record<string, unknown>;
  /** Keywords for meta tags */
  keywords: string[];
  /** Last modified date */
  updatedAt: string;
}

export interface TemplateSEOData {
  slug: string;
  name: string;
  description: string;
  useCase: string;
  category: 'portfolio' | 'documentation' | 'presentation' | 'report' | 'landing';
  features: string[];
}

export interface IntegrationSEOData {
  slug: string;
  name: string;
  description: string;
  logo: string;
  category: string;
  setupGuide: string;
}

/* -------------------------------------------------------------------------- */
/* Template Page Generator                                                     */
/* -------------------------------------------------------------------------- */

const BASE_URL = 'https://livefolio.com';

export function generateTemplatePage(data: TemplateSEOData): SEOPage {
  const title = `${data.name} Template — Create Beautiful ${data.category} Folios | LiveFolio`;
  const description = `${data.description} Use our AI-powered ${data.name.toLowerCase()} template to publish interactive ${data.category} folios in seconds. No coding required.`;

  return {
    slug: `templates/${data.slug}`,
    title,
    description,
    heading: `${data.name} Template`,
    body: data.useCase,
    keywords: [data.name, 'template', data.category, 'folio', 'AI publishing', ...data.features],
    updatedAt: new Date().toISOString(),
    structuredData: {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: `LiveFolio ${data.name} Template`,
      description: data.description,
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Web',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Integration Page Generator                                                  */
/* -------------------------------------------------------------------------- */

export function generateIntegrationPage(data: IntegrationSEOData): SEOPage {
  const title = `LiveFolio + ${data.name} — ${data.category} Integration`;
  const description = `Connect LiveFolio with ${data.name}. ${data.description} Publish interactive folios from your ${data.category} workflow.`;

  return {
    slug: `integrations/${data.slug}`,
    title,
    description,
    heading: `LiveFolio × ${data.name}`,
    body: data.setupGuide,
    keywords: [data.name, 'integration', data.category, 'LiveFolio', 'AI', 'MCP'],
    updatedAt: new Date().toISOString(),
    structuredData: {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: `LiveFolio ${data.name} Integration`,
      description: data.description,
      applicationCategory: 'DeveloperApplication',
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Sitemap Generator                                                           */
/* -------------------------------------------------------------------------- */

export function generateSitemapXML(
  staticPages: string[],
  seoPages: SEOPage[]
): string {
  const entries = [
    ...staticPages.map((path) => ({
      url: `${BASE_URL}${path}`,
      changefreq: 'weekly',
      priority: '0.8',
    })),
    ...seoPages.map((p) => ({
      url: `${BASE_URL}/${p.slug}`,
      changefreq: 'monthly',
      priority: '0.6',
    })),
  ];

  const items = entries
    .map(
      (e) => `  <url>
    <loc>${e.url}</loc>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
  </url>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${items}
</urlset>`;
}

/* -------------------------------------------------------------------------- */
/* JSON-LD Organization Schema                                                 */
/* -------------------------------------------------------------------------- */

export const ORGANIZATION_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'LiveFolio',
  url: BASE_URL,
  logo: `${BASE_URL}/logo-v2.svg`,
  sameAs: [
    'https://github.com/LiveFolio-Cloud/LiveFolio',
    'https://twitter.com/livefolio',
    'https://linkedin.com/company/livefolio',
  ],
};
