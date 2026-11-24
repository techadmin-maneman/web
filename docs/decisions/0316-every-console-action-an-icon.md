# 0316. Every console action an icon

- Status: accepted, on the owner's ruling of 24 November 2026
- Date: 2026-11-25
- Topic: The ops console
- Amends [0314](0314-change-everywhere-and-forms-in-a-grid.md): Change is drawn as its pencil

## Context

The console's actions were words: Change, Add, Save, Approve, Book a visit, and longer ones such as "Send the patch
back". A row of them took more room than the values they act on, and the same action read differently from screen to
screen. The owner ruled, on 24 November 2026, that every button in the ops console is its icon alone, Save, Approve
and Book a visit among them, with icons of the first rank, the long actions covered as well as the short.

## Decision

1. **Every action in the ops console is drawn as its icon.** `Button`, `TextButton`, `RowButton`, `DrawerButton`,
   `ButtonLink` and an in-app `Link` drawn as a button take an `icon` from `@maneman/brand/action-icons`; under
   `IconActions` (`@maneman/ui/icon-actions`), which the console's root turns on, a button that names one draws it
   alone, a square of its size's height. The other apps and the site keep their words: the context is off there.
2. **The icons are Lucide's** (1.70.0, ISC), each turned into one path, drawn at the house's stroke. One icon stands for
   one kind of action everywhere: a pencil for Change, a plus for Add, a check for Save or Confirm, a ringed check for
   Approve, Mark done or Close, a ringed cross for Decline, a calendar with a plus for Book, a calendar's two arrows
   for Move, a bin for Delete or Remove. Dismissing a form is a cross; cancelling a record is that record's own
   cross (a visit's calendar, an order's file), so Cancel the order never stands beside a Keep it of the same shape.
   An action that sends nothing never borrows Send's plane: Told by phone is a phone calling out, Draft order a file
   with a plus. `packages/brand/action-icons.ts` holds the set.
3. **Its words stay its name.** They are read out to a screen reader, and shown in a small label above the button when
   the pointer rests on it, the keyboard comes to it, or a finger presses and holds it, when the press does not act
   (`@maneman/ui/ActionTips`); gone on Escape, a scroll or the next touch. A button's own `aria-label`, where it names
   the record it acts on, is that label.
4. **One that cannot act yet still says what it is, and what it waits for.** Drawn as its icon it is marked
   `aria-disabled` rather than `disabled`, so the pointer and the keyboard still reach it, and a tap does nothing. Its
   label carries a second line, the `Missing` line beneath the form that its `aria-describedby` names ("Write a
   reason.").
5. **Every icon is a finger's square** on a phone or under a coarse pointer (`--tap`), however compact its row.
6. **A record's name, or a piece of content, keeps its words.** A client's name or a purchase order's number that opens
   it, a visit's time on the board, a quick reply's title: these are what the console shows, not what it does.
   `test/node/architecture/console-action-icons.test.ts` counts them, file by file, so a new action without an icon
   fails, a link drawn as a button among them.
7. **The shared parts carry their icon.** Cancel is a cross, and Keep it (Cancel's `keep`) and Back an arrow that turns
   back. `AddForm`'s Add is a plus. `DeleteAction` is a bin, unless what goes is not deleted: a retirement's archive, a
   pause, a switch's power, a person taken off. A form's `SubmitButton` is a check unless it names another. A row's
   Change is its pencil, and its Save and Cancel a check and a cross. A part the other apps
   share, as Try again, takes its icon in the console alone (`useActionIcon`).
8. **A way to another page drawn as a button is an arrow out of the corner**, as Open in Dispatch; a client's four
   parts beside a chat are each their own (visits a calendar, payments a receipt, pieces a box, consents a signed page).

## Consequences

- A button busy sending is dimmed, as every busy button is; its words, "Saving…" where it says so, stay its name and
  its label.
- An end-to-end test still finds a button by its name: the words are still there.
- Tests: `test/dom/ui-button.test.ts`, `e2e/ops/action-tips.e2e.ts`, `e2e/ops/deletions.e2e.ts` (a waiting action's
  label), `test/node/architecture/console-action-icons.test.ts`.
