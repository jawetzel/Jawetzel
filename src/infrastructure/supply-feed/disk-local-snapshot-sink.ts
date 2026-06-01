import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type LocalSnapshotSink } from "@/application/ports/local-snapshot-sink";

/**
 * DiskLocalSnapshotSink — the production {@link LocalSnapshotSink}. It carries
 * the exact dev-gated behavior of the old `writeLocalDevSnapshot` verbatim:
 * returns immediately UNLESS the runtime env is `development`; otherwise it
 * mkdir -p's the dirname and writes the file under `process.cwd()`, then logs.
 *
 * The dev-gate lives here (not in the use-case) so the orchestration stays
 * env-agnostic and a test injects a fake sink. `/data` is gitignored and
 * dockerignored, so this is safe to leave enabled — and it NEVER writes outside
 * `development`.
 */
export class DiskLocalSnapshotSink implements LocalSnapshotSink {
  async write(relativePath: string, bytes: Uint8Array): Promise<void> {
    if (process.env.NODE_ENV !== "development") return;
    const path = join(process.cwd(), relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    console.log(
      `[refresh-embroidery-supplies] wrote local dev snapshot: ${path}`,
    );
  }
}
