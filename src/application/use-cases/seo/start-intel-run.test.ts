import { describe, expect, it } from "vitest";
import { isOk } from "@/domain/shared/result";
import { type SeoTag } from "@/domain/seo/workspace";
import { InMemorySeoWorkspaceRepository } from "@/application/ports/seo-workspace-repository.fake";
import {
  FakeSerpCompetitorsGateway,
  competitorRow,
} from "@/application/ports/serp-competitors-gateway.fake";
import { createStartIntelRun } from "@/application/use-cases/seo/start-intel-run";
import { createApproveCompetitors } from "@/application/use-cases/seo/approve-competitors";

const TAG: SeoTag = {
  tag: "weekendplant",
  label: "Weekend Plant",
  domain: "weekendplant.com",
  locationCode: 2840,
  languageCode: "en",
  entitySchema: ["hardinessZone"],
  urgencyTerms: [],
  city: null,
  createdAt: "2026-07-01T00:00:00.000Z",
};

function build(
  gateway: FakeSerpCompetitorsGateway,
  seed: { tags?: SeoTag[] } = { tags: [TAG] },
) {
  const workspace = new InMemorySeoWorkspaceRepository(seed);
  const startIntelRun = createStartIntelRun({
    workspace,
    competitors: gateway,
    newId: () => "run-1",
    now: () => new Date("2026-07-28T12:00:00.000Z"),
  });
  const approveCompetitors = createApproveCompetitors({
    workspace,
    now: () => new Date("2026-07-28T13:00:00.000Z"),
  });
  return { workspace, startIntelRun, approveCompetitors };
}

describe("StartIntelRun", () => {
  it("stores the ranked competitor set awaiting approval", async () => {
    const gateway = new FakeSerpCompetitorsGateway({
      rows: [
        competitorRow("thespruce.com", 8, { avgPosition: 4 }),
        competitorRow("gardenia.net", 5, { avgPosition: 11 }),
      ],
      cost: 0.031,
    });
    const { startIntelRun, workspace } = build(gateway);

    const result = await startIntelRun.execute({
      tag: "weekendplant",
      keywords: ["Cold Hardy Trees", "zone 3 trees", "cold hardy trees"],
    });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    // Duplicates collapse before the vendor is asked — we pay per keyword.
    expect(result.value.run.keywords).toEqual([
      "cold hardy trees",
      "zone 3 trees",
    ]);
    expect(result.value.run.status).toBe("competitors_pending");
    expect(result.value.run.approvedCompetitors).toBeNull();
    expect(result.value.cost).toBe(0.031);
    expect(result.value.run.competitors?.rows.map((r) => r.domain)).toEqual([
      "thespruce.com",
      "gardenia.net",
    ]);

    const stored = await workspace.findRun("run-1");
    expect(stored?.status).toBe("competitors_pending");
  });

  it("passes the tag's location and language to the gateway", async () => {
    const gateway = new FakeSerpCompetitorsGateway({
      rows: [competitorRow("thespruce.com", 8)],
    });
    const { startIntelRun } = build(gateway, {
      tags: [{ ...TAG, locationCode: 2826, languageCode: "en-GB" }],
    });

    await startIntelRun.execute({ tag: "weekendplant", keywords: ["hedges"] });

    expect(gateway.requests[0]).toMatchObject({
      locationCode: 2826,
      languageCode: "en-GB",
      keywords: ["hedges"],
    });
  });

  it("rejects an unknown tag before spending anything", async () => {
    const gateway = new FakeSerpCompetitorsGateway({ rows: [] });
    const { startIntelRun } = build(gateway);

    const result = await startIntelRun.execute({
      tag: "nope",
      keywords: ["trees"],
    });

    expect(result).toEqual({ ok: false, error: "TAG_NOT_FOUND" });
    expect(gateway.requests).toHaveLength(0);
  });

  it("rejects a keyword list that normalizes to nothing", async () => {
    const gateway = new FakeSerpCompetitorsGateway({ rows: [] });
    const { startIntelRun } = build(gateway);

    const result = await startIntelRun.execute({
      tag: "weekendplant",
      keywords: ["   ", ""],
    });

    expect(result).toEqual({ ok: false, error: "NO_KEYWORDS" });
    expect(gateway.requests).toHaveLength(0);
  });

  it("persists the run when the vendor fails, so the keyword list survives", async () => {
    const gateway = new FakeSerpCompetitorsGateway({ error: "UPSTREAM_ERROR" });
    const { startIntelRun, workspace } = build(gateway);

    const result = await startIntelRun.execute({
      tag: "weekendplant",
      keywords: ["cold hardy trees"],
    });

    expect(result).toEqual({ ok: false, error: "COMPETITORS_UNAVAILABLE" });
    const stored = await workspace.findRun("run-1");
    expect(stored?.status).toBe("draft");
    expect(stored?.keywords).toEqual(["cold hardy trees"]);
  });

  it("maps a missing credential to its own error, distinct from a bad response", async () => {
    const gateway = new FakeSerpCompetitorsGateway({ error: "NOT_CONFIGURED" });
    const { startIntelRun } = build(gateway);

    const result = await startIntelRun.execute({
      tag: "weekendplant",
      keywords: ["cold hardy trees"],
    });

    expect(result).toEqual({ ok: false, error: "COMPETITORS_NOT_CONFIGURED" });
  });
});

describe("ApproveCompetitors", () => {
  async function runWithCompetitors() {
    const gateway = new FakeSerpCompetitorsGateway({
      rows: [competitorRow("thespruce.com", 8), competitorRow("gardenia.net", 5)],
    });
    const ctx = build(gateway);
    await ctx.startIntelRun.execute({
      tag: "weekendplant",
      keywords: ["cold hardy trees"],
    });
    return ctx;
  }

  it("records the approved subset and advances the run", async () => {
    const { approveCompetitors } = await runWithCompetitors();

    const result = await approveCompetitors.execute({
      runId: "run-1",
      domains: ["thespruce.com"],
    });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.status).toBe("competitors_approved");
    expect(result.value.approvedCompetitors).toEqual(["thespruce.com"]);
  });

  it("honours an empty approval literally rather than falling back to all", async () => {
    // Rejecting every domain is a real decision. Treating it as "use them all"
    // would spend layer 2's money against an explicit instruction.
    const { approveCompetitors } = await runWithCompetitors();

    const result = await approveCompetitors.execute({
      runId: "run-1",
      domains: [],
    });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.approvedCompetitors).toEqual([]);
    expect(result.value.status).toBe("competitors_approved");
  });

  it("drops domains layer 1 never observed", async () => {
    const { approveCompetitors } = await runWithCompetitors();

    const result = await approveCompetitors.execute({
      runId: "run-1",
      domains: ["www.thespruce.com", "invented.com"],
    });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.approvedCompetitors).toEqual(["thespruce.com"]);
  });

  it("refuses to gate a run whose layer 1 never returned", async () => {
    const gateway = new FakeSerpCompetitorsGateway({ error: "UPSTREAM_ERROR" });
    const { startIntelRun, approveCompetitors } = build(gateway);
    await startIntelRun.execute({
      tag: "weekendplant",
      keywords: ["cold hardy trees"],
    });

    const result = await approveCompetitors.execute({
      runId: "run-1",
      domains: ["thespruce.com"],
    });

    expect(result).toEqual({ ok: false, error: "COMPETITORS_NOT_READY" });
  });

  it("reports a missing run rather than creating one", async () => {
    const gateway = new FakeSerpCompetitorsGateway({ rows: [] });
    const { approveCompetitors } = build(gateway);

    const result = await approveCompetitors.execute({
      runId: "ghost",
      domains: [],
    });

    expect(result).toEqual({ ok: false, error: "RUN_NOT_FOUND" });
  });
});
