# 0086. The next visit is offered, and the client books it

- Status: accepted; amended 27 September 2026 by [0085](0085-services-ops-can-edit.md), whose services the visit offered now names, and 28 September 2026 by the plan's piece C27, whose summary of each client's last visits the Tasks board's two groups now read, and by [0092](0092-task-owners.md), whose flag, kept from that summary, has First fit to book read only the requests of clients not fitted since their consultation; its site form's first fit to follow superseded 1 October 2026 by [0105](0105-a-consultation-and-fit-in-one-visit.md): the form books the consultation alone, or the consultation and fit in one visit, and writes no request for a fit, so First fit to book lists only the requests written before
- Date: 2026-09-27
- Amends [0051](0051-booking-from-the-site.md), whose form booked a consultation alone, [0045](0045-self-serve-booking.md), whose horizon was the strip's fortnight, [0061](0061-ops-editable-inputs.md), whose register gains its sixth input and a key's own bounds, and [0071](0071-what-ops-see-before-a-setting-changes.md), whose check before a change now stands before a rule is set as well as a price; follows [0047](0047-visit-messages.md) for the reminder, [0060](0060-an-invited-friend-reaches-ops-and-the-crm.md) for the request, [0072](0072-ops-clients-and-queues.md) and [0074](0074-hand-offs-and-messages.md) for the Tasks board, and [0079](0079-an-address-before-a-slot.md); records the owner's rulings of 27 September 2026, ADR 0025's items 68, 69 and 70, and their answers on booking and to open points 46, 61 and 70 (`docs/archive/owner-answers-2026-09-27.md`)

## Context

Nothing booked or offered the next visit. The site's forms, `/book` and an invite's `/r/:code`, booked a free consultation and nothing else; the first fit was offered only once the consultation was done, and then only as a button nobody was told about; a fitted client booked a service only if they thought to, and could never book a replacement, since Home's and Visits' "Book your next visit" booked the first kind the client could book, which for a fitted client is always a service. Home's prompt about a replacement opened WhatsApp to us. Nothing reminded a client that a service was due, and nothing told ops that one had lapsed: board D2's At-risk client was never built. Every visit had to be booked within the fortnight the date strip shows (`BOOKING_DAYS`).

The owner ruled on 27 September 2026, question by question:

- **The site's form.** "Book the consultation and request the fit": the form offers "A consultation" or "The consultation, then my first fit"; the second books the consultation and records a first-fit request in the same write, and no money is taken before the free consultation.
- **From the consultation to the first fit** (open point 70): "No minimum", the gap a console setting starting at 0 days.
- **The service cadence**: monthly, 30 days, a console setting.
- **Who books.** The client, in the app, never the technician: the first fit as the consultation closes, and the next service the moment a first fit, a service or a replacement closes, on its due date, the last visit plus the cadence.
- **Reminders.** One WhatsApp 7 days before the due date, on the client's consent to WhatsApp about their visits, and an At-risk client task for ops 7 days after it (open point 61). Both figures console settings.
- **The horizon**: 45 days, a console setting, "so a service due in 30 days can be booked the day the last visit closes".
- **Replacements**: booked and paid in the app, from Home's due prompt; the WhatsApp hand-off comes out.
- **Home's prompt** (open point 46): the order (1) no address while something is booked, (2) the next service due and not booked, (3) the piece falling due, (4) an invoice issued in the last 14 days, the fortnight a console setting; and a page in the app on what a replacement involves.

And, as a standing rule: every figure a rule uses is set in the console (ADR 0025, item 66); "Message us" is kept for problems only (item 70).

## Decision

### The site's form asks for the first fit with the consultation

The consultation form, on `/book` and on an invite's landing alike, begins with **what to book**: "A consultation", which is where it starts, or "The consultation, then my first fit". The second shows, beneath it, that the fit is booked and paid for in the app once the consultation is done and that nothing is paid now, and asks **the fit's window, if the client has one in mind**: either, the morning or the afternoon. Never the evening: a first fit takes two slots, and the evening's start too late for them (`windowsFor`, `src/config/scheduling.ts`; ADR 0035).

`POST /api/consultation` and `POST /api/r/{code}/consultation` take `first_fit: { window }`, `window` being `morning`, `afternoon` or null for either; left out, the consultation alone. The answer carries `first_fit: true` when it was asked for, and the confirmation then says the fit is booked and paid for in the app once the consultation is done.

**The request is written with the booking** (migration 0047, `first_fit_requests`): in the batch that holds the consultation's slot, with the person, their consent and their address, or in the batch that records the consultation request while self-serve booking is off. A booking refused, for a window gone, a number with a consultation still to happen or one past consultations, leaves no request. The table points at `people`, and not at `leads`, as `consultation_requests` does (ADR 0060). A person's latest request stands: asking again replaces the one before.

**Nothing is paid on the site.** The slot held is the consultation's, free as ever; the first fit is booked in the app, where it is priced and prepaid (ADR 0045).

**The consent recorded is the consultation's own**, `referral-consultation-v1`, "You may contact me on WhatsApp about this consultation.", unchanged. Whether it covers messages about the fit asked for is counsel's to confirm (`docs/open-points.md`, item 41); no new notice is written until counsel does. The form's new words are placeholders for the owner to approve (item 45). They are written in `site/src/content/referral.ts` without the `PLACEHOLDER` mark the apps use, since that mark refuses the site's production build, as ADR 0081 records for the address's words.

**While self-serve booking is off**, the consultation request on the Tasks board says so: "Asked for 24 Sep 2027, afternoon + first fit, morning".

### What the app offers next

`GET /api/me` answers `booking.next`: with nothing booked, what the app offers, the day it is offered on and the window, which the booking sheet opens with (`nextVisitFacts`, `src/domain/next-visit.ts`; the rules in `src/policy/next-visit.ts`):

| Once                                            | It offers        | On                                                                      | In                                                                   |
| ----------------------------------------------- | ---------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| a consultation is done                          | the first fit    | the consultation's day and the lead time ops set, never before tomorrow | the window the site's request asked for, if any                      |
| a first fit, a service or a replacement is done | the next service | the last visit's day and the cadence, or tomorrow once that has passed  | the last visit's window, where a visit of its kind can start in it   |
| the same, with the piece falling due first      | the replacement  | the same day                                                            | the same, and never the evening, which a replacement cannot start in |

"Nothing booked" is no visit still to happen and none paid for and on its way to FSM (ADR 0068), and a booking's consultation not yet in FSM counts as booked. "The piece falling due first" is the piece in wear due on or before the day the service would be: the owner's "if the client's piece falls due before, offer the replacement instead".

**Amended 2 October 2026 (owner, audit decision 17).** The replacement is offered on the earlier of the piece's own due day and the service's, or tomorrow once that has passed, not on the service's day; "the day the service would be" is the day it is offered, so a piece already overdue is the visit offered. `booking.next` and the `next_visit` prompt carry `due_on` beside the day offered, and Home says a visit whose due day has passed "was due": "Your service visit was due on Thu 24 Sep.", with "Book it for Sat 3 Oct"; a replacement's as its month, as Visits says it.

**The booking sheet opens pre-filled.** It asks for the strip from a week before the day offered, so a week either side of it is in view, and has that day chosen where it has a window free, and the window offered where that one is. The client takes them or picks others; nothing is held until they tap. `BookingSheet` takes the day and window offered as props and changes none of its steps.

**The client chooses the kind.** Home's card for a client with nothing booked, and Visits' foot, book the visit offered, in the sheet so filled; beside it, quietly, a fitted client may book the other kind instead, "Or book a replacement piece", or "Or book a service visit". A client after their consultation books the first fit.

### Home's prompt, in the owner's order

`GET /api/me`'s `prompt` is the first of these that applies (`src/policy/home-prompt.ts`):

1. **No address, while something is booked.** As before. A fitted client with nothing booked is no longer asked for one here: the sheet asks for it before any slot (ADR 0079).
2. **The next service due and not booked**, `next_visit`: "Your next service visit is due on Tue 27 Oct, in the morning.", or the replacement's words where it is offered instead, with "Book it for then", which opens the sheet pre-filled. A first fit is Home's card, not this prompt.
3. **The piece falling due**, as a month and never a day (ADR 0059), with "Book the replacement" once its month begins within the horizon (`bookable`), which opens the sheet at the replacement with the strip from that month, and "See what that involves". Not while a replacement is booked or paid for: Home's card shows that one, and the prompt would sell a second (amended in review, 27 September 2026).
4. **An invoice issued** in the last `invoice_prompt` days, 14 to begin with.

**"See what that involves" opens the app's own page**, `/replacement`, on what a replacement involves, with "Book the replacement" at its foot, in place of a WhatsApp message to us. No board draws it; every word is a placeholder in `apps/app/src/content.ts`.

### The reminder

**One WhatsApp a last visit** (`next_service_reminder`, template `next_visit_due_v1`, "Hello {{1}}, your next {{2}} is due on {{3}}. You can book it in the Mane Man app.", placeholder copy). The five-minute cron's `next_service_reminders` job writes it from the evening's reminder hour in India (the day-before reminder's 6 pm; ops set it since ADR 0088, `reminder_hour`), for each client whose last first fit, service or replacement has its next service due from today to `reminder_before_due` days from now, with nothing booked since, and never twice for one visit. Twenty a pass at most.

**The consumer decides at sending**, as it does for every message about a visit (ADR 0047): it sends only with the client's consent to WhatsApp about their visits, taken as it stands then, and not once a visit has been booked, paid for or done since; each skip records why. The words name the visit, "service visit", or "replacement" where the piece falls due first, and the day.

**Within the cron's budget.** The job makes no outside call: it reads D1 and sends to the messaging queue, as the day-before reminders do. Its statement reads a week's visits through an index of the visits a next service follows (migration 0048, `appointments_done_visits`), so a run reads about what it has to do, not every visit ever made (`test/node/database/query-plans.test.ts`, `test/worker/jobs/cron-reads.test.ts`).

### Two Tasks groups

Both read from the rows at the moment ops look, like every other group (ADR 0072, ADR 0074), each with an allowance ops set (`task_sla_hours`), 48 hours to begin with, and each gone **as soon as a later visit is booked**, paid for or done:

| Group                                       | A task while                                                                                                                                           | Waits from | Names                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------ |
| At-risk client (board D2's own)             | a fitted client has nothing booked since their last first fit, service or replacement, `at_risk_after_due` days past the day the next service fell due | that day   | the weeks since the last visit and the due day, as D2 writes "9 weeks since service" |
| First fit to book (ours, no board draws it) | a first fit asked for on the site's form has nothing booked since the consultation, `first_fit_to_book` days on                                        | that day   | the consultation's day and the window asked for                                      |

Both take the third statement of the board's read, which now holds five arms, the most D1 takes in one compound SELECT; a group added next needs a fourth statement (`src/domain/tasks.ts`). The client books; ops reach them from their page, on its visits, and nothing on the board closes either.

**Read from a summary kept as each visit closes** (amended 28 September 2026, plan piece C27). At-risk client read every first fit, service and replacement ever done before its day, and First fit to book each client's every visit for their last consultation, on each look at the board: reads that grow with every visit made, against D1's 5 million rows a day (ADR 0009). Migration 0053 adds `last_visits`, a row for each client with a visit done: their last first fit, service or replacement, its start, and their last consultation's start, worked out by a view, `last_visits_now`, from the appointments themselves.

- **Triggers keep it,** in the same statement as the visit's own write: a visit done added or deleted, or one whose client, kind, start, status or deletion changes, works its client's row out afresh. So the mirror's write of a visit closing, `src/domain/job-sheet.ts`'s status as the technician closes it, the local stand-in for FSM, and the Worker deployed before this one each keep it true without knowing of it. A write that leaves those five as they were, as the mirror's reads mostly do, writes nothing to it. The migration fills it from the visits there.
- **The groups read it,** and look for anything booked since along indexes that hold only what they look for: a client's visits still to happen (`appointments_live_by_person`), those after the last one (`appointments_by_person`), and a booking paid for and on its way to FSM (`slot_holds_confirmed_by_person`). What they list, and when, is as before: the tests of both groups pass unchanged (`test/worker/ops/ops-tasks.test.ts`). A look reads the same rows when every client has had ten times the visits (`test/worker/jobs/cron-reads.test.ts`).
- **Two visits done on one start** were two tasks, one for each; they are now one, for the one the view finds first.

### The horizon

A visit may be booked in the app from tomorrow to `horizon` days on, 45 to begin with, and a first fit no sooner than the lead time after the consultation. `GET /api/availability` still answers a strip of 14 days, from the day asked for, moved back so it ends by the horizon where it can, with any day outside the bookable days offered to nobody; `POST /api/holds` refuses a day outside them (`not_bookable`), for a move as for a new visit. The site's consultation form keeps its own fortnight from tomorrow (`BOOKING_DAYS`, which is now the strip's length and the site's reach alone).

### One setting for the seven figures

ADR 0061's register held ten inputs at most, for its read budget, and five were used (ADR 0088 has since lifted the cap). The seven figures are **one closed-keyed input**, `booking_days`, "Booking and the next visit", whose committed figures live beside their rules in `src/policy/next-visit.ts`:

| Key                   | Figure | May be   |
| --------------------- | ------ | -------- |
| `first_fit_lead`      | 0      | 0 to 30  |
| `service_cadence`     | 30     | 14 to 90 |
| `reminder_before_due` | 7      | 1 to 14  |
| `at_risk_after_due`   | 7      | 1 to 60  |
| `first_fit_to_book`   | 7      | 1 to 60  |
| `horizon`             | 45     | 14 to 90 |
| `invoice_prompt`      | 14     | 1 to 60  |

**A key may have its own bounds.** The register's entry gains `bounds`, each key's own, inside the input's widest (`min` and `max`), and `checkValue` holds each figure to its key's: a horizon shorter than the fortnight the strip shows is refused, `booking_days.horizon` named, though nought is a lead time ops may set. `GET /api/settings` answers `bounds` for every rule, null where every key takes the widest, and the console's boxes and their lines follow them. The input is read by the same cached reader as every other (`OpsInputs.nextVisitDays`); the cron's job and the messaging consumer read the store afresh, as the queue consumers already do.

**The old beside the new, for a rule too.** Settings · Rules no longer sends on the first press. Save shows each figure the change moves, "Between service visits: 30 days → 28 days.", and only the second press sends it, as a price is set (ADR 0071); "Change it" goes back to the boxes, and putting the standard figures back is checked the same way. Save waits while nothing has changed, so the log never records a change that was not one.

### Where the rules are written

The rules are `src/policy/next-visit.ts`, `src/policy/home-prompt.ts` and the second rule of `src/policy/site-booking.ts`, each quoting the owner. Some of those words are recorded only in `docs/archive/owner-answers-2026-09-27.md`, which ADR 0025 names as the record of the answers, so `test/node/policy-quotes.test.ts` now reads that file as a source beside the prompt and the register.

## Consequences

- **Migrations 0047 and 0048** add a table and an index; the Worker already deployed reads neither. **Migration 0053** adds `last_visits`, its view and triggers, and three indexes, which the Worker already deployed neither reads nor needs to write.
- **The contract** gains `first_fit` on both consultation routes and their answers, `booking.next` and the `next_visit` prompt on `GET /api/me`, `bookable` on the `replacement_due` prompt, `bounds` on each rule of `GET /api/settings`, the two task groups, and what `from` does on `GET /api/availability`; the documents and the front ends' types are regenerated.
- **A new message kind and a new cron job**, `next_service_reminder` and `next_service_reminders`. An operator runs nothing for either: the cron's trigger is unchanged.
- **A fitted client with nothing booked and no address** sees the next service rather than the address prompt; the sheet asks for the address before anything is held.
- **The invoice prompt** now shows only when neither the address, the next service nor the piece applies: a fitted client with nothing booked sees the next service instead, in the owner's order.
- **No board draws** the site's choice of what to book, the prompt's next visit, the other kind beside the button, the page on a replacement, or First fit to book; each is a departure recorded in `docs/fidelity-method.md`, and every word a placeholder: `apps/app/src/content.ts` and `apps/ops/src/content.ts` mark theirs, the site's are owed under open point 45, and the reminder's text under item 39.
- **Counsel** confirms whether the consultation's consent line covers the fit asked for with it (item 41).
- Tests: `test/worker/booking/next-visit.test.ts` (what is offered and when, the lead time, the horizon, the reminder written once, sent only with consent and not once a visit is booked, the cron's job); `test/worker/site/consultations.test.ts` and `referrals.test.ts` (the request written with the booking, and none when the booking is refused); `test/worker/ops/ops-tasks.test.ts` (both groups entering and leaving, and "+ first fit"); `test/worker/ops/ops-settings.test.ts` (the input's bounds, its audit, putting it back); `test/worker/app/client-visits.test.ts` (Home's order); `test/node/policy/policy-next-visit.test.ts`, `policy-home-prompt.test.ts`, `ops-settings.test.ts`, `query-plans.test.ts`; `e2e/book.e2e.ts`, `e2e/refer-landing.e2e.ts`, `e2e/app/next-visit.e2e.ts`, `e2e/ops/tasks.e2e.ts` and `e2e/ops/settings.e2e.ts`, each with axe.

## What this does not do

- **It books nothing for the client.** Nothing is held until they tap, and the technician books nothing.
- **It does not list every service of a kind.** The sheet books the kind it is opened at; the services within each kind that ops set up are ADR 0085's, which the sheet's steps follow. **Amended 27 September 2026 ([ADR 0085](0085-services-ops-can-edit.md)):** the visit offered books one of ADR 0085's services, not a bare kind. `booking.next`, the `next_visit` prompt and the `replacement_due` prompt each carry a `tier`: the service the client's last completed visit of that kind was, while it is still offered and priced on the day offered, else the kind's first offered service in the console's order (`serviceToOffer`, `src/domain/services.ts`). BookNext, Home's "Book it for then" and "Book the replacement", and the page on a replacement pass it to the sheet, which opens with that service chosen; where the kind offers more than one, the client still sees them all and may pick another, and the sheet then opens on the day and window offered, as before. The day and window offered are worked out as this record says.
- **It does not send a second reminder**, nor one about a first fit asked for: ops follow a fit up from the Tasks board.
- **It does not give the data export the requests**, as it does not give it consultation requests.
- **It does not move the site's consultation strip** past its fortnight.
