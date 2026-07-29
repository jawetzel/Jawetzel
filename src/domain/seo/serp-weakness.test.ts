import { describe, expect, it } from "vitest";
import { computeSerpWeakness } from "@/domain/seo/serp-weakness";
import { type SerpObservation } from "@/domain/seo/serp-facts";

function serp(
  results: Array<{ url: string; title: string; position?: number }>,
  features: string[] = [],
): SerpObservation {
  return {
    query: "cold hardy trees",
    location: "2840",
    capturedAt: "2026-07-28T00:00:00.000Z",
    features,
    paaQuestions: [],
    results: results.map((r, i) => ({
      position: r.position ?? i + 1,
      url: r.url,
      domain: new URL(r.url).host,
      title: r.title,
      description: null,
    })),
  };
}

const BASE = {
  query: "cold hardy trees",
  ourDomain: "weekendplant.com",
  competitorDomains: [] as string[],
};

/** Ten purpose-built pages, all targeting the query. The hardest case. */
function strongSerp(): SerpObservation {
  return serp(
    Array.from({ length: 10 }, (_, i) => ({
      url: `https://site${i}.com/guide`,
      title: "Cold Hardy Trees — A Complete Guide",
    })),
  );
}

describe("computeSerpWeakness", () => {
  it("scores a page of purpose-built, on-target pages as strong", () => {
    const { score, facts } = computeSerpWeakness({
      ...BASE,
      observation: strongSerp(),
    });

    expect(score).toBe(0);
    expect(facts.titleTermCoverage).toBe(1);
    expect(facts.ugcResults).toBe(0);
  });

  it("scores forum threads as weak", () => {
    const { score, facts } = computeSerpWeakness({
      ...BASE,
      observation: serp([
        { url: "https://reddit.com/r/gardening/x", title: "Cold hardy trees?" },
        { url: "https://quora.com/q/y", title: "Cold hardy trees advice" },
        ...Array.from({ length: 8 }, (_, i) => ({
          url: `https://site${i}.com/guide`,
          title: "Cold Hardy Trees Guide",
        })),
      ]),
    });

    expect(facts.ugcResults).toBe(2);
    expect(score).toBeGreaterThan(0);
  });

  it("counts a forum thread on an unlisted domain by its path", () => {
    const { facts } = computeSerpWeakness({
      ...BASE,
      observation: serp([
        { url: "https://gardenweb.com/forum/12345", title: "Cold hardy trees" },
      ]),
    });

    expect(facts.ugcResults).toBe(1);
  });

  it("treats loose titles as the strongest weakness signal", () => {
    // Nobody is targeting the query precisely — Google assembled this page
    // rather than a field of competitors building for it.
    const { score, facts } = computeSerpWeakness({
      ...BASE,
      observation: serp(
        Array.from({ length: 10 }, (_, i) => ({
          url: `https://site${i}.com/x`,
          title: "Gardening tips for beginners",
        })),
      ),
    });

    expect(facts.titleTermCoverage).toBe(0);
    expect(score).toBe(40);
  });

  it("requires every significant query term in a title, not just one", () => {
    const { facts } = computeSerpWeakness({
      ...BASE,
      observation: serp([
        { url: "https://a.com/x", title: "Cold Hardy Trees for Zone 3" },
        { url: "https://b.com/x", title: "Hardy Perennials" },
      ]),
    });

    expect(facts.titleTermCoverage).toBe(0.5);
  });

  it("discounts an otherwise weak SERP sitting under an AI Overview", () => {
    const observation = serp(
      Array.from({ length: 10 }, (_, i) => ({
        url: `https://site${i}.com/x`,
        title: "Gardening tips",
      })),
      ["ai_overview"],
    );

    const { score } = computeSerpWeakness({ ...BASE, observation });
    expect(score).toBe(25); // 40 loose-title, less the 15 AI-Overview penalty
  });

  it("reports our own position without counting us as a competitor", () => {
    const { facts } = computeSerpWeakness({
      ...BASE,
      competitorDomains: ["thespruce.com"],
      observation: serp([
        { url: "https://thespruce.com/a", title: "Cold Hardy Trees" },
        { url: "https://www.weekendplant.com/b", title: "Cold Hardy Trees" },
      ]),
    });

    expect(facts.ourPosition).toBe(2);
    expect(facts.knownCompetitors).toEqual(["thespruce.com"]);
  });

  it("scores an unobservable SERP as 0, not as weak", () => {
    // No observation is not the same as a soft page one. Scoring it high would
    // float the keywords we know least about to the top of the worklist.
    const { score, facts } = computeSerpWeakness({
      ...BASE,
      observation: serp([]),
    });

    expect(score).toBe(0);
    expect(facts.resultCount).toBe(0);
  });
});
