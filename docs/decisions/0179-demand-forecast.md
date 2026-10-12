# 0179. Demand forecast

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

The owner chose a forecast that drafts and a person who approves, run as often as ops set (11 October 2026: the planning period and the horizon are console settings, seven days and twelve periods to start). The scope gave it four layers added together, each line naming what each layer gave.

## Decision

1. **Once each planning period,** the hourly stock watch runs the forecast for today. Each run is a row of `forecast_runs`, and each stock code's expected use in each city in each period of the horizon a row of `forecast_lines`.
2. **Booked:** each first fit and replacement booked, the hair system made to its client; and each booked visit's consumables, by its service's expected use.
3. **Due:** each fitted piece falling due, the hair system made to its client, weighted by the share of pieces that fell due over the last 180 days whose replacement was booked; 0.8 until ten have.
4. **Pipeline:** each consultation booked, weighted by the share of the last 180 days' consultations whose client booked a first fit (0.5 until ten), landing fourteen days on, spread across the hair systems its city's fits used.
5. **Baseline:** what each city used of each item over its last eight periods, as a period's worth, lifted by the events ops keep (`demand_events`), each in a city or every city.
6. **A line expects** what booked, due and pipeline add up to, or the baseline where that is more, since history sees what the layers cannot. Its high case is the expected and 1.65 times its square root: about one period in twenty uses more.
7. **Runs older than 180 days are let go.** `GET /api/stock/forecast` reads the latest, for a city or every city, with Operations VIEW.

## Consequences

- The supply plan drafts its top-ups, transfers and orders from the latest run; the events calendar gets its page there.
- How far the forecast was from what happened is measured run by run once there are runs to measure.
- Tests: `test/node/policy/forecast.test.ts`, `test/worker/ops/forecast.test.ts`.
