# Client app redesign: the plan

The brief is `docs/prompts/client-redesign.md` (12 November 2026). The prototype, revision 5, is kept read-only in
`design/client-redesign/`. How the redesign fits the console and the technician app, and the owner's rulings, are in
`SYNC-AUDIT.md` beside this file, which is binding. This file is Step 0: the app as it stands, the decisions, every
current state and where it goes, the work in build order, the gaps, and the PRs. The owner asked for the fewest PRs
(12 November), which section 2 settles.

## 1. The app as it stands

|              |                                                                                                                                                                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where        | `apps/app` (`mm-app`), served by the Worker on the client host                                                                                                                                                                    |
| Framework    | React 19, Vite, TypeScript strict. `src/main.tsx` → `src/App.tsx`; the session is the API's (HttpOnly cookie), a 401 anywhere ends it                                                                                             |
| Routing      | The shared router (`packages/ui/router.tsx`); `src/route.ts` maps 11 paths. Five tabs: Home, Visits, Photos, Payments, Refer. Profile under none                                                                                  |
| Styling      | CSS modules over `packages/brand/tokens.css` and `tokens-apps.css`; Instrument Sans and EB Garamond; ink ground for the login, paper once in. Corners already square (`--ui-radius-button: 0`, `--ui-radius-box: 0`)              |
| Words        | `src/content.ts` and `src/content/*.ts` (1,427 lines). No Words-page keys (ruling 4)                                                                                                                                              |
| Backend      | `src/api.ts` over the shared client, typed from `src/api-schema.ts` (`npm run openapi`). About 45 calls; the server side is `src/routes/client/*` (21 files)                                                                      |
| Offline      | The service worker keeps the last Home (`keptHome`) and the lazily loaded screens; offline Home shows the kept one with a note                                                                                                    |
| Build        | `npm run build:app -- --env local\|staging\|production`, shipped with the Worker; production released weekly                                                                                                                      |
| Tests        | 25 Playwright specs in `e2e/app`, 10 Node tests in `test/node/apps/app` (tokens, contrast, copy, booking flow, PWA, headers), worker tests for every client route                                                                 |
| Config today | Production and staging both run `PAYMENTS_PROVIDER: "none"` and `SELF_SERVE_BOOKING: "false"`: consultations book themselves, paid visits are booked by ops and paid by UPI at the visit (ADR 0209). Local runs the stub provider |

## 2. Decisions

1. **Two PRs, not fourteen.** The brief's fourteen steps become commit series on one branch.
   - **PR A, the redesign.** Everything except production's switch. This covers the plan and ADRs, the look, every
     screen and W1 to W10. It also covers the Razorpay code the app needs (Checkout everywhere, the link for a one
     visit and a custom order, open points 16, 17 and 154), and staging on Razorpay's test keys. Built in the brief's
     order, pushed once.
   - **PR B, production pays only through Razorpay. The owner merges it.** It sets `env.production`'s vars (the live
     key, `PAYMENTS_PROVIDER: "razorpay"`, `SELF_SERVE_BOOKING: "true"`) and adds the startup guard with
     `OUTAGE_REQUESTS_ONLY`. It also retires pay-at-the-visit for new visits: no new `pay_at_visit` hold, no
     `visit_booked_at_visit_v1`, and the "pay by UPI at the visit" lines go from the technician app and the console.
   - **Why not one.** The guard refuses production without Razorpay. Without pay-at-the-visit, production would have
     no way to take a paid visit. So both must ship with the live key and its two secrets, which wait on the owner:
     live KYC, the secrets, the live webhook, payment links on the live account and the CA's word on advances. As one
     PR, the whole redesign would wait on them. If they are ready when A is, B folds into A.
   - **What production shows between A and B.** The new app in request mode, which the prototype draws ("Ask for a
     time"). Visits already booked to be paid at the visit keep their line ("Pay Rs. N by UPI at the visit"), as
     ADR 0209's rows stay.
   - **Not in this plan.** Retiring "UPI to record" (`upi_due`) waits until production has no unpaid visit of that
     kind (brief, Razorpay only, 4). It is a one-file PR then.
2. **Reviews in rounds as A grows.** No reviewer reads all of A at once. The three reviewers run at four points:
   - after the shell and Home;
   - after booking and the replacement;
   - after the live card, sign-off and alerts;
   - at the end.

   Each round after the first is the rule's second look: told the commit it last reviewed, a reviewer reads what
   changed since. Only the last round's verdicts are recorded, against the key of the change pushed. Nothing is
   committed while a round reads.

3. **Staging moves to Razorpay test mode in A.** `PAYMENTS_PROVIDER: "razorpay"` and `SELF_SERVE_BOOKING: "true"` on
   staging, with the test key and secrets staging already holds (checked by name before the change). Checkout, links,
   webhooks and the brief's staging acceptance need it. Ops' paid bookings on staging then go out as test payment
   links, as ADR 0209 says they will once a provider is on.
4. **One look, switched at once.** With one PR, the whole app takes the new look together.
   - `apps/app/src/styles/look.css` sets the shared `--ui-*` roles from the brief's tokens, as
     `apps/tech/src/styles/look.css` does.
   - New colours go into `packages/brand/tokens.css` under their brief names where they are not brand colours already.
     `navy` is `--ink` (#16233A) and `brass` is `--brass` (#B98B45), as in the technician plan.
   - The token guard and a client contrast test hold the pairs to 4.5:1.
   - IBM Plex Sans comes from `packages/brand/fonts-plex.css`. The app's Instrument Sans and EB Garamond go.
   - The logo is `packages/ui/Mark.tsx` with `packages/brand/marks.ts`.
5. **One component library.** Every new part goes into `packages/ui`.
   - Reused from the technician redesign where they exist: section head with its 2 px rule, key and value row, radio
     row, segmented control, step progress, action bar, phone-style banner, date strip, Sheet, ConfirmSheet,
     InlineMessage, Toast.
   - Added: top bar with initials and bell, start-time grid with taken starts struck through, hold countdown, tier
     choice, before and after slider, star rating, timeline (issues), alert row.
   - The architecture test that refuses raw controls in apps stays.
6. **Words from the prototype.** Words go into `src/content*`, following the glossary. A state the prototype does not
   draw keeps its current words, restyled.
7. **No figure in the source (brief, non-negotiables).** Every price, duration and rule value is read from the API.
   - Two kinds of day count in today's copy are the law's, not ops'. One is the 30 days for a grievance or a deletion
     request. The other is the 8 years invoices are kept.
   - Both come from the server's constants on `/api/me` (`legal {grievance_days, deletion_days, invoice_years}`), so
     the brief's grep finds only fixtures.
   - A Node test greps `apps/app/src` for `Rs.` followed by a digit, and for hour and day counts.
8. **Old screens go.** A deletes the old screens with their CSS and replaces the `e2e/app` specs with specs for the new
   screens. The site's booking and invite pages are not redesigned; their links into the app land on the new screens.
9. **Function names as they are.** The brief's `allowedTypes` is `bookableTypes` in
   `src/domain/booking/availability.ts`. Tasks rows are queue queries in `src/domain/ops/task-queues.ts`, so "opens a
   Tasks row" means a queue reading the new table.

## 3. Every current state, and where it goes

The 39 screens are `4-client-app/01` to `39` in `Downloads/maneman-client-app-screens-mobile-2026-11-02.zip`. The rows
marked "code" are states in the code that no screenshot shows (audit section 9 included). None is dropped.

### Sign in

| Current                                                                                                 | New                                                                                       |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 01 mobile number · 02 WhatsApp code                                                                     | Sign in (number) → code screen with the resend countdown                                  |
| 03 number not recognised                                                                                | "No booking on +91 …" with "Book a free consultation"                                     |
| code: SMS fallback, wrong / expired / limited / failed, session ended note, help, one-tap from the site | The same two screens, each refusal in red under the field, current words; help as a sheet |

### Home

| Current                                                            | New                                                                                       |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 04 consultation booked                                             | Next-visit card, consultation                                                             |
| 05 fitted client                                                   | Next-visit card (service), Your hair system, free service visits, last visit              |
| 06 loading · 07 offline · 08 error                                 | Home skeleton · offline bar over the kept Home · Home failed with Try again               |
| code: visit stages arrived / in progress / closing / done / missed | The live card (W3): at your door until, step n of N, sign-off, done; missed visit row     |
| code: `being_booked`                                               | Next-visit card, "Paid, being booked"                                                     |
| code: `payment_owed`                                               | A row on Home with Pay, which opens the Razorpay link                                     |
| code: `remake` (partly done, recall)                               | Remake card, "We'll call to set a day" (ADR 0192)                                         |
| code: proposed move                                                | "We need to move your visit": accept or pick another time                                 |
| code: consultation recap, first-fit offer                          | First-fit path: in stock (book and pay) or made to order (pay, being made, arrived, book) |
| code: custom order states                                          | Same path, from `/api/me/custom-orders`                                                   |
| code: invoice prompt                                               | A row under the card: the invoice, opening it                                             |
| code: credits tile and expiry                                      | Free service visits row (and Rewards)                                                     |
| code: address missing before any start                             | Address row on Home; booking's address step before any start (ADR 0079)                   |
| code: book next, was due, replacement prompt, `/replacement`       | Book row on the card; Your hair system says when the replacement opens (ruling 1)         |
| code: requested (self-serve off)                                   | Request mode: "Ask for a time", as the prototype draws it (gap G4)                        |
| code: update ready, not found, page failed                         | Restyled, as today                                                                        |

### Visits

| Current                                                         | New                                                                                                                        |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 09 visits                                                       | Visits: Upcoming / Past, and Issues (W6)                                                                                   |
| 10 a visit and its photos                                       | Past visit: outcome, photos, technician, sign-off and its time, guarantee date with "The fit isn't right", rating, invoice |
| code: cancelled, missed by us, partly done                      | Past visit's outcome line                                                                                                  |
| code: missed visit, dispute open / ruled / closed               | Missed visit: the wait, the charge, "Dispute this charge" until `dispute_until`                                            |
| code: invoice ready / free / held / late, ask for it            | The visit's invoice row, current rules (ADR 0056)                                                                          |
| code: pay at the visit (history)                                | The visit's payment line, history only                                                                                     |
| code: note to the technician, add to calendar, report a problem | Upcoming visit's sheet; problem → Raise an issue                                                                           |

### Booking, change and cancel

| Current                                                                                               | New                                                                                        |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 11 pick a day · 12 pick a start                                                                       | Book: date strip, start times every `step`, taken ones struck through, arrival window      |
| 13 pay · 14 first fit · 15 on a free visit                                                            | Review and pay: hold countdown and grace, code box, consents, credit; Rs. 0 skips Checkout |
| 16 payment failed · 17 hold expired · 18 confirmed                                                    | Razorpay failure, pending and hold-expired states as drawn; confirmation                   |
| code: not served / waiting list, first fit not yet, with ops, full days, offered full, start gone     | Same steps, current words                                                                  |
| code: code invalid / removed, Checkout failed to start, slow confirm, paid hold refunded, credit gone | Same steps, current words                                                                  |
| 19 change free · 20 cancel free · 21 change with a late fee                                           | Manage sheet: free until `free_until`; inside the notice, the late charge by kind          |
| (new)                                                                                                 | Replacement: the tier step, Keep it / Upgrade / Downgrade / Switch (W2)                    |

### Photos

| Current                                                                  | New                                                          |
| ------------------------------------------------------------------------ | ------------------------------------------------------------ |
| 22 timeline · 23 before and after · 24 download                          | Photos: timeline, slider with its knob, viewer with download |
| 25 none yet · 26 loading                                                 | Empty (try-on link) and skeleton                             |
| code: try-on looks kept, link expired and read again, large photo failed | Try-on looks group; same refresh; inline error               |

### Payments → Profile

| Current                                                                                   | New                                                                   |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 27 payments · 30 none yet                                                                 | Profile → Payments and invoices                                       |
| 28 a payment · 29 receipt unavailable                                                     | Payment (or Refund): Razorpay method and payment ID, receipt, invoice |
| code: late fee, missed-visit charge, discount, owed (Pay), credits moved, refund statuses | Rows and lines as today, restyled                                     |

### Refer → Rewards

| Current                                                                                                       | New                                                                    |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 31 refer · 32 choose a card · 33 share · 34 share failed                                                      | Rewards: invite link and card choice; share sheet; invite link failing |
| 35 switch off the photo card                                                                                  | Rewards: the switch                                                    |
| 36 who you invited · 37 nobody yet                                                                            | Rewards → Who you invited                                              |
| code: closed until the first consultation (ADR 0218), card composing / failed, card revoked, `pending_invite` | Rewards' locked state and the same lines                               |

### Profile

| Current                                                                              | New                                                     |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| 38 profile                                                                           | Initials (top right) → Profile                          |
| 39 account                                                                           | Account: number change, sessions, data export, deletion |
| code: address form, building search, not served, visit booked lock                   | Profile → Address                                       |
| code: consents and their switches                                                    | Profile → Privacy and messages                          |
| code: number change (codes, proven, waiting, withdraw, limited, confirmed, rejected) | Account                                                 |
| code: grievances (raise, sent, limited, answered), Care person and hours             | Profile → Help, and the issue log (W6)                  |

### Routes

Every old path keeps working. `/payments` → `/profile/payments`, `/payments/:id` → `/profile/payments/:id`, `/refer` →
`/rewards`, `/refer/fitted` → `/rewards/invited`, `/replacement` → `/` (Your hair system). New: `/alerts`,
`/hair-system`, `/hair-systems` (compare the four), `/visits/issues/:id`, `/profile/address`, `/profile/privacy`,
`/profile/account`.

## 4. The work, in build order

All in PR A unless marked B. Each step is a commit series with its tests.

| #   | What                                                                                                                                                                    | Tests                                                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | This plan and the ADRs, before the code they govern                                                                                                                     | none                                                                                                                                                              |
| 1   | Look file, tokens, Plex, base parts; `Toast` `fullWidth` with icon (W10)                                                                                                | Token, contrast and shared-control tests                                                                                                                          |
| 2   | Shell: four tabs, top bar (initials, bell), Profile and its pages, redirects                                                                                            | Route tests for every old path; e2e on the shell                                                                                                                  |
| 3   | Home and the next-visit card, no live states; Your hair system; Compare the four hair systems                                                                           | e2e per Home state                                                                                                                                                |
| 4   | Booking and Razorpay Checkout; change and cancel; request mode; staging on test keys                                                                                    | e2e through Checkout success, failure, pending, expiry                                                                                                            |
| 5   | W1 replacement only when due; W2 change of hair system at booking, with the tier step                                                                                   | Worker tests: before the window, its first day, remake owed, recall owed; demand by booked tier; task closes and stock returns; starts gated by the promised date |
| 6   | W9 values on the API; the custom-order and one-visit paths                                                                                                              | Route tests per field; e2e on both paths                                                                                                                          |
| 7   | W3 live fields; the live card                                                                                                                                           | Route tests; e2e on each live state                                                                                                                               |
| 8   | W4 sign-off: table, three routes, one-time code; the technician's Sign-off step (offline, Hindi); console story and Tasks queue; the client's card                      | Done refused without sign-off; each state; offline replay                                                                                                         |
| 9   | W5 client alerts and push; the inbox and the banner                                                                                                                     | One alert per event, idempotent; a revoked session's subscription dropped                                                                                         |
| 10  | W6 issue log; W7 fit guarantee                                                                                                                                          | Log states; categories; photos; 5 a day kept; claim opens its Tasks row                                                                                           |
| 11  | W8 ratings and the technician's quality figure                                                                                                                          | One per visit; under 4 opens a Care task; the 90-day average                                                                                                      |
| 12  | Photos and Rewards                                                                                                                                                      | e2e per state                                                                                                                                                     |
| 13  | Razorpay code: `recordPayment` names the bank account (item 17); a kept charge's own invoice (item 16); `createOrder` sets capture (item 154); webhook and refund tests | Brief's list: Checkout and link webhooks, late webhook after expiry, refunds, `upi:` refusal                                                                      |
| 14  | States, offline, errors, 360 px and 130% text pass; `REPORT.md`                                                                                                         | Layout specs at 360 and 390, large text                                                                                                                           |
| B   | Production vars, guard, retiring pay-at-the-visit for new visits, the ADR's consequences in the three apps                                                              | The guard; ops booking sends a link and no `pay_at_visit`                                                                                                         |

Migrations, from 0210:

- `0210_fit_sign_offs`
- `0211_client_alerts` (`client_alerts`, `client_push_subscriptions`)
- `0212_visit_ratings`
- any rebuild W6 needs to widen the problem categories

ADRs, from 0252:

- 0252 the client app's redesign and its departures from the prototype
- 0253 changing hair system at the replacement booking, with when a replacement is bookable (W1, W2)
- 0254 the client signs off the fit
- 0255 client alerts and push
- 0256 the fit guarantee as a setting
- 0257 Razorpay is the only way to pay, superseding 0209's booking path (written in A, in force with B)

## 5. Gaps the brief does not cover

The prototype needs these and no work item supplies them. Each is proposed here rather than built silently. If the
owner says no to one, the app reads a typed adapter with a mock and `REPORT.md` lists it.

| #   | The prototype shows                                                     | Today                                                                                        | Proposed                                                                                                                                          |
| --- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Your hair system: package, month n of N, when its replacement opens     | `/api/me` has the replacement prompt and `first_fit_on`, not the current hair system's start | `hair_system {package, since, replace_after_months, bookable_from}` on `/api/me`, built with W1, which computes the same window                   |
| G2  | Compare the four hair systems: prices, service interval, lifespan       | Prices reach the app only per service offered; no client read of the four packages           | `GET /api/packages`: each package's figures from the price book and `packages`, the city's own first. The words stay in the app's content         |
| G3  | Issue references ("MM-ISS-0032") in the log and the toast               | Reports have no public reference                                                             | A per-report reference, written by W6                                                                                                             |
| G4  | Request mode: "Ask for a time", a day and a time of day, "Send request" | With booking off, the app sends the client to ops on WhatsApp; no client request route       | Keep today's path: the pick goes as a WhatsApp message to ops, drawn as the prototype draws the form. After B, request mode is for an outage only |

## 6. Estimate

The technician redesign's eleven PRs took about two and a half days. This work is about half as large again, and has
more backend. That puts PR A at about four days of continuous work, including the four review rounds. PR B takes a
few hours once the owner has the live account ready.

## 7. Owed by others

- **The owner, for PR B:**
  - the live key ID, which is public;
  - `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` set with `wrangler secret put --env production`, never in
    chat;
  - live KYC;
  - the live webhook with its nine events;
  - payment links on the live account;
  - the CA's word on advances (open points 5, 6, 9, 166);
  - a look at the late-change and missed-visit charges in Settings · Rules, now that money is prepaid again.
- **The owner, on staging:** after A lands, `docs/go-live.md`'s "whole payment path" walk, before B merges.
- **Counsel:** the sign-off wording, that signing off does not end the guarantee. An open point, not a blocker.
