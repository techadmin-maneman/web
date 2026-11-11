# 0248. A technician's safety on a visit

- Status: accepted
- Date: 2026-11-11
- Topic: Field work

## Context

The technician redesign's brief (`docs/prompts/tech-redesign.md`, "Safety") asks for a shield in every visit header.
It opens a sheet saying ops can see the technician's location until the visit closes, an SOS held for three seconds,
and ops' line and 112. Live location runs from check-in to the close. PLAN.md section 5, gap 14, adds an urgent alert to
ops and a banner on every console screen until it is handled. Because this keeps and deletes a technician's personal
data, the plan's short version went to the owner first, and they approved it on 11 November 2026, with the position
sent every two minutes.

## Decision

1. **Where the technician is, from check-in to the close.**
   - While the app is open, the phone sends its position every two minutes for today's visit that is checked in and not
     closed (`POST /api/tech/jobs/{id}/position`). A web app cannot do this in the background.
   - The visit keeps the latest reading alone (`visit_positions`, one row per visit). A later reading replaces an
     earlier one, and one arriving late changes nothing.
   - The API takes a position only for the technician's own visit, between its check-in and its close (`dispatched` or
     `in_progress`).
2. **Gone when the visit no longer needs it.** A trigger deletes the visit's position when the visit closes (completed
   or terminated), is cancelled, is given to another technician, or is deleted. The hourly housekeeping deletes any
   position not heard for 12 hours, in case a close never comes (`POSITION_KEPT_HOURS`).
3. **The SOS is held for `--duration-hold` (three seconds),** with a fill crossing it, and letting go sooner sends
   nothing (`HoldButton` in packages/ui). It sends the visit and where the phone is (`POST /api/tech/sos`), and saves
   `sos_alerts`. It pages the urgent space at once with the technician's name, the visit's ID and a map link
   (`sos:<id>`, an urgent kind). There is one open SOS per technician: a second press while one is open is the same
   SOS, and pages nobody again. The phone vibrates once it is sent.
4. **While it is open,** each position the phone sends updates it too. The phone shows "SOS sent <time>" and
   "I'm safe". "I'm safe" records `safe_at` and tells the urgent space (`sos_safe:<id>`); the SOS stays open.
5. **Every console screen shows the open SOS as a red banner,** to anyone signed in. It names the technician, the
   visit's client and time, when it was sent, a map link while there is a position, and whether they said they are safe.
   Someone with Operations · Act marks it handled (`POST /api/sos/{id}/handled`). That keeps who and when, blanks the
   position, and resolves both alerts.
6. **What is kept.** A position lasts no longer than its visit. An SOS keeps who sent it, the visit, when it was sent,
   said safe and handled, and who handled it. Its position goes once it is handled. Neither table holds client data, so
   neither is in the client data register (`src/policy/personal-data.ts`). Neither is copied to analytics.
7. **Counsel's line.** The technicians' privacy notice must carry counsel's line on live location and SOS positions
   before this reaches production. Staging may run it before then.

## Consequences

- A visit's position on the console exists only on an open SOS. No screen tracks a technician otherwise.
- A phone that is closed or has no signal sends nothing, and the position is the last one that reached us.
- An SOS raised with no signal fails on the phone, which then says to call ops or 112. It is not queued for later.
- Migration 0207 adds two tables and a trigger that writes only to one of them, so the Worker already deployed is
  unaffected.
