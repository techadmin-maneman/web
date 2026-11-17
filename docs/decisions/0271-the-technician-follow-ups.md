# 0271. The technician follow-ups

- Status: accepted
- Date: 2026-11-17
- Topic: Field work
- Amends [0270](0270-the-design-checks-api-side.md), [0053](0053-the-technician-app-offline.md) and [0162](0162-scanning-labels.md):
  the last visit's photograph, the scanner, and what a corrected or unlabelled piece sends

## Context

The design check's API side ([0270](0270-the-design-checks-api-side.md)) left six points for later, agreed with its
logic review: the last visit's photograph still served, a refused label read over and over, no base for kit stock
without labels, a refused step's typed lot lost on its correction, the camera's restart untested, and a one visit's
checklist that could read the client's choice as unmade for a moment.

## Decision

1. **The last visit's after photograph is no longer served.** The card stopped showing it
   ([0270](0270-the-design-checks-api-side.md), decision 3), so `GET /api/tech/jobs/{id}/last-visit-photo` and the
   card's `last_visit.photo_url` go. The card still names the last visit, for the hair profile's head.
   [0053](0053-the-technician-app-offline.md)'s one photograph route is gone, and with it 0270's consequence that the
   route stayed for older builds: an older build's card shows no picture where it drew one.
2. **The scanner reads past the label in hand.** The shared camera takes a `takes` check: a code it does not take
   leaves it reading. The hair system step takes no read of the label it already holds, so a label the check refused,
   held up again, is checked once, and the next label held up is still read. [0162](0162-scanning-labels.md)'s camera
   reads as before wherever no screen passes `takes`.
3. **Kit stock without labels is based as its hair system is named**, as a labelled piece of the kit is: 0270's
   departure that such a piece sends no base no longer holds.
4. **A refused piece step corrected to the same piece keeps what it was sent with.** Its label written again, as the
   same label once spaces and capitals are put right, keeps the base and lot an older build sent typed; any other label
   takes its own, as before.
5. **A one visit's choice goes onto its card as its piece step lands**, before the step leaves the outbox, and a card
   the API answers to a read sent before it landed keeps that choice, so the checklist never reads it as unmade.

## Consequences

Tests: `test/dom/tech-piece-scanner.test.ts` (the scanner's reads), `test/node/front-ends/tech-piece-form.test.ts`
(the base and the corrected label), `test/node/front-ends/tech-outbox-replay.test.ts` (the landed choice) and
`test/worker/field/tech-job-card.test.ts` (no photograph served).
