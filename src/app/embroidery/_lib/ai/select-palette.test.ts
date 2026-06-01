import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeLlmGateway } from "@/application/ports/llm-gateway.fake";
import { SELECT_PALETTE_SYSTEM_PROMPT } from "./prompts";

/**
 * `selectPalette` calls the LLM through `getLlmGateway()` from the DB-free
 * `@/composition/llm` module. We mock that module to hand back a recording
 * `FakeLlmGateway`, so these tests (a) assert the exact request the consumer
 * builds — model / temperature / system prompt / image URL / a user text that
 * carries MAX_THREADS + the thread table — and (b) finally unit-test the
 * Lab-merge / cap / routing consolidation deterministically, with no network.
 *
 * `vi.mock` is hoisted, so the fake is created in the factory and re-exported on
 * a module-scope holder the tests read.
 */
// A mutable holder set after imports resolve. `getLlmGateway()` is called per
// invocation by the consumer, so the mock reads `holder.fake` lazily — by the
// time any test runs, it has been assigned a real FakeLlmGateway below.
const holder = vi.hoisted(() => ({ fake: null as unknown }));

vi.mock("@/composition/llm", () => ({
  getLlmGateway: () => holder.fake,
}));

import { selectPalette } from "./select-palette";
import type { Thread } from "../inkstitch/gpl-palette";
import type { SampledColors } from "../worker";

const fake = new FakeLlmGateway();
holder.fake = fake;

const PNG_URL = "https://example.test/preview.png";

// A small available-thread list with clearly distinct Lab colors so the merge
// pass does NOT fuse them (each well over the merge ΔE threshold apart).
const THREADS: Thread[] = [
  { number: "1001", name: "Pure Red", hex: "#ff0000" },
  { number: "1002", name: "Pure Green", hex: "#00ff00" },
  { number: "1003", name: "Pure Blue", hex: "#0000ff" },
  { number: "1004", name: "Black", hex: "#000000" },
];

describe("selectPalette — request shape", () => {
  beforeEach(() => {
    fake.requests.length = 0;
    fake.cannedResponse = JSON.stringify({
      picks: [
        { number: "1001", role: "body" },
        { number: "1002", role: "accent" },
      ],
      routing: [],
      extract_outline: false,
    });
  });

  it("builds the gateway request with the locked-in model, temperature, prompt, image, and user text", async () => {
    await selectPalette(PNG_URL, THREADS, null, 12);

    expect(fake.requests).toHaveLength(1);
    const req = fake.requests[0];
    expect(req.model).toBe("gpt-5.4-mini");
    expect(req.temperature).toBe(0);
    expect(req.systemPrompt).toBe(SELECT_PALETTE_SYSTEM_PROMPT);
    expect(req.imageUrl).toBe(PNG_URL);

    // The user text carries the hard ceiling and the thread table.
    expect(req.userText).toContain("MAX_THREADS: 12");
    expect(req.userText).toContain("Available threads (4 total):");
    expect(req.userText).toContain("number\thex\trgb\tname");
    // Each available thread shows up as a tab-separated row.
    expect(req.userText).toContain("1001\t#ff0000\trgb(255,0,0)\tPure Red");
    expect(req.userText).toContain("1004\t#000000\trgb(0,0,0)\tBlack");
  });

  it("threads the maxThreads value into the user text", async () => {
    await selectPalette(PNG_URL, THREADS, null, 6);
    expect(fake.requests[0].userText).toContain("MAX_THREADS: 6");
    expect(fake.requests[0].userText).toContain("> 6 picks");
  });
});

describe("selectPalette — parsing & consolidation", () => {
  beforeEach(() => {
    fake.requests.length = 0;
  });

  it("returns distinct picks unmerged when they are far apart in Lab", async () => {
    fake.cannedResponse = JSON.stringify({
      picks: [
        { number: "1001", role: "body" },
        { number: "1002", role: "accent" },
        { number: "1003", role: "shadow" },
      ],
      routing: [],
      extract_outline: false,
      rationale: "Red body, green accent, blue shadow.",
    });

    const result = await selectPalette(PNG_URL, THREADS, null, 12);

    expect(result.threads.map((t) => t.number)).toEqual([
      "1001",
      "1002",
      "1003",
    ]);
    expect(result.threads[0].role).toBe("body");
    expect(result.extractOutline).toBe(false);
    expect(result.routing).toBeNull();
    expect(result.rationale).toBe("Red body, green accent, blue shadow.");
  });

  it("defaults extractOutline to true when the AI omits the flag", async () => {
    fake.cannedResponse = JSON.stringify({
      picks: [{ number: "1001" }, { number: "1002" }],
      routing: [],
    });

    const result = await selectPalette(PNG_URL, THREADS, null, 12);
    expect(result.extractOutline).toBe(true);
  });

  it("drops picks not present in the available list and dedupes repeats", async () => {
    fake.cannedResponse = JSON.stringify({
      picks: [
        { number: "1001" },
        { number: "9999" }, // not in the list — dropped
        { number: "1001" }, // duplicate — deduped
        { number: "1002" },
      ],
      routing: [],
      extract_outline: false,
    });

    const result = await selectPalette(PNG_URL, THREADS, null, 12);
    expect(result.threads.map((t) => t.number)).toEqual(["1001", "1002"]);
  });

  it("throws when fewer than two valid picks survive", async () => {
    fake.cannedResponse = JSON.stringify({
      picks: [{ number: "1001" }, { number: "9999" }],
      routing: [],
    });

    await expect(selectPalette(PNG_URL, THREADS, null, 12)).rejects.toThrow(
      /too few valid picks/,
    );
  });

  it("throws when the response has no picks array", async () => {
    fake.cannedResponse = JSON.stringify({ foo: "bar" });
    await expect(selectPalette(PNG_URL, THREADS, null, 12)).rejects.toThrow(
      /missing `picks` array/,
    );
  });

  it("merges near-duplicate Lab picks; the higher-coverage thread wins and absorbs the routes", async () => {
    // Two nearly-identical reds plus a clearly-distinct green. The reds are well
    // within the merge ΔE threshold, so they collapse to one rep; the
    // higher-coverage one (more routed clusters) survives.
    const threads: Thread[] = [
      { number: "R1", name: "Red A", hex: "#ff0000" },
      { number: "R2", name: "Red B", hex: "#fe0101" },
      { number: "G1", name: "Green", hex: "#00ff00" },
    ];
    const sampled: SampledColors = {
      colors: [
        { hex: "#ff0000", rgb: [255, 0, 0], count: 100, fraction: 0.5 },
        { hex: "#fe0101", rgb: [254, 1, 1], count: 10, fraction: 0.05 },
        { hex: "#00ff00", rgb: [0, 255, 0], count: 90, fraction: 0.45 },
      ],
      total_pixels: 200,
      total_distinct_colors: 3,
      cluster_spread: 360, // high contrast → loose merge threshold
    };

    fake.cannedResponse = JSON.stringify({
      picks: [{ number: "R1" }, { number: "R2" }, { number: "G1" }],
      routing: [
        { cluster_hex: "#ff0000", thread_number: "R1" },
        { cluster_hex: "#fe0101", thread_number: "R2" },
        { cluster_hex: "#00ff00", thread_number: "G1" },
      ],
      extract_outline: false,
    });

    const result = await selectPalette(PNG_URL, threads, sampled, 12);

    // The two reds merged to one; green stays. Two final threads.
    const numbers = result.threads.map((t) => t.number);
    expect(numbers).toHaveLength(2);
    expect(numbers).toContain("R1"); // higher-coverage red survives
    expect(numbers).not.toContain("R2");
    expect(numbers).toContain("G1");

    // Routing maps every cluster to a final index; the merged red cluster is
    // redirected to the surviving red's final index. No fallbacks.
    expect(result.routing).not.toBeNull();
    expect(result.routing!.clusters).toEqual(["#ff0000", "#fe0101", "#00ff00"]);
    expect(result.routing!.fallback).toBe(0);
    expect(result.routing!.aiRouted).toBe(3);
    const r1Idx = numbers.indexOf("R1");
    // Both red clusters route to the surviving red's final index.
    expect(result.routing!.routes[0]).toBe(r1Idx);
    expect(result.routing!.routes[1]).toBe(r1Idx);
    // The consolidation note is appended to the rationale.
    expect(result.rationale).toContain("Consolidated 3 AI picks → 2 threads");
  });

  it("enforces the cap by dropping the lowest-coverage rep and redirecting its cluster", async () => {
    // Four distinct, non-mergeable colors but a cap of 3. One pick (DR) is
    // routed the fewest clusters, so it is the cap-drop victim; its cluster
    // reroutes to the nearest-Lab survivor (Red), never to -1 fallback.
    const threads: Thread[] = [
      { number: "K", name: "Black", hex: "#000000" },
      { number: "W", name: "White", hex: "#ffffff" },
      { number: "R", name: "Red", hex: "#ff0000" },
      { number: "DR", name: "Dark Red", hex: "#7f0000" },
    ];
    const sampled: SampledColors = {
      colors: [
        { hex: "#000000", rgb: [0, 0, 0], count: 100, fraction: 0.3 },
        { hex: "#0a0a0a", rgb: [10, 10, 10], count: 90, fraction: 0.2 }, // → K (2 routes)
        { hex: "#ffffff", rgb: [255, 255, 255], count: 80, fraction: 0.15 },
        { hex: "#f5f5f5", rgb: [245, 245, 245], count: 70, fraction: 0.1 }, // → W (2 routes)
        { hex: "#ff0000", rgb: [255, 0, 0], count: 60, fraction: 0.1 },
        { hex: "#ee0000", rgb: [238, 0, 0], count: 50, fraction: 0.1 }, // → R (2 routes)
        { hex: "#7f0000", rgb: [127, 0, 0], count: 10, fraction: 0.05 }, // → DR (1 route — victim)
      ],
      total_pixels: 460,
      total_distinct_colors: 7,
      cluster_spread: 400,
    };

    fake.cannedResponse = JSON.stringify({
      picks: [
        { number: "K" },
        { number: "W" },
        { number: "R" },
        { number: "DR" },
      ],
      routing: [
        { cluster_hex: "#000000", thread_number: "K" },
        { cluster_hex: "#0a0a0a", thread_number: "K" }, // K: 2 routes
        { cluster_hex: "#ffffff", thread_number: "W" },
        { cluster_hex: "#f5f5f5", thread_number: "W" }, // W: 2 routes
        { cluster_hex: "#ff0000", thread_number: "R" },
        { cluster_hex: "#ee0000", thread_number: "R" }, // R: 2 routes
        { cluster_hex: "#7f0000", thread_number: "DR" }, // DR: 1 route — the victim
      ],
      extract_outline: false,
    });

    const result = await selectPalette(PNG_URL, threads, sampled, 3);

    const numbers = result.threads.map((t) => t.number);
    expect(numbers).toHaveLength(3);
    // DR had the fewest routes (1), so it is the cap-drop victim.
    expect(numbers).not.toContain("DR");
    expect(numbers).toContain("R");
    expect(numbers).toContain("K");
    expect(numbers).toContain("W");
    // No cluster falls back: the dark-red cluster reroutes to its nearest-Lab
    // survivor (Red), and all others keep their reps.
    expect(result.routing!.fallback).toBe(0);
    expect(result.routing!.routes[6]).toBe(numbers.indexOf("R"));
  });

  it("marks clusters the AI did not route as fallback (-1)", async () => {
    const sampled: SampledColors = {
      colors: [
        { hex: "#ff0000", rgb: [255, 0, 0], count: 100, fraction: 0.5 },
        { hex: "#abcdef", rgb: [171, 205, 239], count: 50, fraction: 0.5 },
      ],
      total_pixels: 150,
      total_distinct_colors: 2,
      cluster_spread: 300,
    };

    fake.cannedResponse = JSON.stringify({
      picks: [{ number: "1001" }, { number: "1003" }],
      routing: [{ cluster_hex: "#ff0000", thread_number: "1001" }],
      extract_outline: false,
    });

    const result = await selectPalette(PNG_URL, THREADS, sampled, 12);
    expect(result.routing!.routes[0]).toBe(0); // routed
    expect(result.routing!.routes[1]).toBe(-1); // unrouted → fallback
    expect(result.routing!.aiRouted).toBe(1);
    expect(result.routing!.fallback).toBe(1);
  });
});
