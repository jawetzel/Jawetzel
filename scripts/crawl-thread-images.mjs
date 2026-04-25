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
 * Sampling approach: thread spools/cones are centered in vendor product
 * photos, so we crop the dead-center 20×20 region of the source image and
 * bucket those 400 pixels by 5-bits-per-channel, returning the dominant
 * bucket's pixel-count-weighted centroid as hex. Skipping the resize and
 * background-filter heuristics avoids the centroid drift that whole-image
 * sampling gets from highlights, labels, and packaging.
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

const CROP_SIZE = 20;
// RGB Euclidean radius — a candidate "center" color absorbs all buckets
// whose centroids lie within this distance. Captures lighting/JPEG-noise
// variation on a single thread color without chain-merging through a
// gradient (each cluster is bounded to within 2*radius of its center).
const MERGE_DISTANCE = 30;
// Tag stamped on every entry. Doubles as the "is this entry up-to-date with
// the current algorithm?" check — `--rebuild` skips entries already at this
// version so a SIGINT-interrupted rebuild resumes where it left off. Bump
// the suffix any time the extraction algorithm changes meaningfully.
const CURRENT_METHOD = `center${CROP_SIZE}-seed`;

/**
 * Dominant-color extraction from the dead-center CROP_SIZE×CROP_SIZE region
 * of the source image. Vendor product photos always center the spool/cone,
 * so the center crop is mostly thread fiber.
 *
 * Two-stage clustering: pixels are first bucketed at 5-bits-per-channel,
 * then for each bucket considered as a candidate "center" we sum the pixel
 * counts of all buckets whose centroids are within MERGE_DISTANCE of it.
 * The center with the largest neighborhood wins, and we return the
 * pixel-weighted centroid of that neighborhood. This sidesteps the failure
 * mode where shading variation on one surface splits across many small
 * buckets — and unlike chain-merging, it can't bridge through smooth
 * gradients into a single mega-cluster.
 */
async function extractDominant(imageBytes) {
  const meta = await sharp(imageBytes).metadata();
  const srcW = meta.width ?? 0;
  const srcH = meta.height ?? 0;
  if (srcW < 1 || srcH < 1) return null;
  const cropW = Math.min(CROP_SIZE, srcW);
  const cropH = Math.min(CROP_SIZE, srcH);
  const left = Math.floor((srcW - cropW) / 2);
  const top = Math.floor((srcH - cropH) / 2);

  const { data, info } = await sharp(imageBytes)
    .extract({ left, top, width: cropW, height: cropH })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  const totalPx = info.width * info.height;

  const buckets = new Map();
  for (let i = 0; i < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { rSum: 0, gSum: 0, bSum: 0, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.rSum += r;
    bucket.gSum += g;
    bucket.bSum += b;
    bucket.count++;
  }

  if (buckets.size === 0) return null;

  // Materialize buckets with their centroids for distance comparison.
  const items = [...buckets.values()].map((bucket) => ({
    rMean: bucket.rSum / bucket.count,
    gMean: bucket.gSum / bucket.count,
    bMean: bucket.bSum / bucket.count,
    rSum: bucket.rSum,
    gSum: bucket.gSum,
    bSum: bucket.bSum,
    count: bucket.count,
  }));

  // For each bucket considered as a candidate center, sum the pixel counts
  // of all buckets within MERGE_DISTANCE. The center with the largest
  // neighborhood wins. O(B²) brute force — B ≤ 400, ~160k ops worst case.
  const mergeSq = MERGE_DISTANCE * MERGE_DISTANCE;
  let bestSeed = -1;
  let bestSeedCount = -1;
  for (let i = 0; i < items.length; i++) {
    let neighborhood = 0;
    for (let j = 0; j < items.length; j++) {
      const dr = items[i].rMean - items[j].rMean;
      const dg = items[i].gMean - items[j].gMean;
      const db = items[i].bMean - items[j].bMean;
      if (dr * dr + dg * dg + db * db <= mergeSq) {
        neighborhood += items[j].count;
      }
    }
    if (neighborhood > bestSeedCount) {
      bestSeedCount = neighborhood;
      bestSeed = i;
    }
  }

  // Re-walk the winning neighborhood to compute its weighted centroid.
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let totalCount = 0;
  let memberBuckets = 0;
  const seed = items[bestSeed];
  for (let j = 0; j < items.length; j++) {
    const dr = seed.rMean - items[j].rMean;
    const dg = seed.gMean - items[j].gMean;
    const db = seed.bMean - items[j].bMean;
    if (dr * dr + dg * dg + db * db <= mergeSq) {
      rSum += items[j].rSum;
      gSum += items[j].gSum;
      bSum += items[j].bSum;
      totalCount += items[j].count;
      memberBuckets++;
    }
  }

  const rOut = Math.round(rSum / totalCount);
  const gOut = Math.round(gSum / totalCount);
  const bOut = Math.round(bSum / totalCount);
  return {
    hex:
      "#" +
      [rOut, gOut, bOut].map((c) => c.toString(16).padStart(2, "0")).join(""),
    pixelCount: totalCount,
    bucketCount: memberBuckets,
    rawBucketCount: items.length,
    totalSampled: totalPx,
    totalPx,
    saturationFraction: 1,
    filter: CURRENT_METHOD,
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
  let skippedAuthoritative = 0;
  let skippedCurrent = 0;
  for (const [key, entry] of Object.entries(details.items)) {
    // Skip keys whose hex came from an authoritative source (manufacturer
    // palette, Ink/Stitch GPL, crossmatch). We detect those by: entry.hex
    // is set but we have no image-sample entry for the key — meaning the
    // hex must have come from somewhere other than us. Image samples are
    // lowest priority in build-thread-color-map.mjs, so re-sampling these
    // keys is pure CDN traffic for data that never reaches the final map.
    if (entry.hex && !samples.entries[key]) {
      skippedAuthoritative++;
      continue;
    }
    // With --rebuild: skip entries already produced by the current method
    // so a SIGINT-interrupted rebuild resumes where it left off. Without
    // --rebuild: skip any key with an existing sample (current method or not).
    if (samples.entries[key]) {
      if (!rebuild) continue;
      if (samples.entries[key].filter === CURRENT_METHOD) {
        skippedCurrent++;
        continue;
      }
    }

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
  if (skippedAuthoritative > 0) {
    console.log(
      `  Skipped ${skippedAuthoritative} keys covered by authoritative palettes`,
    );
  }
  if (skippedCurrent > 0) {
    console.log(
      `  Skipped ${skippedCurrent} keys already at method=${CURRENT_METHOD} (rebuild resume)`,
    );
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
