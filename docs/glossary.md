# Glossary

The words the code, the database and the API use for the same few things, and which one means what. Where two surfaces use one word differently, both meanings are here, and the one to use in new code is named.

## A visit and its records

| Word            | Means                                                                                                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **appointment** | One visit to one client at one time: a row of the `appointments` table, our own record (ADR 0110). The code's word for the row.                                                                                  |
| **visit**       | The same appointment as the client sees it: the app's _Visits_, `/api/visits`. A consultation, a service, a first fit or a replacement (`VISIT_TYPES`).                                                          |
| **job**         | The same appointment as its technician sees it: `/api/tech/jobs`. A write to it is a **job event** (`job_events`), landed once by its event ID (ADR 0038).                                                       |
| **booking**     | Making a visit: a **hold** paid for, or free, written as a visit in the request that confirms it (`src/domain/booking/bookings.ts`). Not a record of its own. A Phase 1 booking was a lead with a proposed date. |
| **hold**        | A client's claim on a time while they pay, ten minutes (`slot_holds`, ADR 0045). Confirmed once paid, it keeps its time until it is booked or refunded (ADR 0068).                                               |
| **request**     | A day and window asked for while self-serve booking is off, which ops confirm (`consultation_requests`, ADR 0060).                                                                                               |

## Services and prices

| Word           | Means                                                                                                                                                                                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **kind**       | One of the four kinds of visit: consultation, first fit, service visit, replacement (`VISIT_TYPES`). It decides the technician's steps, the booking rules and the fees, and a new one needs a release. A hold, an appointment and the API call it `type`; the `services` table, `kind`.  |
| **service**    | What a client books: a kind and a tier of it, with its own name, length, place in the kind's order and Books item (`services`, ADR 0085). Ops add, rename, time, order, retire and restore them. Also the kind `service`, a service visit: new prose says "service visit" for the kind.  |
| **tier**       | A service's code within its kind: `standard`, `premium`, or another ops add, made from its first name and never changed. The price book's second key, so a service's prices stay its own whatever it is renamed.                                                                         |
| **standard**   | Each kind's first service, the one there has always been: what a hold with no tier books, and the site's Standard column. The site's Premium is the services coded `premium`.                                                                                                            |
| **offered**    | A service not retired by a day (`isOffered`). Clients see one only while it is offered and priced; one retired from a day stays as it was sold to anyone who bought it before.                                                                                                           |
| **price book** | `price_book`: every price by what it prices (a kind or a late fee), its tier, and the day it applies from, with GST. Never back-dated, so what was sold stays readable; a hold keeps the price it was sold at (ADR 0068). Set in the console's Services and prices (ADR 0061, ADR 0085). |

## Time

| Word                  | Means                                                                                                                                                                                                                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **window**            | One of the three the client books: morning 9–12, afternoon 12–4, evening 4–8 (`BookingWindow`, `WINDOW_TIMES`; ADR 0035). What new code means by the word.                                                                                                                                          |
| **visit window**      | Phase 1's rough preference on the booking form: weekday or weekend, morning or evening (`VisitWindow`, a lead's `first_choice_window`). Still read for Phase 1 leads.                                                                                                                               |
| **window label**      | Two meanings, by surface: on `/api/me` it is Phase 1's words for the booked page, "before noon" or "after four" (`WindowLabel`); on `/api/visits` and `/api/tech/jobs` it is the window, morning, afternoon or evening. The API fields keep their names; renaming them is a change to the contract. |
| **window_start**      | An appointment's booked start, an instant; `window_end` its end. Not a window in the sense above.                                                                                                                                                                                                   |
| **slot**              | One of the dispatch board's four columns a day (`SLOTS_PER_DAY`).                                                                                                                                                                                                                                   |
| **unit**              | Half a slot, the grain the day is counted in: eight a day (`UNIT_STARTS`), so a replacement's slot and a half is three.                                                                                                                                                                             |
| **claim**             | A row in `slot_claims` holding one unit, or one window, of one technician's day, for a hold (ADR 0069).                                                                                                                                                                                             |
| **rate-limit window** | The India hour or day a counter counts in (`src/domain/sign-in/rate-limit.ts`). Nothing to do with a visit's time.                                                                                                                                                                                  |

## People

| Word           | Means                                                                                                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **person**     | Anyone we hold a number for: a row in `people`. The code's word for the row.                                                                                                            |
| **client**     | A person who may sign in to the app: one with a booked consultation or a later visit (`src/domain/sign-in/login.ts`). Fitted, a lead or nothing booked (`clientStateOf`).               |
| **lead**       | Two meanings: a row in `leads`, what a form or a try-on left, which reaches the CRM; and, as a client's state, a person booked but not yet fitted. The CRM's own record is also a Lead. |
| **customer**   | The person's record in Books, where invoices and payments are (`books_customer_id`). Books' word, never ours.                                                                           |
| **technician** | A field technician ops add in the console's Technicians, in `technicians`. He signs in on one phone at a time (ADR 0052).                                                               |
| **staff**      | Whoever Cloudflare Access let into the ops console: a person's e-mail, or a service token (`staffOf`, `src/http/audit.ts`).                                                             |

## Removing a person

| Word                 | Means                                                                                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **deletion request** | A client asking, in the app, for their account to be deleted (`deletion_requests`). Ops decide it within the days `DELETION_DECIDED_WITHIN_DAYS` sets.                                                                       |
| **erasure**          | The act itself (`eraseAndQueue`, ADR 0019 and 0066): photographs deleted, the person blanked, the CRM and Books told. Done in the console only: a decided deletion request, or Erase on a person's own page. All or nothing. |

## Names left from FSM

Zoho FSM is gone (ADR 0110), but some columns still carry its name. Phase 6 of [codebase-upgrade-plan.md](codebase-upgrade-plan.md) renames or drops them.

| Name              | Means                                                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fsm_invoice_id`  | On `appointments`: the visit's invoice in Books.                                                                                                    |
| `fsm_write_state` | On `job_events` and `dispatch_moves`: `written` once the row has landed. A job event a later one superseded is `rejected`.                          |
| `fsm_id`          | On `appointments`, `pieces` and `technicians`: a column that must be filled, which a new row fills with its own ID. Nothing reads it for a purpose. |
