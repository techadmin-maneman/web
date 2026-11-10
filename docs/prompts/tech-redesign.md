# Redesign the Mane Man technician app

You are redesigning the existing technician app in this codebase so it looks and behaves like the approved reference prototype. This is a front-end redesign. Keep every existing backend call, data contract and business rule unless this brief says otherwise. Where the design needs data the backend does not yet provide, build the UI against a typed adapter with a mock, and list every such gap in your final report. Do not invent endpoints silently.

## Inputs

1. `mane-man-technician-prototype.html`: the approved design, as a working clickable prototype. Open it in a browser. The panel on the right is not part of the app; it triggers states (offline, upload failure, ops rejection, cancelled job, camera blocked, storage full, 360 px width, large text, Hindi). Treat it as the visual and behavioural source of truth. Where this brief and the prototype disagree, the prototype wins on look and the brief wins on rules.
2. `strings-hi.json`: the Hindi string catalog (English key to Hindi), plus templates with parameters, regex patterns for strings with numbers, and weekday/month tokens.
3. The current app's screenshots (folders `01-sign-in` to `18-errors`), which you should already have. They define the states that must survive the redesign.

## Step 0: survey before you change anything

1. Find the technician app in the repo: framework, routing, state management, styling approach, how it talks to the backend, offline storage, and how it is built and deployed (the current app has an "add to home screen" note, so check for a PWA manifest and service worker).
2. Read `docs/decisions/` if it exists and follow any decision recorded there.
3. Write `docs/technician-redesign/PLAN.md` with: the current screen and route inventory, a table mapping each current screen and state to the new screen that replaces it (use the mapping below as a starting point), the backend gaps, and the order of work. Commit the plan, then build.

## Non-negotiables

- **Design system.** Use only the tokens below. No other colours, fonts, radii or shadows. No cards with borders as containers: separate content with whitespace, 1 px hairline rules (`line-200`) and a 2 px `navy-900` rule above section titles. No uppercase letter-spaced labels. Sentence case everywhere.
- **Gold has one job.** `brass-500` marks the single most important thing on a screen (the current step, the now-line, the wait timer bar). `gold-700` is for highlight text on white ("Next · leave in 10 min"). Never use gold as decoration.
- **Logo.** The Mane Man lockup is a drawn mark. Never type the brand name in a font as a logo. Use the SVG from the brand kit; until it is in the repo, keep a labelled placeholder.
- **Copy.** Plain, short, no explanations of the obvious. Buttons are verbs ("Check in", "Start visit", "Close visit"). A disabled button always shows one helper line saying what is missing ("2 left", "Pick a reason", "Scan to continue"). Never refer to the client as "him/his"; use the name or "the client". Rupees as "Rs. 6,300".
- **Every current state survives.** No state from the current app may be dropped. Offline, failure, rejection and permission states are part of the redesign, not an afterthought.
- **Bilingual.** English and Hindi, switchable at any time, including mid-visit.
- **Accessibility.** Text contrast 4.5:1 minimum. Touch targets 44 × 44 px minimum. Real `button`, `a`, `input` and `label` elements. `aria-label` on icon-only buttons. Respect `prefers-reduced-motion`.

## Design tokens

| Token | Value | Use |
|---|---|---|
| `navy-900` | `#16233A` | Primary buttons, titles, section rules, selected states, timeline job blocks |
| `navy-700` | `#33435F` | Borders on dark (camera) |
| `brass-500` | `#B98B45` | The one highlight per screen |
| `gold-700` | `#8A6A2F` | Highlight text on white |
| `white-000` | `#FDFDFB` | Every screen background |
| `wash-100` | `#F4F0E8` | Only for a single highlighted row (e.g. "Reschedule asked") |
| `line-200` | `#D9DCE1` | Hairlines, input borders |
| `grid-100` | `#E8EAED` | Progress track, timeline hour lines, done blocks |
| `ink-900` | `#1F2328` | Body text |
| `ink-500` | `#5F6670` | Secondary text |
| `mist-300` | `#A9B2C1` | Secondary text on dark |
| `stone` | `#8C939E` | Unselected radio and checkbox borders, chevrons |
| `disabled` | bg `#EEF0F2`, text `ink-500` | Disabled buttons |
| `placeholder` | `#ECEEF1` | Image and map placeholders |
| `error` | `#B42318` | Errors, expired, SOS, client alerts. Not in the brand kit: add it to the design system as a functional colour |
| Camera chrome | `#0B0F16` and `#3B3F46` | Camera and door-photo screens only |

- **Type.** IBM Plex Sans 400/500/600, with IBM Plex Sans Devanagari for Hindi (same family name via `unicode-range`, or a font stack). Self-host both; do not load from Google at runtime. Tabular figures for every number in a row or table. Scale: screen title 28/600, section title 20/600, list title 16–17/600, body 15–17/400, meta 14/400, smallest 13 (tab labels, axis labels). Nothing below 13 px.
- **Radius.** 4 px buttons, 2 px inputs, chips and small boxes. Circles only for radio dots, step markers, avatars, the camera shutter and the SOS hold fill. Nothing pill-shaped.
- **Spacing.** 20 px screen side padding. 8 px grid. Primary button 52–56 px high. Bottom action bar: 12 px top padding, safe-area bottom padding, 1 px top hairline.
- **Motion.** Screen enter 180 ms fade + 14 px slide; sheets slide up 220 ms; notifications drop down 260 ms; overlays fade 160 ms. All off under reduced motion.

## Information architecture

Bottom tab bar on top-level screens: **Today, Schedule, Kit, Me**. The active tab gets a 2 px navy bar and a heavier label. Tabs are hidden inside a visit.

Back navigation is fixed:
- visit step → visit plan
- visit plan → job
- door → job
- history → job
- job → Today (or Schedule if opened from there)
- schedule preview → Schedule
- guide → wherever it was opened from

Sign out lives in Me only, behind a confirm sheet. It is never in a header.

## Screens

Build each screen to match the prototype. Notes cover behaviour the pixels don't show.

### Sign in
Logo placeholder and an EN/हिन्दी switch at the top. Mobile number with +91 prefix, then **Get code**, then a 6-box OTP. Use `autocomplete="one-time-code"` so the code fills from SMS; show a resend countdown and a "Number not registered? Call ops." line. Keep every current sign-in error state (`01-sign-in`: invalid number, too many codes, codes not going out, offline, sign-in stopped, phone revoked, switched off, work kept on phone).

### Today
- **Header:** date, "N jobs today" (count updates as jobs close), sync status, and an alerts bell with unread count.
- **Problem cards** in red outline at the top, most urgent first: upload failed, ops rejected a step, yesterday's open job.
- **Next job block:**
  - "Next · leave in 10 min" in `gold-700`
  - large time, duration, client name, visit type · payment, short address · drive time
  - Navigate as the primary button, plus Message and Call icon buttons
- **Later today:** one row per job with time, duration, name, type · area · payment, and a third line "20 min drive · leave 1:10 pm". Closed jobs dim, with a navy left bar and "Done", "Cancelled", "Moved", "No-show" or "Not fitted".
- **"Day view" link** to Schedule.
- **Tomorrow row:** "Tomorrow · 2 jobs from 9:30 am".

### Schedule
Week strip (weekday, date, job count, selected day underlined). Below it, a time-scaled day view from 8 am to 8 pm at 1 px per minute:
- jobs as navy blocks sized to their length
- drive time as hatched blocks before each job ("18 min · leave 9:12 am")
- a brass now-line on today

Tapping a today job opens the job. Tapping a future job opens a read-only preview (time, area, payment, "Name and address from 6 pm the day before.", and a link to "How this visit is done").

### Kit
- **Next 7 days:** a need / have / status table built from bookings ("Short 6" in red), with a one-tap request to ops.
- **Arriving transfers:** scan progress, Scan, Report missing, Receive.
- **Return to ops:** the old piece and expired stock.
- **In kit:** quantities and expiry; low and out shown in colour.

Keep all `06-kit` states: label not on transfer, one of two scanned, rest missing, scanning, handed back, empty, already received, did not go through, no signal, failed, loading.

### Me
- **Header:** name, role, city, phone.
- **Your quality (last 30 days):** client rating, hairline redo rate, on-time %.
- **Incentives, November:** total, then one line per job type showing count × rate per visit. These are per-visit incentives, not pay.
- **Account rows:** Guides, Language, Leave (form and request list with With ops / Approved / Declined), Alerts settings, Pending uploads (per-item progress, Retry on failure, "Photos on Wi-Fi only" setting), Contact ops (sheet with hours, Call, WhatsApp), Sign out.

### Alerts
Inbox, newest first; tapping an alert opens its job. Settings, all on by default:
- **Time to leave:** 10 min before you need to set off.
- **Day ahead:** at 8 pm, the next day's jobs.
- **Job changes:** moved, cancelled or reassigned.
- **Running over:** when a visit will make you late for the next.

Push notifications look like the phone's own and carry Navigate and Open job actions.

### Job
- **Map** with distance and time.
- **Address:** full address and landmark, then the gate code with a copy button, then the client's note.
- **Quick actions:** Navigate, Call, Message. Message opens a sheet: pick minutes (10/20/30/45/60), then "On my way, N min" or "Running N min late", sent on WhatsApp.
- **Ask ops to reschedule:** a sheet with reasons (Client asked / I'm running late / Kit problem). Once sent, the screen shows "Reschedule asked … ops will confirm".
- **Client alerts:** a red box, "Before you start".
- **Handoff:** the last technician's note, with name and date and that visit's photos.
- **Client history** link.
- **Hair profile** or consultation data, then "How this visit is done" (that job type's guide).
- **Check in**, only within 150 m and from the opening time.

Keep the `07-job-card` states: no map pin, no WhatsApp updates, check-in not open yet, no position, failed (too far or not measured), awaiting answer, locked, tomorrow's job, changed (given away or time moved), not on your list, loading, failed.

### Client history
Every past visit for this client, newest first. Each visit shows type, date, technician, result, note, five photo thumbnails, and detail (consumables, piece fitted). Client alerts are repeated at the top. Notes, photos and alerts belong to the **client**, not the job, so they survive reassignment.

### At the door
- **Live 15-minute wait timer**, counted from the booked start, with a brass bar. "Nothing is charged while you wait" is shown only where the current app shows it.
- **"Needed for a no-show" checklist:** WhatsApp delivered; call made (Call button); door photo (Take opens a single-shot camera, "Door and flat number in the frame").
- **Close as no-show** stays disabled, with a helper line, until the wait is over and both the call and photo are done. It then opens a confirm sheet ("Rohit is prepaid. Ops decide on the charge.") and leads to a closed screen listing the evidence.
- **Primary action:** Start visit.

Keep all the waiting states in `07-job-card`: arrived early, WhatsApp delivered / not delivered / none sent, telling the client, door camera refused, no signal, wait over, no-show too early.

### Visit engine
A visit is an ordered list of steps defined per job type. Build it as data, not as hard-coded screens:

| Job type | Steps |
|---|---|
| Service visit | Before photos, Service (guided tasks), Consumables, After photos, Outcome |
| First fit | Before photos, Hair profile, Colour and style, Hair system, Fitting (guided tasks), Consumables, After photos, Outcome |
| Replacement | Before photos, Hair system, Fitting (guided tasks), Consumables, After photos, Outcome |
| Consultation | Before photos, Scalp and hairline (guided tasks), Hair profile, Colour and style, Options, Outcome |
| Consultation and fit | Consultation steps, then Hair system, Fitting, Consumables, After photos, Outcome |

Every step screen has:
- a header with the step name, "client · visit type" and a shield (Safety) button
- a progress bar: done segments navy, current brass, rest `grid-100`
- below the bar, "Step n of N" and **All steps ›**, which opens the visit plan
- one primary action at the bottom, reading "Next: <next step>"

**Visit plan:** steps with done / now / to-do markers, "n of N done", an elapsed bar and "Finish by …". Any step can be reopened. A step ops rejected shows "Needs a fix" and a red card.

Each step:

- **Photos (before and after).**
  - Five guided shots (front, top, left, right, hair) with a head-shape overlay and a prompt for each angle, plus a thumbnail strip with the current shot outlined in brass.
  - Torch, Retake, and "Saved on phone".
  - **Compare** puts the previous visit's photo of the same angle (before photos) or today's before photo (after photos) on the top half of the viewfinder.
  - States from `09-before-photos`: camera opening, camera refused ("Camera access is off", Open settings, Continue without photos and tell ops), came out blank, storage full (red bar, shutter disabled), no signal, job changed.
- **Guided tasks** (Service, Fitting, Scalp and hairline).
  - One task per screen: "Task n of N", title, a reference photo slot, numbered instructions and a "Watch for" block.
  - Client alerts repeat above the instructions on every task.
  - The task wording is in the prototype and in `strings-hi.json`. It is draft content: put it in a data file, not in components, so the training lead can edit it.
  - This replaces the old tick-only checklist (`10-checklist`). Keep its "refused, correct it" state.
- **Consumables.**
  - Steppers pre-filled with the usual amount for the job type.
  - When a count differs from the usual, reason chips appear under that item ("Why 1 less?": Client's own / Not needed / Ran out / Other) and Next stays disabled until one is picked.
  - Add item.
  - States from `11-consumables`: more than the kit holds, none in kit, none used, none to record, refused-correct-it.
- **Hair profile.** Norwood stage chips (I–VII). Head measurements in **inches**: circumference, front to nape, ear to ear, temple to temple. Base width and length in inches. Pre-filled from the consultation on later visits. States from `13-profile`: figure out of range, from the profile on record, refused-correct-it.
- **Colour and style.** Chip groups: texture, hairline, colour, product (Essential, Active, Natural, Celebrity) and fixing (Tape, Glue, Tape and glue).
- **Hair system.**
  - Shows what was paid for (or chosen, or the new piece) and the spec, plus "Replacing <old label>" on a replacement.
  - Scan first; the label is checked as soon as it reads, with no separate "check" step.
  - **Type the code** opens an input. It checks the format (`MM-XXX-0000000-X`) and whether the label is in this technician's kit for this client, with the current app's error messages.
  - **Can't fit today** opens a reason sheet and closes the visit as not fitted.
  - For consultation-and-fit, the step is blocked on "Waiting for payment" (Check again / Resend link) until the link is paid.
  - Keep every `12-piece` state.
- **Options** (consultation). Products with first-fit, service-visit and replacement prices (incl. GST), "Price not set" where there is none, and a radio to mark the client's pick.
- **Outcome.**
  - Service, fit and replacement: Done / Partly done; Partly done needs a reason.
  - Consultation: "Going ahead with a fit?" Yes / Not now. Not now needs a reason. Yes shows the payment link: product, price, and a discount code input with Apply that validates and shows the reduced price or the current error. Then "When": Fit today (enabled only if the piece is in the kit) or Book the first fit.
  - All types: "Note for the next technician" (text and voice note), shown on this client's next job whoever takes it.
  - The button label follows the choice: Close visit / Send link and close / Send link and start the fit.
  - States from `15-outcome`.
- **Closed.** Summary rows by result: done, partly done, no-show, not fitted, consultation with payment-link status (Sent · not paid / Paid, with Resend). Partly done and not fitted show "Finish the work", with time suggestions sent to ops. Then the next job with its leave-by time, and Today / Navigate buttons. States from `16-close-out`.

### Guides
A library under Me covering Consultation, First fit, Service visit and Replacement. Each guide lists its steps and their tasks, and every task opens read-only.

### Safety
The shield in visit headers opens a sheet:
- "Ops can see your location until you close this visit"
- **SOS:** press and hold for 3 seconds with a visible fill; releasing early cancels. It alerts ops and shares your location. After sending: "SOS sent 9:41 am", "I'm safe".
- Call ops and Call 112.

Live location sharing runs from check-in to close.

### Offline, sync and interruptions
- **No signal:** a navy bar under the status area, "No signal · your work is saved on this phone". The sync label reads "Offline · n saved". Every action queues locally, and anything that needs the network says it will send when back online.
- **Sync label:** "Synced" / "n to upload" / "1 upload failed" (red).
- **Upload failed:** a red card on Today, and Retry in Pending uploads.
- **Ops rejected a step:** red cards on Today and the visit plan open the step with the reason. The flag clears when the step is resubmitted.
- **Job cancelled or reassigned mid-visit:** a blocking dialog ("… was cancelled" / "… moved to Imran K.", "Your photos and notes so far are saved and sent to ops"), Call ops / Back to Today.
- **New app version, phone storage full, screen failed to draw:** keep the current behaviour, restyled.

Keep every `17-waiting` state: set part-taken, waiting for signal, uploading, given to someone else, delete this job's work, step refused, photos refused, stuck/send again, unsent work at risk.

### Haptics
A short vibration (`navigator.vibrate(25)` or the native equivalent) on check-in, each photo, the door photo, SOS sent and visit closed.

## Hindi and language switching

- Put every user-facing string in a catalog keyed by the English copy, or by stable IDs mapped to it. No string literals in components.
- Load Hindi from `strings-hi.json`:
  - `strings` for exact matches
  - `templates` for strings with parameters (`{first}`, `{time}` and so on)
  - `patterns` for counts and times (e.g. "3 jobs today" to "आज 3 जॉब")
  - `dateTokens` for weekday and month abbreviations
  - Prefer real ICU/plural messages over the regex patterns where your i18n library supports them; the patterns show the expected output.
- Never translate client names, sector names, label codes, product names, Rs. amounts or am/pm.
- **Switch:** on the sign-in screen and under Me → Language. The choice persists on the device and applies immediately.
- **Layout:** Hindi strings run longer, so no fixed-width text containers. Check that nothing truncates or overlaps.
- The Hindi copy is a draft. Leave a note in the PR asking for a native-speaker review of the guide steps.

## Small screens and large text

Every screen must work at 360 px and 390 px width, and with system text at 130%.

- Labels wrap instead of truncating.
- "Step n of N" and "All steps" never wrap.
- Navigate shows its label only; the drive time is in the address line.
- Day-view drive labels truncate with an ellipsis on one line.

## Backend data the design needs

Check each item against the existing API before building. Use what exists, and mock and report what doesn't:

- Client-level: notes, photo history and alerts, independent of job assignment.
- The handoff note written at close, and the voice note.
- Drive time and leave-by time per job, for Today, the day view and the time-to-leave alert.
- Push notifications: time to leave, day ahead, job changes, running over, plus per-user alert settings.
- Ops rejection of a submitted step, with a reason.
- Job cancelled or reassigned events, delivered live.
- Kit forecast: consumable need for the next 7 days from bookings, the kit balance, and the request-to-ops action.
- Label validation against the technician's kit and the client.
- Discount code validation, payment link send and status.
- Reschedule request with a reason.
- Quality metrics (rating, redo rate, on-time) and per-visit incentive rates and counts.
- Leave requests and status.
- SOS event and live location during a visit.

## Delivery

1. Do the Step 0 survey and commit `PLAN.md`.
2. Build in this order, one PR or commit series each:
   1. tokens, fonts and base components (buttons, rows, chips, steppers, radios, checkboxes, sheets, bars, notifications)
   2. tab shell and Today
   3. job, door and visit engine with photos
   4. the remaining steps
   5. closed, offline and interruptions
   6. Schedule, Kit and Me
   7. guides and alerts
   8. i18n
3. For each PR, attach screenshots at 360 and 390 px, in English and Hindi, plus the large-text check. Run the existing test suite, add tests for the visit engine's step order per job type and for the enable/disable rules (no-show, consumables reasons, hair-system scan, outcome readiness).
4. **Final report** in `docs/technician-redesign/REPORT.md`:
   - the old-to-new state mapping, marked done for every state
   - the backend gaps and their mocks
   - anything you could not match to the prototype, and why
   - the strings still missing Hindi

## Acceptance

- Each screen matches the prototype in layout, tokens and copy at 390 px.
- Every state in the 18 screenshot folders is reachable in the new app and appears in the mapping.
- The visit engine runs all five job-type flows end to end, including offline.
- Language switches mid-visit without losing state.
- No text under 13 px, no contrast failures, no touch target under 44 px.
- No colours, fonts or radii outside the token table.
