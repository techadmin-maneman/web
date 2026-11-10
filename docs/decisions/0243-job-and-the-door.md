# 0243. The job and the door in the new look

- Status: accepted
- Date: 2026-11-11
- Topic: Field work
- Follows [0242](0242-client-record.md)

## Context

The technician redesign's brief (`docs/prompts/tech-redesign.md`, "Job" and "At the door") redraws a job as a map, the
address, the way in with Copy, Navigate, Call and Message, the client's record and the visit's data, with Check in at
the foot; and the door as its own screen, a 15-minute timer with a brass bar and a checklist of what a no-show needs.
The plan puts both in PR 5 (`docs/technician-redesign/PLAN.md`, section 3, "07 Job card and the door"), keeping every
state of the old card.

## Decision

1. **The job is a light screen with the action bar at its foot.** Its bar holds the stage's one action: Check in from
   the job's opening time, At the door once checked in, Continue once the visit has begun, View summary once it has
   closed. The line above Check in says how near it must be made, when it opens, that the address has no pin, or that
   the phone gave no position. A check-in measured too far stays on the job as a red card with Try again.
2. **At the door is its own address, `/jobs/{id}/door`,** opened by a check-in that passes or waits for signal. It shows
   the wait as time gone of the 15 minutes, the brass bar, and three lines: the WhatsApp's state, Call, and the door's
   photograph. Start visit is its action; Back returns to the job, whose alerts stay a tap away.
3. **Close as no-show waits for the call and the photograph as well as the wait** (brief). The call is the tap on Call
   from the door, kept on the phone with the check-in's record; the API does not see it. The note for ops stays,
   optional. The question before the close says the client is prepaid and ops decide on the charge, or, with nothing
   paid, that ops are told.
4. **Message is the sheet of words** (On my way, Running late, by the minute), sent from our number as before. The open
   WhatsApp chat leaves the job; a client who takes no updates is called, and the job says so.
5. **The map is a placeholder** with the drive from the day's list; the phone draws no map, and Navigate opens one.
6. **The door's photograph has a screen of its own** in the camera's chrome (`--camera-900`, `--camera-700`), with the
   brief's prompt and a round shutter, now `@maneman/ui/Shutter`.
7. **Not yet drawn:** Ask ops to reschedule (PR 9), How this visit is done (PR 10), the Schedule preview of a locked job
   (PR 9) and the shield (PR 8).

## Consequences

- The client's alerts are a `ProblemCard` with a heading, and Client history a row, as ADR 0242's review asked.
- The client app's photo capture keeps its own shutter for now; it can move to `Shutter` with its next change.
