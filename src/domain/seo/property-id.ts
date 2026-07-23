/**
 * Property identity, derived rather than configured.
 *
 * seo.md Part 4 puts a `propertyId` on every private row: "a propertyId foreign
 * key on every row costs nothing today and is expensive to retrofit". There is
 * no `properties` collection yet, so v1 derives the id from the URL's host
 * instead of demanding config — deterministic, requires no intake step, and
 * retrofit-safe (a real `properties` row can adopt the same key later).
 *
 * Deliberately NOT a public-suffix-list implementation: `co.uk` and friends
 * would need the PSL as a dependency and a refresh cadence, and the only thing
 * riding on this is row grouping and our-domain matching. Stripping a leading
 * `www.` is the whole rule.
 */

/** Comparable host key: lowercase, no leading `www.`, no trailing dot/port. */
export function hostKey(hostOrDomain: string): string {
  return hostOrDomain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

/** The `propertyId` for a URL, or `"unknown"` when it will not parse. */
export function propertyIdOf(url: string): string {
  try {
    return hostKey(new URL(url).host);
  } catch {
    return "unknown";
  }
}

/** Do these two hosts refer to the same property? */
export function sameProperty(a: string, b: string): boolean {
  return hostKey(a) === hostKey(b) && hostKey(a) !== "";
}
