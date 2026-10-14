# 0200. Staging's tenants of its own

- Status: accepted; staging's Books organisation and WhatsApp number wait on the owner
- Date: 2026-10-14
- Topic: Platform
- Amends [0025](0025-phase-2-conflicts-register.md), item 26

## Context

Staging and production shared one Books organisation, so only one environment could write its items and staging's invoices landed in the statutory books, labelled as tests. Both sent WhatsApp through one Evolution instance that also serves another app, and both run in one Cloudflare account. A staging bug could rewrite production's Books items or post test documents into the real books.

## Decision

1. **No vendor tenant is shared.** The config check (`scripts/lib/wrangler-config-check.ts`, `TENANT_VARS`) refuses a Books organisation, Books refund account or Razorpay account that staging and production both name, so production's Books cannot be switched on while staging still writes to the same organisation.
2. **Staging gets a Books organisation of its own** (a second organisation, or Zoho's sandbox of the real one) before production's Books goes on. Production takes the real organisation; staging's organisation ID, refund account and bill accounts move to its own (docs/provisioning.md, step 11b).
3. **Each environment writes its own organisation's items.** `BOOKS_ITEM_PUSH` is each environment's own switch, no longer one passed between them: production's goes on once its price book holds the owner's prices.
4. **Staging sends from a number of its own:** an Evolution instance, or an MSG91 sender, used by nothing else (docs/provisioning.md, step 12a).
5. **The analytics copy stays production's alone**, as the owner ruled (ADR 0146): staging has none, so there is nothing to share.
6. **One Cloudflare account stays**, each environment's resources named for it and checked so (`RESOURCE_TOKEN`); R2's free allowance stays split by `SHARE_BYTES`.

## Consequences

- The release that switches production's Books on fails the config check until staging names its own organisation.
- Staging's records made in the real organisation before the move are deleted by the staging clean-up (docs/provisioning.md, step 8, "Staging's records in the org").
- Tests: `test/node/tooling/wrangler-config-check.test.ts`.
