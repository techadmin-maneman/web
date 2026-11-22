# 0292. Booking moves a draft to make room

- Status: accepted
- Date: 2026-11-22
- Topic: Booking and visits
- Amends [0290](0290-allotted-the-evening-before.md)

## Context

A visit is booked with a draft technician until the evening's lock (ADR 0290), and the re-plan may move a draft to
anyone else who can take it at its promised time. Booking still offered only the starts some technician's day had
room for as it stood, so a start was refused even where one technician could take it the moment one of their drafts
went to another. The owner ruled on 22 November 2026 that booking makes that room with one move, tells nobody, and
leaves the rest to the evening's re-plan.

## Decision

1. **A start nobody can take is offered where one draft's move frees it** (`src/domain/booking/make-room.ts`, called by
   `src/domain/booking/start-offers.ts`). For each technician who may take the booking, each of their drafts on the
   day is set aside in turn; a start that then fits their day, and that nobody else could take, is offered with them,
   where another technician may take that draft at its promised time, as booking would offer it (in the city,
   trained, within their ring, allowed by the rotation), and their day fits it. Of those, the draft goes to whoever's
   home is known first, then whoever it costs least, as booking weighs a taker (ADR 0289). A technician is offered
   once at a start, with the move that adds them least driving. One draft moves, never a fixed visit; nothing is
   swapped.
2. **The hold writes the move with it** (`src/domain/booking/hold-slot.ts`). The draft's move is written as the
   re-plan writes one (`src/domain/booking/draft-moves.ts`): recorded by the allotment, only while the visit is still
   the draft as read. The lock it takes on the day the draft goes to is the hold's, kept until the hold is booked or
   let go, so a hold planned on that day before the move cannot land on the draft's time. A draft fixed, moved or
   proposed since, or a day changed since, fails the batch and nothing is written; the hold tries its next taker,
   those that move no draft first. Google's drives either side of the start are checked on the day without the draft.
3. **Not for a client's move, nor a draft the evening holds.** A client's move reads the days without the visit
   moving, so a draft could be placed where it still stands: no room is made for a move. Tomorrow's drafts are left
   to the evening's check once the half hour before the city's lock has begun (`src/domain/booking/allotment-lock.ts`),
   as the hourly re-plan leaves them.
4. **Nobody is told.** The moved visit stays a draft: its client learns the name in the evening's reminder, and no
   technician lists a draft. Ops see the move on the board's history.

## Consequences

- A hold left unpaid leaves the draft where the move put it; the evening's re-plan may move it again.
- A client can steer other clients' drafts among those allowed to take them by holding and letting holds go; the app
  keeps one hold a client, and the hourly re-plan moves drafts back to the plan that costs least.
- Offering the week's starts reads the city's drafts once more, and sets each aside only where the day has drafts.
