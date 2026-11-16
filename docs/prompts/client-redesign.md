# Redesign the Mane Man client app, with the changes it needs in the API, the technician app and the console

You are redesigning the client app (`apps/app`, `mm-app`) so it looks and behaves like the approved prototype, and
building the backend, technician-app and console changes the redesign depends on. Unlike the technician redesign,
this is not front-end only: section "Work items" lists every change outside `apps/app`, each with its migration,
ADR and tests. Keep every other backend call, data contract and business rule. Where the design needs data this
brief does not cover, build against a typed adapter with a mock and list the gap in your report. Do not invent
endpoints silently.

## Inputs

1. `design/client-redesign/Client App.prototype.html`: the approved prototype, revision 5, clickable at 390 px.
   The panel on its right is not part of the app. It switches the signed-in client (signed out, consultation
   booked, consulted with the hair system in stock, consulted with a made-to-order hair system, first-fit day,
   fitted, replacement due, live visit), fires the events the other two apps cause (on the way, running late, at
   the gate, checked in, step, sign-off asked, done, partly done, missed visit, technician swap, ops move proposal,
   ops cancel), forces rare states (offline, hold running out, inside the notice period, invite link failing,
   loading, errors) and edits the console values the app reads. Source of truth for look and behaviour; where it
   and this brief disagree, the prototype wins on look and the brief wins on rules.
2. `docs/client-redesign/SYNC-AUDIT.md`: how the redesign fits the console and the technician app, conflicts C1 to
   C14, gaps G1 to G6, the sign-off design, one visit seen from all three apps, and the owner's rulings
   (section 8) and Razorpay-only rules (section 10). Read it in full before Step 0. It is binding.
3. The current app's screenshots (`4-client-app/01` to `39`, plus the site's booking and invite pages), which define
   the states that must survive.

## The owner's rulings (12 November 2026)

These override anything older in the prototype, the audit's recommendations or the code.

1. **Replacement only when the hair system ends.** `replacement` is offered from the first day of the month the
   hair system falls due (within `booking_days.horizon`), or while a remake or recall owes one. Never otherwise.
   "Or book a replacement" goes from Home and Visits.
2. **Change of hair system at the replacement booking.** The client picks keep, upgrade, downgrade or switch while
   booking the replacement. No notice is owed and nothing is asked in advance. The hair system already ordered for
   the old package goes back to stock for other clients; nobody pays for it.
3. **The technician's live updates reach the app**: on the way, running late, at the gate, checked in, step n of N,
   sign-off asked, done. In-app alerts and web push for clients.
4. **No Words-page keys for the app.** Client copy stays in `apps/app/src/content*`.
5. **A technician swap stays silent** (ADR 0115).
6. **Sign-off is required to close a fit**: first fit, one visit's fit, replacement. "Client declined to sign" with
   a reason is the technician's only way out, and it opens a Tasks row.
7. **14-day fit guarantee** as a setting, `guarantee_days`, with a claim that opens a Tasks row.
8. **Second check-in unchanged.**
9. **Ratings kept** and shown to the technician as their quality figure.
10. **Corners stay as the current client app draws them: square.** `--ui-radius-button: 0` and `--ui-radius-box: 0`
    in `packages/ui/base.css` stay 0 for the client app. Circles only where the app draws them today (radio dots,
    spinners) plus the before/after slider's knob. The prototype's revision 5 matches this.
11. **Razorpay is live and is the only way to pay.** No cash, no UPI to Mane Man's account, no pay-at-the-visit.
    Section "Razorpay only" below.

## Step 0: survey before you change anything

1. Read `docs/start-here.md`, `docs/glossary.md`, `docs/how-it-works/{booking,field,care,money}.md`,
   `docs/settings.md`, `docs/open-points.md`, every ADR the audit cites, and `.claude/rules/`.
2. Inventory `apps/app/src`: routes, screens, sheets, states, the API calls each makes (`apps/app/src/api.ts`,
   `api-schema.ts`), and how it builds and ships per environment.
3. Write `docs/client-redesign/PLAN.md`: the current screen and state inventory; a table mapping each current
   screen and state (the 39 screenshots and every state in code, including the ones the prototype does not draw,
   audit section 9) to its new screen; the work items below in build order; the backend gaps with their mocks.
   Write the ADRs this brief calls for (numbered from 0252) before the code they govern. Commit the plan, then build.

## Non-negotiables

- **Every number from the console.** Prices, GST, durations, notice hours, late charges, hold countdown and grace,
  start-time step and arrival window, same-day booking, wait at the door, dispute window, move-proposal hours,
  Care's hours and reply promise, referral reward, custom-order grace, guarantee days, service interval and
  hair-system life: all read from the API, which reads Settings · Rules and the price book (audit section 3). No
  figure in `apps/app` source, tests excepted. A grep for `Rs.` followed by a digit, and for hour or day counts in
  copy, must find only fixtures.
- **Design system.** The prototype's tokens, in a client look file (`apps/app/src/styles/look.css`) setting the
  shared `packages/ui` variables, as `apps/tech/src/styles/look.css` does for the technician app. No other colours,
  fonts, radii or shadows. Corners 0 (ruling 10). Separate content with whitespace, 1 px hairlines and a 2 px navy
  rule above section titles; no bordered cards as containers except the tier choices and the sign-off panel as
  drawn. Sentence case. No uppercase letter-spaced labels.
- **Gold has one job**: the one most important thing on a screen (next visit's action, the live progress, the
  hair-system age bar). Never decoration.
- **Logo**: the drawn lockup from `design/brand`, never typed.
- **Copy** follows `docs/glossary.md` and the prototype: "hair system" (never "piece" or "unit"), "visit" (never
  "booking" as a noun), "missed visit" (never "no-show" or "not home"), "free service visit", "the Mane Man example
  card", "Rs. 2,360". Times of day as Morning, Afternoon, Evening. Buttons are verbs. A disabled button shows one
  line saying what is missing. Who comes is never promised before the reminder.
- **Every current state survives**, including those in audit section 9: `being_booked`, `payment_owed`, `remake`,
  `pending_invite`, the invoice prompt, discount codes on a hold, the address step before any start, consents given
  by booking, number change, sessions, data export, deletion, grievances, try-on looks in Photos, the referral
  tracker opening at the first consultation.
- **Accessibility**: 4.5:1 text contrast, 44 × 44 px targets, real buttons, links, inputs and labels, `aria-label`
  on icon-only buttons, `aria-live` for toasts and the live visit card, `prefers-reduced-motion` respected, nothing
  under 13 px, layout intact at 360 px and with text at 130%.

## Design tokens

| Token | Value | Use |
|---|---|---|
| `navy` | `#16233A` | Primary buttons, titles, section rules, selected states, the next-visit card |
| `navy-800` | `#1F2E49` | Messages on navy |
| `navy-700` | `#33435F` | Hairlines and tracks on navy |
| `gold` | `#C9A363` | The one highlight on navy |
| `brass` | `#B98B45` | The one highlight on white, counts |
| `gold-700` | `#8A6A2F` | Highlight text on white |
| `white` | `#FDFDFB` | Every screen's ground |
| `wash` | `#F4F0E8` | One highlighted row or note (the change-of-hair-system note) |
| `line` | `#D9DCE1` | Hairlines, input borders |
| `grid` | `#E8EAED` | Tracks, skeletons |
| `ink` | `#1F2328` | Body text, toasts |
| `ink-500` | `#5F6670` | Secondary text |
| `slate` | `#6B7A93` | Icons in rows |
| `stone` | `#B4BAC3` | Unselected radio and checkbox borders |
| `mist` | `#A9B2C1` | Secondary text on navy |
| `placeholder` | `#ECEEF1` | Image placeholders |
| `red` / `red-wash` | `#A3361F` / `#FBF1EE` | Errors, missed visit, late-change warnings |
| `green` | `#2F6B4F` | Paid, signed off, refunded |

- **Type**: IBM Plex Sans 400/500/600, self-hosted from the technician app's files; tabular figures for every
  amount, date and count in a row. Title 26/600, section 17/600, row 16/500, body 15–16/400, meta 13–14.
- **Radius**: 0 everywhere, circles as ruling 10.
- **Spacing**: 20 px side padding, 8 px grid, primary button 52 px, bottom action bar with 12 px top padding and the
  safe area below.
- **Motion**: screen 180 ms fade and slide, sheets 220 ms, the push banner 260 ms drop, toasts 160 ms fade; none
  under reduced motion.

## Information architecture

Four tabs: **Home, Visits, Photos, Rewards**. Payments and invoices, address, account, privacy, sessions and
deletion move under the profile (initials, top right). The bell (top right) opens the alerts inbox. Map every
current route, `/payments` and `/refer` included, to its new place with a redirect, so links in sent messages keep
working. The five tabs become four only when Payments and Refer have their new homes in the same release.

## Screens

Build each as the prototype draws it, in every state its scenarios show. Rules that are not visible:

- **Sign in**: WhatsApp code, as today; "Book a free consultation" for a new number.
- **Home**:
  - next visit card (consultation, first fit, service, replacement), with the live states of a visit day:
    on the way, running late by N minutes, at the gate, at your door until (the booked start plus
    `no_show_wait_min`), step n of N with the step's name, sign-off, done;
  - the sign-off card (work item W4);
  - "Your hair system": package, month n of N from `replace_after_months`, the date its replacement becomes
    bookable, and "Book your replacement" once it is (ruling 1);
  - after a consultation: the first-fit path, in stock (book and pay) or made to order (pay, being made, arrived,
    book), from `/api/me/custom-orders`;
  - remake, proposed move, `payment_owed`, open issue, free service visits, last visit.
- **Booking**: kind, then hair system (replacement only), then day and start time, then review and pay:
  - start times every `booking_rules.step` with taken ones struck through and an arrival window of
    `booking_rules.arrival` (ADR 0210);
  - the hold countdown from `Hold.expires_at` and its grace;
  - Razorpay Checkout; failure, pending and hold-expired states as drawn; confirmation.
  - For a replacement, the tier step marks each package Keep it, Upgrade, Downgrade or Switch. A change shows the
    new replacement and service prices and lifespan from the price book. Where the new hair system is not in
    stock in the client's size, start times open only from its promised date, and the note says so. It never asks
    the client to pay for the hair system set aside for the old package.
- **Visits**: upcoming and past; a past visit shows outcome, photos, technician, sign-off and its time, the
  guarantee date for a first fit with "The fit isn't right" inside it, rating, invoice. A missed visit shows the
  wait, the charge as Settings · Rules set it, and "Dispute this charge" until `dispute_until`. Issues list here too
  (work item W6).
- **Change or cancel**: free until `free_until`; inside the notice period the late charge by kind, as today's
  `MoveTerms` and `CancelTerms` say.
- **Raise an issue**: category, about which visit or hair system, text, up to 3 photos; the issue's timeline.
- **Photos**: timeline, before and after slider, download, try-on looks.
- **Rewards**: free service visits and expiry, invite link and card choice, who you invited, switch off the photo
  card.
- **Profile**: payments and invoices with Razorpay method and payment ID, refunds, address, account, privacy and
  consents, sessions, data export, deletion.
- **Alerts inbox**: every client alert, newest first, unread marked, each opening its screen.
- **Compare the four hair systems**, from the price book.

## Work items outside `apps/app`

Each is its own commit series, with the ADR, migration and tests named. Migrations from `0210`. Read the files the
audit cites before changing them.

- **W1. Replacement only when due** (C1). `allowedTypes` in `src/domain/booking/availability.ts` offers
  `replacement` only within the due month's window or when a remake or recall owes one; the booking routes refuse it
  otherwise with `not_bookable`. Remove "Or book a replacement" (`BookNext.tsx`, `HomeScreen.tsx`). Tests in
  `test/worker/booking/`: before the window, on its first day, a remake owed, a recall owed.
- **W2. Change of hair system at booking** (C2). `codeFor` in `src/domain/purchasing/stock-demand.ts` takes the
  booked tier for a replacement, as for a first fit. Kits and `stock_at_risk` follow the booking. When the booked
  package differs from the hair system the `replacement_order` task ordered or set aside, the task closes as
  "returned to stock" and that hair system becomes ordinary stock; nothing is charged. A package with no stock in the
  client's size raises the order on the booking (ADR 0174 path) at no extra charge, and availability opens from
  its promised date. `people.package` moves on booking as ADR 0211 says. ADR: "Changing hair system at the
  replacement booking". Tests: demand by booked tier; task closes and stock returns; start times gated by the
  promised date.
- **W3. Live visit on the client API** (C3). Add to `VisitSummary` and `VisitDetail`:
  `latest_update {kind: on_the_way | running_late | at_the_gate, minutes, at}` from `technician_updates`;
  `step {index, of, name}` from the last `job_events` row and the plan in `apps/tech/src/visit/engine.ts` (move the
  plan's step names to a shared module both read); `waits_until` while `arrived`. Public-safe only: no location,
  no phone. Regenerate `docs/openapi-client.json` and `apps/app/src/api-schema.ts`. Tests per plan.
- **W4. Sign-off** (audit section 5, ruling 6).
  - **Storage.** Table `fit_sign_offs (appointment_id, state: asked | signed | flagged | declined, checks, flag_text,
    declined_reason, asked_at, signed_at, signed_on: client_app | technician_phone)`. Not a new `job_events` kind.
  - **API.** `POST /api/tech/jobs/{id}/sign-off-request` asks. `POST /api/visits/{id}/sign-off` lets the client sign
    or flag (checks: hairline, colour and blend, secure and comfortable). `POST /api/tech/jobs/{id}/sign-off-declined`
    takes a reason. A one-time code lets a client without their phone sign on the technician's.
  - **Technician app.** A Sign-off step in the first-fit, one-visit and replacement plans, after the after photos
    and before Outcome. It waits for the client, shows a flag with its text, offers "Sign on this phone" and
    "Client declined to sign". It works offline and syncs, and has Hindi strings. Outcome "Done" stays disabled,
    with the helper line "Waiting for sign-off", until the state is `signed` or `declined`. Follow the technician
    redesign's tokens and rules, not the client's.
  - **Console.** The visit story shows the sign-off, its time and any flag; `declined` opens a Tasks row "Fit
    closed without sign-off".
  - **Terms.** The copy says signing off does not end the guarantee; counsel's wording is an open point, not a
    blocker.
  - ADR "The client signs off the fit". Tests: Done refused without sign-off; each state; the offline replay.
- **W5. Client alerts and web push** (C4, ruling 3).
  - `client_alerts` written beside each outbound message of a kind in `MESSAGE_KINDS` that concerns a client, and
    beside each live event of W3 and W4, whether or not WhatsApp is on. `GET /api/me/alerts` and
    `POST /api/me/alerts/read`.
  - `client_push_subscriptions` keyed to client sessions; the payloadless VAPID push of ADR 0250, reusing
    `src/providers/web-push.ts`. Ask permission only after the first visit is booked, from a row on Home, never on
    load.
  - A technician swap writes no alert (ruling 5).
  - ADR "Client alerts and push". Tests: one alert per event, idempotent; a revoked session's subscription dropped.
- **W6. The issue log** (G1). `GET /api/me/problems` reads each report with its state from the rows that exist
  (Care thread open or closed, City matter, remedy, Care's replies). Widen `PROBLEM_ABOUT` to the prototype's
  categories, mapped to Care's closure reasons. Up to 3 photos through the app's photo upload into the report's
  thread. Grievances and missed-visit disputes list in the same log. Keep the 5-a-day limit.
- **W7. Fit guarantee** (G6, ruling 7). `guarantee_days` (default 14) in Settings · Rules, with the console's
  editor, read by the terms page, `/api/me`, the sign-off copy and the visit screen. A "The fit isn't right" report
  on a first fit inside the window opens a Tasks row "Fit guarantee claim" with an SLA from `task_sla_hours`,
  carrying the sign-off and the photos. ADR amending the terms' 14 days into a setting.
- **W8. Ratings** (ruling 9). `visit_ratings (appointment_id, stars, at)`, one per closed visit, by
  `POST /api/visits/{id}/rating`. A rating under 4 opens a Care task. `src/domain/field/quality.ts` adds the
  technician's average and count over the last 90 days to the figure the technician app's Me shows.
- **W9. Values on the client API** (audit section 3): `care_hours` on `/api/me`, `dispute_until` on `NoShowNote`,
  `refundable_after` on custom orders, `guarantee_until` on a first fit's visit.
- **W10. Toasts** (audit section 7). `packages/ui/Toast.tsx` gains a `fullWidth` variant with a leading icon: ink
  `#1F2328`, white words, 12 px from each side, above the tab bar or action bar, 160 ms fade, 2.6 s, square corners
  in the client app. Toasts only for what the client just did; news arrives as the push banner and an inbox row;
  errors stay inline (`InlineMessage`). One toast library, no second one in the app.

## Razorpay only

The owner, 12 November 2026: Razorpay is live and is the only way to pay. Audit section 10 is the table of paths.

1. **Configuration, one PR, owner-approved:**
   - `env.production.vars`: `PAYMENTS_PROVIDER: "razorpay"`, `RAZORPAY_KEY_ID` the live key the owner gives
     (public, so it goes in `wrangler.jsonc`), `SELF_SERVE_BOOKING: "true"`.
   - `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` are set by the owner with
     `wrangler secret put --env production`. Never ask for them in chat, never write them to a file, a commit, a log
     or a test. If one appears in a commit, follow `.claude/rules/review-before-push.md`: rebuild the branch without
     it and have it rotated.
   - Staging stays on test keys. `src/config/settings-sections.ts` already refuses a live key outside production and
     a test key in it; keep those checks.
2. **Guard.** The startup guard refuses production with `PAYMENTS_PROVIDER` other than `razorpay`, and refuses
   `SELF_SERVE_BOOKING: "false"` there unless an `OUTAGE_REQUESTS_ONLY` var is set. That var is for an outage only:
   requests ops confirm, still paid by Razorpay link.
3. **Ops booking a paid visit** sends a Razorpay payment link (`src/domain/money/payment-links.ts`), as before ADR
   0209. The visit is held until `payment_link.paid`, on the hold's own countdown. The client app shows it as
   `payment_owed` with a Pay button opening the same link.
4. **Retire pay-at-the-visit for new visits.**
   - No new hold is marked `pay_at_visit`.
   - `visit_booked_at_visit_v1` is no longer queued.
   - The client app, technician app (`apps/tech/src/content.ts:537`) and console drop every "pay by UPI at the
     visit" line for new visits.
   - "UPI to record" (`upi_due`) stays only until the last unpaid such visit is recorded, then goes in a later PR.
   - Rows already written, their receipts, the `upi:` payments and the `paid_by_upi` refund refusal stay, read-only.
   - ADR "Razorpay is the only way to pay", superseding 0209's booking path.
5. **The client app** offers Razorpay Checkout for every payment in the app, and the Razorpay link for a one visit
   and a custom order. Copy: "Every payment goes through Razorpay: in the app when you book, or by a Razorpay link we
   text you. Technicians never take cash or UPI." No other method, no "pay later", no cash on delivery.
6. **Charges come back.** Late-change and missed-visit charges were set to Nothing because nothing was prepaid. Do
   not change their values: they are ops' to set in Settings · Rules. Make sure the app shows whatever is set, and
   flag in the report that the owner should review them.
7. **Before the first live payment**, `docs/open-points.md` items 5, 6, 9, 16, 17, 154 and 166 stand. Do the code
   ones:
   - item 17: `recordPayment` names the bank account;
   - item 16: a kept charge's own invoice in the Books pass;
   - item 154: `createOrder` sets capture itself, or a test proves live auto-capture is configured.
   List the owner's ones (live KYC, live webhook with the nine events, payment links on the live account, the CA's
   word on advances) in the report. `docs/go-live.md`'s "whole payment path" walk runs on staging before the
   production PR merges.
8. Tests: the guard; ops booking sends a link and no `pay_at_visit`; webhook paths for Checkout and link
   (captured, failed, pending, late webhook after hold expiry keeps the paid hold per ADR 0068); refunds of a
   Razorpay payment and refusal for a `upi:` one.

## Delivery

1. Step 0, then `PLAN.md` and the ADRs, committed.
2. Build in this order, one PR each, nothing pushed before its review:
   1. client look file, tokens, fonts, `Toast` variant (W10)
   2. shell, tabs, profile, redirects
   3. Home and the next-visit card without live states
   4. booking and Razorpay Checkout, change and cancel
   5. W1 and W2, with the replacement flow
   6. W9 and the custom-order and one-visit paths
   7. W3 and the live card
   8. W4 across all three apps
   9. W5 alerts, push and the inbox
   10. W6 and W7, issues and the guarantee
   11. W8 ratings
   12. Photos and Rewards
   13. Razorpay-only configuration and retirement of pay-at-the-visit (owner merges)
   14. states, offline, errors, 360 px and large-text pass
3. **Every PR follows `.claude/rules/review-before-push.md` exactly:**
   - commit;
   - screenshot every touched screen at 360 and 390 px, the technician app's also at 130% text;
   - spawn `ui-guard`, `security-reviewer` and `reviewer` in parallel, each given the checks run since the last edit
     with commands and result lines;
   - fix CHANGES REQUIRED and FAIL;
   - record each verdict with `node .claude/hooks/review-gate.mjs record`, as the reviewer gave it and with its key;
   - `git fetch origin`, then push.
   Never `--no-verify`, never another hooks path, never a PASS a reviewer did not give. Install the gate in each
   checkout first. Tell `reviewer` this brief and `PLAN.md` are the brief and plan; tell `ui-guard` the prototype is
   the design file.
4. Run the existing suites and add the tests each work item names. `docs/openapi-client.json` and the apps'
   `api-schema.ts` regenerated in the PR that changes the API.
5. **Final report** in `docs/client-redesign/REPORT.md`:
   - the old-to-new state mapping, each marked done;
   - each work item done or not, with its PRs;
   - backend gaps and their mocks;
   - anything not matched to the prototype, and why;
   - the owner's open items from "Razorpay only", step 7, and the charges to review.

## Acceptance

- Each screen matches the prototype at 390 px in layout, tokens and copy, with square corners, and holds at 360 px
  and at 130% text.
- Every state in the screenshots and in audit section 9 is reachable and in the mapping.
- No price, duration or rule value in `apps/app` source; changing one in Settings · Rules changes the app without
  a release.
- A replacement cannot be booked before its window, by the app or the API; a package change at booking is stocked
  as booked, and the set-aside hair system returns to stock with no charge.
- A fit cannot be closed without a sign-off or a recorded decline; ops see both.
- The live card and push follow a visit from on the way to done in staging, with WhatsApp on and with it off.
- In production configuration, no payment path exists outside Razorpay: the guard proves it, and a search of all
  three apps for pay-at-the-visit copy finds only history views.
- All three reviewers PASS on every PR.
