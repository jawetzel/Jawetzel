import {
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { type ObjectStore } from "@/application/ports/object-store";

/**
 * R2ObjectStore — the production {@link ObjectStore}, backed by Cloudflare R2
 * over the AWS S3 SDK v3 (`region: "auto"` against the R2 endpoint). After the
 * object-store slice this is the **only** module in the app that imports
 * `@aws-sdk`; use-cases speak logical keys and never see `S3Client`, the bucket,
 * `PutObjectCommand`, or the `dev_` prefix.
 *
 * The S3 logic moved here **verbatim** from the old `src/lib/r2.ts`: the client
 * construction + env-var validation, the `dev_` choke-point prefix, the bucket
 * lookup, the presigned-URL TTL/filename handling, and the NoSuchKey/404 → null
 * download. `src/lib/r2.ts` is now a thin shim delegating to a singleton of this
 * class via the DB-free `composition/object-store.ts`.
 *
 * See `docs/architecture/external-services.md` → Cloudflare R2.
 */

function getClient(): S3Client {
  const accessKeyId = process.env.CLOUDFLARE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_SECRET_ACCESS_KEY;
  const endpoint = process.env.CLOUDFLARE_ENDPOINT;

  if (!accessKeyId || !secretAccessKey || !endpoint) {
    throw new Error(
      "Missing R2 credentials. Set CLOUDFLARE_ACCESS_KEY_ID, CLOUDFLARE_SECRET_ACCESS_KEY, CLOUDFLARE_ENDPOINT.",
    );
  }

  return new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function getBucket(): string {
  const bucket = process.env.CLOUDFLARE_BUCKET_NAME;
  if (!bucket) throw new Error("Missing CLOUDFLARE_BUCKET_NAME");
  return bucket;
}

/**
 * Whole-key prefix applied to every R2 operation when running in development.
 * Keeps dev writes/reads in a separate bucket subtree (`dev_*`) so iteration
 * never touches prod data. Single point of control — every method routes
 * through it; callers pass logical keys and stay env-agnostic.
 *
 * Exported as a pure function so the dev-prefix rule is unit-testable without
 * any S3 send.
 */
export function applyEnvPrefix(key: string): string {
  if (process.env.NODE_ENV !== "development") return key;
  return `dev_${key}`;
}

/**
 * Pure construction of the public URL from a base and a logical key: strip
 * trailing slashes off the base, env-prefix the key, strip the key's leading
 * slashes, and join with a single `/`. Exported so the slash-handling + prefix
 * rule is unit-testable without env access or S3.
 */
export function buildPublicUrl(base: string, key: string): string {
  return `${base.replace(/\/+$/, "")}/${applyEnvPrefix(key).replace(/^\/+/, "")}`;
}

/**
 * Pure construction of the `Content-Disposition` header value for a download
 * filename: `attachment; filename="<name>"` with any double-quotes stripped
 * from the name. The filename is the user-facing download name and is **not**
 * env-prefixed, so downloads look identical in dev and prod. Exported so the
 * quote-stripping rule is unit-testable without S3.
 */
export function contentDispositionFor(filename: string): string {
  return `attachment; filename="${filename.replace(/"/g, "")}"`;
}

export class R2ObjectStore implements ObjectStore {
  publicUrl(key: string): string {
    const base = process.env.CLOUDFLARE_PUBLIC_URL;
    if (!base) throw new Error("Missing CLOUDFLARE_PUBLIC_URL");
    return buildPublicUrl(base, key);
  }

  async upload(
    key: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void> {
    const s3 = getClient();
    await s3.send(
      new PutObjectCommand({
        Bucket: getBucket(),
        Key: applyEnvPrefix(key),
        Body: bytes,
        ContentType: contentType,
      }),
    );
  }

  /**
   * Generate a time-limited presigned GET URL for an R2 object. The URL is
   * signed with the same credentials `upload` and `download` use, so the bucket
   * itself can be kept private — anyone who holds the URL can fetch the object
   * until it expires.
   *
   * @param key         storage key (e.g. `supplies/details/current.json`)
   * @param ttlSeconds  lifetime of the URL; default 15 minutes, max 7 days
   *                    (the S3 SigV4 limit)
   * @param filename    optional; forces `Content-Disposition: attachment;
   *                    filename=...` so the browser downloads with that name
   *                    instead of the opaque storage key
   *
   * Pattern mirrors taxation_is_theft's `GenerateDownloadUrlAsync` — same TTL,
   * same per-request generation (no caching), same response-header override
   * for the download filename.
   */
  async presignedDownloadUrl(
    key: string,
    ttlSeconds: number = 15 * 60,
    filename?: string,
  ): Promise<{ url: string; expiresAt: Date }> {
    const s3 = getClient();
    const command = new GetObjectCommand({
      Bucket: getBucket(),
      Key: applyEnvPrefix(key),
      ...(filename
        ? {
            // Filename is the user-facing download name — stays free of the
            // dev_ key prefix so downloaded files look the same in dev as prod.
            ResponseContentDisposition: contentDispositionFor(filename),
          }
        : {}),
    });
    const url = await getSignedUrl(s3, command, { expiresIn: ttlSeconds });
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    return { url, expiresAt };
  }

  /**
   * Fetch an object from R2. Returns `null` when the key does not exist
   * (NoSuchKey / 404). Other errors throw.
   */
  async download(key: string): Promise<Uint8Array | null> {
    const s3 = getClient();
    try {
      const res = await s3.send(
        new GetObjectCommand({ Bucket: getBucket(), Key: applyEnvPrefix(key) }),
      );
      if (!res.Body) return null;
      return await res.Body.transformToByteArray();
    } catch (err) {
      if (err instanceof NoSuchKey) return null;
      const status = (err as { $metadata?: { httpStatusCode?: number } })
        ?.$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw err;
    }
  }
}
