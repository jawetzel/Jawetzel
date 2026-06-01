/**
 * Testimonial — the shape of a single file-sourced testimonial
 * (`src/content/testimonials.json` is an array of these). A pure content type
 * with zero I/O; the read lives behind `ContentSource` and is orchestrated by
 * the `GetTestimonials` use-case. Moved verbatim from the old
 * `src/lib/testimonials.ts` getter.
 */
export interface Testimonial {
  quote: string;
  name: string;
  role: string;
  company?: string;
  avatarUrl?: string;
}
