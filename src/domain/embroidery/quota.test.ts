import { describe, it, expect } from "vitest";
import type { Generation } from "@/types/user";
import { computeQuota, MONTHLY_LIMIT, WINDOW_MS } from "./quota";

/**
 * Pure-rule tests for the embroidery generation quota — the 20-per-rolling-30-days
 * policy. Every case passes `now` explicitly so the rolling window is deterministic
 * (no wall-clock dependence). Byte-for-byte parity with the old
 * `src/app/embroidery/_lib/quota.ts` is the gate: the strict-less-than window
 * boundary, the `>= MONTHLY_LIMIT` threshold, the `unlimited` short-circuit, the
 * oldest-in-window `nextResetAt`, and the returned shape.
 */

// A fixed reference "now" so the window math is stable across machines/clocks.
const NOW = Date.UTC(2026, 4, 31, 12, 0, 0); // 2026-05-31T12:00:00Z

/** Build a Generation whose createdAt sits `ageMs` before NOW. */
function genAgedMs(ageMs: number): Generation {
  return {
    createdAt: new Date(NOW - ageMs),
    size: "4x4",
    inputHash: "hash",
    inputName: null,
    zipUrl: "https://example.com/out.zip",
    previewUrl: null,
  };
}

describe("computeQuota", () => {
  it("returns zero usage / not-exceeded / null reset for no generations", () => {
    const q = computeQuota([], NOW);
    expect(q).toEqual({
      used: 0,
      limit: MONTHLY_LIMIT,
      exceeded: false,
      unlimited: false,
      nextResetAt: null,
    });
  });

  it("excludes generations older than the 30-day window from `used`", () => {
    const generations: Generation[] = [
      genAgedMs(WINDOW_MS + 60_000), // outside the window (older than 30d)
      genAgedMs(WINDOW_MS * 2), // far outside the window
      genAgedMs(0), // inside (just now)
      genAgedMs(WINDOW_MS - 1), // inside (1ms shy of the boundary)
    ];
    const q = computeQuota(generations, NOW);
    expect(q.used).toBe(2);
    expect(q.exceeded).toBe(false);
    expect(q.nextResetAt).toBeNull();
  });

  it("treats a generation exactly WINDOW_MS old as NOT in-window (strict <)", () => {
    // now - createdAt === WINDOW_MS, so `now - createdAt < WINDOW_MS` is false.
    const q = computeQuota([genAgedMs(WINDOW_MS)], NOW);
    expect(q.used).toBe(0);
    expect(q.exceeded).toBe(false);
    expect(q.nextResetAt).toBeNull();
  });

  it("is not exceeded just under the limit, with null reset", () => {
    const generations = Array.from({ length: MONTHLY_LIMIT - 1 }, (_, i) =>
      genAgedMs(i * 1000),
    );
    const q = computeQuota(generations, NOW);
    expect(q.used).toBe(MONTHLY_LIMIT - 1);
    expect(q.exceeded).toBe(false);
    expect(q.nextResetAt).toBeNull();
  });

  it("is exceeded exactly at the limit, with reset = oldest-in-window + WINDOW_MS", () => {
    // 20 in-window generations; the oldest is the most-aged one.
    const oldestAgeMs = (MONTHLY_LIMIT - 1) * 60_000; // 19 minutes old
    const generations = Array.from({ length: MONTHLY_LIMIT }, (_, i) =>
      genAgedMs(i * 60_000),
    );
    const q = computeQuota(generations, NOW);
    expect(q.used).toBe(MONTHLY_LIMIT);
    expect(q.exceeded).toBe(true);
    expect(q.nextResetAt).toEqual(new Date(NOW - oldestAgeMs + WINDOW_MS));
  });

  it("picks the oldest in-window generation regardless of input order", () => {
    const ages = [5_000, 90_000, 1_000, 42_000]; // unsorted; oldest = 90s
    const generations = ages.map(genAgedMs);
    // Force exceeded by setting the limit context: re-use computeQuota with a
    // padded set so used >= limit and nextResetAt is computed.
    const padded = [
      ...generations,
      ...Array.from({ length: MONTHLY_LIMIT - generations.length }, (_, i) =>
        genAgedMs(100 + i),
      ),
    ];
    const q = computeQuota(padded, NOW);
    expect(q.used).toBe(MONTHLY_LIMIT);
    expect(q.exceeded).toBe(true);
    expect(q.nextResetAt).toEqual(new Date(NOW - 90_000 + WINDOW_MS));
  });

  it("unlimited never exceeds and never sets a reset, even past the limit", () => {
    const generations = Array.from({ length: MONTHLY_LIMIT + 5 }, (_, i) =>
      genAgedMs(i * 60_000),
    );
    const q = computeQuota(generations, NOW, { unlimited: true });
    expect(q.used).toBe(MONTHLY_LIMIT + 5);
    expect(q.exceeded).toBe(false);
    expect(q.unlimited).toBe(true);
    expect(q.nextResetAt).toBeNull();
    expect(q.limit).toBe(MONTHLY_LIMIT);
  });
});
