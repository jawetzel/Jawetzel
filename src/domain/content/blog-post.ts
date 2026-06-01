/**
 * BlogPost — the shape of a file-sourced blog post (`blog/<YYYY-MM-DD-slug>.json`
 * at the repo root, not under `src/content/`). A pure content type with zero I/O.
 *
 * The repo-root directory read lives behind
 * `ContentSource.readJsonCollectionWithNames` (which yields each file's name
 * alongside its parsed JSON), and the sort/tag-count/kind-filter shaping is
 * orchestrated by the blog use-cases (`GetAllPosts`, `GetPostBySlug`,
 * `GetAllTags`, `GetPostsByKind`). The construction/defaulting rule —
 * including the filename → date/slug convention — lives in {@link parseBlogPost}
 * here so it's pure and unit-testable without disk.
 */
export type PostKind = "article" | "video" | "both";

export interface BlogPost {
  slug: string;
  date: string;
  title: string;
  description: string;
  tags: string[];
  kind: PostKind;
  bodyMd: string;
  hero?: string;
  youtubeId?: string;
  videoMeta?: { duration?: string; publishedAtOnYt?: string };
}

/**
 * A blog post's filename must be `.json` and date-prefixed
 * (`YYYY-MM-DD` optionally followed by `-slug`); anything else is not a post.
 * The capture groups feed the date/slug defaulting in {@link parseBlogPost}.
 */
const BLOG_FILENAME = /^(\d{4}-\d{2}-\d{2})(?:-(.+))?$/;

/**
 * parseBlogPost — build a {@link BlogPost} from a content file's name and parsed
 * JSON, applying the filename → date/slug convention and field defaults. Returns
 * `null` for files that aren't posts (non-`.json`, or a name that doesn't match
 * the date-prefixed pattern), matching the old getter's `parseFile`.
 *
 * - **slug** defaults to the filename base (without `.json`).
 * - **date** defaults to the `YYYY-MM-DD` from the filename.
 * - **title** `"(untitled)"`, **description** `""`, **tags** `[]`,
 *   **kind** `"article"`, **bodyMd** `""`.
 * - **hero / youtubeId / videoMeta** pass through untouched.
 *
 * Pure: no filesystem access — the adapter hands over `{ name, data }`.
 */
export function parseBlogPost(
  fileName: string,
  data: Partial<BlogPost>,
): BlogPost | null {
  if (!fileName.endsWith(".json")) return null;
  const base = fileName.replace(/\.json$/, "");
  const m = base.match(BLOG_FILENAME);
  if (!m) return null;
  const [, date] = m;
  return {
    slug: data.slug ?? base,
    date: data.date ?? date,
    title: data.title ?? "(untitled)",
    description: data.description ?? "",
    tags: data.tags ?? [],
    kind: data.kind ?? "article",
    bodyMd: data.bodyMd ?? "",
    hero: data.hero,
    youtubeId: data.youtubeId,
    videoMeta: data.videoMeta,
  };
}
