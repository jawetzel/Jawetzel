import { describe, it, expect } from "vitest";
import { buildSwaps } from "./swaps";
import { type DeltaFacts } from "./delta-facts";
import { type PageFacts } from "./page-facts";
import { type SerpFacts } from "./serp-facts";

/**
 * These tests assert the SCORING ARITHMETIC exactly, so the facts are built by
 * hand rather than measured — a fixture HTML change must never be able to move
 * a score assertion without also changing what the test is about.
 */

function pageFacts(overrides: Partial<PageFacts> = {}): PageFacts {
  return {
    url: "https://weekendplant.com/trees",
    title: "Trees of the North",
    titleLength: 18,
    metaDescription: null,
    metaDescriptionLength: 0,
    h1: ["Trees of the North"],
    headings: [{ level: 2, text: "Choosing a Site" }],
    wordCount: 800,
    schemaTypes: ["Article"],
    canonical: null,
    noindex: false,
    imagesTotal: 0,
    imagesMissingAlt: 0,
    internalLinksOut: 0,
    externalLinksOut: 0,
    telLinks: [],
    phoneInHeader: false,
    text: "",
    phrases: new Set(),
    properNouns: new Map(),
    contentHash: "abc",
    ...overrides,
  };
}

function serpFacts(overrides: Partial<SerpFacts> = {}): SerpFacts {
  return {
    query: "cold hardy trees",
    location: "2840",
    capturedAt: "2026-07-22T12:00:00.000Z",
    features: [],
    ourPosition: 8,
    competitorCount: 10,
    crawledCount: 10,
    titleLength: { min: 40, median: 54, max: 70 },
    metaLength: { min: 120, median: 148, max: 160 },
    bodyWordCount: { min: 900, median: 1600, max: 2400 },
    internalLinksIn: { min: 1, median: 3, max: 6 },
    titleTerms: [],
    titlePatterns: [],
    metaTerms: [],
    headings: [],
    bodyPhrases: [],
    entities: [],
    schemaTypes: [],
    questions: [],
    titleExamples: [],
    metaExamples: [],
    displayForms: {},
    ...overrides,
  };
}

function deltaFacts(overrides: Partial<DeltaFacts> = {}): DeltaFacts {
  return {
    titleMissingTerms: [],
    titleMissingPatterns: [],
    metaMissingTerms: [],
    missingHeadings: [],
    missingBodyPhrases: [],
    missingEntities: [],
    unansweredQuestions: [],
    missingSchemaTypes: [],
    missingEntityFields: [],
    presentEntityFields: [],
    wordCountDelta: 0,
    internalLinksDelta: 0,
    ...overrides,
  };
}

function areaOf(swaps: ReturnType<typeof buildSwaps>, area: string) {
  return swaps.find((s) => s.area === area);
}

describe("buildSwaps — scoring", () => {
  it("weights features by how many competitors use them", () => {
    // Observed: "cold hardy" 8/10 (weight .8), "zone" 8/10 (.8), "best" 5/10 (.5).
    // Ours has none of them -> current 0. All three are at/above minShare .3,
    // so adopting them all reaches 100% of a 2.1 total.
    const swaps = buildSwaps({
      page: pageFacts(),
      serp: serpFacts({
        titleTerms: [
          { term: "cold hardy", in: 8, of: 10 },
          { term: "zone", in: 8, of: 10 },
          { term: "best", in: 5, of: 10 },
        ],
      }),
      delta: deltaFacts({
        titleMissingTerms: [
          { term: "cold hardy", in: 8, of: 10 },
          { term: "zone", in: 8, of: 10 },
          { term: "best", in: 5, of: 10 },
        ],
      }),
      minShare: 0.3,
      includeProvenance: false,
    });

    const title = areaOf(swaps, "title");
    expect(title?.currentScore).toBe(0);
    expect(title?.suggestedScore).toBe(100);
  });

  it("leaves the long tail out of the suggested score", () => {
    // "rare" is used by 1 of 10 — below minShare, so it stays in the denominator
    // but is never recommended. Suggested tops out below 100 as a result.
    const observed = [
      { term: "cold hardy", in: 8, of: 10 },
      { term: "rare", in: 1, of: 10 },
    ];
    const swaps = buildSwaps({
      page: pageFacts(),
      serp: serpFacts({ titleTerms: observed }),
      delta: deltaFacts({ titleMissingTerms: observed }),
      minShare: 0.3,
      includeProvenance: false,
    });

    const title = areaOf(swaps, "title");
    // .8 / (.8 + .1) = 89%
    expect(title?.suggestedScore).toBe(89);
    expect(title?.signals?.terms?.map((t) => t.term)).toEqual(["cold hardy"]);
  });

  it("credits features the page already has", () => {
    const swaps = buildSwaps({
      page: pageFacts({ title: "Cold Hardy Trees" }),
      serp: serpFacts({
        titleTerms: [
          { term: "cold hardy", in: 8, of: 10 },
          { term: "zone", in: 2, of: 10 },
        ],
      }),
      // Only "zone" is missing.
      delta: deltaFacts({ titleMissingTerms: [{ term: "zone", in: 2, of: 10 }] }),
      minShare: 0.3,
      includeProvenance: false,
    });

    const title = areaOf(swaps, "title");
    // .8 / (.8 + .2) = 80%. "zone" is below minShare so suggested stays 80.
    expect(title?.currentScore).toBe(80);
    expect(title?.suggestedScore).toBe(80);
  });

  it("scores numeric areas by distance from the observed median", () => {
    const swaps = buildSwaps({
      page: pageFacts({ wordCount: 800, internalLinksOut: 0 }),
      serp: serpFacts(),
      delta: deltaFacts(),
      minShare: 0.3,
      includeProvenance: false,
    });

    // 800 against a median of 1600 -> half the target.
    expect(areaOf(swaps, "length")?.currentScore).toBe(50);
    expect(areaOf(swaps, "length")?.suggested).toBe(1600);
    // 0 against a median of 3.
    expect(areaOf(swaps, "links")?.currentScore).toBe(0);
    expect(areaOf(swaps, "links")?.suggested).toBe(3);
  });

  it("scores entitySchema coverage as a plain ratio", () => {
    const swaps = buildSwaps({
      page: pageFacts(),
      serp: serpFacts(),
      delta: deltaFacts({
        presentEntityFields: ["hardinessZone"],
        missingEntityFields: ["matureHeight", "sunRequirement", "soilType"],
      }),
      minShare: 0.3,
      includeProvenance: false,
    });

    const facts = areaOf(swaps, "facts");
    expect(facts?.currentScore).toBe(25);
    expect(facts?.suggestedScore).toBe(100);
    expect(facts?.suggested).toEqual([
      "matureHeight",
      "sunRequirement",
      "soilType",
    ]);
  });
});

describe("buildSwaps — shape", () => {
  const swaps = buildSwaps({
    page: pageFacts(),
    serp: serpFacts({
      titleTerms: [{ term: "cold hardy", in: 8, of: 10 }],
      metaTerms: [{ term: "zone", in: 7, of: 10 }],
      metaExamples: ["Discover 23 cold hardy trees."],
      titleExamples: ["23 Cold Hardy Trees for Zone 3 Gardens"],
      headings: [{ term: "hardiness zones", in: 6, of: 10 }],
      schemaTypes: [{ term: "ItemList", in: 6, of: 10 }],
      questions: ["how fast do cold hardy trees grow"],
      displayForms: { "hardiness zones": "Hardiness Zones" },
    }),
    delta: deltaFacts({
      titleMissingTerms: [{ term: "cold hardy", in: 8, of: 10 }],
      metaMissingTerms: [{ term: "zone", in: 7, of: 10 }],
      missingHeadings: [{ term: "hardiness zones", in: 6, of: 10 }],
      missingSchemaTypes: [{ term: "ItemList", in: 6, of: 10 }],
      unansweredQuestions: ["how fast do cold hardy trees grow"],
    }),
    minShare: 0.3,
    includeProvenance: false,
  });

  it("gives title and meta signals, never a suggested string", () => {
    const title = areaOf(swaps, "title");
    expect(title?.suggested).toBeUndefined();
    expect(title?.signals?.lengthMedian).toBe(54);
    expect(title?.signals?.examples).toEqual([
      "23 Cold Hardy Trees for Zone 3 Gardens",
    ]);

    const meta = areaOf(swaps, "meta");
    expect(meta?.suggested).toBeUndefined();
    expect(meta?.current).toBeNull();
    expect(meta?.currentScore).toBe(0);
  });

  it("gives set areas a suggested set in original casing", () => {
    expect(areaOf(swaps, "headings")?.suggested).toEqual(["Hardiness Zones"]);
  });

  it("treats schema as additive — the suggestion is the full end state", () => {
    expect(areaOf(swaps, "schema")?.suggested).toEqual(["Article", "ItemList"]);
  });

  it("sorts by leverage, highest gap first", () => {
    const gaps = swaps.map((s) => s.suggestedScore - s.currentScore);
    expect(gaps).toEqual([...gaps].sort((a, b) => b - a));
  });

  it("omits provenance by default and attaches it on request", () => {
    expect(areaOf(swaps, "title")?.provenance).toBeUndefined();

    const withProvenance = buildSwaps({
      page: pageFacts(),
      serp: serpFacts({ titleTerms: [{ term: "cold hardy", in: 8, of: 10 }] }),
      delta: deltaFacts({
        titleMissingTerms: [{ term: "cold hardy", in: 8, of: 10 }],
      }),
      minShare: 0.3,
      includeProvenance: true,
    });
    expect(areaOf(withProvenance, "title")?.provenance).toEqual([
      { term: "cold hardy", in: 8, of: 10 },
    ]);
  });

  it("omits areas with no observed data instead of scoring them zero", () => {
    const empty = buildSwaps({
      page: pageFacts({ metaDescription: "present" }),
      serp: serpFacts({ crawledCount: 0, competitorCount: 0 }),
      delta: deltaFacts(),
      minShare: 0.3,
      includeProvenance: false,
    });
    expect(empty.map((s) => s.area)).toEqual([]);
  });
});
