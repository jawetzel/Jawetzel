import { describe, it, expect, vi } from "vitest";

/**
 * Composition test for the supply-feed wiring. The vendor order is
 * **behavior-bearing**, not cosmetic: the refresh loop maps its
 * `Promise.allSettled` outcomes back to vendor names *positionally*, and the
 * `onlyVendor` filter walks the same list — so a reorder silently attributes
 * every vendor's results to its neighbour. That is what these assertions pin.
 *
 * The vendor pulls are stubbed for the same reason the adapter tests stub them:
 * to keep the real `fetch` parsers out of the module graph. Nothing here calls
 * `pull()`, but importing this composition root pulls each adapter — and its
 * parser — in transitively.
 *
 * This lived in `infrastructure/supply-feed/supply-feed-source.test.ts`, which
 * made an infrastructure test import `composition/` (`infrastructure-inward-only`
 * — composition is the one layer allowed to depend on everything, so nothing
 * inside a ring may reach back up into it). It tests the composition root, so it
 * belongs beside it; the per-adapter delegation tests stay with the adapters.
 */

vi.mock("@/worker/jobs/sources/gunnold-pull", () => ({ pullGunnold: vi.fn() }));
vi.mock("@/worker/jobs/sources/sulky-pull", () => ({ pullSulky: vi.fn() }));
vi.mock("@/worker/jobs/sources/allstitch-pull", () => ({ pullAllstitch: vi.fn() }));
vi.mock("@/worker/jobs/sources/habanddash-pull", () => ({ pullHabanddash: vi.fn() }));
vi.mock("@/worker/jobs/sources/coldesi-pull", () => ({ pullColdesi: vi.fn() }));
vi.mock("@/worker/jobs/sources/threadart-pull", () => ({ pullThreadart: vi.fn() }));
vi.mock("@/worker/jobs/sources/ohmycrafty-pull", () => ({ pullOhmycrafty: vi.fn() }));

import { getSupplyFeedSources } from "./supply-feed";

describe("getSupplyFeedSources", () => {
  it("returns the seven active vendors in the exact orchestrator order", () => {
    const names = getSupplyFeedSources().map((s) => s.name);
    expect(names).toEqual([
      "gunnold",
      "sulky",
      "allstitch",
      "habanddash",
      "coldesi",
      "threadart",
      "ohmycrafty",
    ]);
  });

  it("excludes madeirausa (not-yet-implemented stub)", () => {
    const names = getSupplyFeedSources().map((s) => s.name);
    expect(names).not.toContain("madeirausa");
  });

  it("returns exactly seven sources", () => {
    expect(getSupplyFeedSources()).toHaveLength(7);
  });

  it("every source has a string name and a pull function", () => {
    for (const source of getSupplyFeedSources()) {
      expect(typeof source.name).toBe("string");
      expect(typeof source.pull).toBe("function");
    }
  });
});
