import { rehype } from "rehype";
import {
  collapseWhitespace,
  contentHash,
  containsPhrase,
  normalize,
  properNounPhrases,
  phraseSet,
  wordCount,
} from "./text";

/**
 * Fact family 1 — "page facts, measured from the caller's content" (seo.md §4b).
 *
 * A pure `html -> PageFacts` function. The fetch that produced the HTML is I/O
 * and lives behind the `PageFetcher` port; parsing and measuring are arithmetic
 * and live here, which is what makes every detector unit-testable against
 * fixture pages with no network (seo.md §4b "Build note").
 *
 * Parsing goes through `rehype`'s HTML parser (spec-compliant, already a
 * dependency for the markdown pipeline) rather than regex, because half the
 * inputs are competitor pages in the wild — unclosed tags, inline SVG, and
 * `<script>` bodies full of angle brackets are the normal case, not the edge.
 */

/** Minimal structural view of a hast node — all this module traverses. */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** A heading captured from the content region, in document order. */
export interface Heading {
  level: number;
  text: string;
}

export interface PageFacts {
  url: string;
  title: string | null;
  titleLength: number;
  metaDescription: string | null;
  metaDescriptionLength: number;
  /** Every `<h1>` — the count is the fact (0 or >1 are both defects). */
  h1: string[];
  /** `<h2>`/`<h3>` in document order. */
  headings: Heading[];
  wordCount: number;
  /** `@type` values from JSON-LD (including `@graph`) plus microdata itemtypes. */
  schemaTypes: string[];
  canonical: string | null;
  /** True when a robots meta or the `<head>` declares noindex. */
  noindex: boolean;
  imagesTotal: number;
  imagesMissingAlt: number;
  internalLinksOut: number;
  externalLinksOut: number;
  /** `tel:` hrefs found anywhere on the page. */
  telLinks: string[];
  /** True when a phone number or `tel:` link appears inside `<header>`. */
  phoneInHeader: boolean;
  /** Body text of the content region, original case, whitespace-collapsed. */
  text: string;
  /** Unigrams + 2/3-grams of the content region — the delta-fact left-hand side. */
  phrases: Set<string>;
  /**
   * Capitalized phrases in the PROSE of the content region, normalized phrase →
   * original casing. Headings are excluded: they are title-cased by editorial
   * convention, not because they name entities, and letting them in fills the
   * `entities` area with section names ("Best Varieties", "Planting Time")
   * instead of the species/brands/tools it exists to surface. Headings already
   * have their own area.
   */
  properNouns: Map<string, string>;
  /** Change-detection hash over title + normalized body text. */
  contentHash: string;
}

/**
 * Regions whose text is chrome, not content. Excluded from word count, phrase
 * extraction, and heading capture alike — a competitor's nav menu would
 * otherwise donate its link text to every term-frequency table on the page.
 */
const NON_CONTENT_TAGS = new Set([
  "script", "style", "noscript", "template", "svg", "iframe", "canvas",
  "nav", "header", "footer", "aside", "form", "button", "select", "option",
  "figcaption",
]);

/** North-American-shaped phone number. Deliberately loose; presence is the fact. */
const PHONE_PATTERN = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;

function attr(node: HastNode, name: string): string | null {
  const raw = node.properties?.[name];
  if (typeof raw === "string") return raw;
  if (typeof raw === "number") return String(raw);
  if (Array.isArray(raw)) return raw.join(" ");
  return null;
}

/** Depth-first walk over every node. */
function walk(node: HastNode, visit: (node: HastNode) => void): void {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

/** Depth-first walk that does not descend into chrome regions. */
function walkContent(node: HastNode, visit: (node: HastNode) => void): void {
  if (node.type === "element" && NON_CONTENT_TAGS.has(node.tagName ?? "")) return;
  visit(node);
  for (const child of node.children ?? []) walkContent(child, visit);
}

/**
 * Block-level elements. Their boundaries become newlines in the extracted text,
 * which the sentence splitter in `properNounPhrases` treats as a full stop.
 * Without this, `<h2>Best Varieties</h2><p>Paper Birch…` flattens to one run of
 * words and the entity extractor emits "best varieties paper birch" — a phrase
 * that appears nowhere on the page.
 */
const BLOCK_TAGS = new Set([
  "p", "div", "section", "article", "main", "aside", "blockquote", "pre",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "dl", "dt", "dd",
  "table", "thead", "tbody", "tr", "td", "th",
  "br", "hr", "figure", "address",
]);

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/**
 * Concatenated text of a subtree, skipping chrome, with block boundaries kept.
 * `skipHeadings` produces the prose-only variant used for entity extraction.
 */
function textOf(node: HastNode, skipHeadings = false): string {
  const parts: string[] = [];
  const visit = (n: HastNode): void => {
    if (n.type === "element" && NON_CONTENT_TAGS.has(n.tagName ?? "")) return;
    if (skipHeadings && n.type === "element" && HEADING_TAGS.has(n.tagName ?? "")) {
      // Still emit the boundary so the surrounding prose doesn't fuse across
      // the gap the heading left.
      parts.push("\n");
      return;
    }
    if (n.type === "text" && typeof n.value === "string") parts.push(n.value);
    for (const child of n.children ?? []) visit(child);
    if (n.type === "element" && BLOCK_TAGS.has(n.tagName ?? "")) parts.push("\n");
  };
  visit(node);
  return parts
    .join(" ")
    .replace(/[^\S\n]+/g, " ") // collapse spaces/tabs, keep newlines
    .replace(/\s*\n\s*/g, "\n") // tidy around block boundaries
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** First element matching `tagName`, anywhere in the tree. */
function findElement(root: HastNode, tagName: string): HastNode | null {
  let found: HastNode | null = null;
  walk(root, (n) => {
    if (!found && n.type === "element" && n.tagName === tagName) found = n;
  });
  return found;
}

/**
 * The region to measure: `<main>`, else `<article>`, else `<body>`, else the
 * whole tree. Preferring the semantic container is what makes word counts
 * comparable across sites with wildly different chrome.
 */
function contentRoot(root: HastNode): HastNode {
  return (
    findElement(root, "main") ??
    findElement(root, "article") ??
    findElement(root, "body") ??
    root
  );
}

/** Every `@type` in a JSON-LD value, following `@graph` and nested objects. */
function collectSchemaTypes(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectSchemaTypes(item, into);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "@type") {
      if (typeof child === "string") into.add(child);
      if (Array.isArray(child)) {
        for (const t of child) if (typeof t === "string") into.add(t);
      }
      continue;
    }
    collectSchemaTypes(child, into);
  }
}

/** Host comparison for internal-vs-external link classification. */
function sameHost(href: string, pageUrl: URL): boolean | null {
  if (/^(mailto:|tel:|javascript:|#)/i.test(href)) return null;
  try {
    return new URL(href, pageUrl).host === pageUrl.host;
  } catch {
    return null;
  }
}

export function extractPageFacts(input: {
  url: string;
  html: string;
}): PageFacts {
  const root = rehype().parse(input.html) as unknown as HastNode;
  // A malformed caller URL must not throw mid-analysis; fall back to a host that
  // matches nothing, which classifies every link as external.
  let pageUrl: URL;
  try {
    pageUrl = new URL(input.url);
  } catch {
    pageUrl = new URL("https://invalid.invalid/");
  }

  const titleEl = findElement(root, "title");
  const title = titleEl ? textOf(titleEl) || null : null;

  let metaDescription: string | null = null;
  let canonical: string | null = null;
  let noindex = false;
  const schemaTypes = new Set<string>();

  walk(root, (node) => {
    if (node.type !== "element") return;

    if (node.tagName === "meta") {
      const name = (attr(node, "name") ?? attr(node, "property") ?? "").toLowerCase();
      const content = attr(node, "content") ?? "";
      if (name === "description" && metaDescription === null) {
        metaDescription = content.trim() || null;
      }
      // `robots` is the general directive; `googlebot` overrides it for us.
      if ((name === "robots" || name === "googlebot") && /noindex/i.test(content)) {
        noindex = true;
      }
      return;
    }

    if (node.tagName === "link") {
      const rel = (attr(node, "rel") ?? "").toLowerCase();
      if (rel.split(/\s+/).includes("canonical") && canonical === null) {
        const href = attr(node, "href");
        if (href) {
          try {
            canonical = new URL(href, pageUrl).toString();
          } catch {
            canonical = href;
          }
        }
      }
      return;
    }

    if (node.tagName === "script") {
      const type = (attr(node, "type") ?? "").toLowerCase();
      if (type !== "application/ld+json") return;
      const raw = (node.children ?? [])
        .filter((c) => c.type === "text")
        .map((c) => c.value ?? "")
        .join("");
      try {
        collectSchemaTypes(JSON.parse(raw), schemaTypes);
      } catch {
        // Invalid JSON-LD is a real-world constant. It contributes no types;
        // "schema present but unparseable" reads the same as absent to Google.
      }
      return;
    }

    // Microdata is the pre-JSON-LD way to say the same thing; both count.
    const itemType = attr(node, "itemType") ?? attr(node, "itemtype");
    if (itemType) {
      for (const t of itemType.split(/\s+/)) {
        const leaf = t.split("/").pop();
        if (leaf) schemaTypes.add(leaf);
      }
    }
  });

  const content = contentRoot(root);
  const h1: string[] = [];
  const headings: Heading[] = [];
  let imagesTotal = 0;
  let imagesMissingAlt = 0;
  let internalLinksOut = 0;
  let externalLinksOut = 0;
  const telLinks: string[] = [];

  walkContent(content, (node) => {
    if (node.type !== "element") return;
    const tag = node.tagName ?? "";

    // Headings are single-line values (shown as-is, and the `questions` source),
    // so flatten the block-boundary newlines and inline-split spacing `textOf`
    // preserves for prose. The body `text` below keeps its newlines untouched.
    if (tag === "h1") {
      const text = collapseWhitespace(textOf(node));
      if (text) h1.push(text);
      return;
    }
    if (tag === "h2" || tag === "h3") {
      const text = collapseWhitespace(textOf(node));
      if (text) headings.push({ level: Number(tag[1]), text });
      return;
    }
    if (tag === "img") {
      imagesTotal += 1;
      const alt = attr(node, "alt");
      if (alt === null || alt.trim() === "") imagesMissingAlt += 1;
      return;
    }
    if (tag === "a") {
      const href = attr(node, "href");
      if (!href) return;
      const internal = sameHost(href, pageUrl);
      if (internal === true) internalLinksOut += 1;
      else if (internal === false) externalLinksOut += 1;
    }
  });

  // `tel:` links and the header phone check span the WHOLE document — the phone
  // number lives in the chrome by design, which is exactly what we're asserting.
  walk(root, (node) => {
    if (node.type !== "element" || node.tagName !== "a") return;
    const href = attr(node, "href");
    if (href && /^tel:/i.test(href)) telLinks.push(href.replace(/^tel:/i, "").trim());
  });
  const headerEl = findElement(root, "header");
  const headerText = headerEl ? textOf(headerEl) : "";
  const phoneInHeader =
    PHONE_PATTERN.test(headerText) ||
    (headerEl !== null &&
      (() => {
        let found = false;
        walk(headerEl, (n) => {
          if (found || n.type !== "element" || n.tagName !== "a") return;
          const href = attr(n, "href");
          if (href && /^tel:/i.test(href)) found = true;
        });
        return found;
      })());

  const text = textOf(content);

  return {
    url: input.url,
    title,
    titleLength: title?.length ?? 0,
    metaDescription,
    metaDescriptionLength: (metaDescription as string | null)?.length ?? 0,
    h1,
    headings,
    wordCount: wordCount(text),
    schemaTypes: [...schemaTypes].sort(),
    canonical,
    noindex,
    imagesTotal,
    imagesMissingAlt,
    internalLinksOut,
    externalLinksOut,
    telLinks,
    phoneInHeader,
    text,
    phrases: phraseSet(text),
    properNouns: properNounPhrases(textOf(content, true)),
    contentHash: contentHash(`${title ?? ""} ${text}`),
  };
}

/**
 * Does the page state a value for this `entitySchema` field? Exact normalized
 * matching against the field key and its de-camel-cased form, so `hardinessZone`
 * matches a page saying "hardiness zone". This is the load-bearing coverage
 * check (seo.md §4b: "extending coverage detection means extending that list,
 * never touching a detector").
 */
export function detectsEntityField(facts: PageFacts, field: string): boolean {
  const spaced = field.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return (
    containsPhrase(facts.text, field) ||
    containsPhrase(facts.text, spaced) ||
    facts.headings.some((h) => containsPhrase(h.text, spaced)) ||
    normalize(facts.text).includes(normalize(spaced))
  );
}
