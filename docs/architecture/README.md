# `docs/architecture/`

Deep-dive **rationale** for the decisions summarised in `CLAUDE.md`. `CLAUDE.md` states *what* the rule is; these docs explain *why*, record the alternatives considered and rejected, and hold the mechanics too detailed for the summary.

These are authored as decisions are made (or ported from a source repo). A pointer in `CLAUDE.md` to a doc not yet written is a TODO, not a bug.

## Referenced from `CLAUDE.md`

| Doc | Covers | Status |
| --- | --- | --- |
| `auth.md` | session/JWT/sliding-expiry/revocation mechanics + enumeration-safe registration | ✅ ported |
| `client.md` | full rationale for every client-architecture rule | ✅ ported |
| `testing.md` | full stack, layer-by-layer table, responsive-UI seam | ✅ ported |
| `list-reads-projection.md` | projection naming/placement, `$facet` adapter shape, covering-index rules | ✅ ported |
| `payments.md` | plans, customer model, the local subscriptions mirror, `BillingGateway` ports/use-cases | ✅ ported *(optional)* |
| `object-storage.md` | object-store access-path choice + accepted tradeoffs | ✅ ported *(optional)* |
| `types-vocabulary.md` | the controlled-vocabulary `types` collection spec | ✅ ported *(optional)* |

These are genericized ports of a production build — adapt names/values to your domain. Delete the `(optional)` rows + files for modules the project doesn't use.
