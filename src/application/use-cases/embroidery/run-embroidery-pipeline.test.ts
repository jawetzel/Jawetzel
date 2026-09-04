import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { type ObjectStore } from "@/application/ports/object-store";
import { type LocalArtifactSink } from "@/application/ports/local-artifact-sink";
import { FakeEmbroideryComputeGateway } from "@/application/ports/embroidery-compute-gateway.fake";
import {
  ALLOWED_SIZES,
  InvalidCustomerIdError,
  InvalidSizeError,
  validateCustomerId,
  validateSize,
} from "@/domain/embroidery/pipeline-validation";
import {
  createRunEmbroideryPipeline,
  type FilterAvailableFn,
  type LoadPaletteFn,
  type SelectPaletteFn,
  type TagSvgFn,
} from "./run-embroidery-pipeline";
import {
  type PaletteSelection,
  type TagSvgResult,
} from "@/application/ports/embroidery-ai-gateway";
import { type Thread } from "@/domain/embroidery/thread";

/**
 * RunEmbroideryPipeline tests — the generate orchestrator exercised end-to-end
 * against in-memory fakes: no Docker (compute), no R2 (object store), no OpenAI
 * (AI palette/tag), no real disk (local artifact sink), no bundled-`.gpl` load.
 * Asserts the stage order, the persisted artifact set (to BOTH the object store
 * and the disk sink), the best-effort sampleColors `.catch`, the
 * SKIP_AI_PALETTE bypass (empty-threads selection), the returned PipelineResult
 * shape, and the value-object validators.
 */

// --- Fakes ----------------------------------------------------------------

class FakeObjectStore implements ObjectStore {
  readonly uploads: { key: string; bytes: Uint8Array; contentType: string }[] =
    [];
  async upload(
    key: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void> {
    this.uploads.push({ key, bytes, contentType });
  }
  async download(): Promise<Uint8Array | null> {
    return null;
  }
  publicUrl(key: string): string {
    return `https://cdn.test/${key}`;
  }
  async presignedDownloadUrl(): Promise<{ url: string; expiresAt: Date }> {
    return { url: "https://cdn.test/signed", expiresAt: new Date() };
  }
}

class FakeLocalArtifactSink implements LocalArtifactSink {
  readonly localDir = "/tmp/fake/embroidery";
  ensureDirCalls = 0;
  readonly writes: { name: string; bytes: Uint8Array }[] = [];
  async ensureDir(): Promise<void> {
    this.ensureDirCalls += 1;
  }
  async write(name: string, bytes: Uint8Array): Promise<void> {
    this.writes.push({ name, bytes });
  }
}

// Build a minimal STORED (method 0) ZIP the pure `extractZip` reader walks —
// the same shape Python's zipfile.writestr produces (real sizes in each local
// header, no data descriptor). One entry per (name, bytes).
function buildStoredZip(entries: Record<string, Uint8Array>): Uint8Array {
  const chunks: Buffer[] = [];
  for (const [name, data] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, "utf8");
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); // local file header signature
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0, 6); // flags
    header.writeUInt16LE(0, 8); // method 0 = stored
    header.writeUInt16LE(0, 10); // mod time
    header.writeUInt16LE(0, 12); // mod date
    header.writeUInt32LE(0, 14); // crc32 (ignored by reader)
    header.writeUInt32LE(data.length, 18); // compressed size
    header.writeUInt32LE(data.length, 22); // uncompressed size
    header.writeUInt16LE(nameBuf.length, 26); // name length
    header.writeUInt16LE(0, 28); // extra length
    chunks.push(header, nameBuf, Buffer.from(data));
  }
  return new Uint8Array(Buffer.concat(chunks));
}

const THREADS: Thread[] = [
  { hex: "#112233", name: "Navy", number: "1001" },
  { hex: "#445566", name: "Slate", number: "1002" },
];

const fakeLoadPalette: LoadPaletteFn = () => THREADS;
const fakeFilterAvailable: FilterAvailableFn = () => THREADS;

function fakeTagSvgResult(): TagSvgResult {
  return {
    cleanedSvgBytes: new TextEncoder().encode("<svg id='cleaned'/>"),
    taggedSvgBytes: new TextEncoder().encode("<svg id='tagged'/>"),
    geometryReport: {
      viewBox: { x: 0, y: 0, w: 100, h: 100 },
      paths: [],
    } as unknown as TagSvgResult["geometryReport"],
    aiTags: null,
  };
}

function makeDeps(overrides: {
  compute?: FakeEmbroideryComputeGateway;
  objectStore?: FakeObjectStore;
  localArtifacts?: FakeLocalArtifactSink;
  selectPalette?: SelectPaletteFn;
  tagSvg?: TagSvgFn;
}) {
  const zip = buildStoredZip({
    "embroidery.dst": new Uint8Array([1, 2, 3]),
    "embroidery.bmp": new Uint8Array([9, 9, 9]),
  });
  const compute =
    overrides.compute ??
    new FakeEmbroideryComputeGateway({
      trace: new TextEncoder().encode("<svg id='traced'/>"),
      convert: zip,
    });
  const objectStore = overrides.objectStore ?? new FakeObjectStore();
  const localArtifacts = overrides.localArtifacts ?? new FakeLocalArtifactSink();
  const selectPalette: SelectPaletteFn =
    overrides.selectPalette ??
    (async () => ({
      threads: THREADS.map((t) => ({ ...t })),
      extractOutline: true,
      routing: null,
      rationale: "ai",
    }));
  const tagSvg: TagSvgFn = overrides.tagSvg ?? (async () => fakeTagSvgResult());
  return {
    compute,
    objectStore,
    localArtifacts,
    deps: {
      compute,
      objectStore,
      localArtifacts,
      selectPalette,
      tagSvg,
      loadPalette: fakeLoadPalette,
      filterAvailable: fakeFilterAvailable,
      defaultManufacturer: "madeira-polyneon",
    },
  };
}

// Silence the pipeline's plog/perr console output during tests.
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
  vi.restoreAllMocks();
});

const ARTIFACTS = [
  "input.png",
  "palette.json",
  "traced.svg",
  "cleaned.svg",
  "geometry.json",
  "tagged.svg",
  "out.zip",
  "embroidery.bmp",
];

describe("RunEmbroideryPipeline", () => {
  it("runs the stages in order and persists the expected artifact set to both the object store and the disk sink", async () => {
    const { compute, objectStore, localArtifacts, deps } = makeDeps({});
    const png = new Uint8Array([0xff, 0xd8, 0xab, 0xcd]);

    const result = await createRunEmbroideryPipeline(deps).execute(
      png,
      "4x4",
      8,
      { customerId: "cust-1" },
    );

    // Stage order: sampleColors → trace → convert (one call each).
    expect(compute.sampleColorsCalls).toHaveLength(1);
    expect(compute.traceCalls).toHaveLength(1);
    expect(compute.convertCalls).toHaveLength(1);
    // sampleColors invoked full-res, n=256, with the size hint.
    expect(compute.sampleColorsCalls[0]).toMatchObject({
      n: 256,
      fullRes: true,
      size: "4x4",
    });

    // R2 keys: every artifact under embroidery/<customerId>/<hash>_<size>/.
    const prefix = `embroidery/cust-1/${result.hash}_4x4/`;
    const uploadedNames = objectStore.uploads.map((u) =>
      u.key.replace(prefix, ""),
    );
    expect(uploadedNames).toEqual(ARTIFACTS);
    // Content types are exact.
    const byName = new Map(
      objectStore.uploads.map((u) => [u.key.replace(prefix, ""), u.contentType]),
    );
    expect(byName.get("input.png")).toBe("image/png");
    expect(byName.get("palette.json")).toBe("application/json");
    expect(byName.get("traced.svg")).toBe("image/svg+xml");
    expect(byName.get("cleaned.svg")).toBe("image/svg+xml");
    expect(byName.get("geometry.json")).toBe("application/json");
    expect(byName.get("tagged.svg")).toBe("image/svg+xml");
    expect(byName.get("out.zip")).toBe("application/zip");
    expect(byName.get("embroidery.bmp")).toBe("image/bmp");

    // Disk sink: ensureDir once; the 6 persisted artifacts + the extracted zip
    // entries (.dst + .bmp) + the persisted embroidery.bmp all written.
    expect(localArtifacts.ensureDirCalls).toBe(1);
    const diskNames = localArtifacts.writes.map((w) => w.name);
    // The 6 pre-zip persists hit disk:
    for (const a of ["input.png", "palette.json", "traced.svg", "cleaned.svg", "geometry.json", "tagged.svg", "out.zip"]) {
      expect(diskNames).toContain(a);
    }
    // The extracted zip entries hit disk by their in-zip names.
    expect(diskNames).toContain("embroidery.dst");
    expect(diskNames).toContain("embroidery.bmp");
  });

  it("returns the correct PipelineResult shape", async () => {
    const { deps, localArtifacts } = makeDeps({});
    const png = new Uint8Array([1, 2, 3, 4]);

    const result = await createRunEmbroideryPipeline(deps).execute(
      png,
      "5x7",
      20,
      { customerId: "cust-2" },
    );

    expect(result.key).toBe(`embroidery/cust-2/${result.hash}_5x7/`);
    expect(result.customerId).toBe("cust-2");
    expect(result.hash).toMatch(/^[0-9a-f]{12}$/);
    expect(result.size).toBe("5x7");
    // colors clamped to MAX_COLORS (16) from the requested 20.
    expect(result.colors).toBe(16);
    expect(result.artifacts).toEqual(ARTIFACTS);
    expect(result.localDir).toBe(localArtifacts.localDir);
    // urls map every artifact to its public URL under the prefix.
    expect(result.urls["out.zip"]).toBe(`https://cdn.test/${result.key}out.zip`);
    expect(result.urls["embroidery.bmp"]).toBe(
      `https://cdn.test/${result.key}embroidery.bmp`,
    );
    expect(Object.keys(result.urls)).toEqual(ARTIFACTS);
  });

  it("continues when sampleColors fails (best-effort .catch)", async () => {
    const zip = buildStoredZip({
      "embroidery.bmp": new Uint8Array([7]),
    });
    const compute = new FakeEmbroideryComputeGateway({
      trace: new TextEncoder().encode("<svg/>"),
      convert: zip,
    });
    // Make sampleColors reject.
    compute.sampleColors = vi.fn(async () => {
      throw new Error("worker /sample-colors 500");
    });

    const { deps, objectStore } = makeDeps({ compute });
    const result = await createRunEmbroideryPipeline(deps).execute(
      new Uint8Array([5, 6, 7, 8]),
      "6x10",
      undefined,
      { customerId: "cust-3" },
    );

    // The pipeline still finished and traced/converted despite the failure.
    expect(compute.traceCalls).toHaveLength(1);
    expect(compute.convertCalls).toHaveLength(1);
    expect(result.artifacts).toContain("out.zip");
    // colors defaulted to DEFAULT_COLORS (12) when colorsRaw is undefined.
    expect(result.colors).toBe(12);
    // input.png was still persisted.
    const prefix = `embroidery/cust-3/${result.hash}_6x10/`;
    expect(objectStore.uploads.some((u) => u.key === `${prefix}input.png`)).toBe(
      true,
    );
  });

  it("SKIP_AI_PALETTE bypass yields the empty-threads selection (selectPalette never called, palette.json carries no threads)", async () => {
    // SKIP_AI_PALETTE is hard-true in the use-case. This selectPalette must
    // never run; if it did the test would fail (it throws).
    const selectPalette: SelectPaletteFn = async () => {
      throw new Error("selectPalette should not be called when SKIP_AI_PALETTE");
    };
    const { deps, objectStore } = makeDeps({ selectPalette });

    const result = await createRunEmbroideryPipeline(deps).execute(
      new Uint8Array([2, 4, 6, 8]),
      "8x8",
      4,
      { customerId: "cust-4" },
    );

    expect(result.size).toBe("8x8");

    // palette.json reflects the bypass selection: empty `selected`, null routing,
    // the SKIP rationale, extract_outline true.
    const prefix = `embroidery/cust-4/${result.hash}_8x8/`;
    const paletteUpload = objectStore.uploads.find(
      (u) => u.key === `${prefix}palette.json`,
    );
    expect(paletteUpload).toBeDefined();
    const palette = JSON.parse(new TextDecoder().decode(paletteUpload!.bytes));
    expect(palette.selected).toEqual([]);
    expect(palette.routing).toBeNull();
    expect(palette.extract_outline).toBe(true);
    expect(palette.rationale).toBe(
      "AI palette skipped via SKIP_AI_PALETTE debug flag",
    );

    // With no selected threads, trace receives an empty palette + no skip indices
    // and extractOutline true.
    expect(deps.compute.traceCalls[0].palette).toEqual([]);
    expect(deps.compute.traceCalls[0].skipIndices).toEqual([]);
    expect(deps.compute.traceCalls[0].extractOutline).toBe(true);
    expect(deps.compute.traceCalls[0].routing).toBeUndefined();
  });

  it("warns but still publishes when the zip has no embroidery.bmp (no bmp artifact)", async () => {
    const zip = buildStoredZip({ "embroidery.dst": new Uint8Array([1]) });
    const compute = new FakeEmbroideryComputeGateway({
      trace: new TextEncoder().encode("<svg/>"),
      convert: zip,
    });
    const { deps } = makeDeps({ compute });
    const result = await createRunEmbroideryPipeline(deps).execute(
      new Uint8Array([3, 1, 4, 1]),
      "4x4",
      8,
      { customerId: "cust-5" },
    );
    // No embroidery.bmp in the artifact list when the zip lacked it.
    expect(result.artifacts).not.toContain("embroidery.bmp");
    expect(result.artifacts[result.artifacts.length - 1]).toBe("out.zip");
  });
});

describe("pipeline value-object validators", () => {
  it("validateSize accepts the documented sizes (case/×-insensitive)", () => {
    for (const s of ALLOWED_SIZES) {
      expect(validateSize(s)).toBe(s);
    }
    expect(validateSize("  5X7 ")).toBe("5x7");
    expect(validateSize("6×10")).toBe("6x10");
  });

  it("validateSize rejects unknown sizes with InvalidSizeError", () => {
    expect(() => validateSize("3x3")).toThrow(InvalidSizeError);
    expect(() => validateSize("")).toThrow(InvalidSizeError);
    expect(() => validateSize("3x3")).toThrow(/Allowed: 4x4, 5x7, 6x10, 8x8/);
  });

  it("validateCustomerId accepts path-safe ids and lowercases", () => {
    expect(validateCustomerId("abc123")).toBe("abc123");
    expect(validateCustomerId("  AbC_1-2  ")).toBe("abc_1-2");
    expect(validateCustomerId("0000-0000-0000-0000")).toBe(
      "0000-0000-0000-0000",
    );
    // 24-hex Mongo ObjectId (the per-user route customerId) passes.
    expect(validateCustomerId("507f1f77bcf86cd799439011")).toBe(
      "507f1f77bcf86cd799439011",
    );
  });

  it("validateCustomerId rejects empty, leading-symbol, dots/slashes, and over-length", () => {
    expect(() => validateCustomerId("")).toThrow(InvalidCustomerIdError);
    expect(() => validateCustomerId("-bad")).toThrow(InvalidCustomerIdError);
    expect(() => validateCustomerId("a.b")).toThrow(InvalidCustomerIdError);
    expect(() => validateCustomerId("../etc")).toThrow(InvalidCustomerIdError);
    expect(() => validateCustomerId("a/b")).toThrow(InvalidCustomerIdError);
    expect(() => validateCustomerId("a".repeat(65))).toThrow(
      InvalidCustomerIdError,
    );
  });
});
