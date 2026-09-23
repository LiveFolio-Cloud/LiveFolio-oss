/**
 * Folio slug generation — accent-safe, shared by every create path.
 * "Présentation TTA × Chaker Jeux" → "presentation-tta-chaker-jeux"
 * (NFD strips diacritics, then only [a-z0-9] survives).
 */
export function slugifyFolioTitle(title: string): string {
  const base = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'untitled';
}
