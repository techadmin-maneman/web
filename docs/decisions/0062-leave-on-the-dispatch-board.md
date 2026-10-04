# 0062. Leave on the dispatch board

- Status: accepted. Amended by ADR 0074: leave recorded over jobs already booked names them in its answer, marks their day on the board "Away · 1 job to move" in oxblood, and puts each on the Tasks board until it is moved or the leave is taken back.
- Date: 2026-09-24

## Context

The dispatch board is seven days wide and drew no leave at all, so ops could
assign work to a technician who was away. The recorded reason was that FSM's
availability answers at most 48 hours ahead (`docs/archive/fsm-trial.md`,
question 6), which no seven-day board can use.

**That reason is wrong, and it was checked against the org on 24 September 2026**
before anything was built. Read-only, on the credentials the Worker itself uses,
with the access token cached for the hour it lasts:

| Asked                                                    | FSM answered                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `Available_TimeSlots`, tomorrow                          | 200, eleven hour-long slots from 09:00                                                |
| `Available_TimeSlots`, **six days out**                  | 200, and the morning missing — the 09:30 appointment already on that day was left out |
| `Available_TimeSlots`, **twenty days out**               | 200, the full day                                                                     |
| `getAvailableServiceResources`, one, six and twenty days | 200 each, the technician with `is_available: true`                                    |

So FSM answers availability for any date asked, not 48 hours. The trial note was
written from the documentation's wording and never tried past a day.

**What FSM will not answer is leave.** Those calls answer _free time_, never the
reason time is not free: a technician away for a week reads exactly like one with
an empty diary. The one place FSM keeps leave is its **`Time_Off`** module, and
that module cannot be written by API in this org today:

- `GET /fsm/v1/Time_Off` answers **204** — the module exists and is empty, where
  a module that does not exist answers `400 INVALID_MODULE` (`Shifts`, `Leaves`,
  `Holidays`, `Working_Hours` and `Service_Resource_Availability` all did).
- Every create is refused with `Time_Off_Type is missing`, then, once a type is
  named, `Invalid value provided for Time_Off_Type`. It is a lookup, not a word.
- The list of types cannot be read: `Time_Off_Types` and every spelling of it is
  `400 INVALID_MODULE`, and `GET /fsm/v1/settings/fields?module=Time_Off` is
  `401 OAUTH_SCOPE_MISMATCH` on this refresh token.

Time-off types are built in FSM's Setup screens, which the API does not reach —
the same wall as the workflow rules (ADR 0032) and the job-sheet template (open
point 13). Nothing about a Setup screen is ours to fill.

Two further things ruled FSM out even if the owner did configure a type. The
board must **refuse** a job on a day off before anything is written, and so must
self-serve booking; asking FSM on every board render is seven days by however
many technicians, per refresh, against an org quota of 5,000 calls a day and a
token budget that has already refunded paid bookings (open point 32). And ops
have a Technicians screen in our own console, while the owner is FSM's only user.

## Decision

**Leave is recorded on our side, and read by the clash check that already
reserves a technician's time.**

- One table, `technician_leave` (migration 0034): the technician, a first and a
  last day of India's calendar, both inclusive, an optional note in ops' words,
  the Access identity that recorded it, and the identity that took it back.
- `occupancy` (`src/domain/scheduling.ts`) reads it beside `slot_claims` and sets
  `Day.onLeave`. It is a flag on the day, not eight filled half-slots: ops are
  told the technician is away, not that every window happens to be busy.
- `placement` answers null for a day on leave, so **self-serve booking never
  offers it** and the next free technician is taken instead.
- `moveRefusal` answers `on_leave` **before** it answers `clash`, so the dispatch
  board's refusal names the day off. The route answers `409 on_leave`, and the
  board writes "Sandeep Yadav is away on Sat 20 Sep. Nothing was moved."
- The board's `leave` is filled from the same rows, clipped to its own week. A
  cell on leave is shaded and marked **Away**, and offers no window to drop on.
  It still draws whatever is already on it: leave recorded after a job was
  assigned must not hide that job.
- Ops record and take back leave on the Technicians screen, over
  `POST /api/technicians/{id}/leave` and `.../leave/{leave}/cancel`, both audited
  (ADR 0031).

`slot_claims` itself is not reused row for row. Its key is (technician, date,
claim) with a hold behind every row, and leave would mean eleven rows per
technician per day and a nullable foreign key on a table whose whole purpose is
that two holds cannot take one slot. What is worth reusing is the answer to
"what does this technician's day hold", and that is exactly where leave is read,
so there is one answer and no second rule to remember.

## Consequences

- A technician on leave cannot be given work by ops or by a client, and neither
  path had to learn a new check.
- FSM does not know about the leave. FSM's own screens will still offer the day,
  and the owner booking there by hand is not stopped by us — the same shape as
  the overlapping appointments FSM allows and our clash check refuses (ADR 0034).
- The prompt's rule "Leave periods come from FSM technician availability" is not
  kept, and `src/policy/dispatch.ts` says so where it quotes it.
- If the owner configures a Time Off Type in FSM's Setup, leave could be mirrored
  from FSM instead. The board and the refusal would not change: only where
  `occupancy` reads the days from. That is the owner's to want, not ours.
