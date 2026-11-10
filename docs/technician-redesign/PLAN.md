# Technician app redesign: the plan

The brief is `docs/prompts/tech-redesign.md` (received 10 November 2026). The prototype and the Hindi catalog it names are kept read-only in `design/tech-redesign/`. This file is Step 0: the survey, the decisions it forced, every current state and where it goes, the backend gaps, and the order of work. The owner's answers of 10 November are in section 2. Each build step gets an ADR for what departs from the prototype, as the console's redesign did (ADRs 0225 to 0238).

## 1. The app as it stands

|                  |                                                                                                                                                                                                                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where            | `apps/tech` (`@maneman/tech`), served by the Worker on the technician host (ADR 0026)                                                                                                                                                                                                                                                         |
| Framework        | React 19, Vite, TypeScript strict. `index.html` → `src/main.tsx` → `src/App.tsx`                                                                                                                                                                                                                                                              |
| Routing          | The shared router (`packages/ui/router.tsx`): history paths, no library. `src/route.ts` turns a path into a `Route`                                                                                                                                                                                                                           |
| State            | No store library. IndexedDB through `src/store/*` (jobs, outbox, records, device, persist), read with hooks in `src/lib/*` (`useDay`, `useOutbox`, `useScreen`), `useLoad` from `packages/ui` for reads, and context for the session and the outbox                                                                                           |
| Styling          | CSS modules per component, tokens only: `packages/brand/tokens.css` (paper and ink), `tokens-apps.css`, `apps/tech/src/styles/tokens.css` (gloved sizes). Shared parts from `packages/ui` read `--ui-*` roles. Today the whole app is ink with gold on the one primary action (ADR 0025, item 59)                                             |
| Words            | Every word is in `src/content.ts` (960 lines), English only. A component holds no copy                                                                                                                                                                                                                                                        |
| Backend          | `src/api.ts` over the shared client (`packages/web-kit/api.ts`). Paths and bodies are typed from `src/api-schema.ts`, which `npm run openapi` writes from the API's own schemas. 31 paths under `/api/tech` (`docs/api-tech.md`)                                                                                                              |
| Offline          | Every write goes through the outbox (`src/store/outbox.ts`, ADR 0038, ADR 0053), each with a UUIDv7 `X-Client-Event-Id`, and the job's start in `X-Job-Starts-At`. Photos are kept in IndexedDB and uploaded by the outbox. A 409 `superseded` stops a job whose card changed. The API checks the steps' order (`src/policy/in-job-steps.ts`) |
| PWA              | `apps/tech/pwa.ts` (manifest), `apps/tech/sw/sw.ts` (the shell kept for a basement), `packages/web-kit/sw-update.ts` ("a new version is ready"). The iPhone home-screen note is a sign-in state                                                                                                                                               |
| Build and deploy | `npm run build:tech -- --env local\|staging\|production`, `import.meta.env.MM_ENV` in the app. Deployed with the Worker. Production is released weekly                                                                                                                                                                                        |
| Tests            | 17 Playwright specs in `e2e/tech` against a fake API (`e2e/tech/fake-tech.ts`), projects `tech`, `tech-live` and `tech-ios`; 41 Node tests under `test/node/apps/tech` and the architecture tests (shared controls, tokens, contrast)                                                                                                         |

### Routes today

| Path                                                                                                       | Screen                                                         |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| (no session)                                                                                               | Sign-in: number, code, every refusal and sign-out note         |
| `/`                                                                                                        | Today: the day's jobs, tomorrow folded, sign out in the header |
| `/waiting`                                                                                                 | What has not reached us: photo sets and queued writes          |
| `/kit`                                                                                                     | The kit: coming, held, to hand back                            |
| `/week`                                                                                                    | The next six days, a day at a time                             |
| `/month`                                                                                                   | This month's visits by kind, at the technician's rates         |
| `/leave`                                                                                                   | Asks for leave, and a new one                                  |
| `/jobs/:id`                                                                                                | The card; the no-show wait and the door photo are drawn on it  |
| `/jobs/:id/options`                                                                                        | A consultation's packages, prices and try-on looks             |
| `/jobs/:id/before-photos`, `/checklist`, `/consumables`, `/piece`, `/profile`, `/after-photos`, `/outcome` | The steps                                                      |
| `/jobs/:id/done`                                                                                           | The close-out                                                  |

## 2. Decisions

The owner answered every open question on 10 November 2026; those answers are marked (owner). Each departure from the prototype is recorded in its PR's ADR.

1. **Each PR replaces the live screens it covers (owner: no switch).** The PR deletes the old screens it replaces, with their styles and e2e specs, and production gets it with the weekly release. The new look's roles are scoped to the screens already replaced, so a screen not yet replaced keeps the ink it was drawn for. The scope widens to the whole app when the last old screen goes. The shared logic (`store/*`, `lib/*`, `steps/piece-form.ts`, `steps/label.ts`, `steps/drafts.ts`, `steps/useStep.ts`, `steps/sent-before.ts`) is kept and called as before.
2. **One component library.** Every new part is added to `packages/ui` (owner, 1 and 13 November: nothing custom in an app). The tech app holds screens and its own frame. Parts that exist are reused and given the new look through the `--ui-*` roles: Button, Sheet, ConfirmSheet, Chip, ToggleButton, TabBar, ListRow, DayTimeline, DateStrip, Switch, ScanField, PhotoCapture, Toast, InlineMessage and others. Parts to add include a stepper, a radio row, a segmented progress bar, a section head with its 2 px rule, a key and value row, a phone-style notification, a hold-to-confirm button for SOS, and a bottom action bar. The architecture test that refuses raw controls in apps stays.
3. **Tokens.** The brief's colours go into `packages/brand/tokens.css` under their brief names (`--navy-900` … `--error`). Those that are already brand colours keep their value: `navy-900` is `--ink` (#16233A) and `brass-500` is `--brass` (#B98B45). The tech app maps the `--ui-*` roles to them in `apps/tech/src/styles/look.css`. `test/node/apps/tech/tech-contrast.test.ts` holds the new look's pairs to the brief's 4.5:1, and the token guard refuses any colour, radius or shadow outside the table.
4. **Type (owner).** IBM Plex Sans 400/500/600 and IBM Plex Sans Devanagari 400/500/600, self-hosted from `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-sans-devanagari` (5.3.0), in `packages/brand/fonts-plex.css`, one family name split by `unicode-range`. Only the technician app loads it; the console, the client app and the site keep Instrument Sans and EB Garamond.
5. **The logo is the brand kit's drawing.** `MARK` and `WORDMARK_SMALL` are already in `packages/brand/marks.ts`, drawn by `packages/ui/Mark.tsx`, so the sign-in uses them in navy, with no placeholder.
6. **The steps are the API's, drawn as the brief's.** The API sets each visit's events and their order (`src/policy/in-job-steps.ts`) and refuses one sent early, so the visit engine is a table per visit type of _screens_. Each screen feeds one of the API's events, and several screens may feed one event (section 4). Where the owner changed a rule, the API changes with it: a consultation records no consumables, and a first fit takes the hair profile (PR 2).
7. **Words come from the prototype.** The brief makes the prototype's copy the copy. It is written under the copy rules already (tight, no system explanations), and `content.ts` takes it. Where the current app has a state the prototype does not draw (most refusals), the current words stay, restyled.
8. **Inches everywhere (owner).** Head measurements move from centimetres to inches in the API, the database and the console, as base sizes already are. One migration converts what is stored (÷ 2.54, to one decimal), the ranges are restated in inches, and the analytics copy's columns follow. A rewrite of stored data, so its short plan is shown before PR 2 runs it.
9. **The backend is built in this work (owner).** Every gap in section 5 gets its route, table and console part, in the PR that first needs it, so a real phone never shows an invented figure. Payments do not change (owner: the one visit's link still goes at close). The location work stores and wipes personal data, so its short plan is shown before PR 8 is built.
10. **Hindi.** `content.ts` stays the one catalog, keyed by stable paths, with English values. A Hindi catalog is derived from `strings-hi.json` (exact strings, then templates, then patterns, then date tokens), as the prototype derives it. A test lists every English string with no Hindi, so `REPORT.md` can name them. Names, sectors, labels, product names, amounts and am/pm stay as they are. The language is kept on the device and switches without remounting a screen, so a visit keeps its place.

## 3. Every current state, and where it goes

The current states are the 214 captured on 10 November 2026 (`test-results/tech-screens`, zip in Downloads). Each row says the new screen and how the state shows there. "Bar" is the new action bar with its helper line; "sheet" is a bottom sheet; "red card" is the 2 px error outline. All are restyled to the tokens; none is dropped.

### 01 Sign in → Sign in

| Current                                                                                                   | New                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 number empty · 02 too short · 03 typed · 04 sending                                                    | Sign in, number step: +91 field, Get code; the too-short error under the field; Get code waits with its helper line                                                        |
| 05 code sent · 06 part-typed · 07 wrong (tries left) · 08 expired · 09 new code available · 10 signing in | Sign in, code step: six boxes with `autocomplete="one-time-code"`, "Code sent to …", resend countdown then Send a new code, Change number; refusals in red under the boxes |
| 11 invalid · 12 too many codes · 13 codes not going out · 14 offline · 15 sign-in stopped                 | The same screen, each refusal in red, current words                                                                                                                        |
| 16 phone revoked · 17 switched off · 18 work kept                                                         | A note above the number step, current words                                                                                                                                |
| 19 home-screen app's first sign-in                                                                        | Note above the number step, current words                                                                                                                                  |
| 20 app opening                                                                                            | The checking state: the mark, centred, on white                                                                                                                            |
| (new)                                                                                                     | EN / हिन्दी switch at the top; "Number not registered? Call ops."                                                                                                          |

### 02 Today → Today (tab)

| Current                                                          | New                                                                                                                                 |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 01 the day · 09 every kind · 12 job closed                       | Today: date, "N jobs today", sync label, bell; Next job block; Later today rows with closed rows dimmed and their navy bar and word |
| 02 tomorrow open                                                 | Tomorrow row → Schedule on tomorrow                                                                                                 |
| 03 sign out asks · 16 with unsent work · 17 with no signal       | Moved to Me → Sign out sheet; the three states kept there                                                                           |
| 04 loading · 05 failed                                           | Today's loading and failed states (shared `States`)                                                                                 |
| 06 no signal                                                     | No-signal bar under the status area; sync label "Offline · n saved"                                                                 |
| 07 nothing today, tomorrow booked · 08 nothing today or tomorrow | Today with "No more jobs today." and the Tomorrow row, or nothing booked                                                            |
| 10 running over                                                  | Later-today row's third line warns it runs into the next                                                                            |
| 11 at the door                                                   | Next job block reads "At the door", opens At the door                                                                               |
| 13 all done                                                      | "All done today" title, Tomorrow row                                                                                                |
| 14 still open from yesterday                                     | Red card at the top: yesterday's open job                                                                                           |
| 15 unsent work at risk                                           | Red card at the top                                                                                                                 |
| 18 new version ready                                             | `UpdateReady`, restyled, resting on Today                                                                                           |
| 19 storage full                                                  | Storage-full bar above every screen                                                                                                 |
| 20 job changed banner · 21 job cancelled offline                 | Red card on Today; the blocking dialog if the job is open (section 4, interruptions)                                                |

### 03 Your week → Schedule (tab)

| Current                | New                                                                  |
| ---------------------- | -------------------------------------------------------------------- |
| 01 the next six days   | Schedule: week strip (today and the next six), day view 8 am to 8 pm |
| 02 loading · 03 failed | Schedule's loading and failed states                                 |

### 04 Your month → Me, Incentives

| Current                                 | New                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------- |
| 01 visits by kind                       | Me → Incentives: total, a line per kind, count × rate (`/api/tech/month`) |
| 02 nothing yet · 03 failed · 04 loading | The section's empty, failed and loading lines                             |

### 05 Your leave → Me → Leave

| Current                                                                      | New                                                                             |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 01 the form · 02 filled · 03 asked · 04 asks with ops / approved / declined  | Leave: From, To, Reason, Ask; Your requests with With ops / Approved / Declined |
| 05 bad dates · 06 did not go through · 07 no signal · 08 failed · 09 loading | The same screen, each in red under the form or in the list, current words       |

### 06 Kit → Kit (tab)

| Current                                                                                        | New                                                    |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 01 on its way · 03 one of two scanned · 04 rest missing · 05 scanning                          | Arriving: scan progress, Scan, Report missing, Receive |
| 02 label not on the transfer                                                                   | Red line under the scan                                |
| 06 handed back                                                                                 | Return to ops section, done state                      |
| 07 empty · 08 already received · 09 did not go through · 10 no signal · 11 failed · 12 loading | The same screen's states, current words                |
| (new)                                                                                          | Next 7 days table and Request to ops (PR 9)            |

### 07 Job card and the door → Job, At the door, Client history

| Current                                                                                                                                     | New                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 before arriving · 02 everything on it · 30 consultation · 31 first fit with a profile warning · 32 replacement · 33 consultation and fit | Job: map, address and landmark, gate code with Copy, client's note, Navigate / Call / Message, client alerts, handoff, Client history, Hair profile or consultation, How this visit is done, Check in |
| 03 no map pin                                                                                                                               | The map slot reads the address only, with no pin                                                                                                                                                      |
| 04 no WhatsApp updates                                                                                                                      | Message is replaced by Call, with the current line                                                                                                                                                    |
| 05 update sheet · 06 30 min chosen · 07 sent · 08 again after sending                                                                       | Message sheet: 10/20/30/45/60, On my way / Running late; "Sent: …" under the actions                                                                                                                  |
| 09 not open yet · 10 no position · 11 too far · 12 unmeasured · 39 awaiting answer                                                          | Check in's helper line and red line, current words; "checking in" waits on the bar                                                                                                                    |
| 13 to 20 · 24 the wait states (delivered, not delivered, none sent, telling the client, arrived early, wait over, no signal)                | At the door: timer and brass bar, the three-line checklist, each delivery state on its line                                                                                                           |
| 14 door camera · 15 photo taken · 25 door camera refused                                                                                    | Door photo camera (single shot); refused state on the camera screen                                                                                                                                   |
| 21 confirm, prepaid · 22 confirm, nothing paid · 23 too early                                                                               | Close as no-show sheet; too early as a red line                                                                                                                                                       |
| 26 in progress                                                                                                                              | Job's bar: Continue → visit plan                                                                                                                                                                      |
| 27 closed out                                                                                                                               | Job's bar: View summary → closed                                                                                                                                                                      |
| 28 tomorrow's job · 29 locked                                                                                                               | Tomorrow: Job without Check in; locked: the Schedule preview (time, area, payment, "Name and address from 6 pm the day before.")                                                                      |
| 34 loading · 35 failed · 36 not on your list · 37 given away · 38 moved                                                                     | The same, restyled; the changed states as red cards                                                                                                                                                   |

### 08 Options → visit step Options

| Current                                                             | New                                                                                                                                                                                          |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 packages and looks · 02 nothing on sale · 03 loading · 04 failed | Options step: each product with first fit, service visit and replacement prices incl. GST, "Price not set", a radio for the client's pick, and the try-on looks beneath. Its states are kept |

### 09 Before photos, 14 After photos → visit steps Before / After photos

| Current                                                                      | New                                                                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 09/01 to 06, 14/01 to 02 the five angles, all five                           | Camera: head overlay, prompt per angle, thumbnail strip with the current one in brass, Done |
| 07 retake, torch on                                                          | Retake, Torch                                                                               |
| 08 camera refused                                                            | "Camera access is off", Open settings, Continue without photos (ops are told)               |
| 09 came out blank · 12 storage full · 13 refused, retake · 14 camera opening | The same states on the camera; storage full as the red bar with the shutter off             |
| 10 no signal · 11 job changed                                                | No-signal bar, "Saved on phone"; the changed-job dialog                                     |
| (new)                                                                        | Compare with the last visit (before) or today's before (after)                              |

### 10 Checklist → visit steps Service / Fitting / Scalp and hairline (guided tasks)

| Current                           | New                                                                                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 to 07 each visit type's list   | One task per screen, from the job's checklist items in ops' order. Instructions come from the data file by item id, or the item's label alone where the file has none |
| 08 consultation and fit, declined | The consultation's tasks only                                                                                                                                         |
| 09 refused, correct it            | Red card on the visit plan and the step; "Needs a fix"                                                                                                                |

### 11 Consumables → visit step Consumables

| Current                                                                                  | New                                                                                                                    |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 01 as expected · 02 more · 03 less · 04 reason picked · 07 typing a count · 08 none used | Steppers at the usual amount; reason chips under an item that differs ("Why 1 less?"); Next waits with "Pick a reason" |
| 05 add a consumable · 06 more than the kit holds                                         | Add item; the kit-holds warning on the item                                                                            |
| 09 none to record · 10 refused                                                           | The same, restyled                                                                                                     |

### 12 Piece → visit step Hair system

| Current                                                | New                                                                                                                                           |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 to 14, 16, 20, 21 every label, kit and client state | Hair system: paid for / chosen / new piece and its spec, "Replacing …"; Scan first, checked as it reads; Type the code; every current message |
| 15 can't fit today                                     | Can't fit today sheet with reasons → closed, not fitted                                                                                       |
| 17 client's choice · 18 chose · 19 declined            | The one visit's Decision step (section 4)                                                                                                     |
| (new)                                                  | No waiting for payment: the link still goes at close (owner)                                                                                  |

### 13 Profile → visit steps Hair profile and Colour and style

| Current                                    | New                                                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| 01 measure · 02 out of range · 03 filled   | Hair profile: Norwood chips, head and base in inches                                           |
| 04 match · 05 chosen                       | Colour and style: texture, hairline, colour, product, fixing chips                             |
| 06 history · 07 filled                     | Kept as a third part of Colour and style ("History"), since the API takes it in the same event |
| 08 from the profile on record · 09 refused | "From consultation, <date>"; refused as a red card                                             |

### 15 Outcome → visit step Outcome (and Decision on a one visit)

| Current                                                                             | New                                                                                 |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 01 nothing chosen · 02 to 04 partly done / done                                     | Done / Partly done radios, reasons, the bar's helper line                           |
| 05 to 08 consultation going ahead / not now                                         | Going ahead with a fit? Yes / Not now, reasons                                      |
| 09 one visit's payment link · 10 to 13 discount code states · 14 one visit declined | Decision step: product, price, discount code and Apply, When; every code state kept |
| 15 refused                                                                          | Red card                                                                            |
| (new)                                                                               | Note for the next technician, typed (no voice note, owner)                          |

### 16 Close-out → Closed

| Current                                                                                                                                                         | New                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 done · 02 partly done · 03 / 04 consultation · 05 free consultation · 06 / 07 link sent / paid · 08 no-show · 09 not closed yet · 10 photos queued, last job | Closed: icon, title by result, summary rows, payment link status with Resend, Finish the work (partly done, not fitted), Next with its leave-by, Today and Navigate |

### 17 Waiting → Me → Pending uploads

| Current              | New                                                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 to 10 every state | Pending uploads: per item progress and status, Retry, Delete this job's work (asked first), "Photos on Wi-Fi only"; the unsent-at-risk card also on Today |

### 18 Errors

| Current                         | New                                  |
| ------------------------------- | ------------------------------------ |
| 01 a screen that failed to draw | The error boundary, restyled, Reload |

## 4. The visit engine

A table per visit type lists its screens. Each screen names the API event it feeds, if any, and the event is queued when its last screen is done. The API's order is the queue's order.

| Visit type           | Screens (UI)                                                                                                                                                             | API events, in the API's order                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Service              | Before photos · Service (tasks) · Consumables · After photos · Outcome                                                                                                   | before_photos · checklist · consumables · after_photos · outcome                                |
| Replacement          | Before photos · Hair system · Fitting (tasks) · Consumables · After photos · Outcome                                                                                     | before_photos · piece · checklist · consumables · after_photos · outcome                        |
| First fit            | Before photos · Hair profile · Colour and style · Hair system · Fitting (tasks) · Consumables · After photos · Outcome                                                   | before_photos · piece · checklist · consumables · after_photos · outcome; profile (not ordered) |
| Consultation         | Before photos · Scalp and hairline (tasks) · Hair profile · Colour and style · Options · Outcome                                                                         | before_photos · checklist · outcome; profile (not ordered)                                      |
| Consultation and fit | Before photos · Scalp and hairline (tasks) · Hair profile · Colour and style · Options · Decision · Hair system · Fitting (tasks) · Consumables · After photos · Outcome | before_photos · piece · checklist · consumables · after_photos · outcome; profile (not ordered) |

How the screens sit on the API's events:

- **A consultation records no consumables (owner).** PR 2 takes consumables out of a consultation's steps, its job sheet and its shortfall rule. A consultation and fit keeps them, since a fit uses the kit.
- **A first fit's Hair profile and Colour and style are saved (owner).** PR 2 lets the API take the profile at a first fit. The screens open on the consultation's ("From consultation, 3 Nov"), the technician corrects them on the head, and the profile is queued after Colour and style, before the hair system.
- **A consultation and fit's tasks are one event.** The API takes the checklist after the piece. The scalp and hairline tasks are kept on the phone and queued with the fitting's, as one checklist, after the hair system. A client who decides against the fit queues the consultation's items once the decision is made.
- **The one visit's decision is the piece event.** "Going ahead with a fit?" with Fit today is the piece event with the product, sent with the scanned label. Not now is `{ declined: true }`. "Book the first fit" closes as a consultation going ahead (`going_ahead: true`); PR 6 makes sure the API takes that on a one visit.
- **Payments as today (owner).** The one visit's link goes at its close, with the discount code, as now; there is no "Waiting for payment" state. A plain consultation's Yes / Not now is unchanged, and ops book the first fit.
- **The tasks are the job's checklist.** Ops set the checklist per visit type in Settings, Job sheet (the rule stays theirs). The training lead's words (title, reference photo, instructions, Watch for) are in `apps/tech/src/visit/tasks.ts`, keyed by checklist item id (`piece_removed`, `scalp_cleaned` …), with the prototype's draft text. An item the file does not know shows its label alone. A consultation's three items (scalp, measurements, options) are its three tasks.

Every step screen has the header (step name, "client · visit type", shield), the segmented bar, "Step n of N" with All steps ›, and one action, "Next: <next step>". The visit plan lists every screen with done / now / to-do. A step the API refused, or one ops sent back (PR 7), marks its screens "Needs a fix", with a red card on the plan and on Today.

Interruptions: a 409 `superseded` or `already_closed` on any write, a card that comes back changed, or a job-change push (PR 10) opens the blocking dialog ("… was cancelled" / "… moved to Imran K.", saved and sent to ops). Its two actions are Call ops and Back to Today. While the phone is offline, the dialog opens on the next answer.

Tests: a Node test per visit type for the screen order and the events each screen queues (`test/node/apps/tech/visit-engine.test.ts`). Others cover the enable rules: no-show (wait over, call and photo done), consumables (a reason for each differing count), the hair system (a checked label), and the outcome (a result, and a reason where one is asked).

## 5. The backend this work adds

Checked against the 31 routes in `docs/openapi-tech.json`. The owner ruled on 10 November that the backend for each gap is built in this work. What exists is used as it stands.

| #   | The brief needs                                             | Built                                                                                                                                                                                                                                                                                                                                                                                                                   | PR    |
| --- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 1   | Client-level history, notes and alerts                      | `GET /api/tech/jobs/{id}/client-history`: the client's visits newest first, each with type, date, technician, result, note, the five after-photo thumbnails, consumables and the piece fitted. Client alerts in their own table, kept on the client and not the job, so they survive reassignment. Ops and care add and remove them on the console's client page; a technician can flag one at close                    | 4     |
| 2   | The next technician's note                                  | The outcome takes a typed `handoff_note`, kept on the client's record and shown as Handoff on their next job, whoever takes it. No voice note (owner)                                                                                                                                                                                                                                                                   | 4     |
| 3   | Drive time and leave-by per job                             | Each job on the day's list carries `drive_minutes` and `leave_by`, from the technician's home pin or the job before, by the existing drive estimate (`src/policy/drive-estimate.ts`; Google Routes where that provider is on)                                                                                                                                                                                           | 3     |
| 4   | Alerts: time to leave, day ahead, job changes, running over | Web push (owner): VAPID keys as secrets, the technician's subscriptions and per-kind settings, sent by the cron (time to leave, 8 pm day ahead), by ops' changes to a job, and by the running-over check. The service worker shows each with Navigate and Open job                                                                                                                                                      | 10    |
| 5   | Ops sending back a step, with a reason                      | The console's visit drawer gives each landed step Send back, with a reason (owner). The card carries it, Today and the visit plan show it, and resending clears it. The correction window opens for a step sent back                                                                                                                                                                                                    | 7     |
| 6   | Job cancelled or moved, live                                | The job-change push (gap 4), plus the 409 and the card as now                                                                                                                                                                                                                                                                                                                                                           | 7, 10 |
| 7   | Kit forecast for 7 days, request to ops                     | `GET /api/tech/kit` carries `forecast`: the next seven days' consumables, from the job sheet's expected counts for each booked visit, against what the kit holds. `POST /api/tech/kit/requests` makes an ops task                                                                                                                                                                                                       | 9     |
| 8   | Label validation against the kit and the client             | Exists: `GET /api/tech/pieces/lookup`                                                                                                                                                                                                                                                                                                                                                                                   | —     |
| 9   | Discount codes, payment link, status                        | Exists, unchanged (owner)                                                                                                                                                                                                                                                                                                                                                                                               | —     |
| 10  | Reschedule with a reason                                    | `POST /api/tech/jobs/{id}/reschedule-request` (Client asked, Running late, Kit problem) makes an ops task; the card shows "Reschedule asked"                                                                                                                                                                                                                                                                            | 9     |
| 11  | Quality, incentives                                         | `GET /api/tech/quality`, last 30 days: on time (checked in by the booked start) and redo rate (first fits followed by a free refit within 30 days) (owner). The client rating follows once ratings exist. Incentives exist: `/api/tech/month`                                                                                                                                                                           | 9     |
| 12  | The profile at a first fit                                  | The API takes it (owner)                                                                                                                                                                                                                                                                                                                                                                                                | 2     |
| 13  | Leave requests and status                                   | Exists: `/api/tech/leave`                                                                                                                                                                                                                                                                                                                                                                                               | —     |
| 14  | SOS and live location                                       | `POST /api/tech/jobs/{id}/position`, the latest position only, from check-in, wiped at close (owner). `POST /api/tech/sos` posts an urgent alert to the ops alert chat with the technician, job and a map link, and puts a banner on every console screen until someone marks it handled; positions are kept with the SOS until then (owner). Needs a line in the technicians' privacy notice (counsel) before it ships | 8     |
| 15  | Me: role, city, phone                                       | `GET /api/tech/me` carries them                                                                                                                                                                                                                                                                                                                                                                                         | 9     |
| 16  | A visit's elapsed bar and "Finish by"                       | Exists: `starts_at`, `ends_at`, `progress.started_at`                                                                                                                                                                                                                                                                                                                                                                   | —     |
| 17  | Gate code                                                   | The access notes, shown as the way-in line with Copy (owner). No new field                                                                                                                                                                                                                                                                                                                                              | 5     |
| 18  | Head measurements in inches                                 | Migration and API, console and analytics in inches (owner)                                                                                                                                                                                                                                                                                                                                                              | 2     |
| 19  | A consultation without consumables                          | Steps, job sheet and shortfall rule (owner)                                                                                                                                                                                                                                                                                                                                                                             | 2     |

## 6. Order of work

Eleven PRs, each from `origin/main`, pushed once when its step is done (owner, 13 October). Each PR replaces the screens it covers, deletes the old ones with their specs, and has an ADR for what it departs from in the prototype. Each sets its screens beside the prototype's at 360 and 390 px (Hindi from PR 11) and runs the large-text check. Estimate: about 98 hours of build time, eight days of continuous work.

| PR  | What                                                                                                                                  | Hours | Checked by                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------- |
| 1   | The plan, the brief, the design files. Tokens, Plex fonts, the scoped look. Base parts in `packages/ui`                               | 5     | Token, contrast and shared-control tests; a parts page at 360 and 390 |
| 2   | Visit rules and inches: a consultation without consumables, the profile at a first fit, the measurements migration (plan shown first) | 8     | Policy and route tests; the migration run on a copy of staging's data |
| 3   | Tab shell and Today, with drive time and leave-by                                                                                     | 6     | e2e on Today                                                          |
| 4   | The client's record: history, alerts, the next technician's note; the console's client page                                           | 8     | Route and console tests                                               |
| 5   | Job, Message sheet, At the door, door camera, the visit engine and its plan, before and after photos                                  | 8     | Engine tests; e2e check-in to before photos                           |
| 6   | Guided tasks, consumables, hair profile, colour and style, hair system, options, decision, outcome                                    | 9     | Enable-rule tests; e2e through each visit type                        |
| 7   | Closed, offline, interruptions, pending uploads; ops sending back a step                                                              | 11    | e2e offline, refused and sent-back flows                              |
| 8   | Safety: SOS and live location (plan shown first)                                                                                      | 8     | Route tests; the console banner; positions wiped at close             |
| 9   | Schedule and its preview; Kit with the forecast and requests; Me with quality, incentives, leave, contact, sign out; reschedule       | 15    | e2e for each                                                          |
| 10  | Guides; Alerts with web push and its settings                                                                                         | 14    | Push tests against a fake push service; e2e for each                  |
| 11  | Hindi on every screen; `REPORT.md`                                                                                                    | 6     | Missing-Hindi test; screenshots in both languages                     |

## 7. Still owed by others

- **Counsel:** a line in the technicians' privacy notice for the live location and SOS positions, before PR 8 ships.
- **A native Hindi speaker:** a review of `strings-hi.json`, the guide steps first (the brief asks for it in the PR).
- **The owner:** a yes on the two short plans shown before they run, for the measurement migration (PR 2) and the location data (PR 8).
