# 0296. A guided task draws no reference photograph until it has one

- Status: accepted
- Date: 2026-11-23
- Topic: Field work
- Amends [0245](0245-the-steps.md), decision 5: a guided task's screen no longer keeps a place for its reference
  photograph while it has none

## Context

ADR 0245 drew each guided task (`apps/tech/src/steps/TaskGuide.tsx`) with a place for its reference photograph: a grey
box naming what the photograph will show, until there is one. No reference photograph has been given for any task. On a
consultation's "Scalp and hairline" step the owner read the empty box as a photograph that failed to come ("Scalp photo
did not come and shows as a blank", 22 November 2026).

## Decision

1. **No box is drawn** where a task has no photograph: its screen, in a visit's checklist and in Me › Guides, shows its
   numbered instructions and what to watch for.
2. **Each task keeps what its photograph is to show** (`reference` in `apps/tech/src/visit/tasks.ts`), for the training
   lead to take; drawing a photograph once one is given is that change's own.

## Consequences

- Nothing on a task's screen looks broken while the photographs are still to be taken.
- The screens differ from the prototype's by the photograph's place until the photographs come.
