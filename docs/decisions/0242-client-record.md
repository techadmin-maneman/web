# 0242. A client's record for the technicians: alerts, the handoff note, and their history

- Status: accepted
- Date: 2026-11-11
- Topic: Field work
- Follows [0241](0241-tab-shell-today-and-me.md)

## Context

The technician redesign's brief (`docs/prompts/tech-redesign.md`, "Job" and "Client history") asks for client alerts in
a red box before the technician starts, the last technician's note as Handoff, and every past visit with its result,
note, photographs, consumables and piece. "Notes, photos and alerts belong to the client, not the job, so they survive
reassignment." The plan builds the backend for each in PR 4 (`docs/technician-redesign/PLAN.md`, section 5, items 1
and 2); the owner ruled there is no voice note.

## Decision

1. **Client alerts are their own table, `client_alerts`, kept on the client.** Ops and Care raise them on the client's
   page in the console and take them off; each is audited by the client's and the alert's IDs, never a word of it, as
   staff's notes are (`src/domain/clients/staff-notes.ts`). A technician raises one at a visit's close, once however often the phone
   sends the close. One taken off is marked so, never deleted, until an erasure. 200 characters at most.
2. **The handoff note is a typed note at a visit's close, one a visit, in `handoff_notes`.** The job card carries the
   latest left at an earlier visit of the client, with that visit's after photographs, whoever takes the next job; 500
   characters at most. No voice note.
3. **Both come with the outcome**, as `handoff_note` and `client_alert`, and are kept in their own tables, never in the
   job's event, so the event's body stays what the close decided.
4. **The history is `GET /api/tech/jobs/{id}/client-history`:** the client's alerts, and their visits closed before
   the job, newest first, every one, each with its technician by first name, how it closed, its note, its after
   photographs, what its last consumables step used and the piece its last piece step fitted. It is answered for the technician's own job once it unlocks, as its
   card is; its photographs are served one at a time under the same rule, never cached
   (`/api/tech/jobs/{id}/history-photos/{photo_id}`).
5. **Neither is in the client's data export, and an erasure deletes both:** they are our notes on the client, as
   staff's are.

## Consequences

- The job card's alerts and handoff, and the Client history screen, are drawn in this PR; the job screen around them is
  redrawn in PR 5, and the outcome's note field in PR 6.
- The console shows a client's alerts on their page; handoff notes appear only to technicians.
