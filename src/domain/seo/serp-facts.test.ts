import { describe, it, expect } from "vitest";
import { extractPageFacts } from "./page-facts";
import {
  computeSerpFacts,
  type CompetitorPage,
  type SerpObservation,
} from "./serp-facts";

function page(url: string, position: number, html: string): CompetitorPage {
  return { position, url, facts: extractPageFacts({ url, html }) };
}

function body(inner: string): string {
  return `<html><head><title>t</title></head><body><main>${inner}</main></body></html>`;
}

const OBSERVATION: SerpObservation = {
  query: "cold hardy trees",
  location: "2840",
  capturedAt: "2026-07-22T12:00:00.000Z",
  features: ["people_also_ask", "ai_overview"],
  paaQuestions: ["What trees survive zone 3 winters?"],
  results: [
    {
      position: 1,
      url: "https://rival-a.com/trees",
      domain: "rival-a.com",
      title: "23 Cold Hardy Trees for Zone 3 Gardens",
      description: "Zone by zone varieties.",
    },
    {
      position: 2,
      url: "https://rival-b.com/trees",
      domain: "rival-b.com",
      title: "Best Cold Hardy Trees: Zone 2-5 Varieties",
      description: "The best zone varieties for cold climates.",
    },
    {
      position: 3,
      url: "https://rival-c.com/trees",
      domain: "rival-c.com",
      title: "Cold Hardy Trees — A Complete Zone Guide",
      description: null,
    },
    {
      position: 4,
      // Our own page, reported by the SERP with a www prefix the caller's URL
      // omits — the host-key comparison has to see through that.
      url: "https://www.weekendplant.com/trees-of-the-north",
      domain: "www.weekendplant.com",
      title: "Trees of the North",
      description: "A guide.",
    },
  ],
};

const COMPETITOR_PAGES = [
  page(
    "https://rival-a.com/trees",
    1,
    body(`<h2>Hardiness Zones</h2><h2>Best Varieties</h2>
          <p>We grow Paper Birch and American Larch in cold climates.</p>
          <script type="application/ld+json">{"@type":"Article"}</script>`),
  ),
  page(
    "https://rival-b.com/trees",
    2,
    body(`<h2>Hardiness Zones</h2><h3>How fast do cold hardy trees grow?</h3>
          <p>Paper Birch thrives here.</p>
          <script type="application/ld+json">{"@type":"Article"}</script>`),
  ),
];

describe("computeSerpFacts", () => {
  const facts = computeSerpFacts({
    observation: OBSERVATION,
    competitorPages: COMPETITOR_PAGES,
    ourDomain: "https://weekendplant.com/trees-of-the-north",
    config: {},
  });

  it("finds our position despite a www mismatch, and excludes us from the competitor set", () => {
    expect(facts.ourPosition).toBe(4);
    expect(facts.competitorCount).toBe(3);
  });

  it("tracks the two sample sizes separately", () => {
    // 3 competitors on the SERP, 2 of them crawled. Title facts use the first
    // denominator, body facts the second.
    expect(facts.competitorCount).toBe(3);
    expect(facts.crawledCount).toBe(2);
    expect(facts.titleTerms.every((t) => t.of === 3)).toBe(true);
    expect(facts.headings.every((h) => h.of === 2)).toBe(true);
  });

  it("counts title terms by document frequency, collapsed to maximal phrases", () => {
    // All three titles carry "cold hardy trees", so the sub-phrases "cold",
    // "hardy" and "cold hardy" say nothing extra and are dropped.
    const phrase = facts.titleTerms.find((t) => t.term === "cold hardy trees");
    expect(phrase).toEqual({ term: "cold hardy trees", in: 3, of: 3 });
    expect(facts.titleTerms.map((t) => t.term)).not.toContain("cold hardy");

    // "zone" stands alone — it is not contained in that phrase.
    const zone = facts.titleTerms.find((t) => t.term === "zone");
    expect(zone?.in).toBe(3);
  });

  it("counts structural title patterns", () => {
    const patterns = Object.fromEntries(
      facts.titlePatterns.map((p) => [p.term, p.in]),
    );
    // Patterns are a closed vocabulary, so every observed one is reported with
    // its true frequency — one title leading with a count is a real 1-of-3, not
    // noise to be filtered. `minShare` decides later whether to recommend it.
    expect(patterns.leadsWithCount).toBe(1);
    // "Best ...", "A Complete Zone Guide" -> superlative/guide in 2 of 3.
    expect(patterns.containsSuperlative).toBe(2);
  });

  it("counts headings across crawled bodies only", () => {
    const zones = facts.headings.find((h) => h.term === "hardiness zones");
    expect(zones).toEqual({ term: "hardiness zones", in: 2, of: 2 });
  });

  it("keeps an original-case display form for each normalized phrase", () => {
    expect(facts.displayForms["hardiness zones"]).toBe("Hardiness Zones");
  });

  it("collects entities recurring across bodies", () => {
    const birch = facts.entities.find((e) => e.term === "paper birch");
    expect(birch?.in).toBe(2);
  });

  it("merges PAA questions with question-shaped competitor headings", () => {
    expect(facts.questions).toContain("What trees survive zone 3 winters?");
    expect(facts.questions).toContain("How fast do cold hardy trees grow?");
  });

  it("reports schema types by frequency", () => {
    expect(facts.schemaTypes).toEqual([{ term: "Article", in: 2, of: 2 }]);
  });

  it("carries verbatim title and meta examples for the consumer", () => {
    expect(facts.titleExamples).toContain("23 Cold Hardy Trees for Zone 3 Gardens");
    expect(facts.metaExamples).toContain("Zone by zone varieties.");
  });

  it("spreads title length and body word count", () => {
    expect(facts.titleLength.min).toBeGreaterThan(0);
    expect(facts.bodyWordCount.median).toBeGreaterThan(0);
  });
});

describe("computeSerpFacts — question hygiene", () => {
  const facts = computeSerpFacts({
    observation: { ...OBSERVATION, paaQuestions: [] },
    ourDomain: "https://weekendplant.com/trees-of-the-north",
    competitorPages: [
      page(
        "https://rival-a.com/trees",
        1,
        body(
          `<h2>What does cold hardiness actually<br>mean for trees?</h2>
           <h2>Didn't Find What You Were Looking For?</h2>`,
        ),
      ),
    ],
  });

  it("flattens a multi-line question heading to one clean line", () => {
    expect(facts.questions).toContain(
      "What does cold hardiness actually mean for trees?",
    );
  });

  it("excludes a CTA heading that merely ends with a question mark", () => {
    expect(facts.questions.some((q) => q.startsWith("Didn"))).toBe(false);
  });
});

describe("computeSerpFacts — degenerate inputs", () => {
  it("returns empty tables rather than throwing when nothing was crawled", () => {
    const facts = computeSerpFacts({
      observation: OBSERVATION,
      competitorPages: [],
      ourDomain: "https://weekendplant.com/trees-of-the-north",
    });
    expect(facts.crawledCount).toBe(0);
    expect(facts.headings).toEqual([]);
    expect(facts.bodyWordCount).toEqual({ min: 0, median: 0, max: 0 });
    // Title facts survive — they come from the SERP, not the crawl.
    expect(facts.titleTerms.length).toBeGreaterThan(0);
  });

  it("counts config-driven patterns only when config supplies the vocabulary", () => {
    const withConfig = computeSerpFacts({
      observation: {
        ...OBSERVATION,
        results: OBSERVATION.results.map((r) => ({
          ...r,
          title: `Emergency ${r.title}`,
        })),
      },
      competitorPages: [],
      ourDomain: "https://weekendplant.com/x",
      config: { urgencyTerms: ["emergency"] },
    });
    const urgency = withConfig.titlePatterns.find(
      (p) => p.term === "containsUrgencyTerm",
    );
    expect(urgency?.in).toBe(3);
  });
});
