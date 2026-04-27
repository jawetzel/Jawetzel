// Per-project `lastModified` overrides (slug → ISO date).
// Add an entry when a single project page's content changes; otherwise the
// sitemap falls back to the default project date in `sitemap.ts`.
export const PROJECT_ROUTE_DATES: Record<string, string> = {
  vorbiz: "2026-04-27T13:00:00Z",
};

// Hardcoded `lastModified` values for static routes in the sitemap.
// Update the relevant entry whenever the page's content changes.
export const STATIC_ROUTE_DATES: Record<string, string> = {
  "": "2026-04-25T22:00:00Z",
  "/about": "2026-04-25T22:00:00Z",
  "/projects": "2026-04-25T12:00:00Z",
  "/blog": "2026-04-24T23:00:00Z",
  "/resume": "2026-04-24T23:00:00Z",
  "/contact": "2026-04-25T22:00:00Z",
  "/privacy": "2026-04-24T23:00:00Z",
  "/embroidery": "2026-04-24T23:00:00Z",
  "/embroidery/api-docs": "2026-04-24T23:00:00Z",
  "/tools": "2026-04-27T12:00:00Z",
  "/tools/embroidery-supplies": "2026-04-24T23:00:00Z",
  "/security-audit": "2026-04-27T14:00:00Z",
  "/baton-rouge-software-developer": "2026-04-25T22:00:00Z",
};
