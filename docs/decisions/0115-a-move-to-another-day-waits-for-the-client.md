# 0115. A move to another day waits for the client

- Status: accepted
- Date: 2026-10-11
- Topic: Booking and visits
- Amends [0047](0047-visit-messages.md): a move ops make to another day is asked of the client, not told

## Context

The dispatch board moves a visit at once and tells the client the new window on WhatsApp (ADR 0047). Within the visit's own day that is the right weight: a technician swapped, or a later window the same day. A move to another day changes the client's plans, and nobody asked them.

## Decision

1. **A move ops make to another day is a proposal.** The visit stays where it is. The client is messaged the day and window proposed, and opens the app to accept it or to pick another time themselves.
2. **Accepting it moves the visit as the board would,** its checks run again: a window taken since answers that it has gone, and the client picks again.
3. **Within the visit's own day, and any move the client asked for, the board still moves at once,** as before; a swap of technician alone still tells the client nothing.
4. **A proposal lasts two days, or until the visit's own start if that is sooner.** One left unanswered a day becomes a task, and ops call the client. Ops may withdraw one, and a move of the visit since, theirs or the client's, makes it moot.
5. **A client who has not agreed to WhatsApp about visits is not messaged;** ops call them, as they do of a move they made.

## Consequences

- A visit with an open proposal is shown with it on the board and in the client's app, and the proposal holds no slot: the window may be taken before the client accepts.
- The proposal's message is a new template (`move_proposed_v1`), which MSG91 needs approved before it can send it (ADR 0114).
