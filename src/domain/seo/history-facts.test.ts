import { describe, it, expect } from "vitest";
import { computeHistoryFacts } from "./history-facts";
import { type SerpObservation } from "./serp-facts";

function snapshot(capturedAt: string, domains: string[]): SerpObservation {
  return {
    query: "cold hardy trees",
    location: "2840",
    capturedAt,
    features: [],
    paaQuestions: [],
    results: domains.map((domain, index) => ({
      position: index + 1,
      url: `https://${domain}/x`,
      domain,
      title: `Cold Hardy Trees by ${domain}`,
      description: null,
    })),
  };
}

describe("computeHistoryFacts — graceful degradation", () => {
  it("returns explicit nulls with a reason when there is no history", () => {
    const facts = computeHistoryFacts({ snapshots: [], currentTitleTerms: [] });

    expect(facts.observations).toBe(0);
    expect(facts.serpVolatility90d).toEqual({
      value: null,
      reason: "insufficient_history",
      observations: 0,
      required: 3,
    });
    expect(facts.top10Churn.value).toBeNull();
    expect(facts.termStability.value).toBeNull();
  });

  it("never substitutes a default for a missing per-query value", () => {
    const facts = computeHistoryFacts({
      snapshots: [snapshot("2026-07-01T00:00:00.000Z", ["a.com"])],
      currentTitleTerms: ["cold hardy"],
    });
    // One observation: churn needs 2, volatility 3. Both stay null — a zero
    // here would read as "this SERP never moves", which is a lie.
    expect(facts.serpVolatility90d.value).toBeNull();
    expect(facts.top10Churn.value).toBeNull();
    expect(facts.serpVolatility90d.observations).toBe(1);
  });
});

describe("computeHistoryFacts — volatility", () => {
  it("is 0 for a frozen SERP", () => {
    const facts = computeHistoryFacts({
      snapshots: [
        snapshot("2026-05-01T00:00:00.000Z", ["a.com", "b.com"]),
        snapshot("2026-06-01T00:00:00.000Z", ["a.com", "b.com"]),
        snapshot("2026-07-01T00:00:00.000Z", ["a.com", "b.com"]),
      ],
      currentTitleTerms: [],
    });
    expect(facts.serpVolatility90d.value).toBe(0);
  });

  it("is 1 when the top 10 is fully replaced each time", () => {
    const facts = computeHistoryFacts({
      snapshots: [
        snapshot("2026-05-01T00:00:00.000Z", ["a.com"]),
        snapshot("2026-06-01T00:00:00.000Z", ["b.com"]),
        snapshot("2026-07-01T00:00:00.000Z", ["c.com"]),
      ],
      currentTitleTerms: [],
    });
    expect(facts.serpVolatility90d.value).toBe(1);
  });

  it("sorts unordered input before comparing consecutive pairs", () => {
    const ordered = computeHistoryFacts({
      snapshots: [
        snapshot("2026-05-01T00:00:00.000Z", ["a.com", "b.com"]),
        snapshot("2026-06-01T00:00:00.000Z", ["a.com", "c.com"]),
        snapshot("2026-07-01T00:00:00.000Z", ["a.com", "d.com"]),
      ],
      currentTitleTerms: [],
    });
    const shuffled = computeHistoryFacts({
      snapshots: [
        snapshot("2026-07-01T00:00:00.000Z", ["a.com", "d.com"]),
        snapshot("2026-05-01T00:00:00.000Z", ["a.com", "b.com"]),
        snapshot("2026-06-01T00:00:00.000Z", ["a.com", "c.com"]),
      ],
      currentTitleTerms: [],
    });
    expect(shuffled.serpVolatility90d.value).toBe(
      ordered.serpVolatility90d.value,
    );
  });
});

describe("computeHistoryFacts — churn", () => {
  it("names who entered and exited since the previous observation", () => {
    const facts = computeHistoryFacts({
      snapshots: [
        snapshot("2026-07-01T00:00:00.000Z", ["a.com", "b.com"]),
        snapshot("2026-07-15T00:00:00.000Z", ["a.com", "c.com"]),
      ],
      currentTitleTerms: [],
    });
    expect(facts.top10Churn.value).toEqual({
      entered: ["c.com"],
      exited: ["b.com"],
      spanDays: 14,
    });
  });

  it("sees through a www prefix rather than reporting a phantom swap", () => {
    const facts = computeHistoryFacts({
      snapshots: [
        snapshot("2026-07-01T00:00:00.000Z", ["www.a.com"]),
        snapshot("2026-07-15T00:00:00.000Z", ["a.com"]),
      ],
      currentTitleTerms: [],
    });
    expect(facts.top10Churn.value?.entered).toEqual([]);
    expect(facts.top10Churn.value?.exited).toEqual([]);
  });
});

describe("computeHistoryFacts — term stability", () => {
  it("reports 1 when every current term is a long-standing norm", () => {
    const snapshots = Array.from({ length: 6 }, (_, i) =>
      snapshot(`2026-0${i + 1}-01T00:00:00.000Z`, ["a.com"]),
    );
    const facts = computeHistoryFacts({
      snapshots,
      // Every fixture title reads "Cold Hardy Trees by <domain>".
      currentTitleTerms: ["cold hardy"],
    });
    expect(facts.termStability.value).toBe(1);
  });

  it("reports 0 for a term that has never appeared before", () => {
    const snapshots = Array.from({ length: 6 }, (_, i) =>
      snapshot(`2026-0${i + 1}-01T00:00:00.000Z`, ["a.com"]),
    );
    const facts = computeHistoryFacts({
      snapshots,
      currentTitleTerms: ["emergency"],
    });
    expect(facts.termStability.value).toBe(0);
  });

  it("stays null below the six-observation floor", () => {
    const snapshots = Array.from({ length: 5 }, (_, i) =>
      snapshot(`2026-0${i + 1}-01T00:00:00.000Z`, ["a.com"]),
    );
    const facts = computeHistoryFacts({
      snapshots,
      currentTitleTerms: ["cold hardy"],
    });
    expect(facts.termStability.value).toBeNull();
    expect(facts.termStability.required).toBe(6);
  });
});
