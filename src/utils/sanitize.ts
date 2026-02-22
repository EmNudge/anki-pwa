/**
 * Strips dangerous HTML for use in command palette previews.
 * Removes scripts, event handlers, styles, and audio containers.
 */
export function sanitizeHtmlForPreview(html: string): string {
  return (
    html
      // Remove <script> tags and their content
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      // Remove <style> tags and their content
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
      // Remove .audio-container elements and their content
      .replace(/<div\s+class=['"]audio-container['"][^>]*>[\s\S]*?<\/div>/gi, "")
      // Remove event handler attributes (on*)
      .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
  );
}
