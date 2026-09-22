# 0034. The clash check

- Status: accepted
- Date: 2026-09-22

## Context

The backend prompt's rule: "A technician cannot hold two live jobs in one window on one date. This check runs on the server before any write to FSM." Self-serve booking (P2-M5) needs it first: two clients must not be sold the same technician's time. Dispatch (P2-M4) will use the same rule when ops move a job. There are no Durable Objects on the free plan (ADR 0009), so the check cannot sit in one place in memory.

## Decision

**A technician's day is eight half-slots** (ADR 0035), and a visit takes as many as its block: consultation and service two, a replacement three, a first fit four.

**What takes them** (`src/domain/scheduling.ts`, `occupancy`):

- **Live visits in the mirror:** scheduled, dispatched or in progress, whether ops booked them in FSM or a hold became one. A visit starting between two half-slots takes the earlier.
- **Holds not yet expired**, through their claims in `slot_claims` (migration 0016).

**The rule, as `placement`:** a visit fits where every half-slot of its block is free and no other job starts in its window.

**A hold writes its claims in one D1 batch** with the hold itself: one row per half-slot (`unit:3`) and one for its window (`window:afternoon`). The claims' key is (technician, date, claim), so a second hold on the same time fails as a whole, and the next free technician is tried. The same batch lets go of claims whose holds have expired, and of the client's own earlier hold. Once a hold is booked, its claims go and the mirror's visit takes the time.

## Consequences

- Two clients cannot hold the same time, even at the same moment, without a lock.
- A visit ops book in FSM between a client's look and their hold is caught only when the mirror has it. The window is seconds, and FSM, not us, is where ops book.
- Leave and working hours from FSM's availability arrive with dispatch (P2-M4). Until then every active technician counts as free every day.
