import { describe, expect, it } from "vitest";
import { isOk } from "@/domain/shared/result";
import { type IntelRun, type SeoTag } from "@/domain/seo/workspace";
import { InMemorySeoWorkspaceRepository } from "@/application/ports/seo-workspace-repository.fake";
import { InMemorySeoGapRepository } from "@/application/ports/seo-gap-repository.fake";
import {
  FakeDomainIntersectionGateway,
  gapRow,
  type IntersectionOutcome,
} from "@/application/ports/domain-intersection-gateway.fake";
import { FakeRankedKeywordsGateway } from "@/application/ports/ranked-keywords-gateway.fake";
import { createBuildGapPile } from "@/application/use-cases/seo/build-gap-pile";
import { createSetGapStatus } from "@/application/use-cases/seo/set-gap-status";

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

const RUN: IntelRun = {
  runId: "run-1",
  tag: "weekendplant",
  keywords: ["cold hardy trees"],
  locationCode: 2840,
  languageCode: "en",
  status: "competitors_approved",
  createdAt: "2026-07-28T12:00:00.000Z",
  updatedAt: "2026-07-28T12:00:00.000Z",
  competitors: {
    rows: [
      {
        domain: "a.com",
        intersections: 8,
        share: 0.8,
        avgPosition: null,
        medianPosition: null,
        visibility: null,
        estimatedTraffic: null,
      },
      {
        domain: "b.com",
        intersections: 5,
        share: 0.5,
        avgPosition: null,
        medianPosition: null,
        visibility: null,
        estimatedTraffic: null,
      },
    ],
    capturedAt: "2026-07-28T12:00:00.000Z",
    cost: 0.03,
    keywordCount: 10,
  },
  approvedCompetitors: ["a.com", "b.com"],
};

function build(options: {
  run?: IntelRun;
  intersections?: Record<string, IntersectionOutcome>;
  own?: ConstructorParameters<typeof FakeRankedKeywordsGateway>[0];
}) {
  const workspace = new InMemorySeoWorkspaceRepository({
    tags: [TAG],
    runs: [options.run ?? RUN],
  });
  const gaps = new InMemorySeoGapRepository();
  const intersection = new FakeDomainIntersectionGateway(
    options.intersections ?? {},
  );
  const rankedKeywords = new FakeRankedKeywordsGateway(options.own ?? {});
  const buildGapPile = createBuildGapPile({
    workspace,
    gaps,
    intersection,
    rankedKeywords,
    now: () => new Date("2026-07-28T13:00:00.000Z"),
  });
  return {
    workspace,
    gaps,
    intersection,
    buildGapPile,
    setGapStatus: createSetGapStatus({ gaps }),
  };
}

describe("BuildGapPile", () => {
  it("sends the competitor as target1 and us as target2", async () => {
    const { buildGapPile, intersection } = build({
      intersections: { "a.com": { rows: [gapRow("zone 3 trees", 3)] } },
    });

    await buildGapPile.execute({ runId: "run-1" });

    expect(intersection.requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          competitorDomain: "a.com",
          ourDomain: "weekendplant.com",
        }),
      ]),
    );
  });

  it("merges both buckets into the pile and reports the split", async () => {
    const { buildGapPile, gaps } = build({
      intersections: {
        "a.com": { rows: [gapRow("zone 3 trees", 3)], cost: 0.15 },
        "b.com": { rows: [gapRow("zone 3 trees", 5)], cost: 0.15 },
      },
    });

    const result = await buildGapPile.execute({ runId: "run-1" });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    // Two competitors, one shared keyword — folded to a single gap row.
    expect(result.value.gapRows).toBe(1);
    expect(result.value.added).toBe(1);
    expect(result.value.cost).toBeCloseTo(0.3);

    const [row] = await gaps.list({ tag: "weekendplant", limit: 10 });
    expect(row.competitors.map((c) => c.domain)).toEqual(["a.com", "b.com"]);
  });

  it("keeps going when one competitor's pull fails", async () => {
    // At roughly a dollar-fifty a run, discarding five good pulls because the
    // sixth timed out would be the wrong trade.
    const { buildGapPile } = build({
      intersections: {
        "a.com": { rows: [gapRow("zone 3 trees", 3)] },
        "b.com": { error: "UPSTREAM_ERROR" },
      },
    });

    const result = await buildGapPile.execute({ runId: "run-1" });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.gapRows).toBe(1);
    expect(result.value.competitors).toEqual(
      expect.arrayContaining([
        { domain: "a.com", rows: 1, failed: false },
        { domain: "b.com", rows: 0, failed: true },
      ]),
    );
  });

  it("refuses to run before the layer-1 gate is passed", async () => {
    const { buildGapPile, intersection } = build({
      run: { ...RUN, status: "competitors_pending", approvedCompetitors: null },
    });

    const result = await buildGapPile.execute({ runId: "run-1" });

    expect(result).toEqual({ ok: false, error: "COMPETITORS_NOT_APPROVED" });
    expect(intersection.requests).toHaveLength(0);
  });

  it("distinguishes 'rejected everything' from 'not yet decided'", async () => {
    const { buildGapPile, intersection } = build({
      run: { ...RUN, approvedCompetitors: [] },
    });

    const result = await buildGapPile.execute({ runId: "run-1" });

    expect(result).toEqual({ ok: false, error: "NO_COMPETITORS_APPROVED" });
    expect(intersection.requests).toHaveLength(0);
  });

  it("builds the improve bucket from our own striking-distance rankings", async () => {
    // `domain_intersection` with intersections:false can only ever return
    // keywords we DON'T hold, so "your content could rank better" has to come
    // from the opposite direction — one extra call, highest-ROI bucket.
    const { buildGapPile, gaps } = build({
      intersections: { "a.com": { rows: [gapRow("zone 3 trees", 3)] } },
      own: {
        "weekendplant.com": {
          target: "weekendplant.com",
          location: "2840",
          capturedAt: "2026-07-28T12:00:00.000Z",
          totalCount: 3,
          rows: [
            {
              keyword: "already winning",
              position: 2,
              url: "https://weekendplant.com/a",
              searchVolume: 500,
              cpc: null,
              competition: null,
              difficulty: null,
              intent: null,
            },
            {
              keyword: "nearly there",
              position: 8,
              url: "https://weekendplant.com/b",
              searchVolume: 900,
              cpc: null,
              competition: null,
              difficulty: null,
              intent: null,
            },
          ],
        },
      },
    });

    const result = await buildGapPile.execute({ runId: "run-1" });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.improveRows).toBe(1);

    const improve = await gaps.list({
      tag: "weekendplant",
      bucket: "improve",
      limit: 10,
    });
    expect(improve.map((r) => r.keyword)).toEqual(["nearly there"]);
    expect(improve[0].ourPosition).toBe(8);
    expect(improve[0].ourUrl).toBe("https://weekendplant.com/b");
  });

  it("still produces a pile for a property that ranks for nothing yet", async () => {
    // seo.md's "coverage building" mode. `NO_DATA` on our own domain is a real
    // answer, not a failure — the gap half is exactly what such a site needs.
    const { buildGapPile } = build({
      intersections: { "a.com": { rows: [gapRow("zone 3 trees", 3)] } },
      own: {},
    });

    const result = await buildGapPile.execute({ runId: "run-1" });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.improveRows).toBe(0);
    expect(result.value.gapRows).toBe(1);
  });

  it("advances the run to gaps_ready", async () => {
    const { buildGapPile, workspace } = build({
      intersections: { "a.com": { rows: [gapRow("zone 3 trees", 3)] } },
    });

    await buildGapPile.execute({ runId: "run-1" });

    expect((await workspace.findRun("run-1"))?.status).toBe("gaps_ready");
  });

  it("fails only when neither source produced anything", async () => {
    const { buildGapPile } = build({
      intersections: { "a.com": { rows: [] }, "b.com": { rows: [] } },
    });

    const result = await buildGapPile.execute({ runId: "run-1" });

    expect(result).toEqual({ ok: false, error: "NO_GAP_DATA" });
  });

  it("does not resurrect a rejected keyword on a re-run", async () => {
    // The merge rule, end to end: the second pull refreshes the metrics and
    // leaves the human's verdict alone.
    const { buildGapPile, setGapStatus, gaps } = build({
      intersections: {
        "a.com": { rows: [gapRow("zone 3 trees", 3, { searchVolume: 100 })] },
      },
    });

    await buildGapPile.execute({ runId: "run-1" });
    await setGapStatus.execute({
      tag: "weekendplant",
      keywords: ["zone 3 trees"],
      status: "rejected",
    });
    await buildGapPile.execute({ runId: "run-1" });

    const [row] = await gaps.list({ tag: "weekendplant", limit: 10 });
    expect(row.status).toBe("rejected");
    expect(row.firstSeenAt).toBe("2026-07-28T13:00:00.000Z");
  });
});
