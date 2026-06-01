/**
 * LocalArtifactSink — a driven port for the embroidery pipeline's local-disk
 * mirror of every generated artifact.
 *
 * Consumer-owned: `RunEmbroideryPipeline` writes each artifact (`input.png`,
 * `palette.json`, `traced.svg`, …) and every extracted ZIP entry (`.dst`,
 * `.pes`, `embroidery.bmp`, …) to this sink alongside the R2 upload, so the
 * machine-ready files are directly usable on disk without unzipping. It says
 * "ensure the dir, then write these bytes under this name," never "mkdir -p" or
 * "join `process.cwd()`/tmp/embroidery" — the **fs + the fixed
 * `process.cwd()/tmp/embroidery` path live in the adapter**
 * (`infrastructure/embroidery/DiskLocalArtifactSink`), mirroring how
 * `DiskLocalSnapshotSink` owns the dev-disk fs for the supply feed.
 *
 * `localDir` is exposed because the historical `PipelineResult.localDir` is the
 * absolute on-disk path the pipeline returns — keeping it on the port lets the
 * use-case echo the same string the adapter writes to, byte-for-byte.
 */
export interface LocalArtifactSink {
  /**
   * The absolute on-disk directory this sink writes to. Echoed verbatim into
   * `PipelineResult.localDir`. (Historically `process.cwd()/tmp/embroidery`.)
   */
  readonly localDir: string;

  /**
   * Create the local directory if needed (the old `mkdir(localDir, { recursive:
   * true })` at the top of the pipeline). Idempotent.
   */
  ensureDir(): Promise<void>;

  /**
   * Write `bytes` to `<localDir>/<name>` (the old `writeFile(path.join(localDir,
   * name), bytes)`). Used for both persisted artifacts and extracted ZIP
   * entries.
   */
  write(name: string, bytes: Uint8Array): Promise<void>;
}
