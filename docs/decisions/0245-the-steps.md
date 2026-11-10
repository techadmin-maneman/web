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

## Consequences

- The specs find a step's action by where it is, the bar at the foot, not by its words.
