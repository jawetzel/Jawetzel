/**
 * IndexNowSubmitter — a driven port for the IndexNow HTTP ping itself (notify
 * Bing/Yandex/Seznam about changed URLs).
 *
 * Consumer-owned: `PingIndexNow` is its only consumer. The result shape mirrors
 * what the underlying submission reports so the use-case can preserve its exact
 * logging and its stamp-only-on-success rule (`ok` gates the stamp; the batch
 * counts feed the failure log). The production adapter is
 * `infrastructure/indexnow/HttpIndexNowSubmitter` (which wraps the unchanged
 * `src/lib/indexnow.submitToIndexNow` — batching, key/host, best-effort
 * swallowing of transport errors); tests use an in-memory fake.
 */
export interface IndexNowSubmissionResult {
  /** True only when every batch returned 200/202. Gates the ping stamp. */
  ok: boolean;
  totalUrls: number;
  totalBatches: number;
  succeededBatches: number;
  failedBatches: number;
  durationMs: number;
}

export interface IndexNowSubmitter {
  submit(urls: string[]): Promise<IndexNowSubmissionResult>;
}
