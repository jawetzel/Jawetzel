#!/usr/bin/env node
/**
 * Background crawler — samples dominant color from each vendor's product
 * image for (brand, color) keys that have no hex in the master thread-color
 * map yet. Run it as many times as you want; progress persists to disk.
 *
 *   node scripts/crawl-thread-images.mjs             # process all pending keys
 *   node scripts/crawl-thread-images.mjs --max=200   # stop after 200 samples
 *   node scripts/crawl-thread-images.mjs --rebuild   # re-sample even keys we've done
 *
 * Rate-limited to one image every RATE_MS (default 3s) so vendor CDNs don't
 * see a flood. Saves progress after every successful sample, so SIGINT is
 * safe — the next run picks up where this left off.
 *
 * Output: `src/data/thread-palettes/image-samples.json`. Loaded by
 * `scripts/build-thread-color-map.mjs` as the lowest-priority hex source
 * (authoritative manufacturer palettes beat image-sampled estimates).
 *
 * Sampling approach (intentionally simple — image sampling is inherently
 * noisy for product photos with packaging):
 *   1. sharp decode + resize to 64×64 raw RGB
 *   2. discard pixels that are near-white, near-black, or near-grey
 *      (backgrounds, packaging edges, labels)
 *   3. bucket the rest by 5-bits-per-channel, pick largest bucket, emit
 *      the bucket's pixel-count-weighted centroid as hex
 *
 * Edge cases flagged in the output (kit photos, no-dominant-color) so they
 * can be reviewed manually.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import sharp from "sharp";

const COLOR_MAP_PATH = "src/data/thread-color-map.json";
const DETAILS_PATH = "data/supplies/details/current.json";
const OUT_PATH = "src/data/thread-palettes/image-samples.json";

const USER_AGENT =
  "Mozilla/5.0 (compatible; PortfolioWebsite/1.0; +https://jawetzel.com)";
const RATE_MS = 3000;
const FETCH_TIMEOUT_MS = 20000;

// Vendor priority for picking a source image when multiple vendors carry a
// (brand, color). Hab+Dash has the cleanest studio-lit spool shots, so it
// wins when it has coverage; Gunnold's CDN images are next-cleanest; the
// Shopify/BigCommerce vendors tend to have more packaging clutter. ColDesi
// last — Endura items are ColDesi-only and need somewhere to get sampled
// from, but their photography is mixed-quality.
const VENDOR_IMAGE_PRIORITY = [
  "habanddash",
  "gunnold",
  "allstitch",
  "sulky",
  "coldesi",
  "threadart",
];

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    if (arg === "--rebuild") args.rebuild = true;
    else if (arg.startsWith("--max=")) args.max = parseInt(arg.slice(6), 10);
  }
  return args;
}

function imageUrlFromVendor(vendor, detail) {
  let url;
  switch (vendor) {
    case "habanddash":
      url = detail.image_url ?? detail.small_image_url ?? detail.thumbnail_url;
      break;
    case "allstitch":
      url = detail.image_url;
      break;
    case "sulky":
      url = detail.image_url;
      break;
    case "gunnold":
      url = detail.large_url ?? detail.med_url ?? detail.thumb_url;
      break;
    case "coldesi":
      // Coldesi curated shape pulls the first product image into image_url;
      // product_images[] is the full gallery if we ever want to fall back.
      url =
        detail.image_url ??
        (Array.isArray(detail.product_images)
          ? detail.product_images[0]?.src
          : undefined);
      break;
    case "threadart":
      url =
        detail.image_url ??
        (Array.isArray(detail.product_images)
          ? detail.product_images[0]?.src
          : undefined);
      break;
    default:
      return null;
  }
  if (!url) return null;
  // Gunnold's itemextend CDN returns protocol-relative URLs ("//s3..."); Node's
  // fetch() requires an absolute URL. Prepend https: for any that need it.
  if (url.startsWith("//")) return "https:" + url;
  return url;
}

async function fetchBytes(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "image/*" },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return buf;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Dominant-color extraction. Returns { hex, pixelCount, totalSampled }.
 *
 * Two-pass strategy:
 *   1. Strict — drop near-white, near-black, near-grey pixels and bucket the
 *      rest. Good for colorful thread on a white background.
 *   2. Loose fallback — if the strict pass filters everything (white/ivory
 *      stabilizers, white thread, etc.), re-run with no filtering so we
 *      still get a meaningful color. The result is tagged `filter: "loose"`
 *      in the output so downstream can tell these apart.
 */
async function extractDominant(imageBytes) {
  const { data, info } = await sharp(imageBytes)
    .resize(64, 64, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  const totalPx = info.width * info.height;

  const pickFromBuckets = (buckets) => {
    if (buckets.size === 0) return null;
    let top = null;
    for (const b of buckets.values()) {
      if (!top || b.count > top.count) top = b;
    }
    const r = Math.round(top.rSum / top.count);
    const g = Math.round(top.gSum / top.count);
    const b = Math.round(top.bSum / top.count);
    return {
      hex: "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join(""),
      pixelCount: top.count,
      bucketCount: buckets.size,
    };
  };

  // Pass 1 — strict background/saturation filter.
  const strict = new Map();
  let sampledStrict = 0;
  for (let i = 0; i < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r > 240 && g > 240 && b > 240) continue;
    if (r < 15 && g < 15 && b < 15) continue;
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    if (maxC - minC < 12) continue;
    sampledStrict++;
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let bucket = strict.get(key);
    if (!bucket) {
      bucket = { rSum: 0, gSum: 0, bSum: 0, count: 0 };
      strict.set(key, bucket);
    }
    bucket.rSum += r;
    bucket.gSum += g;
    bucket.bSum += b;
    bucket.count++;
  }

  const strictTop = pickFromBuckets(strict);
  if (strictTop) {
    return {
      ...strictTop,
      totalSampled: sampledStrict,
      totalPx,
      saturationFraction: sampledStrict / totalPx,
      filter: "strict",
    };
  }

  // Pass 2 — no filter. Every pixel counts. Needed for white/grey products
  // whose "subject color" is what we'd normally treat as background.
  const loose = new Map();
  for (let i = 0; i < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let bucket = loose.get(key);
    if (!bucket) {
      bucket = { rSum: 0, gSum: 0, bSum: 0, count: 0 };
      loose.set(key, bucket);
    }
    bucket.rSum += r;
    bucket.gSum += g;
    bucket.bSum += b;
    bucket.count++;
  }

  const looseTop = pickFromBuckets(loose);
  if (!looseTop) return null;
  return {
    ...looseTop,
    totalSampled: totalPx,
    totalPx,
    saturationFraction: 1,
    filter: "loose",
  };
}

function loadSamples() {
  if (!existsSync(OUT_PATH)) {
    return {
      source: "image-samples",
      generated_at: new Date().toISOString(),
      entries: {},
    };
  }
  return JSON.parse(readFileSync(OUT_PATH, "utf8"));
}

function saveSamples(samples) {
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  samples.generated_at = new Date().toISOString();
  samples.entry_count = Object.keys(samples.entries).length;
  writeFileSync(OUT_PATH, JSON.stringify(samples, null, 2));
}

function buildQueue(details, colorMap, samples, rebuild) {
  void colorMap; // kept for signature parity; `entry.hex` below is the real check
  const queue = [];
  for (const [key, entry] of Object.entries(details.items)) {
    // Skip keys that compile-feeds already resolved authoritatively — it's
    // the source of truth for "does this key already have a hex?" since
    // details-feed keys and thread-color-map keys use different brand
    // conventions (raw vendor brand vs. paletteKeyFor() output).
    if (entry.hex && !rebuild) continue;
    // Skip keys we've already image-sampled this session
    if (samples.entries[key] && !rebuild) continue;

    let imageUrl = null;
    let sourceVendor = null;
    for (const v of VENDOR_IMAGE_PRIORITY) {
      if (!entry.vendors[v]) continue;
      const url = imageUrlFromVendor(v, entry.vendors[v]);
      if (url) {
        imageUrl = url;
        sourceVendor = v;
        break;
      }
    }
    if (!imageUrl) continue;
    queue.push({ key, imageUrl, sourceVendor });
  }
  return queue;
}

async function main() {
  const args = parseArgs();

  console.log(`Loading ${COLOR_MAP_PATH}...`);
  const colorMap = JSON.parse(readFileSync(COLOR_MAP_PATH, "utf8"));
  console.log(`  ${Object.keys(colorMap.entries).length} mapped keys`);

  console.log(`Loading ${DETAILS_PATH}...`);
  const details = JSON.parse(readFileSync(DETAILS_PATH, "utf8"));
  console.log(`  ${Object.keys(details.items).length} detail keys`);

  const samples = loadSamples();
  const existingSamples = Object.keys(samples.entries).length;
  console.log(`Existing image samples: ${existingSamples}`);

  const queue = buildQueue(details, colorMap, samples, args.rebuild);
  console.log(`Queue: ${queue.length} keys to sample`);

  const limit = args.max ?? queue.length;
  const todo = queue.slice(0, limit);
  if (todo.length === 0) {
    console.log("Nothing to do. Exit.");
    return;
  }

  // Group the work queue by host so we can round-robin across CDNs. Each
  // individual CDN only sees a request when its turn comes up; as long as
  // there are multiple active hosts in the rotation nobody gets hammered,
  // so we can skip the inter-request sleep entirely. When only one host
  // still has work left, we fall back to RATE_MS spacing on that host.
  const hostQueues = new Map();
  for (const item of todo) {
    let host;
    try {
      host = new URL(item.imageUrl).host;
    } catch {
      host = "(unknown)";
    }
    if (!hostQueues.has(host)) hostQueues.set(host, []);
    hostQueues.get(host).push(item);
  }
  const hostOrder = [...hostQueues.keys()];
  console.log(
    `Hosts in rotation: ${hostOrder.map((h) => `${h} (${hostQueues.get(h).length})`).join(", ")}`,
  );

  // Graceful shutdown — save on Ctrl-C
  let interrupted = false;
  process.on("SIGINT", () => {
    console.log("\nSIGINT — saving progress and exiting...");
    interrupted = true;
  });

  let ok = 0;
  let failed = 0;
  let processed = 0;
  let rrIdx = 0;
  const start = Date.now();

  const remaining = () => {
    let n = 0;
    for (const q of hostQueues.values()) n += q.length;
    return n;
  };

  while (remaining() > 0 && !interrupted) {
    // Pick next host with items, starting from rrIdx. Advances rrIdx so the
    // next tick starts from the following host — strict round-robin.
    let pickedHost = null;
    for (let attempt = 0; attempt < hostOrder.length; attempt++) {
      const h = hostOrder[(rrIdx + attempt) % hostOrder.length];
      if (hostQueues.get(h).length > 0) {
        pickedHost = h;
        rrIdx = (hostOrder.indexOf(h) + 1) % hostOrder.length;
        break;
      }
    }
    if (!pickedHost) break;

    const item = hostQueues.get(pickedHost).shift();
    processed++;
    const progress = `[${processed}/${todo.length}]`;
    const { key, imageUrl, sourceVendor } = item;

    try {
      const bytes = await fetchBytes(imageUrl);
      const result = await extractDominant(bytes);
      if (!result) {
        failed++;
        console.log(`${progress} ${key} — no dominant color (all pixels filtered)`);
      } else {
        samples.entries[key] = {
          hex: result.hex,
          source_vendor: sourceVendor,
          image_url: imageUrl,
          pixel_count: result.pixelCount,
          total_sampled: result.totalSampled,
          saturation_fraction: Number(result.saturationFraction.toFixed(3)),
          bucket_count: result.bucketCount,
          filter: result.filter,
          sampled_at: new Date().toISOString(),
        };
        ok++;
        console.log(
          `${progress} ${key} → ${result.hex} (${sourceVendor}, ${result.pixelCount}/${result.totalSampled} px)`,
        );
      }
    } catch (err) {
      failed++;
      console.error(
        `${progress} ${key} — ERROR ${err instanceof Error ? err.message : err}`,
      );
    }

    // Persist after every sample
    saveSamples(samples);

    // Throttle only when a single host is doing all the remaining work —
    // otherwise rotation itself keeps per-host rate comfortable.
    if (interrupted) break;
    const activeHosts = [...hostQueues.values()].filter((q) => q.length > 0).length;
    if (activeHosts === 1 && remaining() > 0) {
      await new Promise((r) => setTimeout(r, RATE_MS));
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nDone. ok=${ok} failed=${failed} elapsed=${elapsed}s`);
  console.log(`Total samples now: ${Object.keys(samples.entries).length}`);
  console.log(`\nRun the mapper to fold these in:`);
  console.log(`  node scripts/build-thread-color-map.mjs`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
