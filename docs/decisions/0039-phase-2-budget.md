# 0039. The Phase 2 budget on the free plan

- Status: accepted
- Date: 2026-09-22

## Context

The owner kept Phase 2 on Cloudflare's free plan with hard caps (22 September 2026), so ADR 0009 stands: nothing may bill. Everything on Workers Free stops at its limit, except R2, which bills past 10 GB. `test/node/free-tier-budget.test.ts` already holds the try-on's worst case under 80% of each allowance.

That worst case was already at the line. Production kept each try-on result for thirty days, and staging and production together could hold 7.96 GB of results, **79.6% of R2's 10 GB**. Phase 2 has to fit into what is left:

- **Photographs are never deleted.** Each visit has five before and five after (`docs/prompts/phase2-backend.md`: "no lifecycle rule").
- **Referral cards** are one image per referrer.
- **The queues** carry FSM's webhook hints, each read back from FSM (ADR 0032), and Phase 2's messages (ADR 0041).
- **Requests** come from three apps and three webhooks.

## Decision

**Production keeps try-on results for fourteen days, not thirty** (`RESULT_RETENTION_DAYS`). The try-on's worst case falls to 3.93 GB, 39.3% of R2. Photographs are still deleted within the hour. The buckets' 30-day expiry rule stays as the backstop, so both consent notices stay true as published ("Kept for: Thirty days, then deleted automatically").

The privacy page changes in two places:

- "the simulation itself is kept for fourteen days";
- the look cookie can show a look again only "while the simulation is kept".

Production has served no try-on, so no stored result is affected.

**Phase 2 has a share of each allowance, set aside in the budget** (`PHASE_2_ALLOWANCE`, `scripts/lib/free-tier-budget.ts`). The budget test adds it to the try-on's worst case, and fails if the two together pass 80%. So no try-on ceiling can be raised into Phase 2's share.

| Allowance              | Free plan  | Try-on worst case | Phase 2's share | Together |
| ---------------------- | ---------- | ----------------- | --------------- | -------- |
| Queue operations a day | 10,000     | 5,500             | 2,000           | 75%      |
| R2 storage             | 10 GB      | 3.93 GB           | 4 GB            | 79.3%    |
| R2 Class A a month     | 1,000,000  | 5,580             | 100,000         | 10.6%    |
| R2 Class B a month     | 10,000,000 | 39,060            | 1,000,000       | 10.4%    |

**The photograph runway is about 1,480 visits.** Phase 2's 4 GB holds:

- **the referral cards:** a thousand of them, at the 300 KB limit Open Graph images need;
- **each visit's ten photographs**, re-encoded on the phone to about 250 KB each.

Before the photographs pass that runway, the owner must decide between the paid plan and keeping photographs in FSM. A storage meter will warn at 50% and 80% of the share. It is built with the photographs (P2-M2), and it refuses uploads at 100%; queued photos then stay on the phone.

**Invoices are not copied to R2.** The prompt asks for Books' PDFs to be cached in `mm-{env}-client-docs` for eight years. Books keeps them for eight years itself, so each one is streamed from Books when it is opened.

**The other allowances have no Phase 2 ceilings yet.** Each is set as the milestone that uses it lands, and added to the budget test:

- **Workers requests (100,000 a day):**
  - only `mm-api` counts, because static assets are free, so the apps' own files cost nothing. **Amended 26 September 2026 ([ADR 0073](0073-prices-from-the-price-book.md)):** `mm-site`'s Worker now answers `/`, `/book` and `/r/*` first, so a view of one of those three pages is a request too; it asks `mm-api` for the prices about once a minute;
  - Phase 2's calls and webhooks, including up to three receipts per message sent, are held to half of the allowance.
- **D1 (100,000 rows written a day; 500 MB per database):**
  - the audit log is one row per ops call (ADR 0031);
  - the FSM mirror is rows of text;
  - neither holds images.
- **Cron triggers (5 for the account):** `mm-api` uses one, every five minutes. Phase 2's jobs, such as reconciliation, credit expiry and hold expiry, run on that same trigger, and none is added.

## Consequences

- **The budget test fails** if a try-on ceiling grows into Phase 2's share. It also fails if results go back to thirty days while the share is reserved.
- **The owner owes a decision before about 1,480 visits:** the paid plan, or photographs in FSM. The storage meter gives notice.
- **The privacy page changed.** The owner approved the privacy and terms text on 22 September 2026. These two phrases are the only changes, and they bring it in line with the new retention.
- **Staging still keeps results for three days,** as before.
