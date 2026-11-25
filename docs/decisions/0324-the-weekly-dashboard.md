# 0324. The weekly dashboard

- Status: accepted
- Date: 2026-11-25
- Topic: Platform
- Amends [0288](0288-attribution-and-conversions.md): a Business Profile channel, and the steps to fitted by channel

## Context

The owner's launch brief of 25 November 2026 (T17) asks for a weekly dashboard in the console: one row per channel
(one Google row, as the owner ruled; Meta; society; referral; Business Profile; direct), spend entered per channel per
week, and for each: spend, enquiries, qualified, booked, attended, fitted, cost per enquiry, cost per attended
consultation, close rate, media cost per client fitted by the month the leads came, tier mix, the middle first-reply
time, the no-show rate and the commonest lost reasons, for a week or a month, as a CSV too. Growth › Funnel (ADR 0288)
already held the spend, the leads, the consultations booked and done and the first fits paid, by channel, for a week or
a month; the Spend page already takes spend by channel. A visit from the Google Business Profile counted as organic
search.

## Decision

1. **Funnel gains a second table, the steps to fitted**, beside the money: for each channel and the total, enquiries,
   consultations booked (the owner's qualified, so one column), consultations done, clients fitted, the close rate
   (fitted over consultations done), the no-show rate (consultations closed as a no-show over those done or missed), the
   middle wait in Care hours from a lead's first message to Care's first reply (ADR 0323), the cost per client fitted of
   the period's leads (the period's spend over those leads fitted since: by month, the cost by lead-cohort month), the
   tier mix of those fitted, and the three commonest lost reasons of the leads lost in the period, in the job sheet's
   words.
2. **Fitted is the lead's stage** (ADR 0320): the first completed first fit, or a consultation done as one visit.
3. **A channel by last touch** reads, for the new figures, the client's last touch as it stands, not as it stood then.
4. **Business Profile is a channel**: a touch tagged `utm_campaign=gbp` and not paid, as the link on the Google Business
   Profile is (`utm_source=google&utm_medium=organic&utm_campaign=gbp`), in the Organic group; a call can be put under
   it too. Untagged, a visit from Google stays organic search.
5. **CSV**: the page writes the period's two tables as a file, one row a channel, from what it read.

## Consequences

- The Business Profile row fills from the Profile's link as it is tagged today.
- Tests: `test/worker/analytics/funnel-steps.test.ts`, `test/node/policy/channels.test.ts`,
  `test/dom/ops-funnel-csv.test.ts`.
