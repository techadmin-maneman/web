# 0227. Today by home, and Tasks as one table

- Status: accepted
- Date: 2026-11-02
- Topic: The ops console
- Amends [0225](0225-the-console-on-a-desk-and-a-phone.md) with the redesign's third step, and on the words a slot it adds is given

## Context

The third of the redesign's eight steps (ADR 0225): Today and Tasks. The design draws Today as a home for each of five kinds of work, dispatch, care, a city head, finance and inventory: four figures, each a tile that opens where it is acted on, then what needs the person beside the home's own list. A person with more than one home switches between them. Tasks it draws as one table: what the task is, whom it is about, when it is due, whose it is and the step that settles it, narrowed to all, mine, nobody's or overdue, each counted, each row opening its drawer.

The staff list has no roles, only grants of a department at a level over a place (ADR 0109). The brief left the homes' mapping to the owner, who approved this one on 2 November 2026.

## Decision

1. **The homes by grants** (`apps/ops/src/today/homes.ts`): Operations gives Dispatch and Inventory; Customer Care gives Care; Finance gives Finance; a person whose every grant is in one city has the City head's home, first. A person with none of these, Growth or Admin alone, has Dispatch. While the Staff list is not enforced, every home is offered.
2. **Each home's figures** are read from calls the console already makes, in words it already has; a figure the API does not give is not drawn:
   - Dispatch: today's visits, the visits with no technician, those running late, the places low on stock. Beside it, today's visits still to come.
   - Care: the chats to answer, those overdue now, the median first reply over the last week, the remedies to approve. Beside it, the chats waiting on us.
   - City head: today's visits, those running late, the money collected today, the concerns open. Beside it, each technician's day and who is away.
   - Finance: the money collected today, UPI to record, charges to decide, payments owed. Beside it, today's payments.
   - Inventory: items below zero, items out, counts to do, recalls open. Beside it, the places that need attention.
3. **Needs you** lists the person's own tasks first, then the longest overdue, of the departments the home is for: operations' about stock on Inventory and its others on Dispatch, every task on the City head's. A kind of task none of the person's homes lists, as Growth's referrals, goes on their first.
4. **Tasks is one table**, the longest overdue first. Its views are All, Mine, Unassigned and Overdue, each with how many it holds over the kind and the client asked for. A row's name opens its drawer from anywhere on the row, and its last cell is its step: the way to where it is decided, the booking that does it, or else Take while nobody has it. Today's Needs you ends each row with the same step. The drawer holds the task's facts and what else is done on it, with Take, Assign and Close at its foot beside the step, filled. On a phone the rows are a list, the views a row of chips.
5. **Today's head** is the home's sentence on the day as its title, "2 visits need a technician.", the date and the header's city on a small line above it, "Monday 2 November · All cities", and the choice of home at its right; where the page sits, and the window's title, still say Today. Each tile carries a short line beneath its figure where there is one to give: "6 done · 1 under way", "Ravi Kumar, 25 min", "Oldest 38 min". Each side list links to its page from its head, by the page's name. On a phone Today is the figures, two to a row, then Needs you under its name in small capitals, as the phone frame draws it.
6. **The header names the page** where nothing stands above it, "Today" or "Tasks", as the design's header does on every page.
7. **A slot the redesign adds is worded,** under the console's copy rules: tight, only what the person needs, no word on how the system works. The owner ruled so on 2 November 2026, in place of ADR 0225's `TODO(copy)`, which is gone. Every such word is listed in `design/ops-redesign/COPY-TODO.md` for review.
8. **The shared parts** gain what these need: a line above a page's title (`PageHeader`, `over`) and beneath a tile's figure (`StatTile`, `note`); a list row's time column and a desk's action beside it, and a list inside a panel (`ListRow`); a row whose name opens a drawer (`RowOpener`); a filter's count, and a chosen chip filled in ink rather than edged (`ToggleButton`, `filled`), which the console's city chips, Tasks' views and Today's homes take; and a toolbar whose end takes a line of its own on a phone.

## Where the build departs from the files, and why

Every screen was set beside the design's files, at 1440 and at 390, and each difference left has its reason here.

- **A tile has a line beneath its figure only where the API gives what it says.** Unassigned, Low stock, Overdue now, Remedies to approve, Concerns, UPI to record, Charges to decide, Payments owed, To count and Recalls have none: the design's lines there, as "Check before 5 pm", rest on figures no call gives.
- **The words are the console's own.** A tile reads "Unassigned" where the design reads "No technician yet"; a row is titled by the kind of task, as Tasks names it, and its step is the console's "Close in Dispatch" or "Book a visit", not the design's sentences and verbs; a side list links to "Dispatch" or "Stock", not "Open the board"; a due day reads "2 days left", not "In 3 h". No word is taken from the design's files (ADR 0225).
- **The homes' choice is the console's chips,** the chosen one filled in ink, not the design's grey segmented track on Today: the brief names a ToggleButton group, and the design fills its chosen filters and cities in ink, which one look for every chip keeps.
- **Each side list's state is a Badge,** tinted as the console's badges are, as the brief asks, where the design writes it in coloured words alone.
- **Some of the design's figures are others.** No call says which kits are short for tomorrow, so Dispatch counts the places low on stock; Care's "past reply time" is Care numbers' overdue now; the City head's booked time has no words of its own, so the home counts the visits running late; Finance's month of technician pay has no state to show, so it counts payments owed.
- **Today follows the header's city where the answer says the city:** the dispatch board and stock. Tasks and payments are kept by the API to the cities the person's grants reach, and chats and Care numbers to those whose Customer Care grant is national; none is yet narrowed to the one city chosen in the header.
- **Tasks keeps its choice of kind,** which the design does not draw: with more than twenty kinds, it is how a person finds one. The departments' sections, each group's five longest waits and the head's overdue count are gone: the Overdue view does the last.
- **Tasks lists the first fifty rows,** then the rest on asking. The client column names the client alone: the board sends no city for a task.
- **A task nobody owns writes its owner as the console writes any gap,** a muted dash read as "None", not "No one" (`NoValue`). The table's head is the shared table's, its names small and muted over a rule, not on a shaded band.
- **On a phone, Tasks keeps its kind and its search** above the list, which the phone frame leaves out: with hundreds of tasks they are how one is found, and the header's search finds clients, not their tasks. A phone's chips are a finger's height, 44 px, where the frame draws them at 28 (WCAG 2.5.8, the brief's targets).
- **On a phone, the choice of home stands with the title,** above the city's chips, for a person with more than one; the phone frame draws one home and no choice.
- **Growth's funnel and Care's share answered on time are no longer on Today.** They stand on Funnel and Care numbers.

## Consequences

- A home reads only what it shows, and only the calls the person may make; the others are not asked until it is the home shown.
- A spec that found a task by its group's heading, or its card's Details, finds it by its row and the row's name.
