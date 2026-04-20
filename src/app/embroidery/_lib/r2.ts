import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

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

export function publicUrlFor(key: string): string {
  const base = process.env.CLOUDFLARE_PUBLIC_URL;
  if (!base) throw new Error("Missing CLOUDFLARE_PUBLIC_URL");
  return `${base.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
}

export async function uploadToR2(
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const s3 = getClient();
  await s3.send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: bytes,
      ContentType: contentType,
    }),
  );
}
