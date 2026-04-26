/**
 * IndexNow — notify Bing/Yandex/Seznam about changed URLs.
 * Google does not participate. https://www.indexnow.org/documentation
 *
 * The key file at /{INDEXNOW_KEY}.txt proves domain ownership; search
 * engines fetch it after each submission to verify.
 */

import { SITE } from "./constants";

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const DEFAULT_KEY = "25238df6c5c7fef5a172e7d0965490e3";
const BATCH_SIZE = 1000;

function getKey(): string {
  return process.env.INDEXNOW_KEY || DEFAULT_KEY;
}

function getHost(): string {
  return new URL(SITE.url).host;
}

function getKeyLocation(): string {
  return `${SITE.url.replace(/\/$/, "")}/${getKey()}.txt`;
}

export interface IndexNowResult {
  ok: boolean;
  totalUrls: number;
  totalBatches: number;
  succeededBatches: number;
  failedBatches: number;
  durationMs: number;
}

/**
 * Submit URLs to IndexNow in batches of up to 1000. `ok` is true only when
 * every batch returned 200 or 202. Network/transport errors are swallowed —
 * IndexNow is best-effort and a failed run will retry on the next sweep.
 */
export async function submitToIndexNow(
  urls: string[],
): Promise<IndexNowResult> {
  const start = Date.now();
  if (urls.length === 0) {
    return {
      ok: true,
      totalUrls: 0,
      totalBatches: 0,
      succeededBatches: 0,
      failedBatches: 0,
      durationMs: 0,
    };
  }

  const key = getKey();
  const host = getHost();
  const keyLocation = getKeyLocation();
  const totalBatches = Math.ceil(urls.length / BATCH_SIZE);

  console.log(
    `[indexnow] Submitting ${urls.length} URL(s) in ${totalBatches} batch(es) — host=${host}`,
  );

  let succeededBatches = 0;
  let failedBatches = 0;

  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batch = urls.slice(i, i + BATCH_SIZE);
    const batchStart = Date.now();
    try {
      const res = await fetch(INDEXNOW_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ host, key, keyLocation, urlList: batch }),
      });
      const batchMs = Date.now() - batchStart;
      if (res.status === 200 || res.status === 202) {
        succeededBatches++;
        console.log(
          `[indexnow] Batch ${batchNum}/${totalBatches}: ${batch.length} URL(s) → ${res.status} OK (${batchMs}ms)`,
        );
      } else {
        failedBatches++;
        const text = await res.text().catch(() => "");
        console.error(
          `[indexnow] Batch ${batchNum}/${totalBatches}: ${batch.length} URL(s) → ${res.status} FAILED (${batchMs}ms): ${text.slice(0, 500)}`,
        );
      }
    } catch (err) {
      failedBatches++;
      console.error(
        `[indexnow] Batch ${batchNum}/${totalBatches}: ${batch.length} URL(s) → network error:`,
        err,
      );
    }
  }

  const durationMs = Date.now() - start;
  const ok = failedBatches === 0;
  console.log(
    `[indexnow] Done — ${succeededBatches}/${totalBatches} batch(es) succeeded, ${failedBatches} failed (${durationMs}ms total)`,
  );
  return {
    ok,
    totalUrls: urls.length,
    totalBatches,
    succeededBatches,
    failedBatches,
    durationMs,
  };
}
