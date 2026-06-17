<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Repo automation rules

## Verify framework APIs against the installed source — don't trust memory

**Before writing any framework code (components, routes, config, data fetching, etc.), consult the actual installed package source/docs under `node_modules/` to confirm current APIs.** Framework majors ship breaking changes faster than training data tracks them; prior knowledge is often stale. Verify behavior against the installed version rather than relying on recall, and match the existing code style in the repo. Use TypeScript strict-mode conventions.

This rule is permanent. The version-specific reminders below are the *current* concrete instance of it — update them when the framework is upgraded. (The managed block above is maintained by tooling; leave it intact.)

## Next.js (current default — update on upgrade)

**ALWAYS reference the installed files** — read the relevant guide in `node_modules/next/dist/docs/` and confirm current APIs in `node_modules/next/dist` before implementing, rather than using outdated or hallucinated patterns.

Key reminders for recent Next.js (App Router):
- `params` and `searchParams` in pages/layouts are **async** (Promises) — you must `await` them.
- `cookies()`, `headers()`, and `draftMode()` from `next/headers` are **async** — `await` them.
- Route Handlers and Server Actions follow the new async conventions.
- Check `node_modules/next/dist` for the exact types and signatures before implementing.

> When you bump the framework major, re-read its release notes / installed docs and rewrite this section to match. The rule above (verify against installed source) does not change; these bullets do.
