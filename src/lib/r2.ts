import { getObjectStore } from "@/composition/object-store";

/**
 * Thin shim over the {@link ObjectStore} port.
 *
 * The S3 implementation moved verbatim into
 * `infrastructure/object-store/R2ObjectStore` (now the sole `@aws-sdk`
 * importer); these four functions keep their exact historical signatures and
 * delegate to the singleton wired in the DB-free `composition/object-store.ts`,
 * so all five consumers (the embroidery pipeline, the upload route, the
 * supply-feed worker job, the supply-feed reader, the download-links route)
 * stay byte-for-byte unchanged. The `dev_` prefix, key/URL schemes, presigned
 * TTL/filename handling, and NoSuchKey/404 → null are all adapter details now.
 *
 * Kept as a shim (rather than rewiring the five consumers) so this slice stays
 * invisible to them; they migrate behind the port when their own slices come up.
 */

export function publicUrlFor(key: string): string {
  return getObjectStore().publicUrl(key);
}

export async function uploadToR2(
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  return getObjectStore().upload(key, bytes, contentType);
}

export async function generatePresignedDownloadUrl(
  key: string,
  ttlSeconds: number = 15 * 60,
  filename?: string,
): Promise<{ url: string; expiresAt: Date }> {
  return getObjectStore().presignedDownloadUrl(key, ttlSeconds, filename);
}

export async function downloadFromR2(key: string): Promise<Uint8Array | null> {
  return getObjectStore().download(key);
}
