# Auth & authz

> Target framing. Behavior is unchanged — see [`overview.md`](overview.md) for
> status. This is the clearest example of **separation by actor** in the app:
> three different callers authenticate three different ways, and the refactor
> makes that explicit rather than implicit-in-the-route-handler.

## The three actors

A gated endpoint accepts **one of three** principals. This is encoded today in
`src/lib/api-auth.ts` → `requireAuth(request, apiKeyEnvVar)`:

| Actor | Credential | Resolves to | Where |
| --- | --- | --- | --- |
| **Browser user** (signed in) | NextAuth session cookie | `{ userId, role }` | `getCachedSession()` |
| **API client** (a user's own integration) | per-user key `pwsk_<uuid>` in `x-api-key` / `Authorization: Bearer` | `{ userId, role }` for that user | `resolveApiKey()` → `findUserByApiKeyHash()` |
| **Service / admin** (server-to-server) | shared secret in a per-surface env var | `{ userId: null, role: "service" }` | `safeEqual(provided, env)` |

`AuthPrincipal = { userId: string | null; role: "user" | "admin" | "service" }`.
The order matters: session first (cheapest, cached), then the `pwsk_`-prefixed
per-user key (the prefix is the discriminator that decides whether to hit the
DB), then the shared env key. Failure returns a `401 Response`; success returns
the principal. A caller that needs a *user* must reject `role: "service"` itself
(the shared key has no `userId`).

### Per-surface keys

`requireAuth` takes the **env-var name** for the shared key so each surface has
its own: `src/app/embroidery/_lib/auth.ts` binds `EMBROIDERY_API_KEY`. **Per-
surface keys keep blast radius small — a leaked key unlocks one surface, not
every gated endpoint.** This is a deliberate decision; new gated surfaces get
their own env var, never a reused one.

### Key hashing

Per-user keys are stored as `apiKeyHash` on the user, never in plaintext.
`hashApiKey()` is **HMAC-SHA256 keyed with `NEXTAUTH_SECRET`** — the single
source of truth shared by the issuer (`/api-access` actions) and the validator
(`api-auth.ts`); they must agree byte-for-byte. Defense in depth: a leaked
`users` collection is useless without the secret. Comparison of the shared env
key uses `timingSafeEqual` over SHA-256 digests (`safeEqual`) to avoid leaking
length/early-mismatch timing.

## Sessions

- **NextAuth v4, JWT strategy** (`src/lib/auth.ts` → `authOptions`).
- **Providers:** Google OAuth + a `magic-link` `CredentialsProvider`.
- **`signIn` callback** branches by actor: the magic-link path trusts the user
  record `authorize()` already built (defaulting `role: "user"`); the Google
  path calls `findOrCreateGoogleUser()` and stashes the Mongo `_id` + `role`
  onto the user so `jwt` can pick them up with no re-read.
- **`jwt` / `session` callbacks** thread `id` and `role` onto the token and then
  the session.
- **`getCachedSession()`** is the hot path. NextAuth's `getServerSession`
  re-verifies and decodes the cookie on *every* call; a signed-in user firing
  several API calls per page repeats that work. The helper **short-circuits to
  `null` when no session cookie is present** (zero work) and otherwise caches the
  `Session` for **10 minutes keyed on the cookie value** via `getCachedOrFetch`.
  Sign-out rotates the cookie, so the stale entry simply ages out.

### Magic link

`magic-link.ts` → `consumeMagicLinkToken()` looks the token up in the in-process
cache and **deletes it on read** — one-time use, no replay. The token is minted
at `POST /api/auth/magic-link`, emailed, and redeemed at `/auth/verify`.

> **Known limitation (current).** The magic-link token store is the in-process
> `cache.ts`, so it is **single-instance only** — it does not survive horizontal
> scaling or a redeploy mid-flight. Fine for the current single Railway replica;
> the refactor should note this when defining the port (a `TokenStore` backed by
> Mongo/Redis would lift the constraint). Same caveat applies to the session and
> API-key caches, but those are read-through caches of durable state, so a miss
> is merely a re-verify — only the magic-link store is *authoritative* in memory.

## Authz

A single **`role` field on the user** — `"user" | "admin"` — plus the synthetic
`"service"` role for the shared-key path. There is **no role hierarchy / no
permission system**; finer access, if ever needed, is another flag, not a
taxonomy. This matches the reference model's "single boolean-ish privilege"
stance. `role` rides on the JWT and the `AuthPrincipal`, so a check costs no
extra read.

## Target ports

The refactor inverts NextAuth and the key machinery behind ports so use-cases
depend on *principals*, not on `next-auth` or `node:crypto`:

| Port | Capability | Adapter (today) |
| --- | --- | --- |
| `SessionGateway` | Resolve the current session → principal; issue/clear | `NextAuthSessionGateway` (`auth.ts` + `getCachedSession`) |
| `ApiKeyVerifier` | Resolve a `pwsk_` key → principal (validator); hash + evict a key (issuer) | `ApiKeyVerifierAdapter` (owns `hashApiKey` + the cache) + `users.ts` |
| `MagicLinkTokens` | Mint / consume one-time tokens | `magic-link.ts` (in-mem `Cache`) |
| `UserRepository` | find/create users, find-by-key-hash | `users.ts` (Mongo) |

`AuthenticateRequest` becomes an **application use-case** taking those ports and
returning `AuthPrincipal` — the same three-path logic, now unit-testable with
fakes (no cookies, no DB, no env vars) and with NextAuth fully behind the
boundary. Driving adapters (route handlers, the embroidery surface) call the
use-case; they no longer know about `next-auth` at all.

> **Status update.** `AuthenticateRequest` now exists
> (`src/application/use-cases/auth/authenticate-request.ts`), wired in
> `composition/container.ts` behind `SessionGateway` (`NextAuthSessionGateway`),
> `ApiKeyVerifier` (`ApiKeyVerifierAdapter`), and `ServiceKeyVerifier`
> (`ServiceKeyVerifierAdapter`). `requireAuth` in `src/lib/api-auth.ts` is now a
> thin shim that parses the header and delegates to it (behavior identical:
> same order, same `pwsk_` discriminator, same 401). `AuthPrincipal` lives in
> `domain/auth/principal.ts`. The **issuer**
> (`embroidery/_lib/api-key-actions.ts`) has since migrated too — it's a thin
> server action delegating to the `IssueApiKey` use-case, which hashes and
> rotate-evicts through the *same* `ApiKeyVerifier` adapter the validator uses
> (the port widened with `hash`/`evict`), so `hashApiKey` / `apiKeyCacheKey`
> stay the one shared source of truth and issuer/verifier can't drift; the
> now-dead `api-auth.ts` re-exports were removed. **Google sign-in** has since
> migrated too — the `signIn` callback's Google branch now delegates provisioning
> to `FindOrCreateGoogleUser` (behind `UserRepository.findOrCreateGoogleUser`),
> symmetric with the magic-link branch's `ConsumeMagicLink`. The auth surface is
> now essentially closed; only `getCachedSession` (a hot-path helper imported
> directly by still-flat route handlers) remains flat in `src/lib/auth.ts`. See
> [`migration.md`](migration.md) → *Progress*.
