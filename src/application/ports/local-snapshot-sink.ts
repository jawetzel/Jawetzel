/**
 * LocalSnapshotSink — a driven port for the dev-only on-disk mirror of feed
 * snapshots.
 *
 * Consumer-owned: `RefreshSupplyFeeds` writes each `current.*` blob to this sink
 * alongside the R2 upload so a developer can inspect the freshly-pulled payloads
 * on disk. It says "write these bytes at this repo-relative path," never "check
 * NODE_ENV" or "mkdir -p" — the **dev-gating lives in the adapter**
 * (`infrastructure/supply-feed/DiskLocalSnapshotSink`), which writes only in
 * `development` and never outside `process.cwd()/data/…`. Keeping the gate in the
 * adapter is what lets the use-case stay env-agnostic and lets a fake sink record
 * calls in tests.
 *
 * The path is the same logical `data/<key>` the old `writeLocalDevSnapshot` used;
 * the env check and the `mkdir -p` are adapter details, invisible across this
 * boundary.
 */
export interface LocalSnapshotSink {
  /**
   * Mirror `bytes` to disk at `relativePath` (resolved under the process CWD by
   * the adapter). A no-op outside `development`.
   */
  write(relativePath: string, bytes: Uint8Array): Promise<void>;
}
