# 0149. Lost reasons

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

The growth figures ask why consultations end without a fit. Nothing recorded it. The owner ruled a short list, kept by ops, picked when a consultation closes without a fit, in the technician app or the console.

## Decision

1. **Ops keep the list in Settings, Job sheet**, beside the partial reasons and kept the same way: a code for each, words ops may change, one taken off kept as retired, and the committed list (`LOST_REASONS` in `src/config/job-sheet.ts`) until they save their own.
2. **A consultation's card carries the list**, as does a one visit's. Closing a consultation as Done asks "Going ahead with a fit?"; Not now asks why. A one visit whose client declined the fit offers the reasons straight away, to pick or leave. Leaving the question unanswered says nothing.
3. **The reason goes with the outcome** and is kept on the visit, as `visits.lost_reason`. One ops have retired since the phone kept the job is still taken; one never listed is refused.
4. **The reporting copy gives a client not yet fitted the reason from their latest consultation**, in ops' words (ADR 0146).
5. **A phone that kept a card before the list was on it** gives it an empty one when it updates, so the consultation closes without asking.

## Consequences

- Picking or changing the reason in the console, on the consultation's visit, follows in its own change.
- Tests: `test/worker/ops/job-sheet-settings.test.ts`, `test/node/dom/tech-kept.test.ts`, `e2e/tech/steps.e2e.ts`.
