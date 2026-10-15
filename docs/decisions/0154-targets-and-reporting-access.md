# 0154. Targets and reporting access

- Status: accepted
- Date: 2026-10-12
- Topic: The ops console

## Context

Every scorecard sets plan beside actual, so the plan needs a home. And the dashboards are shared in Zoho Analytics to each member of staff filtered to their places, from the Staff list, so nobody keeps a second list of access by hand.

## Decision

1. **A Targets page under Admin** takes a month's target for a city by measure: leads, consultations done, new clients, active clients, revenue and acquisition cost in whole rupees before GST, utilisation and on time as percentages. Months run a year either side of this one. Setting one again replaces it; taking one off deletes it. Admin with manage set them; with view, read. Each change is audited with the figure.
2. **The reporting copy carries the targets** (ADR 0146), month by month.
3. **The reporting copy carries who may read what**: each grant of each member of staff let into the console, as the Staff list holds it, in `access`. Someone taken off the list, or switched off, leaves it the same night.

## Consequences

- Making each member of staff a Zoho user, sharing each dashboard filtered by `access`, and scheduling the emails per place are done in Zoho when the copy is switched on.
- Tests: `test/worker/reports/targets.test.ts`, `test/worker/jobs/analytics-nightly.test.ts`, `e2e/ops/targets.e2e.ts`.
