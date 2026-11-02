# 0238. Third design pass: one home, the chat's column, a record's facts beside its head, Inventory's one row of tabs

- Status: accepted
- Date: 2026-11-02
- Topic: The ops console
- Amends [0227](0227-today-by-home-and-tasks-as-one-table.md), [0231](0231-messages-redesigned.md), [0232](0232-technicians-stock-and-money-redesigned.md) and [0236](0236-second-design-pass.md)

## Context

The owner asked why the column beside a chat named the client and explained how the console works, and asked for the
built pages to be set against the design's files again, every difference left found and fixed. They also ruled that
Today needs no choice of home: everyone has one role.

## Decision

1. **Today opens one home** (`apps/ops/src/today/homes.ts`, `homeOf`): the City head's for a person whose every grant
   keeps to one city, Dispatch for operations, Care for Customer Care, Finance for finance, else Dispatch. There is no
   choice between homes, and Needs you lists the person's whole board. Inventory's home had no grant of its own to open
   it, so it is gone; Dispatch's Low stock tile and its Needs you carry stock's tasks.
2. **A chat is named one way** (`whoOf`): one of our technicians by their name, wherever their number is also a
   client's, in the list, the chat's head and beneath what they wrote; the client by theirs; a number we don't know by
   itself. What they wrote is signed with their first name, as the design signs it.
3. **The column beside a chat starts at the facts:** the chat's head names who it is with, so the column does not
   again, and says nothing of how the console works. A client's facts take the Care person among them; what Care do
   for them is one stack of buttons, the parts of their page, free service visits and a matter for their city, with one
   gap between. A technician's chat has their city and their page, and none of a client's actions.
4. **The chat as the design draws it:** who said it and when beneath the bubble; a note for the team ruled at its left
   across the chat, not a bubble; the reply one box, what is written over a foot of Reply or Note and Send; the chats'
   column on a quiet tint, the one open raised and edged in ink; on a phone, the list alone until a chat is chosen.
5. **A view of a few is the design's track** (`Segmented`, a new part of `packages/ui`, on a new `--ui-tint` role): Day
   or Week on the board, Reply or Note in a chat. Filters with counts stay chips.
6. **A page's title is the design's size** (title-1, a step smaller on a phone) **with its figures on a line beneath
   it,** as the design sets a page's lead; the head's actions keep the title's row.
7. **A record's facts stand beside its head** (`PageAside`): a client's At a glance, address and notes run down the
   right from the name, the task banner and the tabs at the left, as the design draws them; beneath the page short of a
   desk's width.
8. **Inventory has one row of tabs:** Stock's views (On hand, Expiring, Movements, Labels, Places) are tabs of
   Inventory's own beside Counts, Purchasing and the rest, each at its own path (`/stock`, `/stock/movements`, …).
   Expiring is always there, and says so when nothing expires.
9. **A technician's week is seven day cards** across the page, each visit in its day and opening it on the board, as
   the design draws it; a phone lists the days with visits.
10. **Smaller fits:** the board as tall as its rows, its hours on the heads' band, the stepper joined in one box; Mine
    the header fields' height; a row's second line a step below its name; a panel's count of nought not shown; an empty
    line with its action at its right; every value of a record changed the one way (`OpenRow` for where a technician's
    day starts); the address not named twice; a toolbar's search giving way before its lists leave its line.

## Where the build departs from the files, and why

- **Messages keeps five views as chips:** the design's track holds three; five do not fit the column, and chips wrap.
- **The chats' rows have no line for what a chat is about,** and the column no "What it's about": the API records it as
  a chat closes (ADR 0231).
- **The board's corner over the names stays blank:** the names' column needs no head to read as technicians.
- **At a glance keeps its words for a client with no hair system** in their cell, beside the figure: the owner asked
  for them in words.

## Consequences

- `packages/ui` gains `Segmented`, `OpenRow` and `EmptyState`'s panel look with an action; `PageHeader` sets its title
  as title-1 and its figures beneath it.
- Words added, in `design/ops-redesign/COPY-TODO.md`: Expiring's empty line. Words removed: the homes' names, the
  technician chat's line, Care's "Nobody has…" beside a chat, the client's page link.
