import type { MetadataRoute } from 'next';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://livefolio.cloud';

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = [
    { url: BASE_URL, lastModified: new Date(), changeFrequency: 'weekly' as const, priority: 1.0 },
    { url: `${BASE_URL}/landing`, lastModified: new Date(), changeFrequency: 'weekly' as const, priority: 0.9 },
    { url: `${BASE_URL}/docs`, lastModified: new Date(), changeFrequency: 'weekly' as const, priority: 0.8 },
    { url: `${BASE_URL}/login`, lastModified: new Date(), changeFrequency: 'monthly' as const, priority: 0.3 },
    { url: `${BASE_URL}/privacy`, lastModified: new Date(), changeFrequency: 'yearly' as const, priority: 0.1 },
    { url: `${BASE_URL}/tos`, lastModified: new Date(), changeFrequency: 'yearly' as const, priority: 0.1 },
    { url: `${BASE_URL}/connections`, lastModified: new Date(), changeFrequency: 'monthly' as const, priority: 0.5 },
    // AI discovery endpoints
    { url: `${BASE_URL}/auth.md`, lastModified: new Date(), changeFrequency: 'weekly' as const, priority: 0.7 },
    { url: `${BASE_URL}/llms.txt`, lastModified: new Date(), changeFrequency: 'weekly' as const, priority: 0.7 },
  ];

  return staticRoutes;
}
