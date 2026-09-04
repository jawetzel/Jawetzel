import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Driven-adapter tests for the SupplyFeedSource port. Each adapter is a thin
 * wrapper over its unchanged `jobs/sources/<vendor>-pull` parser, so the only
 * behavior to assert is: it exposes the right `name`, and `pull()` delegates to
 * the wrapped parser and returns its value. We stub each wrapped pull with
 * `vi.mock` so no real network fetch runs — the parsing logic is untouched and
 * out of scope here.
 *
 * The wiring itself — that `getSupplyFeedSources()` returns the seven active
 * vendors in the exact, behavior-bearing order, madeirausa excluded — is
 * asserted in `composition/supply-feed.test.ts`, beside the root it covers.
 */

vi.mock("@/worker/jobs/sources/gunnold-pull", () => ({
  pullGunnold: vi.fn(),
}));
vi.mock("@/worker/jobs/sources/sulky-pull", () => ({
  pullSulky: vi.fn(),
}));
vi.mock("@/worker/jobs/sources/allstitch-pull", () => ({
  pullAllstitch: vi.fn(),
}));
vi.mock("@/worker/jobs/sources/habanddash-pull", () => ({
  pullHabanddash: vi.fn(),
}));
vi.mock("@/worker/jobs/sources/coldesi-pull", () => ({
  pullColdesi: vi.fn(),
}));
vi.mock("@/worker/jobs/sources/threadart-pull", () => ({
  pullThreadart: vi.fn(),
}));
vi.mock("@/worker/jobs/sources/ohmycrafty-pull", () => ({
  pullOhmycrafty: vi.fn(),
}));

import { pullGunnold } from "@/worker/jobs/sources/gunnold-pull";
import { pullSulky } from "@/worker/jobs/sources/sulky-pull";
import { pullAllstitch } from "@/worker/jobs/sources/allstitch-pull";
import { pullHabanddash } from "@/worker/jobs/sources/habanddash-pull";
import { pullColdesi } from "@/worker/jobs/sources/coldesi-pull";
import { pullThreadart } from "@/worker/jobs/sources/threadart-pull";
import { pullOhmycrafty } from "@/worker/jobs/sources/ohmycrafty-pull";

import { GunnoldFeedSource } from "./gunnold-feed-source";
import { SulkyFeedSource } from "./sulky-feed-source";
import { AllstitchFeedSource } from "./allstitch-feed-source";
import { HabanddashFeedSource } from "./habanddash-feed-source";
import { ColdesiFeedSource } from "./coldesi-feed-source";
import { ThreadartFeedSource } from "./threadart-feed-source";
import { OhmycraftyFeedSource } from "./ohmycrafty-feed-source";

beforeEach(() => {
  vi.clearAllMocks();
});

// Each row pairs an adapter with the parser it must wrap, the expected `name`,
// and the mocked pull fn so we can assert delegation + return-value pass-through.
const cases = [
  {
    name: "gunnold",
    Adapter: GunnoldFeedSource,
    mock: pullGunnold as ReturnType<typeof vi.fn>,
  },
  {
    name: "sulky",
    Adapter: SulkyFeedSource,
    mock: pullSulky as ReturnType<typeof vi.fn>,
  },
  {
    name: "allstitch",
    Adapter: AllstitchFeedSource,
    mock: pullAllstitch as ReturnType<typeof vi.fn>,
  },
  {
    name: "habanddash",
    Adapter: HabanddashFeedSource,
    mock: pullHabanddash as ReturnType<typeof vi.fn>,
  },
  {
    name: "coldesi",
    Adapter: ColdesiFeedSource,
    mock: pullColdesi as ReturnType<typeof vi.fn>,
  },
  {
    name: "threadart",
    Adapter: ThreadartFeedSource,
    mock: pullThreadart as ReturnType<typeof vi.fn>,
  },
  {
    name: "ohmycrafty",
    Adapter: OhmycraftyFeedSource,
    mock: pullOhmycrafty as ReturnType<typeof vi.fn>,
  },
] as const;

describe("SupplyFeedSource adapters", () => {
  for (const { name, Adapter, mock } of cases) {
    describe(`${Adapter.name}`, () => {
      it(`exposes name "${name}"`, () => {
        expect(new Adapter().name).toBe(name);
      });

      it("pull() delegates to the wrapped parser and returns its value", async () => {
        const payload = { source: name, items: [{ sku: "x" }] };
        mock.mockResolvedValueOnce(payload);

        const result = await new Adapter().pull();

        expect(mock).toHaveBeenCalledTimes(1);
        expect(result).toBe(payload);
      });

      it("pull() propagates parser rejections unchanged", async () => {
        const boom = new Error(`${name} fetch failed`);
        mock.mockRejectedValueOnce(boom);

        await expect(new Adapter().pull()).rejects.toBe(boom);
      });
    });
  }
});

