/**
 * resolvePageContext — builds the optional "[Current page context]" system
 * message the portfolio assistant gets, from the page the user is on. Lifted
 * **verbatim** from the flat `lib/ai/chat.resolvePageContext`: the same path
 * normalization, the same per-route strings, and the same blog/project lookups
 * through the DB-free content container (`@/composition/content`).
 *
 * It lives in composition because it reaches the content container (a wiring
 * concern) and is injected into `RunAssistantTurn` as a plain
 * `(pageUrl) => Promise<string | null>` dep, keeping the use-case testable with
 * a fake. The dynamic `import("@/composition/content")` is preserved so this
 * stays DB-free (content reads never touch Mongo).
 */
export async function resolvePageContext(
  pageUrl: string,
): Promise<string | null> {
  if (!pageUrl) return null;
  let url: URL;
  try {
    url = new URL(pageUrl, "http://localhost");
  } catch {
    return null;
  }
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path === "/") return "The user is on the portfolio landing page.";
  if (path === "/about") return "The user is on the About page.";
  if (path === "/contact") return "The user is on the Contact page.";
  if (path === "/privacy") return "The user is on the Privacy page.";
  if (path === "/security-audit") {
    return (
      "The user is on the /security-audit case study — Joshua's redacted " +
      "writeup of a zero-knowledge audit he did on a mid-size B2B distributor. " +
      "References to \"this audit\", \"this company\", or \"the report\" refer to that engagement."
    );
  }
  if (path === "/resume") {
    return "The user is on the Resume page. Use get_resume when they ask for specifics.";
  }
  if (path === "/blog") {
    return "The user is on the blog index. Use search_blog for specific topics.";
  }

  const blogPost = path.match(/^\/blog\/([^/]+)$/);
  if (blogPost) {
    const { createContentContainer } = await import("@/composition/content");
    const post = await createContentContainer().getPostBySlug.execute(
      blogPost[1],
    );
    if (post) {
      return (
        `The user is reading this blog post:\n` +
        `Title: ${post.title}\n` +
        `Date: ${post.date}\n` +
        `Tags: ${post.tags.join(", ")}\n` +
        `Description: ${post.description}\n\n` +
        `References to "this post" mean this one.`
      );
    }
  }

  if (path === "/projects") {
    return "The user is browsing the projects list. Use search_projects to surface specifics.";
  }

  const project = path.match(/^\/projects\/([^/]+)$/);
  if (project) {
    const { createContentContainer } = await import("@/composition/content");
    const p = await createContentContainer().getProjectBySlug.execute(
      project[1],
    );
    if (p) {
      return (
        `The user is on this project case study:\n` +
        `Name: ${p.name}\n` +
        `Tagline: ${p.tagline}\n` +
        `Stack: ${p.stack.join(", ")}\n` +
        `Status: ${p.status ?? "unspecified"}\n\n` +
        `References to "this project" mean this one.`
      );
    }
  }

  if (path === "/tools/embroidery-supplies") {
    const qs = url.searchParams;
    const hex = qs.get("hex");
    const brand = qs.get("brand");
    const shop = qs.get("shopping_source");
    const q = qs.get("q");
    const bits: string[] = ["The user is on the embroidery-supplies tool."];
    if (hex) {
      bits.push(
        `Current color filter: #${hex.replace(/^#/, "")}. If they ask for "closer", "warmer", "cooler" variations, call find_thread_color with an adjusted hex.`,
      );
    }
    if (shop) bits.push(`Current shop filter: ${shop}.`);
    if (brand) bits.push(`Current brand filter: ${brand}.`);
    if (q) bits.push(`Current text search: "${q}".`);
    return bits.join(" ");
  }

  return null;
}
