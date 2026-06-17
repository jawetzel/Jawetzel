# Authentication & Sessions — Architecture

> **Template pattern.** `CLAUDE.md` carries the one-paragraph summary; this is the full design. Genericized from a production build — adapt names/values to your domain.

## 1. Model at a glance

- **Identity key:** email. **One account per verified email.** Case-insensitive (stored lowercased).
- **Two credential types on one account:**
  - **OAuth** (e.g. Google) — verified-by-provider email; no password needed.
  - **Local** — email + password (Argon2id hash).
  - A single account may have **both** (link by verified email). Either signs you in.
- **Email = identity, not proof of intent to log in each time.** Verification proves control of the inbox once; thereafter the credential (password or OAuth) authenticates.
- **Sessions are server-side and revocable** — a JWT cookie rides on top, but the DB session is the source of truth.

## 2. Why app-issued JWT + server sessions (not NextAuth)

**Decision:** roll our own session layer. **NextAuth/Auth.js explicitly rejected.**

Rationale:
- **Revocation.** We need server-side revocation (logout-everywhere, admin force-logout, post-password-reset eviction). NextAuth's default JWT strategy is stateless — can't revoke a token before expiry without bolting on exactly the server-session table we'd build anyway.
- **Control over the cookie/session lifecycle** — sliding expiry with a hard cap, "remember me", throttled writes. (See §5–6.)
- **One identity model, our schema.** Hybrid OAuth-or-password on one account, email as the key, with our `users` shape — not adapter-shaped.
- **Fewer moving parts.** One `sessions` collection + a cookie + middleware. No adapter indirection.

Cost accepted: we write the session logic, CSRF protection, and the OAuth handshake ourselves. Worth it for revocation + a clean identity model.

## 3. `users` collection (identity-relevant fields)

```
users {
  _id:            ObjectId
  email:          string        // lowercased, unique index
  emailVerified:  boolean       // gates local login
  passwordHash?:  string        // Argon2id; absent for OAuth-only accounts
  oauthSub?:      string        // provider subject id; absent for local-only accounts
  displayName?:   string
  accountType:    string        // e.g. 'member' | 'seller' — see Authz; NOT a privilege
  admin?:         boolean       // privileged flag; out-of-band only
  createdAt:      Date
  updatedAt:      Date
}
```

- **Unique index on `email`.** One account per verified email.
- `passwordHash` and `oauthSub` are independently optional — either or both. At least one required.
- Partial unique index on `oauthSub` (sparse; unique among present values).

## 4. `sessions` collection — the revocation source of truth

```
sessions {
  _id:            ObjectId      // opaque session id (also the JWT `sid`)
  userId:         ObjectId      // → users._id
  issuedAt:       Date
  expiresAt:      Date          // sliding; TTL index target
  absoluteExpiry: Date          // hard cap; issuedAt + 90d, never extended
  rememberMe:     boolean       // controls cookie persistence + sliding window length
  userAgent?:     string        // for the account's "active sessions" view
  ip?:            string
  admin:          boolean       // snapshot of users.admin at issue time
  accountType:    string        // snapshot for cheap authz without a user read
}
```

- **TTL index on `expiresAt`** — Mongo auto-evicts expired sessions. Logout = delete the doc ⇒ immediate, real revocation.
- The session doc is read on every authenticated request (see §7) — it's the source of truth, the JWT is just the bearer.
- `admin` and `accountType` are **snapshotted** at issue so the hot path authorizes without a `users` lookup. A privilege change forces re-login (acceptable; admin is out-of-band and rare).

## 5. The JWT (bearer, not source of truth)

- **Payload:** `{ sid, userId, iat, exp }`. `sid` = session `_id`. That's it — no roles, no profile.
- **Signed** with `AUTH_JWT_SECRET` (HS256). Short-ish `exp` aligned to the sliding window, but **the session doc governs** — a valid JWT with a deleted/expired session is rejected.
- **Why both?** The JWT lets the edge/middleware do a cheap signature check and carry the `sid`; the session read does the authoritative check. JWT is the envelope, session is the letter.
- **Never** put authorization state that must be revocable (admin, account type used for gating) *only* in the JWT — it's snapshotted in the session doc, which we control.

## 6. Cookie & sliding expiry

- **Cookie:** `httpOnly; Secure; SameSite=Lax; Path=/`. Name e.g. `__Host-session` (Host-prefixed in prod).
- **`SameSite=Lax`** so top-level navigations from email links work; the OAuth callback uses state, not cookie cross-site.
- **Remember me:**
  - **On** → persistent cookie, `Max-Age` = sliding window (e.g. 30d), session `expiresAt` slides.
  - **Off** → session cookie (no Max-Age; dies with browser), shorter server `expiresAt` (e.g. 12h), no/limited sliding.
- **Sliding expiry with hard cap:**
  - On an authenticated request past a **throttle threshold** (e.g. last slide >1d ago), extend `expiresAt = now + window`.
  - **Never** past `absoluteExpiry` (issuedAt + 90d). At the cap, force re-login.
  - **Throttled writes:** only slide once per threshold window — not every request — to avoid a DB write per page load.

## 7. Request authentication flow

```
1. Middleware reads the cookie, verifies JWT signature (cheap, no DB).
   - invalid/missing → treat as anonymous.
2. Driving adapter / use-case resolves the session:
   - load sessions._id = sid
   - null? → anonymous (JWT valid but session revoked/expired)
   - expiresAt < now? → anonymous (lazy; TTL will sweep)
   - absoluteExpiry < now? → anonymous, force re-login
3. Load principal from the session snapshot (userId, admin, accountType).
   - No users read on the hot path unless the use-case needs profile fields.
4. Maybe slide expiresAt (throttled, §6).
```

- **Principal** (`{ userId, admin, accountType }`) is built from the session and carried by the per-request container (`createContainer(ctx)`).
- Middleware does **signature-only** gating (can't hit Mongo at the edge); the authoritative session check is in the use-case/driving adapter.

## 8. Registration — enumeration-safe

The hard rule: **never reveal whether an email already has an account.**

- **Local register, new email:** create unverified user, send verification email, respond "verification sent."
- **Local register, existing _unverified_:** resend verification, respond "verification sent" (identical).
- **Local register, existing _verified_:**
  - **Right password:** sign them in (this is just a login in disguise). The one allowed enumeration "tell" — accepted as UX.
  - **Wrong password:** respond "verification sent" anyway — **do not** confirm the account exists, and **do not** send anything (or send a "you already have an account" notice to the inbox — out-of-band, not in the HTTP response).
- **Uniform response + uniform timing.** Same HTTP status, same body, padded timing so existence can't be inferred from latency.

## 9. Email verification

- Token: random 32-byte, stored **hashed** (SHA-256) with `expiresAt` (e.g. 24h), single-use.
- `GET /verify?token=…` → hash, look up, check expiry, set `emailVerified = true`, delete token, sign in.
- Verification proves inbox control once; thereafter the credential authenticates.

## 10. Password reset (lost password)

- **Identity-only, shared across account types.** Same flow regardless of `accountType`.
- Request: enumeration-safe ("if an account exists, a reset link was sent") — uniform response.
- Token: random 32-byte, **hashed** at rest, `expiresAt` (e.g. 1h), single-use.
- On reset: set new `passwordHash` (Argon2id), **evict all sessions for the user** (delete all `sessions` where `userId` = …) ⇒ logout-everywhere. Optionally sign in the current device after.
- An OAuth-only account doing "reset password" → sets a password (now hybrid). Fine.

## 11. Sign-out & session management

- **Sign-out:** delete the current session doc, clear the cookie. Immediate revocation.
- **Logout-everywhere:** delete all sessions for the user.
- **Active sessions view:** list the user's `sessions` (userAgent, ip, issuedAt); allow revoking any individually.
- **Post-password-reset:** always logout-everywhere (§10).

## 12. OAuth handshake (server-side)

- Authorization-code flow with PKCE + `state` (CSRF). No client-side token handling.
- On callback: verify `state`, exchange code, **verify the ID token** (signature, `aud`, `iss`, `exp`), extract `sub` + email.
- Link rule: match by **verified email**:
  - email exists → attach `oauthSub` to that account (now hybrid), sign in.
  - no account → create one (`emailVerified = true` from the provider), `accountType` defaulted/asked, sign in.
- **Provider tokens are verified once and discarded** — we don't store access/refresh tokens; we don't call provider APIs after sign-in. Identity only.

## 13. Security checklist

- Argon2id for passwords (tuned cost). Never log password or token plaintext.
- Tokens (verify, reset) stored **hashed**; single-use; short TTL.
- CSRF: OAuth `state`; for cookie-auth POSTs, SameSite=Lax + (optional) double-submit/Origin check on mutations.
- Rate-limit: login, register, verify-resend, reset-request (per-IP + per-account).
- Session cookie `__Host-` prefixed in prod; `httpOnly; Secure; SameSite=Lax`.
- All session/token writes go through the use-case layer; never from the client tree.
- Redact `password`, `token`, `authorization` in logs/errors (shared redaction, see Error strategy in `CLAUDE.md`).

## 14. Testability

- **Domain:** `Email.create`, password policy, token hashing — pure, tested directly.
- **Use-cases** (`RegisterUser`, `SignIn`, `VerifyEmail`, `ResetPassword`, `SignOut`) — fakes for `UserRepository`, `SessionRepository`, `TokenRepository`, `EmailSender`, `Clock`, `PasswordHasher`.
- **Enumeration-safety tested:** new vs. existing-unverified vs. existing-verified-wrong-password return identical shapes.
- **Session lifecycle tested:** sliding throttle, hard cap, revocation-on-reset.
- Adapters (Mongo repos, OAuth verifier) integration-tested.
