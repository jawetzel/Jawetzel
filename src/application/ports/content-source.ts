/** One entry of a named-collection read: the file's name plus its parsed JSON. */
export interface NamedJsonEntry<T> {
  /** The bare filename, e.g. `2026-04-17-hello-world.json`. */
  name: string;
  /** The parsed JSON for that file. */
  data: T;
}

/**
 * ContentSource — a driven port for reading file-sourced editorial content
 * (projects, resume, testimonials, marquee) as parsed JSON.
 *
 * Consumer-owned and intentionally minimal: `readJson` reads a single content
 * document (all `GetResume` needs); `readJsonCollection` reads every JSON file
 * in a content directory (the projects slice's need — `GetAllProjects` et al.);
 * `readJsonCollectionWithNames` does the same but yields each file's *name*
 * alongside its parsed JSON, for callers that derive values from the filename.
 *
 * Both collection reads are addressed by a *content-root-relative* directory.
 * `readJsonCollectionWithNames` also accepts an explicit `base` (`"content"` —
 * the default → `src/content/` — or `"repo-root"`) so the same adapter can serve
 * a repo-root directory without the projects/resume reads (which stay
 * `src/content/`-relative) changing.
 *
 * The production adapter is `FsJsonContentSource`; tests use an in-memory fake.
 * Inverting the filesystem behind this port is what makes the content-shaping
 * rules (cap-of-4, newest-first) unit-testable without disk — see
 * `docs/architecture/data-and-content.md`.
 */
export interface ContentSource {
  /** Read and parse a single JSON document, addressed by content-root-relative path. */
  readJson<T>(relativePath: string): Promise<T>;

  /**
   * Read and parse every `.json` file in a content directory, addressed by a
   * content-root-relative directory path. Entries not ending in `.json` are
   * ignored (matching the previous getter). A missing directory yields `[]`.
   * Returns the parsed documents in filesystem read order; ordering/filtering
   * is the caller's (use-case's) concern.
   */
  readJsonCollection<T>(relativeDir: string): Promise<T[]>;

  /**
   * Read every `.json` file in a directory and return each as a
   * `{ name, data }` pair so the caller can apply filename-derived rules. `base`
   * selects the root the directory is relative to: `"content"` (default) →
   * `src/content/`, `"repo-root"` → the repository root. Files not ending in
   * `.json` are ignored; a missing directory yields `[]`. Entries come back in
   * filesystem read order — sorting/skip rules are the use-case's concern.
   */
  readJsonCollectionWithNames<T>(
    relativeDir: string,
    base?: ContentBase,
  ): Promise<NamedJsonEntry<T>[]>;
}

/** Which root a {@link ContentSource} directory read is relative to. */
export type ContentBase = "content" | "repo-root";
