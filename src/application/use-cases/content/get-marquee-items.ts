import { type ContentSource } from "@/application/ports/content-source";

/** Content-root-relative file holding the marquee items array. */
export const MARQUEE_FILE = "marquee.json";

/**
 * GetMarqueeItems — read the marquee strings. The file is a single JSON *array
 * of strings* (no named type — it's just `string[]`), so this is a `readJson`
 * (single-document) read. Thin like `GetResume`: no shaping; the old getter
 * parsed the array as-is.
 *
 * Behavior parity: the old `getMarqueeItems()` returned `[]` when the file was
 * *missing* (an `fs.existsSync` guard). `readJson` throws on ENOENT, so this
 * use-case catches that and yields `[]` to preserve the guard. The file exists
 * today; this is defensive parity, not a behavior change.
 */
export interface GetMarqueeItemsDeps {
  content: ContentSource;
}

export interface GetMarqueeItems {
  execute(): Promise<string[]>;
}

export function createGetMarqueeItems(
  deps: GetMarqueeItemsDeps,
): GetMarqueeItems {
  const { content } = deps;

  return {
    async execute() {
      try {
        return await content.readJson<string[]>(MARQUEE_FILE);
      } catch (err) {
        // Missing file → empty list, matching the old getter's
        // `fs.existsSync(...) ? ... : []` guard.
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw err;
      }
    },
  };
}
