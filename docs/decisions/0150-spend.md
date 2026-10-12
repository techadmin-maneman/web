# 0150. Spend

- Status: accepted
- Date: 2026-10-12
- Topic: The ops console

## Context

The growth figures divide spend by new clients, by channel and city. Google's and Meta's spend reach Zoho Analytics from their own ad accounts. The rest has no system of record: flyers, salon partners' materials, events, and the free visits our invites give. The owner ruled that referral credits cost what the service costs on the day they are used, and that offline spend is typed into the console.

## Decision

1. **A Spend page under Growth** takes a month's offline spend, for a city or national, under a channel (any but Google Ads and Meta Ads), with a campaign named city-first if there is one, an amount in whole rupees before GST, and a note. Growth with manage may add and take off; with view, read.
2. **An entry is added whole and taken off rather than changed.** One taken off is kept, with who and when, and leaves the figures. Each add and each take-off is audited.
3. **The reporting copy's spend** (ADR 0146) is each entry, on the first of its month; each month paid to a partner, under Offline and partners; and each free visit an invite or a partner's code paid for, on the visit's day and in its city, at its service's price that day. A free visit given back is no spend.

## Consequences

- First-fit discounts count in the blended acquisition cost from the payments' own discount column, not from here.
- Tests: `test/worker/ops/spend.test.ts`, `test/worker/jobs/analytics-nightly.test.ts`, `e2e/ops/spend.e2e.ts`.
