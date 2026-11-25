# 0317. Targets progress

- Status: accepted
- Date: 2026-11-25
- Topic: The ops console

## Context

The Targets page (ADR 0154) held each month's plan, but not how far a city had come, so the plan was read against the
dashboards somewhere else. The 22 November design puts "612 so far" beneath each measure, with a line filling towards
its target, and the owner ruled on 24 November that the month's actual per measure be built.

## Decision

1. **`GET /api/targets/progress?month=`** gives every city's figure for every measure, for a month of the year either
   side of this one: this month's to date, a month gone's in all, and nothing for a month still to come. It is read
   apart from the targets, so the page sets targets whether or not the month can be counted. It is Admin's to read,
   nationally, as the targets are, so it gives Admin view each city's revenue and acquisition cost.
2. **Each measure is counted as the Funnel and the reporting copy count it**, so the page and the dashboards agree,
   city by city. Records marked as tests are left out.
   - Leads: the clients whose first lead came in the month, in that lead's city.
   - Consultations done: the clients whose consultation was done in the month, in the visit's city.
   - New clients: the clients whose first fit was paid in the month, in the payment's city.
   - Active clients: today's, as Cities counts them. A month gone has none, as no count of it is kept by city.
   - Revenue: what was paid in the month, before GST and less what was refunded, in the payment's city, in rupees.
   - Acquisition cost: the spend entered for the city in the month, over its new clients, in rupees. Spend entered for
     no city, partner payouts and free visits given are not any one city's, so they are left out. A city with no spend
     entered, or no new client, has no figure.
   - Utilisation: of the half-slots its technicians had open on the month's days to today, those taken, as the copy's
     capacity reads the dispatch board. A city with no technician has no figure. It counts today's active technicians,
     each in today's city, on every day of the month, so where the roster changed in the month it can differ from the
     reporting copy, which keeps each day as it was worked.
   - On time: of its visits done in the month, those checked in by the end of the arrival window.
3. **The page writes the figure beneath the measure's name**, "612 so far" this month and "612 in October 2026" for one
   gone, with a line beneath it filling towards the target where one is set, in the accent below half. Acquisition cost
   has no line, as a cost is better the less of its target it fills. The target reads "Target 720" at the row's end.
   A measure without a target still shows its figure, as the owner asked for the month's actual per measure; the design
   writes "Not set" there.

## Consequences

- `EditableRow` and `FigureRow` take a `note`, a line beneath the name as the row reads.
- Tests: `test/worker/reports/target-progress.test.ts`, `e2e/ops/targets.e2e.ts`.
