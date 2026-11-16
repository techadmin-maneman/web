# Client app redesign: fit with the ops console and the technician app

12 November 2026. Read against branch `feat/tech-redesign-11-hindi` at `6e5783889`. The prototype this audits is
revision 5 of https://claude.ai/artifact/R3jhpuNxKkZxi6YBExSQk3. The owner's rulings of 12 November 2026 are in
section 8; section 10 covers Razorpay as the only way to pay.

Sources read: `docs/start-here.md`, `docs/glossary.md`, `docs/how-it-works/{booking,field,care,money}.md`,
`docs/settings.md`, `docs/open-points.md`, `docs/openapi-client.json`, ADRs 0043, 0047, 0086, 0096, 0105, 0115,
0145, 0148, 0177, 0191, 0192, 0210, 0211, 0218, 0244, 0250, `apps/app/src/` (every screen and route),
`apps/tech/src/visit/engine.ts`, `apps/tech/src/steps/`, `design/tech-redesign/Technician App.prototype.html`,
`packages/ui/Toast.tsx`, `src/routes/client/*`, `src/domain/booking/{services,availability}.ts`,
`src/domain/purchasing/stock-demand.ts`, `src/domain/ops/task-queues.ts`, `src/domain/care/app-reports.ts`,
`src/config/message-kinds.ts`, `src/policy/ops-settings.ts`, `site/src/content/site/terms-and-conditions.ts`.

## 1. Verdict

The three apps share one record of a visit (`appointments`, `job_events`, `visit_outcomes`), so most of the
redesign lands on what exists. Seven places would conflict if built as first briefed. Four of them are real bugs
or gaps in the code today, which the owner's new rules expose:

1. **A replacement can be booked at any time.** `allowedTypes` returns `["service", "replacement"]` for every fitted
   client (`src/domain/booking/availability.ts:57`), and Home and Visits offer "Or book a replacement"
   (`apps/app/src/booking/BookNext.tsx:51`, `apps/app/src/home/HomeScreen.tsx:301`). The owner's rule is that a
   replacement happens only when the hair system ends.
2. **A change of package at replacement is stocked as the old package.** Stock demand codes a replacement from the
   hair profile's product, never the replacement booked (`codeFor`, `src/domain/purchasing/stock-demand.ts:43`), and
   the `replacement_order` task opens 30 days before the due day for the piece worn (`task-queues.ts:165`). A client
   who books Natural in place of Active gets an Active hair system ordered, kitted and carried to the door.
3. **The technician's live words never reach the app.** "On the way", "Running late" and "At the gate" go only to
   WhatsApp (ADR 0145, `technician_updates`). `VisitDetail.stage` stops at `booked / arrived / in_progress / done /
closing / missed`, with no step and no update. Production has `MESSAGING_ENABLED: "false"`, so in production
   today the client is told nothing at all.
4. **Nothing records that the client accepted the fit.** No step in any of the five plans
   (`apps/tech/src/visit/engine.ts:24`) asks the client, and no table holds an answer. The refund guarantee in the
   terms runs 14 days from the first fit, "in your own judgment", and its only record would be a Care thread.

The other three are the brief against existing decisions, and the prototype now follows the code: a technician
swap tells the client nothing (ADR 0115), taken start times are shown struck through (ADR 0210), and a missed
visit is ruled by ops and disputed in the app (ADR 0096), never raised by the client as an issue.

## 2. Conflicts, and the fix for each

| #   | Where                            | Brief or redesign                                             | What the code does                                                                                                                                                                                      | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | -------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Replacement timing               | Only when the hair system ends                                | Bookable any time a client is fitted (`availability.ts:57`)                                                                                                                                             | Offer `replacement` only from the first day of the month its piece falls due, within `horizon` (ADR 0086's own `bookable` rule, today applied to the prompt alone), or while a remake or recall owes one. Remove "Or book a replacement". Test in `test/worker/booking/`.                                                                                                                                                                                                                                                 |
| C2  | Package change at replacement    | Upgrade or downgrade at replacement, with history             | Booking a replacement of another package moves `people.package` (ADR 0211, decision 6) but demand, kits and `stock_at_risk` read `profile.product`                                                      | (a) `codeFor` takes the booked tier for a replacement as it does for a first fit. (b) **Ruled:** the client chooses at booking, with no notice owed. The hair system ordered for the old package is not charged to anyone: it goes back to stock for another client (`replacement_order` task closes as "returned to stock"). (c) Where the new package is not in stock in the client's size, it is ordered (ADR 0174) at no extra cost beyond the package's own price, and start times open only from its promised date. |
| C3  | Live status                      | Client sees on the way, late, at the gate, arrived, each step | API has no update and no step; WhatsApp only                                                                                                                                                            | Add to `VisitSummary`: `latest_update {kind, minutes, at}` from `technician_updates`, and `step {index, of, name}` from the last `job_events` row. Both are public-safe and read from rows that exist.                                                                                                                                                                                                                                                                                                                    |
| C4  | Notifications                    | In-app inbox and push                                         | None for clients; web push exists for technicians only (`push_subscriptions` keyed to `technician_devices`, migration 0209)                                                                             | `client_alerts` written beside each `outbound_messages` row of the kinds in `MESSAGE_KINDS`, read by a bell; `client_push_subscriptions` keyed to client sessions; the same payloadless VAPID push (ADR 0250). The in-app copy is the only channel while WhatsApp is off.                                                                                                                                                                                                                                                 |
| C5  | Technician swap                  | Tell the client                                               | Silent (ADR 0115, decision 3)                                                                                                                                                                           | **Ruled:** stays silent, as ADR 0115. No change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| C6  | Missed visit                     | Client raises "I was home"                                    | Ops rule the case; the client disputes the charge in the app within `dispute_window_days` (ADR 0096)                                                                                                    | Prototype now uses `POST /api/visits/{id}/dispute`. Client copy says "missed visit", never "no-show" or "not home" (`docs/glossary.md`).                                                                                                                                                                                                                                                                                                                                                                                  |
| C7  | Start times                      | Show only open times                                          | Every start shown, taken ones struck through (ADR 0210, decision 1)                                                                                                                                     | Prototype now strikes them through.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| C8  | Ops can't make it                | "Carry over or refund", client's choice                       | Ops either propose a move the client accepts (ADR 0115, `move_proposal_hours`) or cancel, free to the client unless ops choose otherwise (`ops/visit-changes.ts:84`)                                    | Prototype now shows both paths as ops trigger them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| C9  | Partly done                      | Client books the rest                                         | A remake: ops book it, free when ops judge it not the client's doing; Home says "we'll call to set a day" and offers nothing (ADR 0192)                                                                 | Prototype follows ADR 0192.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| C10 | First fit after the consultation | Pay, then book                                                | Paid in the booking for a hair system in stock (`client-prices`); a custom order is paid by link before its PO (ADR 0174, 0177); a one visit is paid by Razorpay's texted link after the fit (ADR 0105) | Prototype shows the in-stock and the custom-order paths; the build keeps `payment_owed` for the one visit.                                                                                                                                                                                                                                                                                                                                                                                                                |
| C11 | Hair system guarantee            | "No charge if the hairline is wrong at the fitting"           | Terms: 14 days from the first fit, refit free or full refund, first fit only, the technician retrieves the hair system                                                                                  | Copy follows the terms. See section 5 for the sign-off.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| C12 | Booking in production            | App books and pays                                            | `SELF_SERVE_BOOKING: false` in production: requests ops confirm (ADR 0060, 0063, 0064)                                                                                                                  | **Superseded:** Razorpay is live and the only way to pay (section 10). Production turns `SELF_SERVE_BOOKING` on; the request mode leaves the client app's design. The flag and its code path stay for an outage only.                                                                                                                                                                                                                                                                                                     |
| C13 | Second check-in                  | n/a                                                           | `check_in_days {first: 2, second: 21}`: the second lands after the 14-day guarantee has closed                                                                                                          | **Ruled:** leave as it is.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| C14 | Issue log                        | Categories, photos, replies, statuses                         | `POST /api/me/problems` only: `about` is `hair_system` or `visit`, text to 1,000 characters, 5 a day, no photos ("they follow on WhatsApp"), no read-back                                               | See section 4, G1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## 3. Values the app reads from the console, never in code

Every figure in the prototype now comes from one object standing in for these. Change one in the prototype's
controls and every screen follows.

| Shown in the app                                         | Comes from                                                                                                                                                      | Today                                                                                      |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Service visit, first fit, replacement prices             | `price_book` by package and hair system, a city's own first (`price-lookup`); first fit = hair system + service, replacement = replacement + service (ADR 0211) | on `OfferedService.price`, `Hold.price`                                                    |
| How often a service falls due; when a hair system is due | `packages.service_every_days`, `replace_after_months`                                                                                                           | `booking.next`, `prompt`                                                                   |
| Free to move or cancel until                             | `change_notice_hours`                                                                                                                                           | `Hold.free_until`, `MoveTerms`, `CancelTerms`                                              |
| What a late change costs                                 | `late_change_charge` by kind, late fee from the price book                                                                                                      | `Hold.late_change_charge`, `late_fee`                                                      |
| Payment hold                                             | `payment_hold {countdown, grace}`                                                                                                                               | `Hold.expires_at`, `pay_by`                                                                |
| Start-time step and arrival window                       | `booking_rules {step, arrival}`                                                                                                                                 | `Start.arrives_by`                                                                         |
| Same-day booking                                         | `same_day_booking`                                                                                                                                              | `Availability.days`                                                                        |
| No-show wait shown on the missed visit                   | `no_show_wait_min`                                                                                                                                              | `NoShowNote`                                                                               |
| Dispute until                                            | `dispute_window_days`                                                                                                                                           | refusal `dispute_window_closed` only; add `dispute_until` to `NoShowNote`                  |
| Move proposal open until                                 | `move_proposal_hours`                                                                                                                                           | `ProposedMove.expires_at`                                                                  |
| Care's reply promise                                     | `care_hours`                                                                                                                                                    | not on any client endpoint: add to `/api/me`                                               |
| Referral reward                                          | `referral_reward`                                                                                                                                               | `/api/refer`                                                                               |
| Custom order late after                                  | `custom_order_grace_days`                                                                                                                                       | not on `MyCustomOrders`: add `refundable_after`                                            |
| Fit guarantee days                                       | **none**: 14 is only in the terms' words                                                                                                                        | add `guarantee_days` to Settings · Rules, read by the terms page, the app and the sign-off |
| Replacement order lead                                   | `booking_days.replacement_order_lead`                                                                                                                           | ops-only: when stock is ordered. The client is never shown it                              |

## 4. Gaps to build

- **G1. The issue log.** `GET /api/me/problems`: each report the client filed, with its state read from the
  rows that already exist: the Care thread open or closed (`conversations`, ADR 0129, closed "with what it was
  about"), a City matter on it (ADR 0135), a remedy given (ADR 0143), and Care's replies after it in the thread.
  Widen `PROBLEM_ABOUT` to the categories the prototype shows, mapped to Care's closure reasons; accept photos in
  the app through the photo upload the try-on already has (ADR 0217), into the report's thread. Grievances
  (`/api/grievances`, 30 days) and no-show disputes list in the same log, each in its own words.
- **G2. Live visit fields** (C3).
- **G3. Client notifications and push** (C4).
- **G4. Sign-off** (section 5).
- **G5. Replacement rules** (C1, C2).
- **G6. `guarantee_days` and a guarantee claim.** A report of the "fit" category inside the guarantee opens a
  Tasks row ("Fit guarantee claim", deadline from `task_sla_hours`) instead of a plain chat, since the terms owe a
  refit or a refund and the technician must retrieve the hair system.

## 5. The client's sign-off, across the three apps

What the prototype shows ("First fit day" client, "Ask for sign-off" event):

1. **Technician app.** A sign-off screen after the after photos, before Outcome, in the first-fit, one-visit and
   replacement plans (`engine.ts` `PLANS`). It shows "Waiting for the client's sign-off" with a QR fallback
   ("Sign on this phone") for a client without their phone. Outcome "Done" is disabled until the sign-off lands
   or the technician records "Client declined to sign" with a reason, which ops see.
2. **Client app.** A push and the Home card turn to "Your sign-off": today's after photos, three checks
   (hairline, colour and blend, secure and comfortable), "I'm happy with the fit", or "Something isn't right"
   with what and a note. That goes to the technician's screen at once; the technician fixes it and asks again.
   For a first fit the card says signing off does not end the guarantee.
3. **Ops console.** The visit drawer's story (`visit-story`) shows the sign-off, its time and any flag; a fit
   closed without one is a Tasks row.
4. **Storage.** A `fit_sign_offs` table (`appointment_id`, `state`, `checks`, `flag_text`, `signed_at`,
   `signed_on: client_app | technician_phone`), written by `POST /api/visits/{id}/sign-off` and
   `POST /api/tech/jobs/{id}/sign-off-request`. Not a new `job_events` kind: ADR 0105 records that a new kind
   means rebuilding a table others reference.
5. **Terms.** Counsel to confirm the sign-off is recorded as acceptance at the visit and does not waive the
   14-day guarantee; the copy says so.

## 6. One visit, three views

| Moment                        | Technician app                                      | Ops console                      | Client app (redesign)                        | Gap                                                                 |
| ----------------------------- | --------------------------------------------------- | -------------------------------- | -------------------------------------------- | ------------------------------------------------------------------- |
| Booked                        | Job on Today; card unlocks at `address_unlock_hour` | Dispatch board block             | Next visit card, technician named            | none                                                                |
| Ops move, same day            | Job moves                                           | Board move, `visit_moved`        | Card shows new time                          | none                                                                |
| Ops move, another day         | Unchanged until accepted                            | Proposal, a task after a day     | "We need to move your visit": accept or pick | none (ADR 0115)                                                     |
| Ops cancel                    | Job gone ("was cancelled" dialog)                   | Cancel with refund               | Card goes, refund shown                      | none                                                                |
| Swap technician               | "moved to …" dialog                                 | Board                            | Nothing (C5)                                 | owner's ruling                                                      |
| On the way, late, at the gate | Presets                                             | Kept in `technician_updates`     | Live card and push                           | C3, C4                                                              |
| Checked in                    | Door screen, 15-minute timer from the booked start  | Check-in on the board            | "At your door until 12:15"                   | uses `stage: arrived`; add `waits_until`                            |
| Steps                         | Visit engine                                        | Visit story                      | Step n of N                                  | C3                                                                  |
| Sign-off                      | New screen                                          | Story                            | New card                                     | section 5                                                           |
| Done                          | Outcome                                             | Closed                           | Photos, rating, invoice                      | rating has no table: add `visit_ratings`, below 4 opens a Care task |
| Partly done                   | Reason, "Finish the work" asks                      | Tasks row, remake free or closed | "We'll call to set a day"                    | none (ADR 0192)                                                     |
| No-show                       | Wait, call, door photo                              | Case ruled, dispute card         | Missed visit, dispute                        | add `dispute_until`                                                 |

## 7. Toasts and notifications

- **Toasts** now match the technician app's (`design/tech-redesign/Technician App.prototype.html`): ink
  `#1F2328`, white words and tick, square corners as the client app's own (`--ui-radius-box: 0`), the screen's width less 12 px each side, above the tab bar or the
  action bar, 160 ms fade, 2.6 seconds, a few words ("Note saved", "Sent to Care · MM-ISS-0032"). Only for what the
  client just did. `packages/ui/Toast.tsx` draws a centred ink note for 6 seconds today; give it a `fullWidth`
  variant and an icon, as the plan's one-library rule asks (`docs/technician-redesign/PLAN.md`, item 2), rather
  than a second toast in the app.
- **Incoming news** is the technician app's phone-style notification (22 px corners, "Mane Man · now", Dismiss and
  an action; the phone draws that one, not the app), then a row under the bell. Errors stay inline (`InlineMessage`).

## 8. The owner's rulings, 12 November 2026

1. **Replacement timing (C1):** fix as proposed. Bookable from the first day of the month the hair system falls due,
   or while a remake or recall owes one. "Or book a replacement" goes.
2. **Change of hair system (C2):** chosen while booking the replacement, no notice owed. The one ordered for the
   old package goes to stock for other clients; nobody pays for it.
3. **Technician's live updates (C3, C4):** build `latest_update` and `step`, client alerts and client push.
4. **Words page:** no `app:` keys. The app's copy stays in `apps/app/src/content.ts`.
5. **Technician swap (C5):** silent, as ADR 0115.
6. **Sign-off:** required to close a first fit, a one visit's fit and a replacement. "Client declined to sign"
   with a reason remains the technician's way out, and opens a Tasks row.
7. **Guarantee:** `guarantee_days` (14) in Settings · Rules; a fit claim inside it opens a Tasks row.
8. **Second check-in (C13):** unchanged.
9. **Package change after the order:** nobody pays. The ordered hair system becomes stock.
10. **Ratings:** kept, in `visit_ratings`, and shown to the technician as their quality figure.
11. **Corners:** the client app keeps its current corners, which are square (`--ui-radius-button: 0`,
    `--ui-radius-box: 0`). Circles stay only where the app draws them today.
12. **Payments:** Razorpay is live and is the only way to pay (section 10).

## 9. What the build keeps that the prototype does not draw

`being_booked` (a paid hold still booking, ADR 0068), `payment_owed` (the one visit's texted link), `remake`
(ADR 0192), `pending_invite`, `invoice` prompt, discount codes on a hold (`CodeBox`), the address step before any
start (ADR 0079), consents given by booking (ADR 0080), number change, sessions, data export, deletion,
grievances, try-on looks kept in Photos (ADR 0084), the referral tracker and its opening at the first
consultation (ADR 0218), the reading of past `pay_at_visit` holds and `upi:` payments (ADR 0209, history only), and the five tabs collapsing to four only once
Payments and Refer have their new homes (Profile and Rewards).

## 10. Razorpay, the only way to pay

The owner, 12 November 2026: Razorpay is live and will be the only way to pay. No other payment flow.

| Path                                 | Today                                                                           | After                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Client books a paid visit in the app | Off in production (`SELF_SERVE_BOOKING: false`, `PAYMENTS_PROVIDER: none`)      | Razorpay Checkout on the hold, as staging does                                                    |
| Ops book a paid visit                | Booked unpaid, `pay_at_visit`, UPI to Mane Man's account at the door (ADR 0209) | A Razorpay payment link (ADR 0105's path); the visit holds until it is paid, as before ADR 0209   |
| One visit, consultation and fit      | Razorpay link after the fit, or UPI at the visit                                | Razorpay link only; the app shows it as `payment_owed` with a Pay button that opens the same link |
| Custom order                         | Razorpay link                                                                   | unchanged                                                                                         |
| Late fee, missed-visit charge        | Waived (set to Nothing: nothing prepaid to keep)                                | Kept from the Razorpay payment, as Settings · Rules say; ops choose the values                    |
| Refunds                              | Razorpay, or by bank for a `upi:` payment                                       | Razorpay only for new payments; past `upi:` payments still refund by bank                         |
| Technician                           | Never handles money                                                             | unchanged                                                                                         |

What goes: the `pay_at_visit` branch for new holds, the "UPI to record" Tasks queue once the last unpaid one is
recorded, the `visit_booked_at_visit_v1` message for new bookings, and every client-facing mention of paying at the
visit. What stays: the rows already written, their receipts, and the refusal `paid_by_upi` for refunds of them.
The startup guard refuses production with `PAYMENTS_PROVIDER` other than `razorpay`.

Owed before the first live payment (`docs/open-points.md`): live keys and webhook (items 5, 6), live capture
checked (item 154), payment links on the live account (item 166), Books naming the bank account for captures
(item 17), a kept charge's own invoice (item 16), and the CA's word on advances (item 9). Secrets
(`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`) are set by the owner with `wrangler secret put`; never in the repo.
