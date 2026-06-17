# Payments & Billing — Architecture

> **Template pattern · optional module.** Delete if the project doesn't bill. `CLAUDE.md` carries the summary; this is the full design for platform billing.

## 1. Model at a glance

- **Stripe, platform-billing only.** The billing role (e.g. `seller`) pays the platform for membership. **No Connect, no payouts, no marketplace splits** (add only if the domain needs it).
- **Recurring via the Stripe Subscriptions API.** Plans (e.g. monthly + annual) — **price IDs from env**, no in-app plan CRUD.
- **Non-billing account types have no billing surface.** Only the billing role sees billing.
- **Local `subscriptions` collection mirrors Stripe.** The webhook is the **single writer**; the app reads local state, **never** calls Stripe at request time.
- **Entitlement is billing-infra only.** Whether a feature is gated by subscription status is a *separate* concern — this doc is about getting accurate billing state into our DB.

## 2. Why mirror Stripe locally

- **Request-time reads never hit Stripe.** Page loads, dashboards, gating checks read our `subscriptions` collection — fast, and resilient to Stripe latency/outage.
- **Stripe is the source of truth for _money_; our mirror is the source of truth for _our app's view_ of subscription state.** The webhook keeps them in sync.
- **Single writer = the webhook.** No race between "app writes subscription" and "webhook writes subscription." The app never writes subscription state directly; it creates Checkout/Portal sessions and lets Stripe → webhook → DB.

## 3. `subscriptions` collection

```
subscriptions {
  _id:                  ObjectId
  userId:               ObjectId      // → users._id
  stripeCustomerId:     string
  stripeSubscriptionId: string
  status:               'active' | 'past_due' | 'canceled' | 'trialing' | 'incomplete' | …  // mirrors Stripe
  priceId:              string        // which plan
  currentPeriodEnd:     Date
  cancelAtPeriodEnd:    boolean
  trialEnd?:            Date          // grandfathering (see §6)
  createdAt / updatedAt: Date
}
```

- One active subscription per billing user. Indexed on `userId` and `stripeCustomerId`.
- `status` mirrors Stripe's subscription status verbatim — don't invent our own state machine.

## 4. Customer model

- **One Stripe Customer per billing user**, created lazily at first checkout (or on role approval).
- `stripeCustomerId` stored on the user (or the subscriptions doc). Reused for Portal + future subscriptions.
- Email synced to the Stripe Customer for receipts.

## 5. Flows

### 5a. Subscribe (new)
- App creates a **Stripe Checkout Session** (subscription mode, chosen price) → redirect to Stripe.
- User pays on Stripe-hosted checkout.
- Stripe fires `checkout.session.completed` + `customer.subscription.created` → **webhook writes** the `subscriptions` doc.
- App success page reads local state (may briefly lag the webhook; show "provisioning" if absent).

### 5b. Manage / cancel
- App creates a **Stripe Billing Portal Session** → redirect. User manages card, cancels, switches plan there.
- Stripe fires `customer.subscription.updated` / `.deleted` → webhook updates local mirror.
- **No in-app cancel/plan-switch UI** — the Portal owns it. Less surface, fewer bugs.

### 5c. Renewal / dunning
- Stripe handles retries/dunning. `invoice.payment_failed` → status `past_due` (mirrored). `invoice.paid` → `active`.

## 6. Grandfathering migrated subscribers (migration-only)

- If migrating subscribers with an existing paid period, give them `trialEnd` = their remaining period.
- They enter as `trialing` (no immediate charge); Stripe charges at `trialEnd`. Preserves what they already paid for.
- Delete this section for a greenfield app with no migration.

## 7. The webhook (single writer)

- **One Route Handler** (`app/api/stripe/webhook`), signature-verified (`STRIPE_WEBHOOK_SECRET`).
- **Idempotent:** dedupe on Stripe event id (store processed ids / upsert by subscription id). Stripe retries; handlers must be safe to re-run.
- Maps Stripe events → `subscriptions` writes. The **only** writer of subscription state.
- Returns 2xx fast; heavy work deferred if needed. Never throws raw — logs once, returns 200 to stop retries on poison events (with alerting).

## 8. Ports & use-cases

- **`BillingGateway` port** (`application/ports`) — `createCheckoutSession`, `createPortalSession`, `getCustomer`. Adapter: `StripeBillingGateway` (`infrastructure/stripe`).
- **`SubscriptionRepository` port** — read local mirror; **write only from the webhook path**.
- **Use-cases:** `StartSubscription` (creates checkout), `OpenBillingPortal`, `HandleStripeWebhook` (the writer). Reads like `GetMySubscription` hit the local mirror.
- **Webhook → use-case:** the Route Handler verifies signature, parses the event, calls `HandleStripeWebhook`, which writes via `SubscriptionRepository`.

## 9. Transaction history

- Merge **Stripe invoices** (via API or mirrored) + any **migrated orders** into one view.
- Display-only: date, amount, status, plan, receipt link.
- Mark provenance (`source: 'stripe' | 'migrated'`) so mixed history is unambiguous.

## 10. Account billing surface

- **Billing role only.** `/account/billing`: current plan + status, next charge date, "Manage billing" (→ Portal), transaction history.
- Non-billing account types: no billing UI at all.
- Provisioning lag: if subscription just created and mirror not yet written, show a "provisioning…" state.

## 11. Security & correctness

- **Webhook signature verification** is mandatory (`STRIPE_WEBHOOK_SECRET`). Reject unsigned/invalid.
- **Idempotency** on every webhook handler (Stripe retries; dedupe on event id).
- **Never trust client-reported payment state** — the webhook is the only writer; the client success page is cosmetic.
- **Price IDs from env** — no hardcoded prices; no in-app plan CRUD.
- Reconciliation: a periodic job *may* re-sync local mirror against Stripe (deferred; webhook is primary).
- Redact card/customer PII in logs (shared redaction).

## 12. Testability

- **`BillingGateway` faked** for use-case tests (`StartSubscription`, `OpenBillingPortal`).
- **Webhook handler tested** with recorded Stripe event fixtures → assert `subscriptions` writes; idempotency (same event twice = one write).
- **`SubscriptionRepository` contract-tested** (fake + Mongo).
- Never hit real Stripe in tests; fixtures + fake gateway.

→ See also: `CLAUDE.md` (summary), `auth.md` (accountType gating the billing surface).
