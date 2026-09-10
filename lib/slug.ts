/**
 * Generates a URL-friendly slug combined with the project's unique ID.
 * e.g., "My Creative Portfolio" and ID "txmh78d" -> "my-creative-portfolio-txmh78d"
 */
export function getProjectShareSlug(title: string, id: string): string {
  if (id === 'welcome-folio') {
    return 'welcome-folio';
  }
  const slugified = title
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')           // Replace spaces with -
    .replace(/[^\w\-]+/g, '')       // Remove all non-word characters except dashes
    .replace(/\-\-+/g, '-')         // Replace multiple dashes with single dash
    .replace(/^-+/, '')             // Trim dashes from start
    .replace(/-+$/, '');            // Trim dashes from end

  if (!slugified) {
    return id;
  }
  return `${slugified}-${id}`;
}
