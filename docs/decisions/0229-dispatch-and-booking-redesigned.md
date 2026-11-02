# 0229. Dispatch and booking, to the November redesign

- Status: accepted
- Date: 2026-11-02
- Topic: The ops console
- Amends [0225](0225-the-console-on-a-desk-and-a-phone.md) with the redesign's fourth step

## Context

The fourth of the redesign's eight steps (ADR 0225): Dispatch, its visit drawer, and Book a visit. The design draws the board's day as a timeline: a row a technician, their visits and hours booked beneath their name over a bar of how full the day is; the visits nobody is on pinned at the top in the warning's tone; leave as a hatched band; the time it is now ruled down the day; each kind of visit in its own look. Its head steps a day back and on, with Day or Week beside. A visit's drawer has its facts, who is free to take one nobody is on, what happened, and Call, Message, Move and Cancel at its foot. On a phone it is one technician at a time. Book a visit is three numbered steps, the visit, the day and the time, with its price and Book pinned at the foot.

## Decision

1. **The day board** (`apps/ops/src/dispatch/DayBoard.tsx`) draws each technician with their zone, visits and hours booked, and a bar of how much of the hours shown is booked; a row of the visits nobody is on, pinned at the top; whole-day leave as a band; the half-hour it is now marked down the day; each visit in its kind's look, the week grid's own. The shared timeline (`DayTimeline`) gains these, and its key (`TimelineLegend`).
2. **The head** holds a step back and on, by the day in the Day view and the week in the Week view, the day or week between, which brings today back; and Day or Week. The line beside the title says the day's visits, the technicians working and the visits nobody is on.
3. **A visit nobody is on** offers who is free to take it (`apps/ops/src/dispatch/Suggestions.tsx`): the technicians free at the time asked first, then the start closest to it, then the nearest, three at most. Assign takes it to the move's own sheet, at that technician and start.
4. **A visit's drawer** keeps its facts as a list, what happened, and at its foot Call, WhatsApp, the client's page, Move, closing by hand and letting in, with Cancel the last word, in the destructive tone.
5. **On a phone** the board is one technician's visits at a time, chips to change technician, the visits nobody is on pinned above.
6. **Book a visit** is three numbered steps: the visit, a card each kind; the day, a strip of the fortnight offered with how many starts are free beneath each day; the time, under its part of the day, then the technician, whoever is free unless ops choose; a discount code a word away. Book waits for a time, and names the day and the time.

## Where the build departs from the files, and why

Every screen was set beside the design's files, at 1440 and at 390, and each difference left has its reason here.

- **No Book a visit in the header.** A visit is always a client's; ops book one from where a client is in view: their page, a task, and the client panel beside a chat. A button with no client in view would first have to ask who. The owner asked whose visit it would book, and was given this answer.
- **The board keeps its search,** at the end of the key's row, which the design does not draw: with a city's technicians and their visits, it is how one is found. A phone has neither the key nor the search.
- **How full a day is** is the share of the hours shown that is booked: the board gives no technician's own working hours.
- **The suggestions say how far, not how long:** the room check gives kilometres from home, not minutes on the road ("free at 2 pm · 3 km away").
- **A visit's state stays in its facts,** with its payment badge beside the title as before, where the design puts the state there.
- **The kinds' cards name the kind alone,** with no length or price: the API prices one kind at a time, as it is chosen; the foot says what the one chosen costs.
- **A taken time is not drawn struck through:** the API lists the starts free, not those taken.
- **No toast with an undo after booking.** A booking can send a payment link or a message at once; undoing it is not safe. The panel says what was booked, and the link where one went.
- **The free starts drawn along the hours, a technician a row, are gone** from Book a visit: the design draws the times under their parts of the day, and the technician is chosen beneath them.
- **The day strip's squares carry the day's number alone,** as a fortnight seven to a row does not fit "3 Nov" on a phone; each day's whole date is read out.

## Consequences

- A move from the drawer's Assign goes through the same sheet and reason as one placed on the board, so nothing is written without them.
- The sheet now follows the start placed once the starts free have come, where it used to take the first it had.
