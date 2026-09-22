# Prompt for the coding agent — Mane Man Phase 2 front end, rev 2

_Paste verbatim into the same repository. Builds three surfaces from the Phase 2 designs on top of the Phase 2 backend contract:_
- _the **client app**_
- _the **referral card and landing page**_
- _the **internal referral and waitlist views**_

_The designs are final. Port them; do not redesign._

_Rev 2 adds the **technician app**, the **dispatch board** and the **pieces tab**. These are our interface over Zoho FSM: every screen reads from the backend's FSM mirror, and every action is written back to FSM through the backend. The front end never talks to FSM directly._

---

## Before you start

1. Read `docs/prompts/phase1-frontend.md` (rev 2) and follow it unchanged wherever it applies:
   - the fidelity harness method
   - the content file and publish gates
   - the tokens file, which Phase 2 extends and does not fork
   - self-hosted fonts
   - the analytics privacy rule
   - the performance, accessibility and security bars
   - the feature-inventory evidence rule
2. The API contract is `docs/api.md` and the OpenAPI file after Phase 2 backend milestones. Generate the types; never hand-write them.
3. Design sources, under `design/phase2/`:

| File | Use |
|---|---|
| `Client App.dc.html` | Spec boards A–G: **the source of truth** for every client-app screen and state |
| `Referral and Waitlist.dc.html` | The card (A), chat previews (B) and landing (C1–C5) |
| `Ops Console.dc.html` | All of it: dispatch (A), client page (B), referrals and waitlist (C) |
| `Phase 2 Prototype.dc.html` | Flow order and timers. Where it differs from a spec board, the board wins; record the difference in an ADR. |
| `Technician App.dc.html` | Spec boards A–B, plus the contrast, gloved-use and motion notes: **the source of truth** for the technician app |

## Surfaces and stack

| Surface | Host | Stack |
|---|---|---|
| Client app | `app.maneman.in`, Worker `mm-app` with static assets | React with Vite, as a single-page PWA (the roadmap specifies a React PWA). TypeScript strict. No UI framework. |
| Referral landing | `maneman.in/r/:code`, inside `mm-site` | Astro page plus one island, like the Phase 1 site |
| Internal views | `ops.maneman.in`, Worker `mm-ops`, behind Cloudflare Access | React with Vite, desktop only |
| Technician app | `tech.maneman.in`, Worker `mm-tech` with static assets | React with Vite, as an offline-first PWA for company Android phones. TypeScript strict. |

Tokens, fonts, icons and brand files are shared from one package across all four front ends. Add the design's nine new glyphs to the icon set, drawn on the same 24 px grid with a 1.6 stroke and round caps:
- visit credit
- hold timer
- compare
- tax document
- share
- referral
- offline
- upload queue
- piece ID

## Client app rules from the design

- **Layout and targets.** The design is 390 px wide. On wider screens, centre that column rather than stretching the layout. Tap targets as specified: primary buttons 56 px, rows 64 px, tabs 64 px, icon buttons 44 px.
- **Tabs.** Five: Home, Visits, Photos, Payments, Refer. Profile sits behind the avatar on Home.
- **Motion.** One curve, `cubic-bezier(0.22, 0.61, 0.36, 1)`:
  - sheets rise in 420 ms
  - tabs cross-fade in 300 ms and never slide
  - the hold timer counts whole seconds with no pulse
  - nothing bounces and nothing scales
  - all of it is disabled under `prefers-reduced-motion`
- **Money.** The ex-GST figure is the main number with the inclusive figure muted beside it. Every amount comes from the API's price book; never type a price into a component.
- **Contact.** No telephone number anywhere. Support and notifications are WhatsApp only.
- **PWA.**
  - A manifest built from the brand kit, and install prompts left to the browser.
  - A service worker caches the app shell and the last Home response, so the design's offline state (B3) shows the cached next visit.
  - Booking and reschedule are disabled while offline.
  - Photographs and documents are never cached by the service worker.
- **Session.** The backend's `HttpOnly` cookie. The app stores no token and no personal data in browser storage, except the cached Home payload, which is cleared on logout.

## Feature inventory, client app

Each item needs a Playwright check or a fidelity screenshot pair against the matching board.

- **A. Login**
  - A1: mobile number, *Send code on WhatsApp*.
  - A2: six boxes for the code. Automatic reading via the WebOTP API where the phone supports it. *Send by SMS instead* appears after 30 seconds. The WhatsApp resend has a visible countdown. Wrong-code state: oxblood borders and the design's one line, "That code did not match. Two attempts left." After five wrong codes, the code is void.
  - A3: number not recognised, with *Book a free consultation*, which goes to the public `/book`, and *Message us*.
- **B. Home**
  - B1, fitted client: next-visit card (date, window, technician initials and name, type and length, address) with *Reschedule* and *Add a note*; the credit tile with its expiry; one contextual prompt.
  - B2, lead: the consultation card, *Free · nothing to pay*, and the three *What to expect* steps. The Photos, Payments and Refer tabs can be reached but show their empty states.
  - B3: loading, offline and error states, as designed.
- **C. Visits**
  - C1: upcoming and past visits, and *Book your next visit*.
  - C2–C4: the three-step sheet.
    - Date: a 14-day strip where full days are disabled in place, not hidden.
    - Window: three windows, with "your regular technician is free" when he is.
    - Pay and confirm: hold countdown from 10:00, the amount, the free-until line, a choice of UPI or card through Razorpay Checkout, and a note that the technician never handles money.
  - C5:
    - Credit applied: payment skipped, credits remaining shown.
    - First fit: the guarantee line and the late-move fee line.
  - C6: payment failed, hold expired, confirmed.
  - C7 and C8: reschedule and cancel, each in its "more than 24 hours" and "inside 24 hours" version. **The consequence text comes from the backend's pre-confirmation response**, not from the front end.
  - C9: past-visit detail, with photographs, technician, duration, type and *What was done*.
  - **When `SELF_SERVE_BOOKING` is off,** Book, Reschedule and Cancel open WhatsApp with a pre-filled message naming the visit. This is the one sanctioned deviation; record it in an ADR.
- **D. Photos**
  - D1: timeline by visit, five angles, the same crop, no captions.
  - D2: compare with a vertical divider that follows the finger with no easing and no snap. Changing the angle cross-fades both sides together.
  - D3:
    - empty before the first fit
    - download: the downloaded file goes to the phone's gallery, and the design's line says so
    - loading: thumbnails fade in as each one arrives, with no spinner
- **E. Payments**
  - E1: one list of payments, refunds and charges.
  - E2: entry detail with *Tax invoice* and *Receipt*. A refund shows its voucher and destination. A charge shows the evidence line.
  - E3: empty for a lead; refund processing; document unavailable with *Notify me*.
- **F. Refer**
  - F1: landing with the offer line, the credit tile, "No other discount applies", *Share an invite* and *See who has been fitted*.
  - F2: card choice between *My before and after* and *A Mane Man example*. Without consent, the first option opens F3 instead of being selected.
  - F3: the four consent lines, no scrolling, the irreversible line last.
  - F4: share preview exactly as the friend will receive it. Share via WhatsApp or the Web Share API; *Copy link*.
  - F5: tracker of completed fits only.
  - F6: empty tracker; revoke the photo card; share failed.
  - **Composing the personal card:**
    - Compose it in the browser on a canvas at 1200×630: the client's first-fit *before* and *after* front photographs at the same crop, with one gold rule (`#C9A363`) running full height down the middle, and no text.
    - Upload it through `POST /refer/card`.
    - Run the composition in a Worker thread so the tab stays responsive.
- **G. Profile**
  - G1: name, address with access notes and edit, and the consent list. Each purpose shows its date and has a toggle.
  - G2: change mobile number (a code goes to both numbers, then ops confirm), Support on WhatsApp, and *Request deletion* with the design's retention line.

## Feature inventory, referral card and landing

- **The Open Graph card.** The page at `/r/:code` sets `og:image` to the backend's versioned card URL. Check both chat renders from boards B1 (Android crops to a wide strip) and B2 (iOS shows the full card) with real shares to test handsets.
- **C1, arrival.**
  - "Gurgaon", *Rohit sent you this*, the headline and offer line.
  - The price rows from the price book.
  - *How it works*, three steps.
  - *Do we come to you?* with a pincode field and *Check*.
  - The referrer's first name appears only when the backend returns it.
- **C2, served.** "We come to {area}", then the consultation booking:
  - date strip, three windows, name, mobile, the contact-consent line
  - *Book the consultation*
  - "Rohit is told when you are fitted."
- **C3, not served.** "We are not in {area} yet", then:
  - name, mobile
  - required contact consent and optional launch-alert consent
  - *Add me to the list*
  - the 12-month invite line
- **C4, confirmations.** Consultation booked; on the list; code expired, with *Book anyway*; pincode not recognised.
- **C5, desktop at 1440.** Card and how-it-works on the right, prices and pincode on the left. The result replaces the navy block in place, with no page change.

## Technician app rules from the design

- **Built for the conditions the design names:** bright sun, basements with no signal, adhesive on gloves.
  - Navy ground with off-white text; gold on the one primary action only.
  - Primary buttons 64 px, list rows 88 px, steppers 56 px square, nothing under 48 px.
  - Nothing actionable below 17 px type, and no grey on grey.
  - Every colour pairing meets the design's contrast table: at least 5.8:1, and 7:1 for all but one pairing. A test checks each pair.
- **Gloved use.**
  - The primary action sits at the bottom of every screen, in the same place, 64 px tall and full width. The only exception is the *Retake* key.
  - Steppers instead of number fields, so no keyboard ever opens.
  - Capture is one tap, with no pinch or drag.
- **Motion.**
  - Steps slide in 300 ms on the house curve.
  - The wait timer counts whole seconds, with no pulse.
  - Upload progress moves on real bytes only.
  - Nothing animates while the camera is capturing.
- **Money.** None anywhere: a *Prepaid* or *Credit* badge only.
- **Photographs never touch the phone's gallery.**
  - Capture through `getUserMedia` into a canvas, not through a file input that may save to the camera roll.
  - Hold the frames in IndexedDB, which is private to the app, until they upload.
  - Re-encode to JPEG so no metadata survives.
  - Delete each frame from IndexedDB once the backend confirms the upload.
  - The upload queue shows each set as queued, uploaded or dropped, with *Retry*.
- **Offline first.**
  - Today's and tomorrow's jobs and client cards are cached in IndexedDB. Tomorrow's cards appear only once the backend's day-before unlock releases them.
  - Every action is queued with a client-generated event ID and replayed in order when the phone is back online.
  - A `409 superseded` from the backend shows what changed, for example "Ops moved this job to Sandeep at 10:40". It never shows a generic error.
  - The offline banner uses the design's copy.
- **Location.** Requested only when the technician taps *I have arrived*, never tracked in the background.
- **Session.**
  - The session can be revoked from ops. On revocation, the app wipes its IndexedDB and signs out at its next contact with the backend.
  - Signing out also wipes all local data.

## Feature inventory, technician app

- **A1 Today.**
  - "{n} jobs today", first job's time and sector.
  - Job rows with time, slots, type, badge, client and sector.
  - Tomorrow collapsed below.
- **A2 Offline, empty, upload queue.**
  - "No signal · working offline" with its explanation.
  - Nothing booked today, with a pointer to tomorrow.
  - "{n} photo sets waiting", each with its state and *Retry*.
  - "Never written to this phone's gallery."
- **A3 Job detail.**
  - Client, time, type and slots, badge, address and access notes, *Navigate*.
  - The piece card.
  - Last visit's after-photograph.
  - *Start job*.
  - The locked state for jobs further out: time, type and sector only.
- **Sign-in.** Mobile number and code, as in the prototype.
- **B1 Before photographs.** Guided capture of front, top, left, right and hair, with "3 of 5" progress, *Retake* and *Capture*.
- **B2 Checklist.** "3 of 6". Continue stays disabled until every item is done: "Finish the list to continue".
- **B3 Consumables and piece.**
  - Consumables with steppers.
  - Piece, on replacement jobs only: *Scan the piece* using `BarcodeDetector` where the phone supports it, with the camera; otherwise *Pick from the list*. The result shows the piece code and base.
- **After photographs.** Same capture as B1. The design labels the outcome screen "Step 6", so the flow is six steps: before, checklist, consumables, piece, after, outcome. Confirm against the prototype and record it in an ADR.
- **B4 Outcome and close-out.**
  - *Done* or *Partial*; Partial requires a reason.
  - Closed-out summary: duration, photographs queued, next job.
  - Duration is never typed.
- **B5 Client not home.**
  1. Arrived: *I have arrived*. Check-in failed shows "You are {distance} from the address" and explains that no-show cannot be recorded from there.
  2. Waiting: the 15-minute countdown, with the WhatsApp delivery status to the client. *Close as no-show* stays dim until the countdown ends.
  3. He appears: *Rohit is at the door*, "The timer stops. Nothing is charged.", then *Start job*.
  - Closed as no-show: the evidence summary and "This goes to ops with the charge."

## Feature inventory, dispatch board and pieces tab (`ops.maneman.in`)

- **A1 Dispatch board.**
  - Technicians down the side, seven days across, four slots per day.
  - Blocks sized by slot.
  - Utilisation per cent at each column head, as a figure, not a chart.
  - Leave blocks.
  - The unassigned tray, showing the asked and offered windows and the referral source.
  - A city and week picker.
- **A2 Drag and the reason picker.**
  - Pick up a block. A hint shows its slot size. Drop it on a cell with room.
  - The sheet shows "Move {client} to {technician}", with the from and to times, the reason list and the notification line.
  - *Move and notify* stays disabled until a reason is picked.
  - A move inside 24 hours adds the design's line that the client is not charged.
  - A cell that would clash is refused before the sheet opens, with the backend's message.
  - Keyboard alternative: select a block, choose a destination from a list, then the same sheet.
- **A3 Block drawer.** Client, time, technician, badge, details, *WhatsApp {client}*, *Open client*.
- **B1 Pieces tab.** Piece, base, fitted date, supplier lot, replacement due, failed and reason.
- **No-show queue** (implied by the technician app's "goes to ops"). Each case shows the evidence: check-in time, distance, delivery receipt. Charge or waive, with a reason. Build it in the ops table style and record it in an ADR.
- **Technician devices.** A list of each technician's devices with *Revoke*.

## Feature inventory, internal views (`ops.maneman.in`)

- **Density.** Tables set in 13 px type with 34 px rows and no charts. Gold marks the selection and the one primary action, nothing else.
- **C1: review queue.** Pair, time held, rule and signal, with *Approve* and *Reject*. Both require a reason.
- **C2: all referrers.** Sent, opens, consults, fits, granted, redeemed. Internal figures only.
- **C3: waitlist by pincode.** Pincode, area, count, oldest, referrals, alerts. *Mark {pincode} live* shows "This messages N people" and needs a second confirmation.
- **B2 and B3: client lookup.**
  - Photographs start in the locked state. *View photos* writes the audit entry before anything loads, and the open state shows "logged {time}".
  - The consents tab is read-only, with "Only the client can change these".
- **Two queues the design implies but does not draw:** number-change confirmations and deletion requests. Build them in the same table style and record them in an ADR.

## Quality bar

- **Performance.**
  - Client app: first load under 150 KB of gzipped JavaScript, and LCP under 2.5 s on a mid-range Android on 4G.
  - Referral landing: meets the Phase 1 site budgets.
- **Accessibility.** WCAG 2.2 AA across all three surfaces:
  - the one-time-code boxes work as a single labelled field for assistive technology
  - the compare divider and the date strip work by keyboard
  - the hold timer does not announce every second
- **Technician app.** First load under 150 KB of gzipped JavaScript. After the first sync, the app works entirely offline for a full day. A Playwright test in offline mode covers a whole job, then the replay once back online.
- **Security.**
  - A content security policy per surface. `app` allows Razorpay Checkout's hosts and the backend; `ops` allows its own origin only. `tech` allows its own origin and the presigned R2 upload host. Its `Permissions-Policy` grants the camera and geolocation to itself only.
  - No analytics on `app` except Cloudflare Web Analytics.
  - No analytics at all on `ops`.
- **End-to-end tests** at 390 px (app and landing) and 1440 px (landing and ops), covering:
  - login on both channels
  - fitted and lead Home states
  - each C-sheet path, with the booking flag both on and off
  - compare
  - a payment entry with its documents
  - refer with and without consent, including revoke
  - landing served, not served, expired and invalid
  - review approve and reject
  - pincode launch

## Milestones

These follow the backend's milestones.

- **P2-F1 — App shell and login** (after P2-M1): the PWA, tabs, login A1–A3, and Profile G1–G2.
- **P2-F2 — Read surfaces** (after P2-M2): Home B1–B3, Visits C1 and C9, Photos D1–D3, Payments E1–E3. The C-sheets ship with the WhatsApp fallback. This is the roadmap's December release.
- **P2-F3 — Refer, landing and internal views** (after P2-M3): F1–F6, landing C1–C5, and the ops C1–C3 and B2–B3 views. This is the roadmap's January release.
- **P2-F4 — Technician app, dispatch and pieces** (after P2-M4): technician A1–A3 and B1–B5, sign-in, the offline queue; ops A1–A3, B1, the no-show queue and devices.
  - Field test before sign-off: a full service job on a company Android phone in direct sun and in a basement with no signal, gloved.
  - Then the backend's two-week parallel run beside FSM's native app.
- **P2-F5 — Self-serve booking** (after P2-M5): C2–C8 live against Razorpay test mode, then live mode once the flag is switched on.

## Out of scope

- Any direct call from a front end to Zoho FSM. Everything goes through `mm-api`.
- Any change to the Phase 1 site beyond adding `/r/:code`.
- Any redesign.
