# 0225. The console on a desk and a phone, to the November redesign

- Status: accepted
- Date: 2026-11-02
- Topic: The ops console
- Amends [0208](0208-the-console-redesigned.md) on the console's widths and its frame; access is unchanged

## Context

On 2 November 2026 the owner handed over a designed console: a desktop prototype at 1440 px and phone frames at 390 px (`design/ops-redesign/`), with a brief to rebuild the console's layout and interaction to them in eight steps, the shared library first. The console had been a desk tool, "never narrower than the navigation column and one panel" (`apps/ops/src/styles/global.css`); on a phone its tables fell into stacks of a column's name beside its value. The owner approved the plan for the eight steps on 2 November 2026.

## Decision

1. **The console is built for a desk and for a phone.** From 1024 px the navigation stands beside the page as drawn at 1440. Below 1280 the right-hand column of a page moves beneath its main column, and Settings' own menu runs across the top. From 1023 down the navigation is off the page; from 600 down the phone's layout takes over, with a tab bar on the ink at the window's foot. Between 601 and 1023 the desk's layout stands in one column. These are `MEDIA`'s widths (`@maneman/brand/breakpoints`), and no others.
2. **The design files give the layout, never the words.** Every string stays the console's own. A slot the new layout adds, with no string of the console's to fill it, gets a content key whose value is `TODO(copy)`, listed in `design/ops-redesign/COPY-TODO.md`, and draws nothing while it holds that value, so no placeholder reaches a weekly production release. Every figure and state comes from the API; one the API does not return is left out, not drawn from the mock.
3. **Everything is drawn in `packages/ui`.** The redesign's new looks are the library's: `TabBar` for the phone's navigation, `ListRow` for a list's row on a phone (two lines and one figure, never a table's cells stacked), `NavGroup` for the navigation's groups, `rowRule` for a table row's rule in the tone of how pressing it is, and a picker drawn on `Popover` (`look="field"`, `PopoverChoice`, `PopoverHeading`). A drawer holds its actions in a foot pinned at the window's foot, and on a phone fills the window. A part a single screen needs is added in that screen's step, in the library, before the screen uses it.
4. **The city chosen in the header is kept in the browser, under the signed-in person's email,** and applies to every screen. Keeping it on the server would need a table of its own; the owner may ask for that later.

## Where the build departs from the files, and why

- **A drawer on a phone is the console's `Drawer` filling the window, rising from its foot,** where the brief names a `Sheet`. `Sheet` is the client and technician apps' sheet, with their own frame and sizes; one drawer component, wide at a desk and whole on a phone, keeps every console drawer's head, cross, form and foot the same.
- **The tab bar's names and a list row's second line are at 13 px,** where the files draw 11 and 12. The brand's scale starts at 13 (ADR 0077).
- **A row under the pointer, and a picker's chosen line, take `--ui-ground`,** where the files write `#F4F1E9`. That is the paper's own value; `--ui-ground` is the role the dark theme turns to the ink's, as the table's rows already do.
- **The tab bar's counts follow the navigation's rule:** filled in the urgent look only where something is overdue, as `SideNav`'s are. The phone frames fill every count.

## Consequences

- `test/node/architecture/safe-area.test.ts` holds the tab bar and a drawer's foot clear of an iPhone's home indicator.
- The eight steps land one pull request at a time, each with every test green; the console runs between them with the old screens beside the new.
- A later step that departs from the files says so in a record of its own.
