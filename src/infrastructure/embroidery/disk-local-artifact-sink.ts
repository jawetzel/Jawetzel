import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { type LocalArtifactSink } from "@/application/ports/local-artifact-sink";

/**
 * DiskLocalArtifactSink — the production {@link LocalArtifactSink}. It owns the
 * `node:fs` machinery and the **fixed** local directory the embroidery pipeline
 * has always written to:
 *
 *   `path.join(process.cwd(), "tmp", "embroidery")`
 *
 * One fixed folder inside the project, overwritten every run — the stable
 * "latest output" path regardless of input image. The `mkdir -p` and the
 * `writeFile(path.join(localDir, name), bytes)` moved here verbatim from
 * `pipeline.ts`'s old `mkdir` + `persist()`/extract `writeFile` calls; the
 * use-case calls the port and never touches `fs`, mirroring how
 * `DiskLocalSnapshotSink` owns the dev-disk fs for the supply feed.
 */
export class DiskLocalArtifactSink implements LocalArtifactSink {
  readonly localDir: string;

  constructor() {
    this.localDir = path.join(process.cwd(), "tmp", "embroidery");
  }

  async ensureDir(): Promise<void> {
    await mkdir(this.localDir, { recursive: true });
  }

  async write(name: string, bytes: Uint8Array): Promise<void> {
    await writeFile(path.join(this.localDir, name), bytes);
  }
}
