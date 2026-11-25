# 0322. Customer Care's times, to the minute

- Status: accepted
- Date: 2026-11-25
- Topic: Messages and the CRM
- Amends [0132](0132-the-reply-clock.md): the hours are times of the day

## Context

The owner's launch brief of 25 November 2026 sets the operating hours at 9:30 am to 7 pm, every day, and asks that a
lead waiting five minutes in those hours be told to Care (T16). Customer Care hours, the setting the reply clock reads,
held whole hours: Care could open at 9 or 10, never at 9:30. Every setting's value is a whole number.

## Decision

1. **Care's times are minutes past midnight in India,** a new setting, `care_times`, in place of `care_hours`: when Care
   open and close, and when an after-hours message is answered by. The first reply stays in minutes. The committed
   default is 9:30 am to 7 pm, a first reply within the hour and answered by 10 am.
2. **Expand, then contract.** A migration copies `care_hours` into `care_times`, its hours times sixty, so a release
   moves the setting as ops set it; `care_hours` stays for the release before, still serving while the new one is the
   canary. The client app's `care_hours` keeps whole hours for app copies older than this one, beside `opens_minute`
   and `closes_minute`, which the app reads now. A later release drops the old row and the whole hours.
3. **The console takes a time** for a setting in minutes of the day, chosen on a clock and read as "9:30 am".

## Consequences

- The after-hours reply says "9:30 am" where Care open then.
- Contract, waiting: drop the `care_hours` row and the client API's whole-hour fields once no app copy reads them.
- Tests: `test/node/policy/care-hours.test.ts`, `test/dom/ops-rule-drafts.test.ts`.
