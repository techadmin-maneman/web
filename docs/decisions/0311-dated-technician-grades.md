# 0311. Dated technician grades

- Status: accepted
- Date: 2026-11-24
- Topic: Field work

## Context

A visit pays a technician by their grade's rate for its kind (docs/decisions/0122-technician-pay-per-visit.md).
Rates are dated: each applies from a day, and a visit is paid at the rate in force on its own day. A technician's
grade was not: `technicians.pay_grade_id` held one grade, and the pay statement priced every visit on the grade the
technician held when it was read. Moving a technician up a grade therefore re-priced every month already worked. The
owner ruled on 24 November that a grade, like a rate, applies from a day, and that Pay grades shows the history of
both.

## Decision

1. **A grade applies from a day.** `technician_grades` keeps each technician's grade by the India date it applies
   from. A grade of none from a day takes theirs away. Migration 0238 gives every graded technician their grade from
   2000-01-01, so every past statement prices as it did.
2. **Every reader takes the grade in force on its day** (`src/lib/grade-on.ts`):
   - the pay statement and the technician's own month, on each visit's day;
   - a client's cost in the analytics months, on the visit's day;
   - Pay grades' technicians and each grade's count, and the grade the technician app names, on today.
   - A grade is deleted only while no technician's grade, on any day, names it.
3. **A change starts today or later**, as a rate does. Setting one for a day that already has a change replaces it,
   and nothing else. One that starts today is written to `technicians.pay_grade_id` too, which only the release before
   this one reads; nothing reads it after.
4. **Pay grades shows both histories:** each technician's grades by the day each applies from, a change set to start
   later among them, and each grade's past rates, from the rows `visit_pay_rates` already keeps.

## Consequences

- A grade change never re-prices a visit before its start, and one set to start later leaves this month alone.
- `technicians.pay_grade_id` is not dropped yet: it goes once the release before this one can no longer be rolled back
  to.
