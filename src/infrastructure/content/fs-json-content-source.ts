import fs from "node:fs";
import path from "node:path";
import {
  type ContentBase,
  type ContentSource,
  type NamedJsonEntry,
} from "@/application/ports/content-source";

/**
 * FsJsonContentSource — the production {@link ContentSource}, reading JSON from
 * the bundled content root (`src/content/`) and, for named-collection reads,
 * optionally from the **repo root** (see `readJsonCollectionWithNames`'s `base`
 * argument). Parsed documents are memoized per path/dir: editorial content is
 * immutable at runtime, so this preserves the read-once behavior of the previous
 * getters (`getResume()`'s module-level cache) without re-hitting disk on every
 * request.
 *
 * Deliberately depends on nothing but the filesystem — importing it (and the
 * content composition that wires it) never pulls in Mongo, so static pages like
 * `/resume` stay free of the database. See `docs/architecture/data-and-content.md`.
 */
export class FsJsonContentSource implements ContentSource {
  private readonly root = path.join(process.cwd(), "src", "content");
  private readonly repoRoot = process.cwd();
  private readonly cache = new Map<string, unknown>();

  private baseDir(base: ContentBase): string {
    return base === "repo-root" ? this.repoRoot : this.root;
  }

  async readJson<T>(relativePath: string): Promise<T> {
    const cached = this.cache.get(relativePath);
    if (cached !== undefined) return cached as T;

    const raw = await fs.promises.readFile(
      path.join(this.root, relativePath),
      "utf8",
    );
    const parsed = JSON.parse(raw) as T;
    this.cache.set(relativePath, parsed);
    return parsed;
  }

  async readJsonCollection<T>(relativeDir: string): Promise<T[]> {
    const cacheKey = `dir:${relativeDir}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached as T[];

    const dir = path.join(this.root, relativeDir);
    let names: string[];
    try {
      names = await fs.promises.readdir(dir);
    } catch (err) {
      // Missing directory → empty collection, matching the old getter's
      // `fs.existsSync(...) ? ... : []` guard.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        this.cache.set(cacheKey, []);
        return [];
      }
      throw err;
    }

    const files = names.filter((f) => f.endsWith(".json"));
    const items = await Promise.all(
      files.map(async (f) => {
        const raw = await fs.promises.readFile(path.join(dir, f), "utf8");
        return JSON.parse(raw) as T;
      }),
    );
    this.cache.set(cacheKey, items);
    return items;
  }

  async readJsonCollectionWithNames<T>(
    relativeDir: string,
    base: ContentBase = "content",
  ): Promise<NamedJsonEntry<T>[]> {
    const cacheKey = `named:${base}:${relativeDir}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached as NamedJsonEntry<T>[];

    const dir = path.join(this.baseDir(base), relativeDir);
    let names: string[];
    try {
      names = await fs.promises.readdir(dir);
    } catch (err) {
      // Missing directory → empty collection, matching the old getter's
      // `fs.existsSync(...) ? ... : []` guard.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        this.cache.set(cacheKey, []);
        return [];
      }
      throw err;
    }

    const files = names.filter((f) => f.endsWith(".json"));
    const entries = await Promise.all(
      files.map(async (f) => {
        const raw = await fs.promises.readFile(path.join(dir, f), "utf8");
        return { name: f, data: JSON.parse(raw) as T };
      }),
    );
    this.cache.set(cacheKey, entries);
    return entries;
  }
}
