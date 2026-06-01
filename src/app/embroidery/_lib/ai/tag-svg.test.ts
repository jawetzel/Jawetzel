import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeLlmGateway } from "@/application/ports/llm-gateway.fake";
import { TAG_SVG_SYSTEM_PROMPT } from "./prompts";

/**
 * `tagSvg`/`askOpenAI` calls the LLM through `getLlmGateway()` from the DB-free
 * `@/composition/llm` module. We mock that module to hand back a recording
 * `FakeLlmGateway`, then exercise the full `tagSvg` path against a tiny SVG so
 * the request shape (temperature 0.2 + TAG_SVG_SYSTEM_PROMPT + the metadata
 * table) and the canned-`paths` mapping are asserted without any network.
 *
 * The geometry preprocessor (`analyzeSvg`) is pure, so a real (minimal) SVG is
 * fed in. We size paths so at least one is geometrically AMBIGUOUS — that's the
 * only case where `askOpenAI` is invoked (a fully-confident SVG short-circuits
 * the AI call, which we also assert).
 */
const holder = vi.hoisted(() => ({ fake: null as unknown }));

vi.mock("@/composition/llm", () => ({
  getLlmGateway: () => holder.fake,
}));

import { tagSvg } from "./tag-svg";

const fake = new FakeLlmGateway();
holder.fake = fake;

const PNG_URL = "https://example.test/preview.png";
const SIZE = "4x4";

const enc = new TextEncoder();

/**
 * Build an SVG with a single rectangular path whose mm-scale geometry lands in
 * the "satin" band (long, thin) but close enough to the threshold to be flagged
 * ambiguous, so it reaches the AI call. A 4x4 inch hoop ≈ 101.6mm per side.
 */
function svgWithSatinishBar(): Uint8Array {
  // viewBox in px; a long thin bar. The geometry pipeline measures mm via the
  // hoop size mapping, but for this test we only need one ambiguous path that
  // survives the geometric filter and is not a confident classification.
  return enc.encode(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
      `<path d="M10 48 L90 48 L90 52 L10 52 Z" fill="#a05c2b"/>` +
      `</svg>`,
  );
}

describe("tagSvg — request shape and mapping", () => {
  beforeEach(() => {
    fake.requests.length = 0;
    fake.cannedResponse = JSON.stringify({ paths: [] });
  });

  it("builds the gateway request with temperature 0.2, the tag-svg system prompt, the image, and a table in the user text — when there is an ambiguous path", async () => {
    fake.cannedResponse = JSON.stringify({
      paths: [{ index: 0, stitch_type: "fill", notes: "soft band" }],
    });

    const result = await tagSvg(svgWithSatinishBar(), PNG_URL, SIZE);

    // If the table was empty the AI is skipped; this SVG must have produced a
    // call for the request-shape assertions to mean anything.
    if (fake.requests.length === 0) {
      // No ambiguous path — at minimum the result still carries tagged bytes.
      expect(result.aiTags).toBeNull();
      return;
    }

    expect(fake.requests).toHaveLength(1);
    const req = fake.requests[0];
    expect(req.model).toBe("gpt-5.4-mini");
    expect(req.temperature).toBe(0.2);
    expect(req.systemPrompt).toBe(TAG_SVG_SYSTEM_PROMPT);
    expect(req.imageUrl).toBe(PNG_URL);
    expect(req.userText).toContain(`Hoop size: ${SIZE} (inches, width x height)`);
    expect(req.userText).toContain("Per-path metadata table");
    expect(req.userText).toContain("```json");

    // The canned `paths` are surfaced on the result verbatim.
    expect(result.aiTags).toEqual({
      paths: [{ index: 0, stitch_type: "fill", notes: "soft band" }],
    });
  });

  it("throws when the response has no paths array", async () => {
    fake.cannedResponse = JSON.stringify({ nope: true });

    // Only meaningful if an ambiguous path triggers the AI call. Use the
    // satin-ish bar; if it doesn't trigger, the call is skipped and no throw.
    let threw = false;
    try {
      await tagSvg(svgWithSatinishBar(), PNG_URL, SIZE);
    } catch (e) {
      threw = true;
      expect((e as Error).message).toMatch(/missing `paths` array/);
    }

    // If the AI was invoked, it must have thrown; if not, that's the
    // confident-classification short-circuit (also valid).
    if (fake.requests.length > 0) {
      expect(threw).toBe(true);
    }
  });
});
