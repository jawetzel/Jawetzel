import { describe, it, expect } from "vitest";
import { detectsEntityField, extractPageFacts } from "./page-facts";

const URL = "https://weekendplant.com/garden-skills/trees-of-the-north";

const FIXTURE = `
<!doctype html>
<html>
  <head>
    <title>Trees of the North</title>
    <meta name="description" content="A guide to northern trees.">
    <link rel="canonical" href="/garden-skills/trees-of-the-north">
    <script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[
        {"@type":"Article","headline":"Trees of the North"},
        {"@type":"BreadcrumbList"}
      ]}
    </script>
  </head>
  <body>
    <header>
      <a href="/">Home</a>
      <a href="tel:+15135551234">(513) 555-1234</a>
    </header>
    <nav><a href="/blog">Blog</a><a href="/about">About</a></nav>
    <main>
      <h1>Trees of the North</h1>
      <p>Choosing a site matters. The hardiness zone determines what survives.</p>
      <h2>Choosing a Site</h2>
      <p>We planted American Larch here.</p>
      <h3>Winter Care</h3>
      <img src="a.png" alt="a larch">
      <img src="b.png">
      <img src="c.png" alt="">
      <a href="/garden-skills/mulching">Mulching</a>
      <a href="https://example.com/outside">Outside</a>
      <script>var x = "<h2>not a heading</h2>";</script>
    </main>
    <footer><a href="/privacy">Privacy</a></footer>
  </body>
</html>`;

describe("extractPageFacts", () => {
  const facts = extractPageFacts({ url: URL, html: FIXTURE });

  it("reads title and meta description with their lengths", () => {
    expect(facts.title).toBe("Trees of the North");
    expect(facts.titleLength).toBe(18);
    expect(facts.metaDescription).toBe("A guide to northern trees.");
    expect(facts.metaDescriptionLength).toBe(26);
  });

  it("resolves a relative canonical against the page URL", () => {
    expect(facts.canonical).toBe(URL);
  });

  it("collects JSON-LD @type values through @graph", () => {
    expect(facts.schemaTypes).toEqual(["Article", "BreadcrumbList"]);
  });

  it("captures h1 and h2/h3 from the content region in order", () => {
    expect(facts.h1).toEqual(["Trees of the North"]);
    expect(facts.headings).toEqual([
      { level: 2, text: "Choosing a Site" },
      { level: 3, text: "Winter Care" },
    ]);
  });

  it("does not mistake markup inside a <script> body for a heading", () => {
    expect(facts.headings.map((h) => h.text)).not.toContain("not a heading");
  });

  it("excludes nav/header/footer chrome from the measured text", () => {
    // "Blog", "About", "Privacy" and "Home" are chrome link text. If they
    // reached the phrase table, every competitor's menu would pollute the
    // frequency counts.
    expect(facts.phrases.has("blog")).toBe(false);
    expect(facts.phrases.has("privacy")).toBe(false);
    expect(facts.text).not.toContain("Privacy");
  });

  it("counts images missing alt, treating alt=\"\" as missing", () => {
    expect(facts.imagesTotal).toBe(3);
    expect(facts.imagesMissingAlt).toBe(2);
  });

  it("splits internal from external links", () => {
    expect(facts.internalLinksOut).toBe(1);
    expect(facts.externalLinksOut).toBe(1);
  });

  it("finds tel: links and the header phone, which live in the chrome", () => {
    expect(facts.telLinks).toEqual(["+15135551234"]);
    expect(facts.phoneInHeader).toBe(true);
  });

  it("extracts proper nouns from the body", () => {
    expect(facts.properNouns.has("american larch")).toBe(true);
  });

  it("hashes content so unchanged pages are not re-snapshotted", () => {
    const again = extractPageFacts({ url: URL, html: FIXTURE });
    expect(again.contentHash).toBe(facts.contentHash);
  });
});

describe("extractPageFacts — robustness", () => {
  it("survives unparseable JSON-LD instead of throwing", () => {
    const facts = extractPageFacts({
      url: URL,
      html: `<html><head><script type="application/ld+json">{ nope </script></head><body><p>hi</p></body></html>`,
    });
    expect(facts.schemaTypes).toEqual([]);
  });

  it("detects a robots noindex directive", () => {
    const facts = extractPageFacts({
      url: URL,
      html: `<html><head><meta name="robots" content="noindex, follow"></head><body></body></html>`,
    });
    expect(facts.noindex).toBe(true);
  });

  it("reads microdata itemtype as a schema type", () => {
    const facts = extractPageFacts({
      url: URL,
      html: `<html><body><div itemscope itemtype="https://schema.org/LocalBusiness"></div></body></html>`,
    });
    expect(facts.schemaTypes).toContain("LocalBusiness");
  });

  it("falls back to <body> when there is no <main> or <article>", () => {
    const facts = extractPageFacts({
      url: URL,
      html: `<html><body><h2>Only Heading</h2><p>one two three</p></body></html>`,
    });
    expect(facts.headings).toEqual([{ level: 2, text: "Only Heading" }]);
    expect(facts.wordCount).toBeGreaterThan(0);
  });

  it("does not throw on a malformed page URL", () => {
    const facts = extractPageFacts({ url: "not a url", html: FIXTURE });
    // Analysis still completes against the fallback host. Relative links stay
    // internal (they are internal by construction, whatever the base resolves
    // to) and absolute off-host links stay external.
    expect(facts.title).toBe("Trees of the North");
    expect(facts.internalLinksOut).toBe(1);
    expect(facts.externalLinksOut).toBe(1);
  });
});

describe("detectsEntityField", () => {
  const facts = extractPageFacts({ url: URL, html: FIXTURE });

  it("matches a camelCase field against its spaced form in the body", () => {
    expect(detectsEntityField(facts, "hardinessZone")).toBe(true);
  });

  it("reports a field the page never states", () => {
    expect(detectsEntityField(facts, "daysToMaturity")).toBe(false);
  });
});
