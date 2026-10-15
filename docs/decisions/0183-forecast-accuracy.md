# 0183. Forecast accuracy

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

The scope: accuracy is measured each period against what happened, with error and bias per item and city, so ops can see when to trust the forecast (ADR 0179).

## Decision

1. **A run is measured once its first period has passed,** from the hourly stock watch, the latest unmeasured run first. Each stock code and city it expected in that period is kept beside what the kits used then (fitted pieces among it, since they leave the kit as used); a code used that it never expected is kept at an expected nought. A run is marked measured even where nothing was used, so it is measured once.
2. **The measurement outlives the run:** `forecast_accuracy` names its own period, since runs are let go after the learning days.
3. **Three figures:** off by (each line's miss added up, over what was used), bias (expected less used, over used; above nought where it ran high), and the share of lines whose use stayed within the high case. Off by and bias say nothing where nothing was used.
4. **The Supply plan shows it beneath the forecast, for the city picked:** the last 12 measured periods, newest first, and each item across them, the furthest off first.

## Consequences

- Runs made before this lands are measured too, one an hour, the latest first.
- Tests: `test/node/policy/forecast-accuracy.test.ts`, `test/worker/purchasing/forecast-accuracy.test.ts`, `test/dom/ops-supply-plan-planning.test.ts`.
