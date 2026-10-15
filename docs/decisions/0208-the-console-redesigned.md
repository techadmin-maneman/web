# 0208. The console redesigned: work first, Settings in one place, and two themes

- Status: accepted
- Date: 2026-10-15
- Topic: The ops console
- Amends [0109](0109-console-departments-and-access.md) on how the navigation is grouped; access is unchanged

## Context

The console grew a section at a time, each drawn its own way. Its navigation listed about thirty sections under five departments, mixing the day's queues with records, reports and setup. What it was set up with sat in a dozen places: the policies on one long page, prices and discount codes under Finance, cities, staff and targets under Admin, Care's team beside its inbox, the words under Growth. Its panels were boxes on the page's own paper, sized to the Ops Console board's 484 and 660 px; its boxes were a phone's height beside 34 px table rows; forms stood open under the lists they added to; a rule with several figures put its boxes side by side; and a person who could only look at a setting saw it in a disabled box. Every stylesheet drew in the palette's own colours, so no other theme was possible.

## Decision

- **The navigation holds the work, an entry a job:** Today, Tasks, Dispatch, Clients, Messages, Technicians, Inventory, Requests, Money, Growth and Reports (`apps/ops/src/route.ts`, `NAV`). An entry of several pages opens on the first the person may open and heads each with the others as tabs. Settings stands at its foot. It folds to its icons at a desk.
- **Settings is one place,** a page each under nine groups, with a menu of its own (`SETTINGS_PAGES`): everything the console is set up with, from cities and window times to prices, Care's team, the words, staff and the policies, which are split across the pages by subject. Every old address lands on its page's new one.
- **Access is unchanged.** Each page is shown to those whose call opening it goes ahead, as before. The menu lists only the pages a person may open, a group with none is left out, and Settings shows only if any page is open. A person who may only look sees each value as it reads, with no box, no change bar and no button, and a page of policies says View only beside its title.
- **Today opens the console:** the figures that matter now, each a tile that opens where it is acted on, and the tasks that need the person, from the calls the console already makes.
- **Every page has one shape,** from the shared parts (`packages/ui`): where it sits and a search across the top; its title, figures and actions; its tabs; the row that narrows a list; and its cards, raised off the page. A record's page is titled by its record. A panel titled as its page is keeps its heading for a screen reader alone.
- **One field to a line.** A form lays its fields one to a line, a rule of several figures a row each, and no box stands in a table: a row's change, and a list's way to add to it, open in a drawer beside the page. The row above a list, its search and its choices, is the one place boxes share a line.
- **Copy says the state and the action only** (`docs/patterns.md`): no line that explains how the console works.
- **A light and a dark theme.** The shared parts' paper looks draw in `--ui-*` roles (`packages/brand/tokens.css`), which hold the paper's colours everywhere and turn to the ink's in the console's dark theme (`apps/ops/src/styles/theme.css`). It follows the computer unless the person chooses in the account menu, kept in their browser. The other apps and the site look as they did. The status tones stay the brand's: brass to look at, rust to act on or for what went wrong, the text's own ink for what is done.
- **A desk's density:** boxes and buttons at 36 px, small buttons at 32, words at 14.
- **The board is no longer the console's reference.** Its fidelity pairs are retired; the kit is shot in both themes instead (`docs/fidelity-method.md`).

## Consequences

- `test/node/apps/ops/ops-theme-roles.test.ts` refuses a palette colour in the console's stylesheets, outside what is drawn on the ink on purpose and what only prints; `ops-theme-contrast.test.ts` holds every pair of words and ground to 4.5:1 in both themes.
- `e2e/ops/one-box-a-line.ts` fails a page or drawer where two boxes of one form share a line or a box stands in a table, outside the row that narrows a list.
- A new screen takes its frame, its parts and its forms' drawers from what is here, and needs little stylesheet of its own.
- Links and bookmarks to the old addresses keep working through `MOVED`; the browser tests name the new ones.
