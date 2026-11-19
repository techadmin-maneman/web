# 0282. Tasks chosen together, and the keys a desk moves by

- Status: accepted
- Date: 2026-11-19
- Topic: The ops console
- Amends [0092](0092-task-owners.md) and [0227](0227-today-by-home-and-tasks-as-one-table.md): how a task is taken,
  assigned or closed, and the Tasks table's columns and keys

## Context

The Tasks board was triaged one row at a time: a task taken, assigned or closed from its own row or drawer, with no
way to choose several, and no keys to move along the rows but the browser's own tabbing. With fifty or more rows a
morning, ops took each in turn.

## Decision

1. **One way to choose rows, for every list** (`packages/ui/useRowSelection.ts`, `SelectionBar`): a box a row, a run
   with Shift held, and the head's box for every row shown. A row closed or narrowed away is let go.
2. **Tasks chosen are taken, assigned to someone, or closed together**, at a desk, where the person may change whose
   any is or close it (`apps/ops/src/tasks/BulkActions.tsx`). Take and Assign reach only those the person may own.
   Close is offered only where every task chosen is of one group that closes with a reason alone, with that group's
   own words and one reason for all: never a guarantee claim, which asks whether the hair system was at fault
   (ADR 0273), nor an erasure finished in the CRM, which closes with no words.
3. **Each change is the API's own, task by task**, as one row's is: `PUT /api/tasks/{group}/{id}/owner` and
   `POST /api/tasks/{group}/{id}/close`, so each keeps its own audit entry and its own refusal. No route takes many
   at once. The bar then says how many were changed; where some were not, how many, and why in the words the first
   refused row's own refusal uses, and only those refused stay chosen, to try again. Where a task had changed
   meanwhile, the page is read again instead, as a row's own refusal reads it: the frame says the run's words, counts
   and all, above the fresh board, and the choice and the view are let go.
4. **The keys**: j or ↓ to the next row's name, k or ↑ to the one before, x to choose the row (with Shift, the run),
   and Enter on a row's name to open its drawer. A box being typed in or a list being chosen from keeps its keys.
5. **How overdue a row is** shows in its order, the longest overdue first, as before. Graded weights by age, which
   the finding also asked for, are not drawn: the owner kept one red, oldest first (19 November 2026).

## Consequences

- Twenty tasks taken at once are twenty calls, made one after another; the bar is busy until the last answers.
- A phone draws no boxes: its rows open their tasks, as before.
