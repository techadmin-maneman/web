# 0151. Retention figures

- Status: accepted
- Date: 2026-10-12
- Topic: Platform

## Context

The Retention and LTV dashboard needs each client's standing month by month, by the cohort of their first fit. The owner settled the terms: active is a first fit, service or replacement within the service cycle and its grace; lapsed is past that; lost is lapsed for 90 days, a console setting.

## Decision

1. **One tested rule says where a client stands** (`src/policy/client-standing.ts`): active through their last fitting plus the service cadence plus the grace the At-risk client task gives, both already set in Settings · Rules; lapsed from the day after; lost once lapsed for **Lost after**, a new setting under Reports, 90 days until ops set another.
2. **The reporting copy holds a row per client per month** from the month of their first fitting, which is new: their standing at each later month's end (tonight, for this month), the visits done in it and the revenue they earned, before GST and less refunds, on the visits' days. Each row carries the cohort month, the city of the first fit and the first lead's channel (ADR 0148).
3. **Every month is worked out again each night with today's settings**, so a changed cadence or grace restates the past, and the figures always read one way.
4. **Margin follows the standard costs** (ADR 0152).

## Consequences

- LTV, LTV to CAC and payback are worked out in Zoho from these rows, the spend (ADR 0150) and, once they exist, the margins.
- Tests: `test/node/policy/client-standing.test.ts`, `test/worker/jobs/analytics-nightly.test.ts`.
