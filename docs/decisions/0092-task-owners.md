# 0092. Whose each task is, a visit ops close without a follow-up, and an address given to ops

- Status: accepted
- Date: 2026-09-28
- Amends [0072](0072-ops-clients-and-queues.md), whose board drew no owner, and [0074](0074-hand-offs-and-messages.md), under which only the thing itself could close a visit left partly done or a visit with no address; follows [0031](0031-access-and-audit.md) for who is signed in, [0054](0054-address-capture.md) for how an address is saved and [0086](0086-the-next-visit-is-offered.md) for the Tasks board's reads; records the owner's answers to open points 61 and 62 of 27 September 2026 (`docs/archive/owner-answers-2026-09-27.md`), the plan's pieces C7 and C8, and departures in ADR 0025 (items 77 and 78)

## Context

Board D2 writes an owner in ops against every task, "Priya" or "Anil", and the Tasks board drew none: there is no tasks table, since every task is read at the moment ops look from the queue the database already keeps (ADR 0072), and nothing recorded who had one. Two groups could leave the board only when their thing was done: a visit left partly done, once another visit was booked, and a visit to come with no address, once the client saved one in the app (ADR 0074). A client who wants no follow-up, or who tells ops their address on the phone, left a task nobody could close.

The owner ruled on 27 September 2026:

- **Open point 61:** "ops take or assign a task to a named member of staff (their Access e-mail) and the board shows whose it is".
- **Open point 62:** yes to both: "ops may close a partial visit's task without a follow-up, with a required reason kept under who closed it; and ops may record on the client's page an address the client gives them on the phone, marked as given to ops".

Two of the board's reads also grew with every lead ever made (found 28 September 2026): Consultation request read every consultation request, and First fit to book every first-fit request, on each look.

## Decision

### What is kept about a task, and never the task

A task is still read from its queue when ops look. What is kept is **about** a task, keyed by its group and the id of the row it is read from (`task_owners`, `task_closures`, migration 0056): a piece, a grant, a visit, a request. One visit can be two tasks, a job on a day off with no address, so the group is part of the key and each has its own owner.

**A task's episode, where its row can be a task again** (amended in review, 28 September 2026). For most groups a row is one task: a grant held, a grievance, a no-show, a partial visit. When one leaves because its thing was done and comes back because that was undone, a booking called off, it is the same task, and keeps its owner. Two groups' rows can be a new task, and an owner left behind on them would land on it:

| Group             | The row           | A new task on it                                                                             | Its episode                                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | ----------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Job on a day off  | the job           | ops move the job off the day, the task leaves, and leave recorded later falls on its new day | the first leave recorded over the job. Moved to another time or day within that leave, or its time changed by the client or FSM, it is the same conflict and keeps its owner. One edge: should that first leave be cancelled while a later leave over the same day keeps the conflict, the later one is its first, and the task is nobody's until ops take it again |
| First fit to book | the fit's request | a later consultation follows the same request, which still stands                            | the consultation it follows. A lead who fills in the site's form again while their task waits (self-serve booking off), which keeps the request's row (`firstFitRequestStatement`), is the same lead to follow up, and keeps the owner working them (the coordinator's decision in review)                                                                          |

The board reads each task's episode (empty for every other group), and an owner is kept for the episode it was given in (`task_owners.episode`) and found only by it: a new task on the same row is nobody's until ops make it someone's. The episode was chosen over the task's `since`, which the review offered as the other way, because a First fit to book's `since` moves with the days ops set in Settings (`first_fit_to_book`, ADR 0086): changing that figure would have dropped every owner of the group. The request's own id was not made new on each asking either: that would change ADR 0086's statement, drop the owner of a lead asking again while being worked, and still leave the later consultation. The job's start is not part of a conflict's episode (amended in the second review): a move within the same leave, or a time the client or FSM changed, would have made the task nobody's while it stayed on the board. A row whose task has gone is left behind; only its own episode reads it again.

### Whose a task is

**Ops take a task, give it to another member of staff, or hand it back.** `PUT /api/tasks/{group}/{id}/owner` with `{ owner }`, an e-mail or null. The task must be on the board as ops look (`404 not_found` otherwise); each change is audited in the same batch (`task.assign`, with the group and the owner; `task.hand_back`), and one that changes nothing writes nothing. `GET /api/tasks` answers each task's `owner`.

**The members of staff are those who have used the console in the last 90 days.** There is no staff table, and the brief left two choices: any well-formed e-mail on the org's Access domain, or the e-mails that have acted in the audit log. The second is taken:

- It is what Access says. Every call to the console is logged under the e-mail Access signed its caller in with (`auditCall`, ADR 0031), so the log holds exactly the people Access has let in, and no one else.
- A typo or a service token's ID cannot make a task nobody's: `mayOwnTasks` (`src/policy/tasks.ts`) takes only an e-mail in that list, in any case, as Access gives every e-mail in lower case.
- It needs no new setting. The org's Access domain is not a variable the Worker has, and the free plan's 64 are full (ADR 0074).
- The console can offer a list rather than a box to type in: `GET /api/tasks` answers `staff`.

**Seen lately, since the log keeps everyone for ever** (amended in review, 28 September 2026, the coordinator's decision). Someone who has left stays in the audit log, which nothing may change (ADR 0031), so the list is those whose latest call is within `STAFF_SEEN_WITHIN_DAYS`, 90 days: someone who left is offered, and may be given a task, for 90 days after their last call and no longer. A task already theirs still shows them, and can be handed back or given on. The figure is ours; if ops want it in Settings, it is one more key.

The cost: a new member of staff can be given a task once they have opened the console once. The log holds every call ever made, so the list is walked along the log's index of actors one e-mail at a time, with each one's latest call found along the same index, `staffSeenSince` (`src/domain/task-owners.ts`): a look reads a row or two for each member of staff, not one for each call they made (`test/worker/cron-reads.test.ts`).

**A person, never a service token.** Access lets a service token in too, and the log names it by its client ID. Taking, giving or handing back a task, closing one and saving an address given on the phone are kept under whoever did them, so each refuses a service token, `403 access_required` (`memberOfStaffOf`, `src/http/audit.ts`).

**The board shows whose each is,** in D2's own column, by first name as the board writes it: "priya.sharma@maneman.in" reads "Priya". Beneath each task's lines, where the way to where it is decided already stood, the row offers Take it or Hand it back, and Give it to…, a list of the staff. The board draws none of these (ADR 0025, item 77).

**No "mine" or "unassigned" filter.** The brief asked for one only if the board allowed it without redesign. It does not: D2's head holds the title and the overdue count, and each group's count is its whole queue while the board lists fifty (ADR 0072), so a filter the console applied to what it lists would count one thing and show another. The owner's name on each row is enough to begin with.

### A visit left partly done, closed without a follow-up

`POST /api/tasks/partial_visit/{id}/close` with `{ reason }`: required, 1 to 300 characters (`REASON_MAX_CHARS`, ADR 0072's bound), refused without one (`400 invalid_request`, `fields: ["reason"]`). It is kept in `task_closures` with who closed it and when, and audited in the same batch (`task.close`); two members of staff closing it at once close it once, and the second writes nothing and logs nothing. The reason is ops' words about a client's visit, so, as ADR 0072 rules for a decision's reason, it is kept with the closing and never in the log, and an erasure blanks it with the others (ADR 0074's list; `src/domain/erasure.ts`).

The closed task leaves the board and stays closed: the group's statement leaves out a visit with a closing. A later visit left partly done is another visit, so another task. Only this group closes (`CLOSABLE_TASK_GROUPS`); `GET /api/tasks` says which groups may (`closable`), and every other group still leaves only when its thing is done. The client's page shows, beneath the visit's state, who closed it, when and why (`closed_without_follow_up` on each visit of `GET /api/clients/{id}`).

### An address the client gives ops on the phone

**Saved exactly as the app saves one.** `POST /api/clients/{id}/address` takes the app's own shape (`AddressSave`, the same fields and checks), and the save and the building search are one path for both, `src/http/address-save.ts`: a building chosen from the search is geocoded once, within `GEOCODE_DAILY_CEILING`, its pin kept with its source; a typed address saves with no pin; the address replaces the one before it; and FSM's contact and the CRM are sent it as the app's save sends them (ADR 0054, ADR 0070). `POST /api/clients/{id}/address/suggestions` is the app's search for ops, with a day's limit for each member of staff as each client has one, counted against the same ceiling.

**Marked as given to ops.** `addresses.given_to_staff` holds the Access e-mail of the member of staff who saved it, and the row's own `created_at` when; the save is audited in its batch (`address.given_to_ops`, naming the client and no part of the address). An erasure blanks the mark with the rest of an address it keeps (one a check-in was measured against, blanked to its city and pincode, ADR 0066) and deletes every other; the audit log, which no erasure reaches, still says who saved one. The client's page shows it as "Given on the phone · To priya@maneman.in, 28 Sep 2026", with the flat, floor, tower and building the record now carries. A visit to come with no address then leaves the Tasks board, as it does when the client saves one: the group reads only whether an address is saved.

**The app says so.** The client sees the address in their profile like any other, with a line beneath it: "You gave us this address on the phone on 28 Sep 2026. If anything is wrong, change it here." (placeholder words, `apps/app/src/content.ts`). The address was typed by ops from what they heard, and the client is the one who knows the door, so they are told it came from a call and can check it. `GET /api/profile` answers `address_given_to_ops`, the day, and never who took it. An address the client saves in the app is their own, and the mark goes with the address it replaces.

**The flat or house number is not made required here.** That is plan piece C18, waiting on a staging trial; the field is optional as the app has it.

### Two reads that stay flat as leads grow

- **Consultation request** reads only the requests whose client has no consultation booked or done: `consultation_requests.booked`, kept by triggers on the appointments as consultations are booked, called off, moved, changed or deleted, and as a request is written, with a partial index of the rows still waiting.
- **First fit to book** reads only the requests whose client has not had a first fit, service or replacement done since their last consultation: `first_fit_requests.fitted_since`, kept by triggers on `last_visits` (migration 0053), which already holds both starts, with a partial index of the rows still unfitted. The group's own rules are unchanged; the flag only narrows what is read.

A look at the board reads the same rows when ten times the leads have been answered (`test/worker/cron-reads.test.ts`), and the migration's triggers are held to the flags' own definitions after every kind of write (`test/node/migration-0056.test.ts`). No trigger body holds `CASE … END`, which wrangler's statement splitter cuts in two.

## Consequences

- **Migration 0056** adds `task_owners`, with each owner's episode, and `task_closures`, a nullable `addresses.given_to_staff`, `consultation_requests.booked` and `first_fit_requests.fitted_since` (each with a default, filled from what is there), their triggers and two partial indexes. The Worker already deployed reads none of it, and the triggers keep the flags true while it writes.
- **The contract** gains the two task routes and the two address routes; `owner` on each task, `staff` and each group's `closable` on `GET /api/tasks`; `building`, `flat`, `floor`, `tower`, `landmark` and `given_to_ops` on the client's address, and `closed_without_follow_up` on each of their visits; and `address_given_to_ops` on the client's profile. The documents and the front ends' types are regenerated.
- **Four audit actions:** `task.assign`, `task.hand_back`, `task.close`, `address.given_to_ops`.
- **Open point 61** is settled but for the figure for First fit to book, which nobody has ruled; **open point 62** is settled.
- **No board draws** the actions on a task, the close form, the address form on the client's page or the app's line; each is a departure in ADR 0025 (items 77 and 78) and `docs/fidelity-method.md`, and every word a placeholder.
- Tests: `test/worker/ops-tasks.test.ts` (take, give, hand back, a task not on the board, an e-mail nobody signed in with, one seen only long ago, one owner for one of two tasks about a visit, a moved job's new conflict and a first fit after a later consultation with no owner, a job moved within its leave and a first fit asked again keeping theirs, a task undone and back with its owner, a service token refused; close with a reason, refused without one, no other group, stays closed, a later one its own task, a service token refused), `test/worker/ops-client-address.test.ts` (saved and pinned as the app's save, marked, audited, sent on, the task gone, the client's profile, a service token refused), `test/worker/ops-clients.test.ts`, `erasure.test.ts` (the mark blanked), `client-profile.test.ts`, `cron-reads.test.ts`; `test/node/migration-0056.test.ts`, `policy-tasks.test.ts`; `e2e/ops/tasks.e2e.ts`, `e2e/ops/clients.e2e.ts` and `e2e/app/profile.e2e.ts`, each with axe.
