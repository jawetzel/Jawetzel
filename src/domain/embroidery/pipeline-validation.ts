import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

/**
 * Pure embroidery-pipeline value-object constructors + constants + the pure ZIP
 * reader and PNG hash. These are the pipeline's **domain invariants enforced at
 * construction** — invalid sizes / customer IDs are unconstructable — plus two
 * pure byte helpers the orchestrator uses. They moved here verbatim from
 * `src/app/embroidery/_lib/pipeline.ts` (which now re-exports them so the
 * routes' imports stay byte-for-byte unchanged). Zero I/O.
 *
 * See `docs/architecture/embroidery.md` → the validators become value objects.
 */

export const DEFAULT_COLORS = 12;
// 1 = single-thread silhouette work — valid for users on single-needle home
// machines that don't want to thread-swap mid-design. 16 matches the real-
// world ceiling of typical commercial single-head heads.
export const MIN_COLORS = 1;
export const MAX_COLORS = 16;

export const ALLOWED_SIZES = ["4x4", "5x7", "6x10", "8x8"] as const;
export type AllowedSize = (typeof ALLOWED_SIZES)[number];

// Default customer_id for requests that omit the field — treated as the
// shared "test user" bucket so unauthenticated-ish testing flows don't
// pollute real customer folders.
export const TEST_CUSTOMER_ID = "0000-0000-0000-0000";

export class InvalidSizeError extends Error {
  constructor(raw: string) {
    super(
      `Invalid size "${raw}". Allowed: ${ALLOWED_SIZES.join(", ")}`,
    );
    this.name = "InvalidSizeError";
  }
}

export function validateSize(raw: string): AllowedSize {
  const clean = raw.trim().toLowerCase().replace("×", "x");
  if ((ALLOWED_SIZES as readonly string[]).includes(clean)) {
    return clean as AllowedSize;
  }
  throw new InvalidSizeError(raw);
}

// Customer IDs go into R2 keys and local folder paths, so keep them URL-safe
// and path-safe. Lowercase alphanumeric + hyphen/underscore, must start with an
// alphanumeric, 1–64 chars. No dots (blocks `..` traversal), no slashes.
export class InvalidCustomerIdError extends Error {
  constructor(raw: string) {
    super(
      `Invalid customer_id "${raw}". Allowed: 1–64 chars, lowercase alphanumeric, hyphens, underscores; must start with a letter or digit.`,
    );
    this.name = "InvalidCustomerIdError";
  }
}

export function validateCustomerId(raw: string): string {
  const clean = raw.trim().toLowerCase();
  if (/^[a-z0-9][a-z0-9_-]{0,63}$/.test(clean)) return clean;
  throw new InvalidCustomerIdError(raw);
}

export function hashPng(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 12);
}

// Minimal local-file-header ZIP reader. Python's zipfile.writestr writes real
// sizes in each local header (no data descriptors), so we can walk sequentially.
export function extractZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 0;
  while (i + 4 <= buf.length) {
    const sig = buf.readUInt32LE(i);
    if (sig !== 0x04034b50) break; // stop at central directory / EOCD
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const nameStart = i + 30;
    const dataStart = nameStart + nameLen + extraLen;
    const dataEnd = dataStart + compSize;
    const name = buf.toString("utf8", nameStart, nameStart + nameLen);
    const slice = buf.subarray(dataStart, dataEnd);
    const data =
      method === 0 ? slice : method === 8 ? inflateRawSync(slice) : null;
    if (data === null) throw new Error(`zip: unsupported method ${method} for ${name}`);
    out.set(name, new Uint8Array(data));
    i = dataEnd;
  }
  return out;
}
