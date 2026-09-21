# 0017. No paid face pre-check

- Status: accepted
- Date: 2026-09-21

## Context

The prompt says: submit a side-profile and a two-face image, read the credit balance before and after, and add Face Analyzer Advanced as a pre-check only if a rejection bills. The harness recorded that failed calls bill 0 credits (API notes, 7.6), but not for these two cases.

## Measurement, 21 September 2026

Measured with `scripts/ailabtools-probe.ts rejected`, against Pro with the staging key:

| Photo                 | What AILabTools did                                                                                           | Credits                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------- |
| A man in side profile | Accepted the submit, then refused at the first poll: 422, `ERROR_NO_FACE_IN_FILE`, "No face detected."        | 1,730 before, 1,730 after |
| Two men side by side  | Accepted the submit, then refused at the first poll: 422, `ERROR_NO_FACE_IN_FILE`, "Multiple faces detected." | 1,730 before, 1,730 after |

The two-face image was composed from two of the test photos for this measurement and kept outside the repository.

## Decision

- **No pre-check.** A refused face costs nothing, so the endpoint's own refusal stands in for Face Analyzer Advanced.
- **Classification.** The refusal arrives on the poll, not the submit. The adapter classifies it as `photo_unreadable`, and the customer's page is told so.

## Consequences

- **Queue cost.** A refused photo costs one submit and one poll: a few queue operations, and no credits.
- **Re-measure if pricing changes.** If AILabTools starts billing refusals, re-run the probe and revisit this ADR.
