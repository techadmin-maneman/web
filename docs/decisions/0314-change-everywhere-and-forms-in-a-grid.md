# 0314. Change everywhere, and forms in a grid

- Status: accepted
- Date: 2026-11-24
- Topic: The ops console
- Supersedes [0212](0212-editing-in-place.md) on how a value reads and opens, and on a hair profile corrected whole;
  extends [0313](0313-the-settings-screens-to-the-22-november-redesign.md)'s Change from Settings to every page;
  amends [0106](0106-a-clients-hair-profile.md) on how a profile is corrected

## Context

ADR 0313 gave each setting a Change button that opens a small dialog, as the 22 November redesign draws Settings.
Every other value in the console still read as its own button, opening in place, so a record's page and a setting's
page changed a value two ways. A client's hair profile was corrected through a form that opened a second copy of the
whole profile under the first. Most forms stood one box to a line however wide their panel, so a short form ran down
one narrow column. The owner ruled on 24 November 2026 (all the recommended options):

- every editable value reads its name, its value and Change: on a page Change opens the small dialog, inside a drawer
  it opens in place, since no dialog opens over a drawer;
- a form's short fields stand two or three to a row on a desk and one to a line on a phone, as the design's forms do;
  this replaces the 15 October rule of one input to a row;
- a hair profile is corrected from each figure's own row, each save a new version, with no second copy below.

## Decision

1. **A value reads as words beside its Change** (`packages/ui/EditableRow.tsx`, and `OpenRow` for a value changed in
   a drawer of its own). The value is no longer a button. Change is read with the value's name and described by the
   value, so a screen reader hears both.
2. **Where Change opens is set by where the row stands** (`packages/ui/change-in-dialog.ts`). It is a dialog on any
   page, as ADR 0313 drew it for Settings. It is in place inside a drawer: `packages/ui/Drawer.tsx` says so for
   everything in it. On a page the row is drawn as the redesign draws a setting, the value and Change at its end. In a
   drawer the name stands quiet in its column, the value beside it and Change at the row's end. A row a person may
   only look at reads the same, without Change.
3. **A form's fields stand on a grid** (`packages/ui/forms.module.css`, `.fields`). A short field takes a cell at least
   `--field-cell` wide: a line of words, a figure, a date or a choice. The console sets 200 px, which is two to a
   drawer's row and three to a panel's. Anything else takes the whole row: a note, a file to choose, ticks or
   choices, a group, the form's actions and what it says. A box the form knows is long, as a note on one line, says
   so with `wide`. The forms that stacked their own fields now use the grid: a new task, a technician's details and
   leave, receiving an order, raising a custom order, a claim's credit, and a pincode added.
4. **A hair profile is corrected a row at a time** (`apps/ops/src/clients/HairProfile.tsx`). Its rows stand under the
   design's headings, Head, Base, Hair, Product and Health history, two columns where there is room and one on a
   phone. Each figure, choice and part of the history has its own Change, its box in `ProfileBoxes.tsx`. Its save
   sends the whole profile again, that row changed, as a new version from the version it was read from, and says
   Save new version; its dialog's Now is the value alone, without what it was. A profile changed meanwhile is read
   again, as before. A client with no profile yet has the same rows, each reading Not known.

## Consequences

- Tests read a value beside its Change, not inside it (the button's parent, or its accessible description).
- `SettingPairs` stands its rows one to a line on any page and two to a row only inside a drawer.
- Read-only rows on a package's record (`ReadRow`) replace `SettingValue` there, so its rows read as one.
- Tests: `test/dom/ui-editable-row.test.ts`, `test/dom/ui-console-frame.test.ts`, `e2e/ops/clients-visits.e2e.ts`.
