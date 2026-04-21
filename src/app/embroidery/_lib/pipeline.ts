import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

import { selectPalette } from "./ai/select-palette";
import { tagSvg } from "./ai/tag-svg";
import {
  DEFAULT_MANUFACTURER,
  filterAvailable,
  loadPalette,
} from "./inkstitch/gpl-palette";
import { publicUrlFor, uploadToR2 } from "@/lib/r2";
import { convertSvg, sampleColors, traceImage } from "./worker";

// Minimal local-file-header ZIP reader. Python's zipfile.writestr writes real
// sizes in each local header (no data descriptors), so we can walk sequentially.
function extractZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 0;
  while (i + 4 <= buf.length) {
    const sig = buf.readUInt32LE(i);
    if (sig !== 0x04034b50) break; // stop at central directory / EOCD
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const nameStart = i + 30;
    const dataStart = nameStart + nameLen + extraLen;
    const dataEnd = dataStart + compSize;
    const name = buf.toString("utf8", nameStart, nameStart + nameLen);
    const slice = buf.subarray(dataStart, dataEnd);
    const data =
      method === 0 ? slice : method === 8 ? inflateRawSync(slice) : null;
    if (data === null) throw new Error(`zip: unsupported method ${method} for ${name}`);
    out.set(name, new Uint8Array(data));
    i = dataEnd;
  }
  return out;
}

function plog(msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[pipeline ${ts}] ${msg}`);
}

function perr(step: string, err: unknown): never {
  const ts = new Date().toISOString().slice(11, 19);
  const e = err as {
    name?: string;
    message?: string;
    code?: string;
    cause?: { code?: string; message?: string; errno?: number; syscall?: string };
    stack?: string;
  };
  console.error(`[pipeline ${ts}] ${step} FAILED`);
  console.error(`  name: ${e?.name ?? "unknown"}`);
  console.error(`  message: ${e?.message ?? String(err)}`);
  if (e?.code) console.error(`  code: ${e.code}`);
  if (e?.cause) {
    console.error(`  cause.message: ${e.cause.message}`);
    console.error(`  cause.code: ${e.cause.code}`);
    console.error(`  cause.syscall: ${e.cause.syscall}`);
    console.error(`  cause.errno: ${e.cause.errno}`);
  }
  if (e?.stack) console.error(`  stack: ${e.stack}`);
  throw err;
}

async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  plog(`${name} start`);
  try {
    const out = await fn();
    plog(`${name} done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return out;
  } catch (err) {
    plog(`${name} threw after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    perr(name, err);
  }
}

export type PipelineResult = {
  key: string;
  customerId: string;
  hash: string;
  size: string;
  colors: number;
  artifacts: string[];
  urls: Record<string, string>;
  localDir: string;
};

export const DEFAULT_COLORS = 12;
export const MIN_COLORS = 2;
export const MAX_COLORS = 16;

export const ALLOWED_SIZES = ["4x4", "5x7", "6x10", "8x8"] as const;
export type AllowedSize = (typeof ALLOWED_SIZES)[number];

// Default customer_id for requests that omit the field — treated as the
// shared "test user" bucket so unauthenticated-ish testing flows don't
// pollute real customer folders.
export const TEST_CUSTOMER_ID = "0000-0000-0000-0000";

export class InvalidSizeError extends Error {
  constructor(raw: string) {
    super(
      `Invalid size "${raw}". Allowed: ${ALLOWED_SIZES.join(", ")}`,
    );
    this.name = "InvalidSizeError";
  }
}

export function validateSize(raw: string): AllowedSize {
  const clean = raw.trim().toLowerCase().replace("×", "x");
  if ((ALLOWED_SIZES as readonly string[]).includes(clean)) {
    return clean as AllowedSize;
  }
  throw new InvalidSizeError(raw);
}

// Customer IDs go into R2 keys and local folder paths, so keep them URL-safe
// and path-safe. Lowercase alphanumeric + hyphen/underscore, must start with an
// alphanumeric, 1–64 chars. No dots (blocks `..` traversal), no slashes.
export class InvalidCustomerIdError extends Error {
  constructor(raw: string) {
    super(
      `Invalid customer_id "${raw}". Allowed: 1–64 chars, lowercase alphanumeric, hyphens, underscores; must start with a letter or digit.`,
    );
    this.name = "InvalidCustomerIdError";
  }
}

export function validateCustomerId(raw: string): string {
  const clean = raw.trim().toLowerCase();
  if (/^[a-z0-9][a-z0-9_-]{0,63}$/.test(clean)) return clean;
  throw new InvalidCustomerIdError(raw);
}

function hashPng(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 12);
}

export type PipelineOptions = {
  customerId?: string;
  manufacturer?: string;
  threadNumbers?: string[];
};

export async function runPipeline(
  pngBytes: Uint8Array,
  sizeRaw: string,
  colorsRaw?: number,
  opts: PipelineOptions = {},
): Promise<PipelineResult> {
  const size = validateSize(sizeRaw);
  const customerId = validateCustomerId(opts.customerId ?? TEST_CUSTOMER_ID);
  const colors = Math.max(
    MIN_COLORS,
    Math.min(
      MAX_COLORS,
      Number.isFinite(colorsRaw) ? Math.round(colorsRaw as number) : DEFAULT_COLORS,
    ),
  );
  const manufacturer = (opts.manufacturer ?? DEFAULT_MANUFACTURER).toLowerCase();
  const fullPalette = loadPalette(manufacturer);
  const availableThreads = filterAvailable(
    manufacturer,
    fullPalette,
    opts.threadNumbers ?? null,
  );
  const hash = hashPng(pngBytes);
  const prefix = `embroidery/${customerId}/${hash}_${size}/`;
  // One fixed folder inside the project, overwritten every run — stable
  // "latest output" path regardless of input image.
  const localDir = path.join(process.cwd(), "tmp", "embroidery");
  await mkdir(localDir, { recursive: true });
  plog(
    `start customer=${customerId} hash=${hash} size=${size} colors=${colors} localDir=${localDir}`,
  );

  const persist = async (
    name: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void> => {
    await Promise.all([
      uploadToR2(`${prefix}${name}`, bytes, contentType),
      writeFile(path.join(localDir, name), bytes),
    ]);
  };

  await step("persist input.png", () => persist("input.png", pngBytes, "image/png"));
  const pngUrl = publicUrlFor(`${prefix}input.png`);

  // Full-res, high-N sampling so the AI sees the exact cluster set the trace
  // stage will bucket against. 256 is PIL's quantize cap and generous enough
  // to capture every perceptible cluster in a rich illustration.
  const sampled = await step("sampleColors", () => sampleColors(pngBytes, 256, true))
    .catch((err) => {
      // Worker is best-effort here — if /sample-colors fails, the AI step still
      // runs (with weaker context) and the trace falls back to RGB-nearest.
      plog(`sampleColors failed (${err}); continuing without cluster routing`);
      return null;
    });
  if (sampled) {
    plog(
      `sampled ${sampled.colors.length} clusters from ${sampled.total_distinct_colors.toLocaleString()} distinct RGB values ` +
        `(${sampled.total_pixels.toLocaleString()} subject pixels)`,
    );
  }

  const selection = await step("selectPalette (AI)", () =>
    selectPalette(pngUrl, availableThreads, sampled),
  );
  const selectedThreads = selection.threads;
  const paletteHex = selectedThreads.map((t) => t.hex);
  plog(
    `picked ${selectedThreads.length} threads from ${manufacturer} ` +
      `(extract_outline=${selection.extractOutline}): ` +
      selectedThreads.map((t) => `${t.number}:${t.hex}(${t.name})`).join(", "),
  );
  if (selection.routing) {
    const { aiRouted, fallback } = selection.routing;
    const total = aiRouted + fallback;
    const pct = total > 0 ? Math.round((aiRouted / total) * 100) : 0;
    plog(
      `AI routed ${aiRouted}/${total} clusters (${pct}%); ${fallback} fell back to Lab-ΔE nearest`,
    );
  }
  await step("persist palette.json", () =>
    persist(
      "palette.json",
      new TextEncoder().encode(
        JSON.stringify(
          {
            manufacturer,
            available_count: availableThreads.length,
            extract_outline: selection.extractOutline,
            rationale: selection.rationale ?? null,
            selected: selectedThreads,
            routing: selection.routing,
          },
          null,
          2,
        ),
      ),
      "application/json",
    ),
  );

  const tracedSvgBytes = await step("traceImage", () =>
    traceImage(
      pngBytes,
      size,
      colors,
      paletteHex,
      selection.extractOutline,
      selection.routing ?? undefined,
      // AI-marked "background" threads get ripped out entirely — no trace
      // layer, no stitches. Those pixels stay as fabric. Honors the role
      // label the AI already emits.
      selectedThreads
        .map((t, i) => (t.role === "background" ? i : -1))
        .filter((i) => i >= 0),
    ),
  );
  plog(`traced.svg ${tracedSvgBytes.length} bytes`);
  await step("persist traced.svg", () =>
    persist("traced.svg", tracedSvgBytes, "image/svg+xml"),
  );

  const { cleanedSvgBytes, taggedSvgBytes, geometryReport, aiTags } = await step(
    "tagSvg (AI)",
    () =>
      tagSvg(tracedSvgBytes, pngUrl, size, {
        threadPalette: selectedThreads,
        // Photos (extract_outline=false) have hundreds of small paths where
        // underlay is wasted compute. Line-art keeps underlay for clean fills.
        applyUnderlay: selection.extractOutline,
      }),
  );

  await step("persist cleaned.svg", () =>
    persist("cleaned.svg", cleanedSvgBytes, "image/svg+xml"),
  );
  const geometryBytes = new TextEncoder().encode(JSON.stringify(geometryReport, null, 2));
  await step("persist geometry.json", () =>
    persist("geometry.json", geometryBytes, "application/json"),
  );
  await step("persist tagged.svg", () =>
    persist("tagged.svg", taggedSvgBytes, "image/svg+xml"),
  );

  const artifacts = [
    "input.png",
    "palette.json",
    "traced.svg",
    "cleaned.svg",
    "geometry.json",
    "tagged.svg",
  ];
  if (aiTags) {
    const aiTagsBytes = new TextEncoder().encode(JSON.stringify(aiTags, null, 2));
    await step("persist ai-tags.json", () =>
      persist("ai-tags.json", aiTagsBytes, "application/json"),
    );
    artifacts.push("ai-tags.json");
  }

  const zipBytes = await step("convertSvg", () => convertSvg(taggedSvgBytes, size));
  plog(`out.zip ${zipBytes.length} bytes`);
  await step("persist out.zip", () =>
    persist("out.zip", zipBytes, "application/zip"),
  );
  artifacts.push("out.zip");

  // Also extract the zip's contents into the local dir so the .dst/.pes/.svg
  // files are directly usable without unzipping.
  await step("extract out.zip locally", async () => {
    const entries = extractZip(zipBytes);
    await Promise.all(
      [...entries].map(([name, data]) =>
        writeFile(path.join(localDir, name), data),
      ),
    );
    plog(`extracted ${entries.size} files: ${[...entries.keys()].join(", ")}`);
  });

  plog(`pipeline complete, local dir: ${localDir}`);

  const urls = Object.fromEntries(
    artifacts.map((name) => [name, publicUrlFor(`${prefix}${name}`)]),
  );

  return { key: prefix, customerId, hash, size, colors, artifacts, urls, localDir };
}
