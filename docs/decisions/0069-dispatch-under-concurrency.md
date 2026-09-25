# 0069. Dispatch under concurrency

- Status: accepted
- Date: 2026-09-25
- Amends [0034](0034-clash-check.md); follows [0062](0062-leave-on-the-dispatch-board.md) and [0068](0068-a-paid-hold-is-kept.md)

## Context

The audit of 24 September 2026 moved jobs on the board the way two ops users on a busy day would, and found the board's writes safe only one at a time:

| Finding | What happened                                                                                                                                                                                                                                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BIZ-18  | A first fit at 12:00 given to a technician whose replacement ran from 10:30 to 12:45 was accepted: a change of technician alone checked the window, not the half-slots. The client was messaged that his visit had moved.                                                                                           |
| OPS-06  | A first fit dropped on an empty evening was refused as "already holds a job"; the real reason is that a first fit cannot start in the evening (ADR 0035).                                                                                                                                                           |
| BIZ-19  | The check, the FSM write and the mirror were three steps with nothing holding the time between them: a client's hold or a second move could take it while FSM was being written.                                                                                                                                    |
| BIZ-20  | The utilisation at each column's head, which is also written to `events` daily as the owner's weekend-share figure, was near 0% for a day already worked: a finished job fell out of it, a technician on leave still counted as capacity, and the city asked for was ignored. A probe read 38% where 75% was right. |
| FEO-05  | Two ops users overwrote each other: the move carried no idea of what the board had shown, an assign was a move by another name, and the board never refreshed.                                                                                                                                                      |

## Decision

**A change of technician alone keeps the visit's time.** A move whose day and window are the job's own, sent or left out, is a change of technician: the visit keeps its start, its half-slots are checked there on the new technician's day, FSM is asked to reassign it and not to reschedule it, and the client, whose window is as it was, is sent nothing. A move naming the technician, day and window the job already has is `400 invalid_request`.

**A window with no room is named as such.** A move is refused, in this order, as `on_leave` (ADR 0062), as `clash` where another job starts in the window, and as `does_not_fit` where the window is free but the visit's block is not: a half-slot it needs is taken, or it would run past the day's last one. `src/policy/dispatch.ts` gives the order; `src/domain/scheduling.ts` answers whether the block fits.

**A move claims its new time before FSM is written.** In one batch, before any call to FSM, the move is opened in `dispatch_moves` and its new time claimed in `slot_claims`, the table whose key already stops two holds taking one technician's time (ADR 0034): a row per half-slot and one for the window. A claim now belongs to a hold or to a move (migration 0040). Then:

- a client's hold, or another move, that reaches for that time while FSM is written fails on the key, and the booking's availability counts the claim as taken;
- once FSM answers, the claim goes in the same batch that writes the mirror, which then holds the time; if FSM refuses, it goes with the refusal;
- the batch that opens the move lets go of holds nobody is paying for, as a new hold does, so a hold that lapsed does not stand in the way. **A paid hold's claims are never let go or written over** (ADR 0068): the check refuses the time first, and the key refuses it again if the hold arrived since.

A move still open five minutes on (`MOVE_CLAIM_SECONDS`) never finished; the Worker that made it has gone. The next move and the five-minute sweeper close it as `rejected`, "never finished", and let its time go. Whether FSM took it is FSM's to say, and the mirror follows FSM's record as it does every change FSM makes.

**One move of a job at a time.** `dispatch_moves` holds at most one open move per job (a partial unique index). A second move of the same job, sent while the first is still with FSM, is answered `409 superseded` with `fields: ["moving"]`, and nothing is written.

**A move says what the board showed.** Assign and move carry `expected_technician_id` (null for a job in the tray) and `expected_starts_at`: the job as the board it was made from showed it. If either differs from the job now, another ops user moved it since, and the answer is `409 superseded` with `fields` naming what changed, `technician` and `time`, before anything is written. The board then shows the job where it is now.

**Utilisation is the day as it is worked.** A column's figure is the slots its jobs take, finished and in progress as well as still to come, out of the slots of the technicians working that day: one on leave has none, and a job still on him counts for nothing until it is moved. The board draws a finished job where it was worked, and it cannot be moved. With a city chosen, only that city's jobs are counted and drawn. The technicians are not narrowed: none carries a city (FSM gives a territory, which the board shows as the zone), and booking sends any active technician anywhere. So a city's figure is the share of the team's day its jobs take, and the daily event, written for every city together, is the team's whole day.

**The answer says what the client was told.** `client_notice` is `messaged` when the new window was queued to go on WhatsApp, `unchanged` when only the technician changed, and `no_client` when the visit has no client on our records.

## Consequences

- `slot_claims` was rebuilt: `hold_id` became optional and `move_id` was added, with exactly one of the two set. Nothing points at the table, so dropping it disturbs no reference (`docs/migrations.md`); the Worker already deployed reads and writes the four columns it did, and never sees a move's claim.
- A move that dies mid-way holds its time for at most five minutes, then the sweeper frees it.
- Every move needs the two `expected_` fields. An ops tab loaded before this deploy is refused `invalid_request` until it is reloaded.
