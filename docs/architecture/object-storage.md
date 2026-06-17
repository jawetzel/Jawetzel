# Object / Media Storage — Architecture

> **Template pattern · optional module.** Delete if the project stores no user/media files. `CLAUDE.md` carries the summary; this is the full rationale + the access-path decision.

## 1. Model at a glance

- **Object storage behind an application port.** The app never talks to a storage SDK directly. Default vendor: **Cloudflare R2**.
- **Bulk migrated media (if any) + all future uploads live in the object store** — **not** in the app's static assets, **not** in Mongo.
- **Access path: record which one your credentials allow** (see §3 — this is the load-bearing decision). The template default is the Cloudflare REST API with Bearer-token auth (`R2RestObjectStore`).
- **Public read via a CDN domain**; writes via the authenticated API from the server only.

## 2. The port

```ts
interface ObjectStore {
  put(key: string, body: Buffer | ReadableStream, opts?: { contentType?: string }): Promise<void>;
  get(key: string): Promise<ReadableStream | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  url(key: string): string;   // public CDN URL for a key
}
```

- **Consumer-owned** (`application/ports/`), named for the role (`ObjectStore`), not the tech.
- Adapter `R2RestObjectStore` (`infrastructure/object-store`) implements it via the Cloudflare REST API.
- Swappable: an `S3ObjectStore` or `FsObjectStore` (tests/local) could implement the same port.

## 3. Access path — REST vs. S3-compatible (record the choice)

**The load-bearing decision.** R2 (and most stores) offer an S3-compatible endpoint *and* a native REST API. **Pick by the credential you can actually obtain, and write it down.**

- On the build this came from, **the only obtainable credential was a Cloudflare API token (Bearer)** — S3-style access-key/secret pairs were not mintable for that account. That forced the **REST API** path and a small custom adapter.
- If your account *can* mint an access-key-id/secret, the S3-compatible path lets you reuse the AWS SDK instead.
- Either way the **port hides it**; the rest of the app doesn't care. Just record which path and why, so the adapter choice isn't a mystery later.

## 4. Key structure

```
<entity>/<id>/<filename>        e.g. users/abc123/avatar.jpg
migrated/<original-path>         preserve provenance for a bulk import
```

- Deterministic keys derived from entity + id; no random UUIDs unless needed for collision avoidance.
- Content-addressed where dedup matters.

## 5. Upload flow

1. Client requests an upload (Server Action) → server validates (type, size, auth).
2. Server `put`s to the store via the port (`ObjectStore.put`).
3. Server stores the **key** (not the URL) on the entity; `url(key)` derives the public CDN URL at render.
4. Public read via the CDN domain; no auth on read for public media.

- **Store keys, not URLs** — the CDN domain can change; the key is stable.
- Large/streamed uploads: stream to the store, don't buffer the whole file in memory where avoidable.

## 6. Testability

- **`ObjectStore` faked** in tests (`InMemoryObjectStore` / `FsObjectStore`) — use-cases never hit the real store.
- **`R2RestObjectStore` integration-tested** against a real bucket (or a local mock) — the contract test runs against both.
- Key derivation is pure → tested directly.

→ See also: `CLAUDE.md` (summary), `testing.md` (contract tests).
