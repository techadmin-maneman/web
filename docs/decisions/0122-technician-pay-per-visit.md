# 0122. Technician pay per visit

- Status: accepted
- Date: 2026-10-11
- Topic: Field work

## Context

Technicians are paid a salary and a rate for each visit, and the rate differs by seniority and by city. Nothing recorded it, so payroll would be worked out by hand from the visits closed. The owner ruled on 11 October 2026 that the rates are set in the console, and that the payroll provider (Zoho Payroll or RazorpayX) is integrated later.

## Decision

1. **Grades.** Finance names the seniority grades (`pay_grades`) and gives each technician one (`technicians.pay_grade_id`), or none. A grade is deleted only while nothing uses it.
2. **Rates.** A rate is per grade and kind of visit: consultation, consultation and fit, first fit, service visit, replacement, and client not home (`visit_pay_rates`). It is for every city, or for one, where it stands in for every city's. Each starts from a date, today or later, and is never rewritten, so a month already worked keeps the rates it was worked at. A rate of none from a date takes a city back to every city's rate.
3. **Who.** The Technician pay page is under Finance. Grades and every city's rates need a national grant; a city's own rate, and a technician's grade, keep to the caller's cities. Each change is audited with IDs, codes and amounts, never a grade's name.

## Consequences

- The payroll integration reads these: each technician's visits closed in a month, by kind and city, at the rate in force on each visit's day.
- Tests: `test/worker/ops/technician-pay.test.ts`, `e2e/ops/technician-pay.e2e.ts`.
