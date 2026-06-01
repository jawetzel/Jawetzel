/**
 * HTML-escape untrusted text for safe interpolation into email/markup bodies.
 * Pure, no I/O — usable from domain and application alike.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
