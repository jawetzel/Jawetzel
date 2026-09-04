import { describe, expect, it } from "vitest";
import { isOk } from "@/domain/shared/result";
import { type GapKeyword } from "@/domain/seo/gap-pile";
import { type SeoTag } from "@/domain/seo/workspace";
import { type SerpObservation } from "@/domain/seo/serp-facts";
import { ok, err, type Result } from "@/domain/shared/result";
import {
  type SerpFetchResult,
  type SerpGateway,
  type SerpGatewayError,
  type SerpRequest,
} from "@/application/ports/serp-gateway";
import { InMemorySeoWorkspaceRepository } from "@/application/ports/seo-workspace-repository.fake";
import { InMemorySeoGapRepository } from "@/application/ports/seo-gap-repository.fake";
import { FakeKeywordMetricsGateway } from "@/application/ports/keyword-metrics-gateway.fake";
import { FakeSeoCorpusRepository } from "@/application/ports/seo-corpus-repository.fake";
import { createScreenFinalists } from "@/application/use-cases/seo/screen-finalists";

/**
 * Per-query {@link SerpGateway} double. The shared `FakeSerpGateway` returns
 * one fixed observation; layer 3 fans out across many keywords and needs a
 * different answer — including a failure — per query.
 */
class MultiSerpGateway implements SerpGateway {
  readonly requests: SerpRequest[] = [];

  constructor(private readonly byQuery: Record<string, SerpObservation>) {}

  async fetchSerp(
    request: SerpRequest,
  ): Promise<Result<SerpFetchResult, SerpGatewayError>> {
    this.requests.push(request);
    const observation = this.byQuery[request.query];
    if (!observation) return err("NO_RESULTS");
    return ok({ observation, cost: 0.002 });
  }
}

const TAG: SeoTag = {
  tag: "weekendplant",
  label: "Weekend Plant",
  domain: "weekendplant.com",
  locationCode: 2840,
  languageCode: "en",
  entitySchema: [],
  urgencyTerms: [],
  city: null,
  createdAt: "2026-07-01T00:00:00.000Z",
};

function row(overrides: Partial<GapKeyword> = {}): GapKeyword {
  return {
    tag: "weekendplant",
    keyword: "cold hardy trees",
    location: "2840",
    bucket: "gap",
    status: "accepted",
    searchVolume: 900,
    cpc: null,
    competition: null,
    difficulty: 30,
    intent: "informational",
    ourPosition: null,
    ourUrl: null,
    competitors: [{ domain: "thespruce.com", position: 3, url: null }],
    screening: null,
    firstSeenAt: "2026-07-01T00:00:00.000Z",
    lastSeenAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function serp(query: string, titles: string[]): SerpObservation {
  return {
    query,
    location: "2840",
    capturedAt: "2026-07-28T00:00:00.000Z",
    features: [],
    paaQuestions: [],
    results: titles.map((title, i) => ({
      position: i + 1,
      url: `https://site${i}.com/x`,
      domain: `site${i}.com`,
      title,
      description: null,
    })),
  };
}

/**
 * Frozen "now", shared by the use-case **and** the corpus fake.
 *
 * `FakeSeoCorpusRepository` defaults its clock to `new Date()`, so leaving it
 * unset silently measured the freshness window against the real wall clock while
 * the use-case ran at a fixed instant. The corpus-reuse test seeds a snapshot
 * stamped `2026-07-28`; once real time passed `DEFAULT_MAX_SNAPSHOT_AGE_DAYS`
 * (7) beyond that, the fake declared it stale and the use-case paid for a fresh
 * SERP — a time bomb that passed until 2026-08-04 and failed every run after.
 * Both clocks must be the same instant.
 */
const NOW = (): Date => new Date("2026-07-28T13:00:00.000Z");

function build(options: {
  rows?: GapKeyword[];
  serps?: Record<string, SerpObservation>;
}) {
  const workspace = new InMemorySeoWorkspaceRepository({ tags: [TAG] });
  const gaps = new InMemorySeoGapRepository(options.rows ?? [row()]);
  const serpGateway = new MultiSerpGateway(options.serps ?? {});
  const keywords = new FakeKeywordMetricsGateway([]);
  const corpus = new FakeSeoCorpusRepository({}, NOW);
  const screenFinalists = createScreenFinalists({
    workspace,
    gaps,
    serp: serpGateway,
    keywords,
    corpus,
    now: NOW,
  });
  return { gaps, serpGateway, corpus, screenFinalists };
}

describe("ScreenFinalists", () => {
  it("screens accepted keywords and stores the score with its operands", async () => {
    const { screenFinalists, gaps } = build({
      serps: {
        "cold hardy trees": serp("cold hardy trees", [
          "Gardening tips",
          "More gardening",
        ]),
      },
    });

    const result = await screenFinalists.execute({ tag: "weekendplant" });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.screened).toBe(1);

    const [stored] = await gaps.list({ tag: "weekendplant", limit: 10 });
    expect(stored.screening).not.toBeNull();
    // Every operand is stored, not just the number — the score is a sort
    // order a reviewer can overrule, not a verdict.
    expect(stored.screening?.facts.titleTermCoverage).toBe(0);
    expect(stored.screening?.weaknessScore).toBe(40);
  });

  it("ignores keywords that are not accepted", async () => {
    const { screenFinalists, serpGateway } = build({
      rows: [row({ status: "new" }), row({ keyword: "other", status: "rejected" })],
    });

    const result = await screenFinalists.execute({ tag: "weekendplant" });

    expect(result).toEqual({ ok: false, error: "NOTHING_ACCEPTED" });
    expect(serpGateway.requests).toHaveLength(0);
  });

  it("skips already-screened rows unless rescreen is asked for", async () => {
    const screened = row({
      screening: {
        capturedAt: "2026-07-01T00:00:00.000Z",
        weaknessScore: 55,
        facts: {
          resultCount: 10,
          ugcResults: 2,
          directoryResults: 0,
          titleTermCoverage: 0.5,
          distinctDomains: 10,
          knownCompetitors: [],
          features: [],
          ourPosition: null,
        },
      },
    });
    const { screenFinalists, serpGateway } = build({ rows: [screened] });

    const first = await screenFinalists.execute({ tag: "weekendplant" });
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    expect(first.value.screened).toBe(0);
    expect(first.value.skipped).toBe(1);
    expect(serpGateway.requests).toHaveLength(0);
  });

  it("reuses a corpus SERP instead of paying for a fresh one", async () => {
    const { screenFinalists, corpus, serpGateway } = build({});
    await corpus.saveSnapshot(
      serp("cold hardy trees", ["Cold Hardy Trees Guide"]),
    );

    const result = await screenFinalists.execute({ tag: "weekendplant" });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.fromCorpus).toBe(1);
    expect(result.value.cost).toBe(0);
    expect(serpGateway.requests).toHaveLength(0);
  });

  it("caps a run and reports what is left", async () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      row({ keyword: `kw ${i}` }),
    );
    const serps = Object.fromEntries(
      rows.map((r) => [r.keyword, serp(r.keyword, ["Something else"])]),
    );
    const { screenFinalists } = build({ rows, serps });

    const result = await screenFinalists.execute({
      tag: "weekendplant",
      limit: 2,
    });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.screened).toBe(2);
    expect(result.value.remaining).toBe(3);
  });

  it("keeps going when one keyword's SERP fails", async () => {
    const rows = [row({ keyword: "good" }), row({ keyword: "bad" })];
    const { screenFinalists } = build({
      rows,
      serps: { good: serp("good", ["Unrelated"]) },
    });

    const result = await screenFinalists.execute({ tag: "weekendplant" });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.screened).toBe(1);
    expect(result.value.failed).toBe(1);
  });

  it("preserves the screening when layer 2 is later refreshed", async () => {
    // Layer 3 costs a call per keyword. Re-running layer 2 must not silently
    // throw that away — `merge` is what guarantees it.
    const { screenFinalists, gaps } = build({
      serps: { "cold hardy trees": serp("cold hardy trees", ["Unrelated"]) },
    });
    await screenFinalists.execute({ tag: "weekendplant" });

    await gaps.mergeAll({
      tag: "weekendplant",
      observed: [row({ searchVolume: 4200 })],
    });

    const [stored] = await gaps.list({ tag: "weekendplant", limit: 10 });
    expect(stored.searchVolume).toBe(4200);
    expect(stored.screening?.weaknessScore).toBe(40);
  });
});
