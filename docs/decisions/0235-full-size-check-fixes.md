# 0235. The redesign checked at full size, and what it changed

- Status: accepted
- Date: 2026-11-02
- Topic: The ops console
- Amends [0225](0225-the-console-on-a-desk-and-a-phone.md): the tabs run on to a second line on a phone, not off its edge

## Context

With the eight steps and Settings landed, every console screen was looked at full size at 1440 and 390 on 2 November 2026. Most faults were one standard applied unevenly: a panel's picker in its body on one page and in its head on the next; a none said as a bare note on the ground in some panels and as the empty line in others; counts without the thousands grouped. On a phone, choices hid past the screen's edge: section tabs and chip rows scrolled sideways with no bar. Some were plain faults: Technician pay on a phone named each value and showed none, as its table kept a desk's least width; the head kept room for the search and the person down its whole height, squeezing the tabs beneath the title.

## Decision

1. **Every choice in sight on a phone.** Tabs and chip rows run on to a second line; nothing scrolls sideways. The design draws the tabs as one scrolling row; the owner's rule (2 November) that no choice hides past an edge wins.
2. **A panel's picker is in its head:** Technician pay's month, Partner commission's month, Failure rates' grouping, Expected use's service. Payments' days join its search and states in one row inside the panel. A page's own action is in the page's head: Supply plan's Draft again.
3. **None is said one way,** `EmptyState`'s line, across the console's panels; Care numbers says "No chats in these days." where it drew a dash, and a client's History "Nothing done on this record yet.", not the Activity page's filter words.
4. **Counts group their thousands** (`quantity`): Tasks' head, the tab bar, Technicians' jobs, Funnel.
5. **A table on a phone is cards the screen's width.** A table's least width gives way; a value too long for its line runs on to the next whole; button words never break; an empty cell is left out; a row's own buttons (`ACTIONS`) stand at the edge unnamed; a total sits as a line of its own.
6. **A record's actions open in drawers:** a payment's refund, a client's invite, where a technician's day starts. A row's action stands beneath it on a phone (`ListRow` `action`).
7. **Tiles keep figures whole:** a tile's value never breaks, smaller on a phone; the kit tile is "Kit below zero" with a figure, where the design writes "Kit, 4 below zero". Words in the client's at-a-glance figures are set at the text's size (`FigureGrid` `words`).

## Consequences

- Left for the owner: tables still read as cards on a phone (ADR 0225 asks for list rows), and a sortable table's heads stand as a line above them.
- Words added, in `design/ops-redesign/COPY-TODO.md`: "Kit below zero", "Commission for the month", "To approve", "Attach an invite", "No chats in these days.", "No remedies given in these days.", "Nothing done on this record yet.", the Refund column's spoken name.
