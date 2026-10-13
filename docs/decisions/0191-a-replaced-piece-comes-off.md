# 0191. A replaced piece comes off

- Status: accepted
- Date: 2026-10-13
- Topic: Field work

## Context

A replacement's piece step names the piece that came off only to say why it failed. On an ordinary replacement the technician leaves it out, so the old piece stayed worn in our records: the client's Home offered another replacement as soon as the visit closed, the Tasks board kept asking for one to be ordered, and a recall of its lot still counted it.

## Decision

1. **Replaced, apart from failed.** `pieces.replaced_at` is set when another piece is fitted on a later visit for the same client. A piece that failed keeps `failed_at` and is not also replaced, so failure rates count failures only.
2. **One worn piece at a time.** Fitting a piece marks every other worn piece of the client replaced, named in the step or not.
3. **Worn means neither.** Every read of the piece a client wears, and the replacement it falls due for, skips a replaced piece.
4. **Earlier pieces too.** Migration 0157 marks replaced each worn piece a later fit took the place of.

## Consequences

- The console's pieces table shows "Came off": a failure with its reason, or the day it was replaced.
- Tests: `test/worker/field/field-piece.test.ts`, `test/worker/app/client-visits-me.test.ts`, `test/node/database/migration-0157.test.ts`.
