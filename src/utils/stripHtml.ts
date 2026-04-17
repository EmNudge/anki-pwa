/**
 * Strip HTML tags, sound references, and trim whitespace.
 * Shared utility used across components and modules for plain-text display.
 */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/\[sound:[^\]]+\]/g, "")
    .replace(/<[^>]*>/g, "")
    .trim();
}
