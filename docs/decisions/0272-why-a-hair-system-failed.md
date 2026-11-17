# 0272. Why a hair system failed

- Status: accepted
- Date: 2026-11-18
- Topic: Field work
- Amends [0270](0270-the-design-checks-api-side.md), [0188](0188-failure-rates-and-value-at-risk.md), [0169](0169-supplier-claims.md)
  and [0271](0271-the-technician-follow-ups.md): failures recorded again, by the technician and by Care, for reasons ops
  keep; and a one visit's checklist takes the client's no while it is open

## Context

The scan-first hair system step ([0270](0270-the-design-checks-api-side.md), decision 6) stopped asking why a piece
failed, so nothing recorded a failure any more: the Quality page's failure rates ([0188](0188-failure-rates-and-value-at-risk.md)),
a returned piece's reason on the claims list ([0169](0169-supplier-claims.md)) and the Hair systems tab's "Came off"
counted none. On 18 November 2026 the owner answered how failures are recorded again: by the technician and by ops,
from a list ops keep that starts with six reasons.

## Decision

1. **Ops keep the reasons a hair system failed**, a fifth list of the job sheet beside the not-fitted reasons
   ([0270](0270-the-design-checks-api-side.md), decision 1): table `failure_reasons`, set in Settings › Job sheet
   (`POST /api/job-sheet/failure-reasons`), standing at Edges lifting, Shedding, Base torn, Colour faded, Damaged by
   the client and Other until ops save their own. A reason taken off is kept as retired, as on the other lists.
2. **A piece keeps its failure in words, and the list's code beside them.** `pieces.failure_reason` keeps the reason's
   words as they read when it failed, so everything that reads it reads as before; the new `pieces.failure_code` keeps
   the list's code, so a reason ops reword later is still counted as one. A reason sent that is not on the list, as the
   API has always taken one, is kept in its own words with no code.
3. **The technician may say why, never must.** On a replacement whose piece came off before it was due (its
   replacement day after the visit's day), "Came off early? Say why" beneath what is expected opens the light sheet of
   "Can't fit today" with the reasons as chips; Done sends the one picked as `old_piece.failure_reason`, by its code,
   and the piece that came off is recorded as failed for it, its hand-back for the claims list too. One left unsaid is
   replaced, as before. The card carries the list on a replacement (`failure_reasons`), and a card kept before it
   offers none.
4. **Care may mark a client's hair system failed, or take a failure back**, on the client's Hair systems tab:
   Mark failed asks why, from the list, and the day, from its fit to today (`POST /api/clients/{id}/pieces/{code}/failure`);
   Undo takes it back (`DELETE` on the same path), the hand-back's reason with it while that is still to be settled. A
   piece another was fitted over is then replaced when it came off, as if it had never failed. Both are logged.
5. **Closing a guarantee claim, or a chat about the hair system the client wears, asks whether it was at fault**:
   "Was the hair system at fault?" No, or Yes with a reason. A claim's Yes marks failed today the piece its fit put on;
   a chat's, the piece the client wears, asked where the chat's latest open report is about edges lifting, shedding
   or colour. No is where it starts, and marks nothing.
6. **The Quality page counts failures by reason**: of every piece fitted in the period, how many failed for each, by
   the list's words for its code, else the words kept.
7. **A one visit's checklist takes the client's no while it is open.** It keeps the list it opened with
   ([0271](0271-the-technician-follow-ups.md), decision 5), but for a no heard since, which only ever shortens it to
   the consultation's: one opened with the full list in the moment the card had not yet heard the choice no longer keeps
   it, the point [0271](0271-the-technician-follow-ups.md)'s review left for later.

## Consequences

A hair system marked failed by Care owes the client a replacement, as one the technician recorded always has
([0192](0192-free-remakes.md)): Care mark one only where it did fail. A failure is recorded once; a second, from a claim or a
chat on a piece already failed, leaves the first standing.

A Worker rolled back past this reads and writes neither `failure_reasons` nor `pieces.failure_code`: a failure the
technician records then keeps the code's words unturned, as it was sent.

Tests: `test/worker/ops/job-sheet-settings.test.ts` (the fifth list), `test/worker/field/field-piece.test.ts` (a code
kept as its words with the code), `test/worker/ops/piece-failures.test.ts` (Mark failed, Undo, a claim's and a chat's
close), `test/worker/inventory/stock-quality.test.ts` (failures by reason), `test/node/front-ends/tech-piece-form.test.ts`
(when it asks, and what it sends), `test/node/front-ends/tech-kept.test.ts` (a card kept before the list),
`test/dom/ops-chat-close-fault.test.ts` (a chat's close), `test/dom/tech-checklist-choice.test.ts` (the no heard while
open), and `e2e/tech/steps-piece.e2e.ts` and `e2e/ops/piece-failures.e2e.ts` (the screens).
