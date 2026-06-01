import { type ContentSource } from "@/application/ports/content-source";
import { type Testimonial } from "@/domain/content/testimonial";

/** Content-root-relative file holding the testimonials array. */
export const TESTIMONIALS_FILE = "testimonials.json";

/**
 * GetTestimonials — read the testimonials list. The file is a single JSON
 * *array*, so this is a `readJson` (single-document) read, not a collection
 * read. Thin like `GetResume` — no shaping; the old getter parsed the array
 * as-is — but it owns the seam so the pages go through a use-case and are
 * testable against a fake `ContentSource`.
 *
 * Behavior parity: the old `getTestimonials()` returned `[]` when the file was
 * *missing* (an `fs.existsSync` guard). `readJson` throws on ENOENT, so this
 * use-case catches that and yields `[]` to preserve the guard. The file exists
 * today; this is defensive parity, not a behavior change.
 */
export interface GetTestimonialsDeps {
  content: ContentSource;
}

export interface GetTestimonials {
  execute(): Promise<Testimonial[]>;
}

export function createGetTestimonials(
  deps: GetTestimonialsDeps,
): GetTestimonials {
  const { content } = deps;

  return {
    async execute() {
      try {
        return await content.readJson<Testimonial[]>(TESTIMONIALS_FILE);
      } catch (err) {
        // Missing file → empty list, matching the old getter's
        // `fs.existsSync(...) ? ... : []` guard.
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw err;
      }
    },
  };
}
