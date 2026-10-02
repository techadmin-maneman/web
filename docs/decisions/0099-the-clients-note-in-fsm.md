# 0099. The client's note in FSM

- Status: accepted, on the owner's ruling of 27 September 2026 (`docs/open-points.md`, item 64)
- Date: 2026-10-01
- Amends [0074](0074-hand-offs-and-messages.md), which kept the note out of FSM until a note had been tried on the org; the calls are the trial of 30 September 2026 (`docs/decisions/fsm-trial.md`, "Text FSM keeps"); the text is kept as [0098](0098-the-door-in-fsms-address.md) keeps a street

## Context

A client leaves the technician a note on a visit to come, in the app (ADR 0074): "Ring twice", "The lift is out". It is kept on the visit, the latest in place of any before it, and the technician reads it on the client's card from the day before. FSM was not written, since no note on an appointment had been tried against the org, so ops reading the appointment in FSM never saw it (open point 64). The owner ruled on 27 September 2026: write it to FSM.

The trial of 30 September 2026 found that an appointment takes notes (`POST /Service_Appointments/{id}/Notes`), that one can be changed (`PUT .../Notes/{note id}`) and blanked (`Note_Content: ""`), that its title is kept, and that no call deletes one. FSM keeps a note only up to its first character past U+FFFF, such as 🙏, answering success.

## Decision

**One note per visit, the client's latest, titled "From the client".** Each note the client saves is queued for the fsm-sync consumer (`note_appointment_id`), which reads the visit's note afresh and writes it to the visit's appointment (`writeClientNote`, `src/providers/fsm-zoho.ts`). The provider lists the appointment's notes and changes the one titled "From the client", or adds it where there is none. So FSM holds only the latest, a write whose answer was lost is changed rather than made twice, and notes ops write in FSM themselves are never touched. The note leaves out the characters FSM would cut it at (`fsmText`, `src/lib/fsm-text.ts`).

**Failures.** A write FSM fails is tried again after 30 s, 1, 2 and 4 minutes, as the contact's is; the fifth tells ops once (`client_note_fsm:<visit>`), and a later note that reaches FSM clears it. A note that cannot be queued is kept and tells ops the same way. The technician reads the note in their app either way.

**Erasure.** FSM cannot delete a note, so the erasure blanks it. `appointments.fsm_note_written_at` (migration 0066) marks each visit whose note reached FSM; the FSM step of an erasure blanks each one's note before it anonymises the contact, and empties the mark. A note FSM will not blank stops that step, which the sweeper tries again as it does the contact (ADR 0049). Nothing is written for a client already erased.

## Consequences

- Ops see the client's words on the appointment and its work order in FSM, under "From the client".
- A note written in the evening before a visit reaches FSM within seconds; one FSM keeps refusing leaves an alert, and the technician's card is unaffected.
- An emoji the client typed reaches the technician's card but not FSM.
- Tests: `test/worker/fsm-client-note.test.ts`; additions to `client-notes.test.ts` and `fsm.test.ts`.
