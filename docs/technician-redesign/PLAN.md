# Technician app redesign: the plan

The brief is `docs/prompts/tech-redesign.md` (received 10 November 2026). The prototype and the Hindi catalog it names are kept read-only in `design/tech-redesign/`. This file is Step 0: the survey, the decisions it forced, every current state and where it goes, the backend gaps, and the order of work. Each build step gets an ADR for what departs from the prototype, as the console's redesign did (ADRs 0225 to 0238).

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

## 2. Decisions this plan takes

Each is recorded in ADR 0239 when the first PR lands. The owner can overrule any of them; the default stands until then.

1. **The new look ships behind a switch until the last PR.** Production technicians must never see half a redesign: the weekly release would otherwise ship whichever steps had merged. The new screens are new files beside the old ones, and `App.tsx` picks between them by one switch: on for staging builds, off for production, and settable on any phone through the URL `?look=new` / `?look=old`, kept in local storage for testing. The old e2e specs keep running against the old screens until the last PR. That PR turns the switch on everywhere, then deletes the old screens, their styles, their e2e specs and the switch. The shared logic (`store/*`, `lib/*`, `steps/piece-form.ts`, `steps/label.ts`, `steps/drafts.ts`, `steps/useStep.ts`, `steps/sent-before.ts`) is not duplicated: the new screens call it as the old ones do.
2. **One component library.** Every new part is added to `packages/ui` (owner, 1 and 13 November: nothing custom in an app). The tech app holds screens and its own frame. Parts that exist are reused and given the new look through the `--ui-*` roles: Button, Sheet, ConfirmSheet, Chip, ToggleButton, TabBar, ListRow, DayTimeline, DateStrip, Switch, ScanField, PhotoCapture, Toast, InlineMessage and others. Parts to add include a stepper, a radio row, a segmented progress bar, a section head with its 2 px rule, a key and value row, a phone-style notification, a hold-to-confirm button for SOS, and a bottom action bar. The architecture test that refuses raw controls in apps stays.
3. **Tokens.** The brief's colours go into `packages/brand/tokens.css` under their brief names (`--navy-900` … `--error`). Those that are already brand colours keep their value: `navy-900` is `--ink` (#16233A) and `brass-500` is `--brass` (#B98B45). The tech app maps the `--ui-*` roles to them in a new `apps/tech/src/styles/theme.css`, scoped to the new look so the old screens keep ink until they are deleted. `test/node/apps/tech/tech-contrast.test.ts` checks every text pair against 4.5:1. The token guard refuses any colour, radius or shadow outside the table.
4. **Type.** IBM Plex Sans 400/500/600 and IBM Plex Sans Devanagari 400/500/600, self-hosted from `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-sans-devanagari` (5.3.0, published July 2026, past the three-day release age). This is the existing @fontsource pattern. It goes in a new `packages/brand/fonts-plex.css`, under one family name split by `unicode-range`, imported by the tech app alone. The console, the client app and the site keep Instrument Sans and EB Garamond. _This is the one place the technician app leaves the brand's typefaces; the brief names Plex, and Instrument Sans has no Devanagari._
5. **The logo is the brand kit's drawing.** `MARK` and `WORDMARK_SMALL` are already in `packages/brand/marks.ts`, drawn by `packages/ui/Mark.tsx`, so the sign-in uses them in navy, with no placeholder.
6. **The steps are the API's, drawn as the brief's.** The API sets each visit's events and their order (`src/policy/in-job-steps.ts`) and refuses one sent early, so the visit engine is a table per visit type of _screens_. Each screen feeds one of the API's events, and several screens may feed one event (section 4). No event, body or order changes.
7. **Words come from the prototype.** The brief makes the prototype's copy the copy. It is written under the copy rules already (tight, no system explanations), and `content.ts` takes it. Where the current app has a state the prototype does not draw (most refusals), the current words stay, restyled.
8. **Head measurements in inches, stored in centimetres.** The API keeps `head_circumference_cm` and the rest in centimetres. The screen shows and takes inches to one decimal, and converts at the edge: 22.6 in is sent as 57.4 cm, and 57.4 cm shows as 22.6 in. The API's ranges are checked in centimetres as now, and the out-of-range message names the range in inches.
9. **What the API does not provide is shown only where it exists.** Every gap in section 5 gets a typed adapter in `apps/tech/src/gaps/` with two implementations. One reads the API, and while there is no route it answers "not available". The other is a mock, used by the local build, the e2e fake and the screenshot harness. A real phone therefore never shows an invented figure, alert or note: the section is left out, or the step behaves as it does today, until the route exists. The console's redesign set the same rule: figures only from the API.
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
| (new)                                                                                          | Next 7 days table and Request to ops: gap 7            |

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
| (new)                                                  | Waiting for payment, where the API supports it (gap 9)                                                                                        |

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
| (new)                                                                               | Note for the next technician: text now, voice note behind gap 2                     |

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
| First fit            | Before photos · Hair profile · Colour and style · Hair system · Fitting (tasks) · Consumables · After photos · Outcome                                                   | before_photos · piece · checklist · consumables · after_photos · outcome                        |
| Consultation         | Before photos · Scalp and hairline (tasks) · Consumables · Hair profile · Colour and style · Options · Outcome                                                           | before_photos · checklist · consumables · outcome; profile (not ordered)                        |
| Consultation and fit | Before photos · Scalp and hairline (tasks) · Hair profile · Colour and style · Options · Decision · Hair system · Fitting (tasks) · Consumables · After photos · Outcome | before_photos · piece · checklist · consumables · after_photos · outcome; profile (not ordered) |

Where this departs from the brief's table, and why:

- **A consultation keeps Consumables.** The API takes a consultation's consumables before its outcome, and the shortfall rule (fewer than expected needs a reason) applies to it. Where ops expect none, the step is the current "nothing to record" screen.
- **A first fit's Hair profile and Colour and style are read-only.** The API takes a profile only at a consultation and a one visit (`takesProfile`). A first fit shows the consultation's, "From consultation, 3 Nov", with Next. Editing them at a first fit is gap 12.
- **A consultation and fit's tasks are one event.** The API takes the checklist after the piece. The scalp and hairline tasks are kept on the phone and queued with the fitting's, as one checklist, after the hair system. A client who decides against the fit queues the consultation's items once the decision is made.
- **The one visit's decision is the piece event.** "Going ahead with a fit?" with Fit today is the piece event with the product, sent with the scanned label. Not now is `{ declined: true }`. "Book the first fit" closes as a consultation going ahead (`going_ahead: true`); whether the API takes that on a one visit is checked in PR 4.
- **A plain consultation sends no payment link.** The API sends a link only from a one visit, at its close. A plain consultation's Yes / Not now is unchanged. A link from a plain consultation, and a link sent before the fit with the Hair system step waiting on it, are gap 9.
- **The tasks are the job's checklist.** Ops set the checklist per visit type in Settings, Job sheet (the rule stays theirs). The training lead's words (title, reference photo, instructions, Watch for) are in `apps/tech/src/visit/tasks.ts`, keyed by checklist item id (`piece_removed`, `scalp_cleaned` …), with the prototype's draft text. An item the file does not know shows its label alone. A consultation's three items (scalp, measurements, options) are its three tasks.

Every step screen has the header (step name, "client · visit type", shield), the segmented bar, "Step n of N" with All steps ›, and one action, "Next: <next step>". The visit plan lists every screen with done / now / to-do. A refused event marks its screens "Needs a fix", with a red card on the plan and on Today.

Interruptions: a 409 `superseded` or `already_closed` on any write, or a card that comes back changed, opens the blocking dialog ("… was cancelled" / "… moved to Imran K.", saved and sent to ops). Its two actions are Call ops and Back to Today. While the phone is offline, the dialog opens on the next answer, as the changed-job banner does today. Live delivery is gap 6.

Tests: a Node test per visit type for the screen order and the events each screen queues (`test/node/apps/tech/visit-engine.test.ts`). Others cover the enable rules: no-show (wait over, call and photo done), consumables (a reason for each differing count), the hair system (a checked label), and the outcome (a result, and a reason where one is asked).

## 5. Backend gaps

Checked against the 31 routes in `docs/openapi-tech.json`.

| #   | The brief needs                                                           | The API today                                                                                                                                                                                     | Built as                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Client-level notes, photo history, alerts                                 | The client's own note (`client.note`), the last visit's date, technician and one photo (`last_visit`), the hair profile and history. No per-visit history, no alerts, no photo sets across visits | Adapter `clientHistory`. The real one gives the last visit from `last_visit`, and the client's note. Alerts and the visit list come from the mock                                                                                              |
| 2   | The handoff note written at close, and a voice note                       | None: the outcome takes no note                                                                                                                                                                   | Note field drawn; the real adapter says not available, so the field is left out on a real phone. Mock in local and e2e                                                                                                                         |
| 3   | Drive time and leave-by per job                                           | None                                                                                                                                                                                              | Adapter `travel`. The real one has none: rows show no drive line, and the day view has no drive blocks. Mock fills them                                                                                                                        |
| 4   | Push: time to leave, day ahead, job changes, running over; alert settings | None; no web push for technicians                                                                                                                                                                 | Alerts screen and settings over adapter `alerts`. Real: an empty inbox and no settings row; the bell hidden. Mock fills them. The phone-style notification is drawn for the mock                                                               |
| 5   | Ops rejecting a submitted step, with a reason                             | A write the API refuses (400 with fields) is kept as refused, with the reference (`store/verdict.ts`). No ops review after the event lands                                                        | Built on the refusals the API gives now. Ops' after-the-fact rejection is gap 5                                                                                                                                                                |
| 6   | Job cancelled or reassigned, live                                         | A 409 `superseded` on the next write; the card read again                                                                                                                                         | Built on the 409 and on reading the card. Live delivery is gap 6                                                                                                                                                                               |
| 7   | Kit forecast for 7 days, request to ops                                   | Kit held, coming, returned (`/api/tech/kit`); no forecast, no request                                                                                                                             | Adapter `kitForecast`; real: section left out. Mock fills it                                                                                                                                                                                   |
| 8   | Label validation against the kit and the client                           | `/api/tech/pieces/lookup`                                                                                                                                                                         | Uses it                                                                                                                                                                                                                                        |
| 9   | Discount codes, payment link send and status                              | `/discount-code`; `payment_link {url, paid}` on a one visit's card, sent at close                                                                                                                 | Uses them. The link sent before the fit, with Hair system waiting on payment, and a link from a plain consultation, are gaps: the real adapter answers not supported, and the step does not wait                                               |
| 10  | Reschedule with a reason                                                  | None for technicians (the client app has its own)                                                                                                                                                 | Adapter `reschedule`; real: the link left out. Mock fills it                                                                                                                                                                                   |
| 11  | Quality metrics, per-visit incentive rates and counts                     | Incentives: `/api/tech/month` (kind, visits, rate, amount). Quality: none                                                                                                                         | Incentives from the API. Quality over adapter `quality`; real: section left out                                                                                                                                                                |
| 12  | Editing the profile at a first fit                                        | Refused: the profile is a consultation's and a one visit's                                                                                                                                        | Read-only at a first fit                                                                                                                                                                                                                       |
| 13  | Leave requests and status                                                 | `/api/tech/leave`                                                                                                                                                                                 | Uses it                                                                                                                                                                                                                                        |
| 14  | SOS and live location during a visit                                      | None                                                                                                                                                                                              | Safety sheet: Call ops and Call 112 work as `tel:` links. The SOS hold and "Ops can see your location" go over adapter `safety`. Real: not available, so neither is drawn; a phone never says ops can see it when they cannot. Mock fills them |
| 15  | Me: role, city, phone                                                     | `/api/tech/me`: name, initials, device                                                                                                                                                            | Name from the API; role, city and phone over adapter `profile`, mock in local and e2e                                                                                                                                                          |
| 16  | A visit's elapsed bar and "Finish by"                                     | `starts_at`, `ends_at`, `progress.started_at`                                                                                                                                                     | Uses them                                                                                                                                                                                                                                      |
| 17  | Gate code                                                                 | `access_notes` (free text)                                                                                                                                                                        | Shown as the way-in line, with Copy. A separate gate code field is gap 17                                                                                                                                                                      |

`REPORT.md` lists each gap with its mock and what a real phone shows until the API has it.

## 6. Order of work

One PR per step, each from `origin/main`, pushed once when the step is done (owner, 13 October). Each PR has an ADR for what it departs from in the prototype, its screens beside the prototype's at 360 and 390 in English (Hindi from PR 8 on), and the large-text check. The switch keeps every PR off production until PR 8.

| PR  | What                                                                                                                                                                                                                                                                                                   | Checked by                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| 1   | Plan, the brief, the design files. Tokens, Plex fonts, the scoped theme. Base parts in `packages/ui`: buttons in the new look, rows, section head, key and value row, chips, stepper, radio row, checkbox row, sheet, action bar, segmented bar, notification, hold button, plus the tech app's switch | Unit and architecture tests (tokens, contrast, shared controls), a parts page rendered at 360 and 390 |
| 2   | Tab shell (Today, Schedule, Kit, Me; tabs hidden in a visit), the no-signal bar, sync label, Today with every 02 state                                                                                                                                                                                 | e2e `tech-v2-today` against the fake                                                                  |
| 3   | Job, Message sheet, At the door, door camera, the visit engine and its plan, the step frame, before and after photos                                                                                                                                                                                   | Engine unit tests; e2e for check-in to before photos                                                  |
| 4   | Guided tasks, consumables, hair profile, colour and style, hair system, options, decision, outcome                                                                                                                                                                                                     | Enable-rule tests; e2e for each visit type through to the outcome                                     |
| 5   | Closed, interruptions, Safety sheet, pending uploads, every refusal state                                                                                                                                                                                                                              | e2e offline and refused flows                                                                         |
| 6   | Schedule and its preview, Kit, Me (quality, incentives, leave, contact, sign out)                                                                                                                                                                                                                      | e2e for each                                                                                          |
| 7   | Guides library, Alerts inbox and settings, notifications                                                                                                                                                                                                                                               | e2e for each                                                                                          |
| 8   | Hindi and the switch on every screen; the switch turned on, the old screens and specs deleted; `REPORT.md`                                                                                                                                                                                             | Missing-Hindi test, the full tech e2e on the new screens, the screenshot set in both languages        |

## 7. For the owner

None of these blocks the work; each default above stands until changed.

- The new look on staging from PR 1, production only at PR 8 (decision 1).
- The technician app on IBM Plex Sans, the rest of the brand on Instrument Sans (decision 4).
- Measurements shown in inches, stored in centimetres (decision 8).
- Every gap in section 5 hidden on real phones until its route exists (decision 9). Several are worth building: the handoff note, drive time, SOS and location, the payment link before the fit, and reschedule. Each is a backend task of its own and is not in these PRs.
