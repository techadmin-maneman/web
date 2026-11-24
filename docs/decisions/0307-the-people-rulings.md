# 0307. The People rulings

- Status: accepted
- Date: 2026-11-24
- Topic: The ops console
- Amends [0303](0303-snoozing-a-task.md) on what may be snoozed, and [0306](0306-the-people-screens-to-the-22-november-redesign.md)
  on a client's stage

## Context

The People screens (ADR 0306) left seven questions to the owner, who answered them on 24 November: the prototype's
stages and journey bar; its views of the list, with counts; a pincode asked on Add a client; no CSV of the list; the
city chosen in the header alone; a technician's pay grade on Add and Edit; and no snooze for a statutory task.

## Decision

1. **A client has a stage: Lead, Consulted, Fitted or Active.** A lead until a visit of theirs is done; consulted once
   a consultation is; fitted once a first fit, service or replacement is; and active while the last of those is within
   their package's service cadence and the grace the At-risk client task gives, as the retention figures count it
   (ADR 0151). A fitted client past that is Fitted again. The list, the search and a client's page show it, the page
   with the prototype's journey bar beneath its head: Lead, Consultation, First fit, Active.
2. **Clients has the prototype's views, each with its count**: All, Leads, Visit booked, Fitted (active ones too),
   Nothing booked and Needs something. Needs something is the clients a task on the caller's own board waits on, read
   from that board, so the list and the count hold only what the caller may see; its count is left out where the board
   was read only in part. The view is kept in the address (`/clients?view=lead`).
3. **Add a client asks a pincode, which may be left out** (`people.pincode`, migration 0237). It is the client's city
   until an address, a visit, a booking, a consultation asked for or the waitlist says another, so a client added on a
   call is in their city's list. A number already held keeps its record, as a form never changes a person someone
   else may hold. Erasure blanks it, and the export gives it.
4. **A request about a client's own data cannot be snoozed**: a deletion asked for, what an erasure leaves in the CRM,
   a grievance and a number change, whose time the law or our promise sets. The API refuses it, and the board marks
   each group `snoozable`, so the panel shows no Snooze for them.
5. **A technician's pay grade is chosen on Add and Edit** by someone with Finance access, through the pay grade's own
   route (`POST /api/technician-pay/technicians/{id}`); nobody else sees the field.
6. **The list has no CSV, and no city choice of its own**: the header's city narrows it, as every screen.

## Consequences

- A client's stage is read against today, so one becomes Fitted again the day after their grace runs out, with no
  write.
- Needs something costs a read of the board on the list's first page and on each page of that view.
- Bookmarks of the list made before this (`/clients?state=lead`) open on All.
