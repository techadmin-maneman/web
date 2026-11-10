# 0245. The visit's steps in the new look

- Status: accepted
- Date: 2026-11-12
- Topic: Field work
- Follows [0244](0244-the-visit-engine.md)

## Context

The brief (`docs/prompts/tech-redesign.md`, "Visit engine") gives every step one frame: the step's name with the client
and the visit beneath, the visit's steps as a bar under it with "Step n of N" and All steps, and one action at the foot,
"Next: <the step after>". PR 6 of the plan (`docs/technician-redesign/PLAN.md`) redraws each step in it.

## Decision

1. **One step frame for every step** (`apps/tech/src/steps/StepFrame.tsx`). It reads where the visit stands from the
   step's address, the card the phone keeps and the outbox, so no step says where it is. The bar opens the visit's
   plan. The action reads "Next: <the step after>", "Close visit" on the last, or a step's own words where the brief
   gives them. What it still waits on is a line above it, never the button's own words, and a step the API refused
   says "Needs a fix" in red.
2. **The steps' bodies take the new look's roles**: their own colours become the look's, their shared parts drop
   their ink variants, and a control is the app's gloved 48 px, past the brief's 44.
3. **The consumables step's one tap "Used as expected" goes**: its action is "Next" as every step's is, and "Pick why"
   is the line above it.
4. **The close-out takes the new look's colours now**, since it shares the steps' sheet; its redraw is PR 7's.
5. **The guided tasks are the job's checklist, one item a screen** (`apps/tech/src/steps/Checklist.tsx`): Task n of N,
   the title, where the reference photograph goes, the numbered instructions and what to watch for, with the client's
   alerts above and the item's Done. The words are draft, in a data file apart from the screens for the training lead
   to edit (`apps/tech/src/visit/tasks.ts`), keyed by the job sheet's item; an item it has none for shows its label.
   Tick all stays, for a routine visit.
6. **The outcome takes the note for the next technician and an alert**, each sent with the close only when written
   (ADR 0242). No voice note.
7. **Where the steps keep what they had**:
   - The consumables' reason is one for the step, as the API keeps it (ADR 0222), said under the counts, not a chip
     under each item.
   - Colour and style is the hair profile step's second part, as it was, and shares its place in the bar; the history
     stays its third.
   - The consultation's Options stays on its job, open at any point of the visit, and the one visit's decision stays at
     the head of the hair system step, the API's piece event.
   - Matching the hair system to a profile measured with no signal is PR 7's, with the rest of the offline work: the
     profile the phone sends and the one the card reads are typed apart, and laying one over the other needs care.

## Consequences

- The specs find a step's action by where it is, the bar at the foot, not by its words.
