/**
 * ObjectStore — a driven port for blob storage (upload, download, public/
 * presigned URLs).
 *
 * Consumer-owned: use-cases (and the still-flat workflows that will migrate
 * later — the embroidery pipeline, the supply feeds) say "store these bytes" /
 * "give me a download URL," never "talk to R2." Named for the capability, not
 * the technology. The production adapter is
 * `infrastructure/object-store/R2ObjectStore`; a fake can stand in for tests.
 *
 * Every method takes a **logical** key — the `dev_` prefix that keeps dev
 * iteration off prod objects, the bucket, and the key/URL schemes are all
 * adapter details, invisible across this boundary.
 *
 * `publicUrl` is **synchronous** (a pure string build, no network), mirroring
 * the historical `publicUrlFor`; the other three are async because they hit S3.
 *
 * See `docs/architecture/external-services.md` → Cloudflare R2.
 */
export interface ObjectStore {
  /** Upload `bytes` under `key` with the given content type. */
  upload(key: string, bytes: Uint8Array, contentType: string): Promise<void>;

  /** Fetch the object at `key`; `null` when it does not exist (NoSuchKey/404). */
  download(key: string): Promise<Uint8Array | null>;

  /** The public (non-signed) URL for `key`. Synchronous string construction. */
  publicUrl(key: string): string;

  /**
   * A time-limited presigned GET URL for `key`.
   *
   * @param ttlSeconds lifetime of the URL; default 15 minutes, max 7 days
   *                   (the S3 SigV4 limit)
   * @param filename   optional; forces `Content-Disposition: attachment;
   *                   filename=...` so the browser downloads with that name
   */
  presignedDownloadUrl(
    key: string,
    ttlSeconds?: number,
    filename?: string,
  ): Promise<{ url: string; expiresAt: Date }>;
}
