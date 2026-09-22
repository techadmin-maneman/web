# Prompt for the coding agent — Mane Man Phase 2 backend, rev 2

_Paste verbatim into the same repository as Phase 1. This extends `mm-api` for the Phase 2 designs:_
- _**Client App** (Phase 2, 1 of 4)_
- _**Referral card, landing page, waitlist** (2 of 4)_
- _the **Technician App** (3 of 4)_
- _the **Ops console** (4 of 4) in full: dispatch board (A), client page with pieces, photographs and consents (B), referrals and waitlist (C)_
- _the **Phase 2 Prototype**, for flows and timers_

_Rev 2 adds the technician app, the dispatch board and the pieces tab. **Zoho FSM remains the system of record for all field operations.** These surfaces are our own user interface over FSM: they read FSM's data and write every field action back to FSM. They hold no competing copy of the truth._

---

## Before you start

1. Read `docs/prompts/phase1-backend.md` (rev 4.1) and follow it unchanged in everything below. That covers:
   - the environments, CI/CD and engineering standards
   - the milestone and ADR workflow
   - the data-protection rules
   - the provider-adapter pattern
   - the rule that D1 owns every client-facing record under our own UUIDs

   This prompt adds to it. It does not relax it.
2. Read `docs/decisions/fsm-trial.md`, the outcome of the Zoho FSM trial. Where this prompt assumes an FSM capability the trial found missing, stop and write an ADR. The roadmap's fallbacks are:
   - our own availability logic when FSM exposes none by API
   - our own photo capture PWA when FSM fails the photo checks
3. The design files sit under `design/phase2/`. The spec boards (Client App, Referral and Waitlist, Ops console) are the source of truth for behaviour and copy. The Prototype shows flows and timers.

## Business rules, decided

Encode each rule once, in `src/policy/`, with a unit test that quotes it. Values marked *config* are environment variables because they are still open.

- **Login.** Open to any person with a booked consultation or any later appointment. No password.
- **One-time code.**
  - Six digits, sent on WhatsApp.
  - After 30 seconds the client may choose SMS instead.
  - Five wrong attempts void the code.
  - WhatsApp resend has a 30-second cooldown.
- **Prepayment.** Every visit is prepaid at booking. Technicians never handle money, and no amount to collect is ever sent to FSM.
- **Moving a visit.**
  - More than 24 hours before the window starts: moving or cancelling is free. The payment carries over, or is refunded to its source; a credit comes back.
  - Inside 24 hours:
    - a paid service visit is charged, and the new visit is paid separately
    - a credit booking loses the credit
    - a first fit costs a late fee of *config* `LATE_FEE_FIRST_FIT` (Rs. 4,000 in the design), with the balance carried over
    - a replacement's late fee is *config* `LATE_FEE_REPLACEMENT` (Rs. 3,000 in the design)
  - When ops move a visit, the client is never charged.
- **Prices.** Shown ex-GST as the main figure, with the GST-inclusive amount beside it. Prices come from a price book (below), never from design strings.
- **Referral reward.**
  - When a referred person's **first fit closes as done**, the referrer and the referred each get 3 service-visit credits.
  - There is no other discount for the referred person.
  - Credits are usable on any day.
  - Credits expire *config* `CREDIT_TTL_DAYS` after grant (365 by default; the design shows an expiry date of 3 Jan 2028).
- **Referral tracker.** The referrer sees completed fits only: first name and month. Never opens, consultations or pending referrals.
- **Invites.**
  - An invite to an unserved area stays valid *config* `INVITE_TTL_AFTER_LAUNCH_DAYS` (365) after that area goes live.
  - An expired invite still allows a free consultation, but carries no credits.
- **Fraud holds.** A grant is held for ops review when any of these is true:
  - the referrer and the referred share an address
  - they share a UPI handle or card fingerprint
  - the referrer passes *config* `REFERRAL_MONTHLY_CAP` (5) fits in a calendar month
  - the mobile numbers match

  Held grants appear in the review queue. Ops approve or reject each one.
- **Consents.** Each purpose carries its own date and can be switched by the client in the app. Ops can read them and never grant them. The purposes are:
  - photographs for the client's own record
  - photographs on referral cards
  - photographs in marketing
  - WhatsApp about visits
  - WhatsApp about launches
- **Account deletion.** Photographs deleted within 7 days (*config*); invoices kept 8 years (*config*). Both need counsel's sign-off before launch, and the design flags this.
- **Number change.**
  - A code goes to both numbers.
  - The change then waits for ops to confirm, and takes effect only after that confirmation.

## Technician app and dispatch — how they relate to FSM

**FSM owns** clients, appointments, assignments, technicians, job sheets, outcomes and assets (pieces). Our apps never become a second source of truth for any of these.

- **Reads come from the D1 mirror**, kept current by FSM webhooks and the nightly reconciliation. They do not go to FSM on every screen view, for four reasons:
  - the technician app must work offline
  - pages load faster
  - FSM's API has credit and concurrency limits [confirm in the trial findings]
  - the mirror is already required by the roadmap
- **Writes go to FSM first,** synchronously through `providers/fsm.ts`, and are applied to the mirror only after FSM accepts them. If FSM rejects a write, the user sees the rejection; nothing is written only locally.
  - This covers reassignment, moves, job start and close, checklist, consumables, outcome, piece fitted and failure reason.
  - The one exception is the technician app offline, below.
- **Offline writes from the technician app** are queued on the device with a client-generated ID, and sent in order when the phone is back online. The server makes each write idempotent on that ID before passing it to FSM.
  - If FSM has changed underneath (for example ops reassigned the job while the phone was offline), the write is rejected with `409 superseded`.
  - The technician sees what changed. Nothing is merged silently.
- **Photographs.**
  - Captured in our app, stored in `mm-{env}-client-photos`.
  - Also attached to the FSM job sheet, so FSM stays the complete record, if the trial confirmed an attachment API. If it did not, the FSM job carries a link to the photo set instead, recorded in an ADR.
- **Licensing: a gate before any build in this section.** Confirm in writing with Zoho that technicians and dispatchers working through our apps over the API are within FSM's licence terms, and whether each still needs an FSM user seat.
  - The roadmap's FSM cost model and its user caps (200 on Professional, 500 on Premium) assume seats.
  - Record the answer in `docs/decisions/fsm-licensing.md`. If Zoho says the usage breaches its terms, stop.

## Technician and dispatch rules, from the designs

- **Technician login.** Mobile number plus a one-time code, the same flow as clients but a separate role.
  - A technician is recognised only if FSM lists him as an active field technician.
  - His sessions are bound to a device and can be revoked by ops. Revoking also wipes the device's cached jobs on its next contact.
- **Jobs visible to the technician.**
  - Today's jobs in order; tomorrow collapsed.
  - Jobs further out show only time, type and sector. **The address, access notes and client card unlock the day before**, and the API enforces this, not just the screen.
- **No money anywhere in the technician app.** A job shows a *Prepaid* or *Credit* badge only, and no API response to a technician carries an amount.
- **Check-in.** *I have arrived* records the time and the device's position, and passes only within *config* `CHECKIN_RADIUS_M` (200 m) of the address.
  - Addresses are geocoded when a client address is created or edited, and the coordinates stored on `addresses`. Choose the geocoder in an ADR.
  - The 200 m radius is an open question in the design, given GPS error in Gurgaon high-rises. Log the measured distance on every check-in, so the value can be tuned from real data.
- **No-show.**
  - The wait timer starts at check-in and runs *config* `NO_SHOW_WAIT_MIN` (15) minutes.
  - *Close as no-show* is disabled until the timer ends.
  - Ops then receive three facts: check-in time, distance, and the delivery receipt of the day-before or arrival WhatsApp to the client (from the BSP's delivery webhook).
  - A no-show is charged under the 24-hour policy. The charge is applied by ops from the evidence, never automatically.
  - Whether the wait differs for a first fit is open, so make it *config* per visit type.
- **In-job steps, one screen each:**
  1. Five **before** photographs: front, top, left, right, hair.
  2. The service checklist. Six items for a service visit. The list is per visit type and lives in config, taken from the FSM job-sheet template.
  3. Consumables used, with quantities.
  4. The piece: replacement jobs only. Scan the label code (for example `MM-STD-4417-B`) or pick from the client's pieces in FSM.
  5. Five **after** photographs.
  6. Outcome: *Done*, or *Partial* with a reason.
- **Partial reasons.** Four in the design. The design says ops need the full set because these drive the task queue. Make the reasons an FSM-synced list and flag it in an ADR.
- **Duration** runs from *Start job* to the outcome. The technician never types a time.
- **Dispatch board.**
  - Rows are technicians; columns are seven days; each day has *config* `SLOTS_PER_DAY` (4) slots.
  - Blocks are sized in slots: consultation 1, service 1, replacement 1.5, first fit 2. Sizes come from the price book's visit types.
  - The unassigned tray shows each job's asked window and offered window.
  - **A technician cannot hold two live jobs in one window on one date.** This check runs on the server before any write to FSM.
  - A move requires a reason from the design's list (technician unavailable, client asked to move it, zone rebalance, skill needed · first-fit certified, running over on an earlier job). It then updates FSM and messages the client with the new window. **The client's payment carries over and he is never charged for a move ops make**, including inside 24 hours.
  - Each column head shows its utilisation, in per cent. This is the operating figure for the model's weekend-share assumption, so it is also written to `events` daily.
  - Leave periods come from FSM technician availability.
- **Windows against slots.** The client app offers three windows (9–12, 12–4, 4–8). The dispatch board has four slots a day. Define the mapping in *config* `WINDOW_SLOT_MAP` and record it in an ADR. The two designs do not agree, so the mapping must be explicit, not guessed.
- **Pieces tab.** For each piece: code, base, fitted date, supplier lot, replacement due date, and failure with reason, all from FSM assets. The replacement due date follows the per-base cycle config already defined in this prompt.

## Data model additions

Numbered migrations only. Every table keys on our UUID; FSM, Books and Razorpay IDs are foreign references.

- **FSM mirror** (roadmap Stage 3):
  - `appointments`: our id, `fsm_id`, `person_id`, `type` (consultation, first fit, service, replacement), `window_start`, `window_end`, `technician_id`, `status`, `payment_state`, `credit_ledger_id`, `address_id`, `client_note`.
  - `visits`: what was done, duration, outcome (done or partial with reason), piece used.
  - `technicians`: display name and initials only.
  - `pieces`: `piece_code`, base, fitted date, replacement-due date computed from *config* per-base cycles.
  - `addresses`: including access notes.
- **Photographs.** `photo_sets` (visit, before or after) and `photos` (angle: front, top, left, right, hair; `r2_key`, `width`, `height`, `taken_at`). Stored in a new bucket per environment, `mm-{env}-client-photos`, with **no lifecycle rule**. Deletion is only ever explicit and audited.
- **Money.**
  - `price_book`: item, tier, ex-GST amount, GST rate, `valid_from`. It is the only source of prices for the app and the referral page, and ops edit it through a migration or a script.
  - `payments`: Razorpay order, payment and refund IDs; amount; method; status; reference like `MM-2027-0841`.
  - `documents`: Books invoice and receipt PDFs, cached to `mm-{env}-client-docs` and retained 8 years.
- **Credits.** An append-only `credit_ledger` with kinds `grant`, `redeem`, `restore`, `expire`, `clawback` and `adjust`. Each entry has its source (a referral ID, an appointment ID or an ops user) and an expiry. The balance is computed; never store a mutable counter.
- **Holds.** `slot_holds`: appointment draft, window, technician, `expires_at` (600 seconds, as the prototype's countdown).
- **Referrals.**
  - `referral_codes`: **random, non-guessable, never derived from the phone number.** The design's `RM4417` reuses the last four digits of the client's number; build the code from initials plus random characters. Also holds the card state (house or personal) and the card version.
  - `referral_attributions`: code, referred person, first touch, consultation, first fit, grant state (pending, held, approved, rejected, granted, expired, clawed back), fraud signals.
- **Waitlist.**
  - `serviceable_pincodes`: pincode, area name, city, served, `launched_at`. Loaded from the India Post pincode directory with a script [confirm licence and source]. The Phase 1 `cities` table is derived from it.
  - `waitlist_entries`: pincode, person, referral code, contact consent, launch-alert consent.
- **Identity.**
  - `otp_challenges`: hashed code, channel, attempts, expiry.
  - `sessions`: device label, created, last seen, revoked.
  - `number_change_requests`: pending ops confirmation.
- **Field operations (mirror plus our own operational data):**
  - `technicians`: gains `fsm_id`, `active`, and `zone` from FSM.
  - `technician_devices`: device ID, session, `revoked_at`.
  - `checkins`: appointment, time, latitude, longitude, accuracy, distance in metres, passed.
  - `no_show_cases`: check-in, wait start and end, message delivery receipt, ops decision.
  - `job_events`: every in-job action with its client-generated ID, `fsm_write_state`, and `superseded` flag.
  - `consumables_used`.
  - `dispatch_moves`: from, to, reason, actor, the FSM write result, and the notification sent.
  - `addresses`: gains `lat`, `lng` and `geocoded_at`.
  - These are ours because FSM has no place for them, not because they compete with FSM. Everything FSM does hold is written to FSM.
- **Audit.** `audit_log`, append-only: staff photo views ("name, client and time are logged" in the Ops console B2), consent changes, number changes, deletions, credit adjustments and fraud decisions.

## Providers and integrations

Each is a new adapter with a stub, following Phase 1's pattern.

- **`providers/fsm.ts` (Zoho FSM).**
  - Build it from the FSM API documentation and the trial findings; invent no endpoints.
  - Covers:
    - clients, appointments, availability (if the trial confirmed it), notes, job-sheet outcomes, assets or pieces
    - photo export through the webhook the trial validated
    - the retainer invoice as the prepay record, as the roadmap sets out
  - A webhook receiver keeps the mirror current, verified by FSM's signature or a shared secret, idempotent on event ID.
  - A nightly reconciliation job compares the mirror with FSM and alerts on drift.
  - **Writes**, each confirmed against the FSM documentation and the trial org before use:
    - reassigning or rescheduling an appointment
    - starting and closing a job
    - job-sheet fields: checklist, consumables, outcome, partial reason, duration
    - asset updates for the piece fitted or failed
    - attaching photographs

    Every write carries our idempotency ID wherever FSM supports one. Where FSM does not, deduplicate on our side before sending.
- **`providers/geocode.ts`.** Address to coordinates; choose the provider in an ADR. It is called only when an address is created or edited, never per check-in.
- **`providers/books.ts` (Zoho Books).** Invoice and receipt retrieval as PDF, on the India data centre host. Documents still generating return the design's "Document unavailable" state, with a notify-me flag.
- **`providers/payments.ts` (Razorpay).**
  - Orders, Checkout (UPI and card), payment-captured and refund webhooks verified with the webhook secret, and refunds to source.
  - The UPI handle or card fingerprint from each payment feeds the fraud rules.
  - No card data ever touches our systems.
- **`providers/otp.ts`.**
  - WhatsApp through the BSP's authentication template.
  - SMS through a DLT-registered provider, using a template that ends with the WebOTP line `@app.maneman.in #<code>` so Android can read it automatically, as the design notes ("read automatically where your phone allows").
- **`providers/messaging.ts`.** Extended with the Phase 2 templates, each approved through the BSP:
  - consultation confirmation, day-before reminder and waitlist confirmation (worded as in the Referral design's B3)
  - payment receipt, reschedule and cancel confirmations
  - "your friend was fitted" to the referrer
  - the launch alert when a pincode goes live
  - number-change codes

## Endpoints

All client routes sit on `app.maneman.in/api/*`, behind the session cookie. The cookie is host-only, `HttpOnly`, `Secure`, `SameSite=Lax`, with a 90-day sliding expiry that is revocable. Referral routes sit on `maneman.in/api/r/*`. Ops routes sit on `ops.maneman.in/api/*` behind Cloudflare Access, and every call records the Access identity in the audit log.

**Identity:**
- `POST /auth/otp` with `{ mobile }`. Responds `404 not_recognised` when the number has no booking; the design's A3 screen shows that.
- `POST /auth/otp/sms`, available after 30 seconds.
- `POST /auth/verify`.
- `POST /auth/logout`.
- Rate limits per number and per IP; code lifetime of 10 minutes.

**Read endpoints:**
- `GET /me` for the Home card. It returns one of three states:
  - lead with a consultation
  - fitted with a next visit
  - nothing booked

  It also returns the credit balance with its earliest expiry, and the one contextual prompt (for example "replacement due in March", from the piece's due date).
- `GET /visits` (upcoming and past) and `GET /visits/:id`, which includes what was done, the duration, the technician and the photo set.
- `GET /photos` for the timeline, and `GET /photos/compare?from=&to=&angle=`. Both return signed URLs that expire in 15 minutes.
- `GET /payments` and `GET /payments/:id`. For a charge, the entry carries the design's evidence line ("cancelled 9:14 am, visit was 10 am"). For a refund, it carries the destination and the voucher.
- `GET /documents/:id`.

**Booking.** Every route here sits behind the `SELF_SERVE_BOOKING` flag.
- Endpoints:
  - `GET /availability?type=&from=`: 14 days of three windows (morning 9–12, afternoon 12–4, evening 4–8), each marked available or full, with the regular technician's availability flagged.
  - `POST /holds`: 600 seconds.
  - `POST /bookings`: pay, or apply a credit.
  - `POST /appointments/:id/reschedule`.
  - `POST /appointments/:id/cancel`.
  - `POST /appointments/:id/note`.
- Each mutating route returns the consequence **before** the client confirms. That is the design's rule ("the consequence shows before he confirms"), and it comes from `src/policy/`.
- When the flag is off, the booking, reschedule and cancel routes return `409 ops_assisted`. The app then opens WhatsApp to ops with a pre-filled message.
- The roadmap puts self-serve booking at seed. The flag lets the rest of Phase 2 ship first.

**Profile:**
- `GET /profile`.
- `PATCH /profile/address`.
- `PATCH /consents/:purpose`.
- `POST /number-change`.
- `POST /deletion-request`.

**Referrals (client):**
- `GET /refer`: code, balance, and the tracker of completed fits only.
- `POST /refer/card`: accepts the 1200×630 personal card, which the app composes in the browser from the client's first-fit before and after front photographs. Requires consent to photographs on referral cards. Validates the dimensions and stores the card under `mm-{env}-referral-cards`.
- `DELETE /refer/card`: the revoke. New opens show the house sample.

**Referral landing (public):**
- `GET /r/:code`: an HTML-level Open Graph response rendered by `mm-site`. It serves:
  - `og:image` pointing at `/og/:code.png?v=<card version>`. Versioning is what makes a revoke take effect on new shares, since WhatsApp caches previews by URL.
  - the referrer's first name, only while *config* `REFERRER_NAME_ON_INVITE` is on. The design leaves open whether naming him is acceptable.
- `GET /api/r/:code` returns the invite state: valid, expired or unknown.
- `GET /api/pincodes/:pin` returns served or not served, with the area name.
- `POST /api/r/:code/consultation` books a consultation. It uses the availability API when self-serve is on; otherwise it records the preferred date and window for ops to confirm.
- `POST /api/r/:code/waitlist`: contact consent is required, the launch-alert consent is optional.

**Ops:**
- Referral review queue: approve or reject, with the reason recorded.
- All referrers, with the internal funnel figures (sent, opens, consults, fits, granted, redeemed).
- Waitlist by pincode, with count, oldest entry, referral count and alert opt-ins.
- `POST /pincodes/:pin/launch`. It shows the number of people to be messaged, asks for confirmation, then queues the launch alerts to launch-consented entries only.
- Client lookup:
  - consents, read-only
  - a locked photograph view that writes the audit entry before returning any URL
  - number-change confirmations and deletion-request processing
  - a CSV import that back-fills referrals ops logged before January, into the ledger and attributions, as the roadmap commits

**Jobs:**
- Credit expiry, daily.
- The referral grant on a first fit closing as done: the fraud rules run first, then either the grant (plus a WhatsApp to the referrer) or a hold.
- A clawback if a granted first fit is later refunded under the guarantee.
- Slot-hold expiry.
- FSM reconciliation.
- The photo-export retry.
- Deletion within the retention window.
- Document-ready notifications.

**Technician** (`tech.maneman.in/api/*`, technician session):
- `POST /tech/auth/otp` and `POST /tech/auth/verify`.
- `GET /tech/jobs?date=` for today and tomorrow. Later dates return time, type and sector only.
- `GET /tech/jobs/:id`, which respects the day-before unlock.
- `POST /tech/jobs/:id/checkin` with position and accuracy. The response states pass or fail with the distance.
- `POST /tech/jobs/:id/start`.
- `POST /tech/jobs/:id/photos/upload-url` for each angle and phase, then `POST /tech/jobs/:id/photos` to confirm.
- `POST /tech/jobs/:id/checklist`, `/consumables`, `/piece` and `/outcome`.
- `POST /tech/jobs/:id/no-show`, which is refused before the wait ends.
- `GET /tech/pieces/lookup?code=`.
- Every write accepts the client-generated `X-Client-Event-Id`, which is idempotent.

**Dispatch and pieces** (ops):
- `GET /dispatch?from=&city=` returns the grid, blocks, unassigned tray, leave and per-day utilisation.
- `POST /dispatch/assign` and `POST /dispatch/move` both take a reason. Each runs the clash check, writes to FSM, then messages the client.
- `GET /clients/:id/pieces`.
- `GET /no-shows` and `POST /no-shows/:id/decision`, for ops to charge or waive from the evidence.
- `POST /technicians/:id/devices/:device/revoke`.

## Milestones and definition of done

**P2-M1 — Identity and profile.** OTP on both channels, sessions, eligibility, profile, consents, number change, deletion request, audit log. Staging proof:
- a login by WhatsApp code and one by SMS fallback
- the fifth wrong code voids the challenge
- an unknown number gets `not_recognised`

**P2-M2 — Mirror and read surfaces.** The FSM adapter, webhooks, nightly reconciliation, photo export into R2, Books documents, and the payments mirror from Razorpay webhooks. Staging proof:
- a staff-run job in the FSM trial org appears in `/visits` with its five-angle before-and-after set
- the invoice PDF opens
- a deliberately broken webhook is repaired by the nightly reconciliation

This is the roadmap's December scope.

**P2-M3 — Referral and waitlist.** Codes, the card upload and revoke, versioned Open Graph images, the landing APIs, attribution, the first-fit grant, fraud holds and review, the back-fill import, and the pincode launch. Staging proof:
- a referred consultation leads to a first fit that closes as done
- both people are credited and the referrer is messaged
- a same-address pair lands in review
- after a revoke, a fresh share shows the house card

This is the roadmap's January scope.

**P2-M4 — Field operations over FSM.** Licensing answer recorded first. Then:
- the FSM write paths
- technician identity and devices
- jobs with the day-before unlock
- check-in with the geofence
- in-job steps with photo upload to R2 and FSM
- the offline write queue with supersede handling
- no-show evidence
- the dispatch grid, assign and move with the clash check, reasons and client message
- the pieces tab
- the utilisation events

Staging proof, against the FSM trial org:
- A service job run end to end in the app shows its outcome, checklist, duration and both photo sets in FSM's own web console.
- An offline close-out replays correctly once the phone reconnects.
- A job reassigned while the phone was offline is rejected as superseded.
- A move by ops messages the client and does not charge him.
- A same-window double booking is refused.

**Rollout.** At the November launch, technicians use FSM's native app, as the roadmap plans. When this milestone passes, two technicians run our app in parallel for two weeks against the same FSM records, then everyone cuts over. Both apps write to the same FSM data, so running them in parallel is safe.

**P2-M5 — Self-serve booking and money,** behind the flag: availability (computed with the same clash rule and window-to-slot mapping as dispatch, from the P2-M4 code), holds, Razorpay checkout, credit redemption, reschedule and cancel under the 24-hour policy, refunds, and late fees. Staging proof covers each consequence in design screens C4 to C8:
- payment failed
- hold expired
- a move outside 24 hours carries the payment over
- a cancel inside 24 hours loses the credit
- a first-fit move inside 24 hours charges the late fee and carries the balance

**P2-M6 — DPDP readiness** (roadmap Stage 4, before 14 May 2027): access and deletion requests end to end, retention jobs verified, and a breach runbook.

## Provision before each milestone

| Milestone | Needs |
|---|---|
| P2-M1 | BSP authentication template approved; DLT entity, header and OTP template registered with the WebOTP line; `app.maneman.in` and `ops.maneman.in` DNS records, with Access on `ops` |
| P2-M2 | FSM trial findings written up; FSM and Books API credentials (India data centre) for staging and production; `mm-{env}-client-photos` and `mm-{env}-client-docs` buckets with **no** lifecycle rule; Razorpay test keys and webhook secret |
| P2-M3 | `mm-{env}-referral-cards` bucket; the pincode dataset; the referral and launch templates approved; ops' referral CSV |
| P2-M4 | The Zoho licensing answer in writing; FSM write-scope API credentials; the job-sheet template with checklist, consumables and full partial-reason lists; piece label format and whether labels carry a barcode or QR code; the geocoder choice; `tech.maneman.in` DNS; company Android phones for technicians (strongly preferred: PWA storage on iOS can be evicted, and the design depends on offline storage) |
| P2-M5 | Razorpay live keys; confirmed late-fee values; the refund route checked against Razorpay; the decision to switch on `SELF_SERVE_BOOKING` |

## Out of scope

- Replacing FSM as system of record for anything. If a feature needs data FSM cannot hold, it goes in our own tables as operational data. It does not become a parallel record of the job.
- Any UI; the front-end prompt owns it.
- Photographs in marketing: the consent is recorded, and nothing uses it.
