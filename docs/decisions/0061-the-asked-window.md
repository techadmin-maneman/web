# 0061. The asked window and the offered one

- Status: accepted
- Date: 2026-09-24

## Context

The dispatch board's unassigned tray shows a client's asked window beside the
window being offered. It showed the same value twice, because the tray read one
time off the appointment and wrote it into both lines. Two identical values tell
ops nothing, and the tray exists so they can see where they are about to
disappoint someone.

**The preference can be read back.** `GET /fsm/v1/Requests/8229000000304279` —
REQ4, the Request our booking wrote on 23 September — answered on 24 September
with the subform untouched:

```
Preference: { Preferred_Date_1: "2026-09-25", Preferred_Date_2: null,
              Preference_Note: "Morning, 9 am to 12 pm", Preferred_Time: null }
```

So `createRequest`'s `Preference` is real, durable and readable. The question was
how a board row reaches it.

**Not through the appointment.** A service appointment carries the same
`Preference` subform and it is **read-only** there. On our own test appointment,
created and then deleted:

| Tried                                              | FSM answered                           | Read back     |
| -------------------------------------------------- | -------------------------------------- | ------------- |
| `POST /Service_Appointments` with `Preference`     | **201**                                | all four null |
| `PUT /Service_Appointments/{id}` with `Preference` | **200**, `"message": "record updated"` | all four null |
| `PUT /Work_Orders/{id}` with `Preference`          | **200**, `"message": "record updated"` | **kept**      |

The appointment takes the field and drops it without a word. The work order keeps
it.

**Through the work order, then.** A work order converted from a Request carries
`Request: { name, id }`; one our own booking makes outright carries no such
field, which is right — a visit a client booked into the window they picked has
no separate "asked". `appointments.fsm_work_order_id` is already mirrored, so the
chain appointment → work order → Request exists.

That is two FSM reads. Doing them per tray row per board render would put ops'
refresh key against a 5,000-a-day org quota and the shared token budget (open
point 60), so they are done once per visit and kept, exactly as ADR 0055 does
with the invoice link it has to walk for.

## Decision

**The asked window is resolved once per visit and stored, and the words are read
from our own lead rather than parsed back out of FSM.**

- `appointments.asked_window` and `asked_checked_at` (migration 0031).
- `fsm.requestPreference(workOrderId)` reads the work order, follows its
  `Request` if it has one, and answers that Request's preference. Two reads, no
  write. Null when the work order names no Request.
- `resolveAskedWindows` runs on the five-minute cron beside the invoice pass,
  over live visits whose `asked_checked_at` is null, five a pass. It matches the
  Request to `leads.fsm_request_id` and takes `leads.first_choice_window`, which
  is the client's own choice in our vocabulary — `weekday_am` and `weekend_am`
  are the morning window, the two `_pm` choices the evening one, the same mapping
  `sendLeadToFsm` writes into the Request's note.
- Every visit looked at is stamped, whether a window was found or not, so a visit
  with no Request behind it is never asked about twice.
- The tray shows `Asked · Sat, morning` beside `Offered · Sat, evening` where the
  two differ, and **`Asked · not recorded`** where `asked_window` is null. The
  offered window is never repeated as though it were the asked one.

The note FSM holds — "Morning, 9 am to 12 pm" — is words we sent. Reading a
window back out of that prose would be a guess, and a guess is how this project
has twice shown a figure it could not know. The lead is the fact.

## Consequences

- Ops see the disagreement the tray was drawn for, and see plainly when there is
  nothing to compare.
- A visit ops create in FSM from a Request typed there, with no lead of ours
  behind it, resolves to `not recorded`. That is true: we have no record of what
  that client asked for.
- The asked **date** is not shown. The tray has one date column, and the window
  is what the open point and the tray's two lines are about. `Preferred_Date_1`
  is read and could be stored the same way if the board ever wants it.
- Nothing writes `Preference` to a work order, although FSM would take it. There
  is no reader for it, and FSM's own screens are the owner's.
