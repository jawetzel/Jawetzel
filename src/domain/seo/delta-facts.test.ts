import { describe, it, expect } from "vitest";
import { computeDeltaFacts, DEFAULT_MIN_SHARE, isRecommended } from "./delta-facts";
import { extractPageFacts } from "./page-facts";
import { computeSerpFacts, type SerpObservation } from "./serp-facts";

const OUR_URL = "https://weekendplant.com/trees";

const OUR_PAGE = extractPageFacts({
  url: OUR_URL,
  html: `<html><head><title>Trees of the North</title></head>
    <body><main>
      <h1>Trees of the North</h1>
      <h2>Choosing a Site</h2>
      <p>The hardiness zone matters. We planted American Larch.</p>
      <script type="application/ld+json">{"@type":"Article"}</script>
    </main></body></html>`,
});

const OBSERVATION: SerpObservation = {
  query: "cold hardy trees",
  location: "2840",
  capturedAt: "2026-07-22T12:00:00.000Z",
  features: [],
  paaQuestions: ["What trees survive zone 3 winters?"],
  results: [
    {
      position: 1,
      url: "https://a.com/x",
      domain: "a.com",
      title: "23 Cold Hardy Trees for Zone 3",
      description: "Cold hardy varieties by zone.",
    },
    {
      position: 2,
      url: "https://b.com/x",
      domain: "b.com",
      title: "Best Cold Hardy Trees by Zone",
      description: "Cold hardy picks for every zone.",
    },
  ],
};

const SERP = computeSerpFacts({
  observation: OBSERVATION,
  ourDomain: OUR_URL,
  competitorPages: [
    {
      position: 1,
      url: "https://a.com/x",
      facts: extractPageFacts({
        url: "https://a.com/x",
        html: `<html><body><main><h2>Best Varieties</h2>
          <p>Paper Birch grows well.</p>
          <script type="application/ld+json">{"@type":"ItemList"}</script>
          </main></body></html>`,
      }),
    },
    {
      position: 2,
      url: "https://b.com/x",
      facts: extractPageFacts({
        url: "https://b.com/x",
        html: `<html><body><main><h2>Best Varieties</h2>
          <p>Paper Birch is reliable.</p>
          <script type="application/ld+json">{"@type":"ItemList"}</script>
          </main></body></html>`,
      }),
    },
  ],
});

const CONFIG = {
  minShare: DEFAULT_MIN_SHARE,
  entitySchema: ["hardinessZone", "matureHeight", "sunRequirement"],
};

describe("computeDeltaFacts", () => {
  const delta = computeDeltaFacts({ page: OUR_PAGE, serp: SERP, config: CONFIG });

  it("reports title terms the ranking set uses and we do not", () => {
    const terms = delta.titleMissingTerms.map((t) => t.term);
    // Reported as the maximal phrase both competitors share, not as its parts.
    expect(terms).toContain("cold hardy trees");
    expect(terms).toContain("zone");
  });

  it("reports title patterns we lack, using the same predicates as the SERP table", () => {
    const patterns = delta.titleMissingPatterns.map((p) => p.term);
    // Both competitor titles contain a number; ours does not.
    expect(patterns).toContain("containsNumber");
  });

  it("reports headings common to the ranking set and absent from ours", () => {
    expect(delta.missingHeadings.map((h) => h.term)).toContain("best varieties");
  });

  it("does not report a heading we already have", () => {
    expect(delta.missingHeadings.map((h) => h.term)).not.toContain(
      "choosing a site",
    );
  });

  it("reports entities the competitors name and we omit", () => {
    expect(delta.missingEntities.map((e) => e.term)).toContain("paper birch");
  });

  it("does not report an entity we already name", () => {
    expect(delta.missingEntities.map((e) => e.term)).not.toContain(
      "american larch",
    );
  });

  it("splits entitySchema fields into present and missing", () => {
    expect(delta.presentEntityFields).toEqual(["hardinessZone"]);
    expect(delta.missingEntityFields).toEqual(["matureHeight", "sunRequirement"]);
  });

  it("reports schema types the ranking set carries and we lack", () => {
    expect(delta.missingSchemaTypes.map((s) => s.term)).toEqual(["ItemList"]);
  });

  it("computes numeric deltas against the top-10 median", () => {
    expect(delta.wordCountDelta).toBe(
      OUR_PAGE.wordCount - SERP.bodyWordCount.median,
    );
    expect(typeof delta.internalLinksDelta).toBe("number");
  });

  it("leaves a PAA question unanswered when the page never addresses it", () => {
    expect(delta.unansweredQuestions).toContain(
      "What trees survive zone 3 winters?",
    );
  });
});

describe("questions the page does answer", () => {
  it("counts a question as answered when headings carry its terms", () => {
    const page = extractPageFacts({
      url: OUR_URL,
      html: `<html><head><title>t</title></head><body><main>
        <h2>Which trees survive zone 3 winters</h2>
        <p>Plenty of them.</p></main></body></html>`,
    });
    const delta = computeDeltaFacts({ page, serp: SERP, config: CONFIG });
    expect(delta.unansweredQuestions).not.toContain(
      "What trees survive zone 3 winters?",
    );
  });
});

describe("schema type matching is normalization-safe", () => {
  // The bug: page schema was normalized (lowercased) but SERP schema terms stay
  // raw PascalCase, so a type the page HAD ("Service") read as missing.
  const page = extractPageFacts({
    url: OUR_URL,
    html: `<html><head><title>t</title></head><body><main><p>x</p>
      <script type="application/ld+json">{"@type":["Service","Person"]}</script>
      </main></body></html>`,
  });
  const serp = computeSerpFacts({
    observation: { ...OBSERVATION, results: OBSERVATION.results },
    ourDomain: OUR_URL,
    competitorPages: [1, 2].map((n) => ({
      position: n,
      url: `https://c${n}.com/x`,
      facts: extractPageFacts({
        url: `https://c${n}.com/x`,
        html: `<html><body><main><p>y</p>
          <script type="application/ld+json">{"@type":["Service","Organization"]}</script>
          </main></body></html>`,
      }),
    })),
  });
  const delta = computeDeltaFacts({ page, serp, config: CONFIG });

  it("does not report a schema type the page already declares", () => {
    expect(delta.missingSchemaTypes.map((s) => s.term)).not.toContain("Service");
  });

  it("still reports a type the page genuinely lacks", () => {
    expect(delta.missingSchemaTypes.map((s) => s.term)).toContain("Organization");
  });
});

describe("isRecommended", () => {
  it("is true at or above the share threshold", () => {
    expect(isRecommended({ term: "x", in: 3, of: 10 }, 0.3)).toBe(true);
    expect(isRecommended({ term: "x", in: 2, of: 10 }, 0.3)).toBe(false);
  });

  it("is false when the sample is empty, never a divide-by-zero", () => {
    expect(isRecommended({ term: "x", in: 0, of: 0 }, 0.3)).toBe(false);
  });
});
