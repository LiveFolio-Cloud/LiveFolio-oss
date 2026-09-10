/**
 * Shared SWR fetcher with JSON parsing and error handling.
 * All data-fetching components should use this to benefit from
 * automatic caching, deduplication, and stale-while-revalidate.
 */

export const jsonFetcher = async <T = unknown>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) {
    const error = new Error('An error occurred while fetching the data.');
    throw error;
  }
  return res.json();
};

export const textFetcher = async (url: string): Promise<string> => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('An error occurred while fetching the data.');
  }
  return res.text();
};
