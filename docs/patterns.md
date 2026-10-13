# Patterns

How a screen is put together from `packages/ui`, so a new one reads like the rest. Every part is in the kit: run a local console (`npm run dev:ops`, or the local build) and open `/_kit` to see each one in its states, on paper and on the ink. The nightly fidelity run shoots the kit to `docs/fidelity/ops/kit.png`.

## The parts

Take every control and every recurring piece from `packages/ui`; a screen's own stylesheet sets only where a part stands, never its colour or size (`test/node/architecture/shared-controls.test.ts`, `test/node/dom/ui-package.test.ts`).

- **Text** is a named style, `typeLook("title-3")`, never a size: display, title 1 to 3, body large, body, label, caption, figure (`packages/ui/type.ts`).
- **Colour** is a role where a part can stand on either ground: `--surface`, `--on-surface`, `--on-surface-muted`, `--border-subtle`, `--border-control`, `--status-*`. A screen on the ink says so with `data-ground="ink"` on its root, and every part beneath follows.
- **Sizes** come from the scale and the spaces in `packages/brand`; a size only one app draws is in that app's `src/styles/tokens.css`.

## Sending a change

There is one way, held by `test/node/apps/ops/ops-settings-writes.test.ts` (docs/decisions/0071):

- **A change made in boxes** is a `SettingForm`: its first button is Review; the check, titled "Review the change", sets each change beside what it was, as "Field: was → now", with no full stop; Confirm sends it and Edit goes back to the boxes. A form that stays open after it says so with `said` ("Saved.").
- **A one-press action** (pause, switch off, reopen, restore) is an `ActionCheck`: its button, then its question ("Reopen Fri 29 Oct?"), sent by Confirm; Cancel puts the button back. A row's own button opens it asking.
- **A removal for good** is a `DeleteAction`, which asks once and names what goes.
- **A refusal** shows beneath the form, in the form's own words for its code, with the check still open to send again or go back.

## Saying what happened

- **An error, a saved line or a note** is an `InlineMessage` (`tone` error, saved or note). An error is said at once (an alert), a saved line when the reader is next free (a status). A box's own error goes in its `Field`, which ties it to the box.
- **Nothing to show** is an `EmptyState`: on a page, a line in the serif and one beneath it; in a panel or table, one muted line. Say the state, never how the system works: "Nothing to count today", not "Tasks come round each morning".
- **Loading and a failed load** are `Loading` and `Failed` (`packages/ui/States.tsx`, through each app's `states/`), with the call's reference beneath a failure.
- **A state beside what it is about** ("Prepaid", "At visit") is a badge: `badgeLook("brass")` on paper, `badgeLook("muted")` on the ink.

## Console pages

- **A list page** is one `Panel` with its title and count, `TableTools` above a `Table` (search, filters, sorting by `SortButton`, Show more), and an `EmptyState` in the panel when nothing matches. Example: Referrals (`apps/ops/src/referrals/ReferralsScreen.tsx`).
- **A detail page** is a head naming the record, `Tabs` for its parts, and a `Panel` a part; an action that changes the record opens in a `Drawer` from the right. Example: a client's page (`apps/ops/src/clients/ClientScreen.tsx`).
- **A settings page** is a `Panel` per subject, each subject's rules in a `SettingForm` or a group of them under one Review. Example: Rules (`apps/ops/src/settings/Rules.tsx`).
- **Sections of one job** are a group (`SECTION_GROUPS`, `apps/ops/src/route.ts`): Inventory, Care and Data requests each have one entry in the navigation, and each of their pages is headed by the group's sections as tabs. A new section of such a job joins its group.
- **Ctrl K** (or ⌘K) opens Go to, from any page: the pages the person may open, by name, and clients by name or four digits of their number.
- **Words** are in `apps/<app>/src/content/`: staff copy says the state and the action only.
