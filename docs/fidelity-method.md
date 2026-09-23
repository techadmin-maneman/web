# The fidelity method

How `npm run fidelity` pairs the design with the build. Its screenshots are in `docs/fidelity/`.

## Phase 1

`scripts/fidelity.ts` opens the design and the local build in Chromium and shoots them side by side, section by section.

- **The design's libraries** are React 18.3.1, ReactDOM 18.3.1 and `@babel/standalone` 7.29.0. The design fetches them from unpkg; the run answers those requests with the same versions from `node_modules`. React 18.3.1 stays at the repository root for this reason, whatever version an app uses.
- **Fonts.** The design loads its fonts from Google, and the build self-hosts the same families (`packages/brand/fonts.css`). Both wait for `document.fonts.ready`.
- **Video** is blocked on both sides, so both show the poster.
- **Fixed bars** are hidden while the sections are shot, then shot on their own.

Any difference in type, spacing, colour or order is a defect.

## Phase 2 boards

The Phase 2 files in `design/phase2` run on the same prototype runtime. `test/node/phase2-inputs.test.ts` checks that their `support.js` is byte-identical to `design/support.js`, so the same library routing renders them. Pairs for the client, technician and ops apps follow the Phase 1 method, with two differences:

- **Compare frames, not boards.** A spec board draws several states side by side, with captions and notes around them. Crop the design to the one frame a screen matches, such as `A2 · Code · after 30 seconds`, and shoot the build in that state (a `?state=` preview, as the Phase 1 site has).
- **Match the frame's width:**
  - the client and technician apps at 390 px, the width of the phone frames;
  - the ops console at 1440 px, scaled to the 1000 px the board shows it at.

The board's own furniture is not part of the product: the canvas (`#CFCABE`), captions and notes. The Prototype is a reference for flow and timers only, and a spec board overrules it (`design/phase2/README.md`).

## The client app (P2-F1 and P2-F2)

`npm run build:app -- --env local && npm run fidelity:app` writes `docs/fidelity/client-app/`: board A1 to A3, B1, B2, B3's three states, C1 to C4, C5's first fit, C6's three states, C9, D1, D2, D3's empty, loading and download states, E1, E2, E3's empty and unavailable states, G1 and G2.

- **The app's API is answered with the design's own example,** Rohit Malhotra with a consultation on Sat 21 Sep, or, fitted, his next service visit on Thu 19 Sep with Imran. No mm-api runs. The login's timers run on Playwright's clock, so A2 is shot 30 seconds after the code was sent, as it is drawn. The payments are shot with the clock in 2027, the year the design dates them in.
- **The design's photographs are ink blocks with the angle written on them.** The app's are answered with blocks of the same inks (D2's two sides differ, as drawn), and carry no captions.
- **The status bar the phone frames draw is cropped off,** and the app is shot 44 px shorter to match. A2 and A3 draw their back arrow in that band, so both keep it and are shot at the full 844 px.
- **B3, D3, E3 and G2 are not phone screens.** B3, D3 and E3 draw small frames, each with a caption, and G2 the account's three cards on their own. Each is set beside the app's whole screen in that state, or its three cards.

These differences are known and stand:

| Pair     | Difference                                                                                        | Why                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| A1       | The design shows the typed number masked                                                          | A client sees the digits they type                                                                |
| A2       | "If +91 98xxx x4417 has a booking with us, a code is on its way on WhatsApp", and a link to A3    | The owner's neutral ruling (ADR 0030)                                                             |
| A3       | Titled "No booking on this number?"                                                               | The same ruling                                                                                   |
| B3 error | Centred on the screen                                                                             | The error is the whole screen, where the board draws a small frame                                |
| B1       | No credit tile and no prompt                                                                      | They arrive with the credits (P2-M3) and the pieces (P2-M4)                                       |
| B1       | Reschedule and Add a note are the same width                                                      | As on B2, whose pair matched; the design pads the second button                                   |
| C1       | No "Prepaid"                                                                                      | Prepayment arrives with booking (P2-M5)                                                           |
| C9, D1   | The photographs carry no captions; C9 has no "What was done"                                      | The prompt: "no captions"; what was done arrives with the job sheet (P2-M4)                       |
| D3       | The photograph opens large in a sheet, above the download line, with Close                        | A tap on a thumbnail shows the photograph; the board draws the download line alone                |
| E1       | Newest first, and no charge or credit                                                             | The board lists its entries in no order; charges and credits arrive with P2-M5 and P2-M3          |
| E2       | "UPI", without the UPI app                                                                        | Razorpay does not always say which app paid; the owner ruled to show "UPI" (ADR 0025, item 29)    |
| E3       | The pair shows the receipt's line, a placeholder                                                  | Receipts wait for the invoicing route (`docs/open-points.md`, item 35)                            |
| C4       | "Card" where the board has "Card ending 4417", and the countdown shows the time the hold has left | Checkout offers saved cards; the app does not know them                                           |
| C5       | Shown in the pay step, with the date and the choice of payment                                    | The board draws the first fit's lines on their own                                                |
| C5       | No credit-applied pair                                                                            | Credits arrive with P2-M3                                                                         |
| C6       | No "Your bank declined it."                                                                       | Checkout says why a payment failed; the app does not repeat a bank's reason                       |
| C6       | The confirmation has "Done" beneath "Add a note"                                                  | The sheet needs a way to close; its wording is a placeholder                                      |
| G1       | The address includes the house; the design shows the area only                                    | The owner ruled on 22 September 2026 that the profile shows the whole address (ADR 0025, item 23) |
| G1       | A fifth consent, "WhatsApp about launches"                                                        | The waitlist's launch alert (ADR 0042); its wording is a placeholder                              |
| G2       | The cards sit inside the page's 20 px margins                                                     | The design draws them on their own, 390 px wide                                                   |

## The ops console (P2-F3)

`npm run build:ops -- --env local && npm run fidelity:ops` writes `docs/fidelity/ops/`: boards B2 in both its states, B3, C1, C2 and C3.

- **The console is drawn at 1440, and these boards are panels within it,** 660 and 484 px wide, drawn at their own size. Each pair is therefore a panel beside a panel, not a screen beside a screen, and neither side is scaled. A1 and B1, which the board does draw whole at 1440, are not built.
- **B2 draws its two states one above the other,** locked and open, and the console shows one at a time, so each is paired with its own half of the frame.
- **The console's API is answered with the board's own figures,** so both sides show the same things. No mm-api runs. The clock is set to 2027, the year the board's waiting dates fall in, so they read without a year, as the board writes them; B2's is set to India's 10:42, the time it letters on the opened photographs.
- **The design's photographs are ink blocks with the angle written on them,** as the client app's boards draw them. The console's are answered with blocks of the same ink, and carry no captions.
- **Nobody in the fixtures is real.** The names, numbers, pincodes and photographs are the board's own or synthetic.

These differences are known and stand:

| Pair | Difference                                                                                            | Why                                                                                                              |
| ---- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| B2   | No "AK · 19 Sep": who last opened the photographs, and when                                           | The audit log is written on every view and read by nobody; no route gives the last one back                      |
| B2   | "logged 10:42 am" where the board has "logged 10:42"                                                  | India's clock as the console writes it everywhere else                                                           |
| B2   | Each set of angles is headed "Before" or "After"                                                      | A visit has a set before and a set after; the board draws one unnamed set of five                                |
| B2   | The caption carries the technician's whole name, "Imran Qureshi" for the board's "Imran"              | FSM gives one name; splitting it would be a guess                                                                |
| B2   | Every visit that has photographs, newest first, not one                                               | `GET /api/clients/:id/photos` answers with the client's whole history; the board draws a single visit            |
| B3   | "Notice", the version of the notice the client saw, where the board has "Source"                      | Nothing records whether a consent came from the app or the site; the notice version is what the route does give  |
| B3   | "from their own app" where the board writes "from his own app"                                        | The client is not always a he; every line here is a placeholder until the owner approves it                      |
| B3   | A line beneath the table when the client has asked to be erased                                       | The route answers with their latest deletion request, and it belongs beside the consents; the board draws none   |
| C1   | "Fitted Sun 19 Sep" where the board has "3 days held"                                                 | `GET /api/referrals/held` gives the day of the first fit, not how long the grant has waited                      |
| C1   | The rule's name, with no line of detail beneath it                                                    | The route names each rule a grant met; the addresses and UPI handles behind them stay out of the console         |
| C1   | Approving and rejecting each ask for a reason before they send                                        | The prompt: "Approve and Reject. Both require a reason." The board draws no field for either                     |
| C2   | No "Sent" column                                                                                      | Nothing counts invitations sent: a code is shared by the client, not by us (ADR 0048)                            |
| C2   | The busiest referrer first                                                                            | `GET /api/referrers` orders them by fits; the board lists its rows in no order                                   |
| C3   | The pincode is the control, underlined, where the board draws no way in                               | The panel that follows has to be opened by something, and the board's six columns leave no room for a button     |
| C3   | A pincode we already come to says "Live" beside its area, and offers no launch                        | The route returns served pincodes that still have people waiting; the board draws only those waiting             |
| C3   | The message is `launch_alert_v1` (src/config/message-templates.ts), with the first name a placeholder | It is what the queue will actually send; the name is each person's own                                           |
| C3   | "Not now" where the board has "Edit the message"                                                      | The message is a template in the repository, not something the console can rewrite                               |
| C3   | The note about the 33 who did not opt in sits inside the panel                                        | The board draws it as a caption beneath the frame; it is the reason both counts are shown, so it stays with them |

The console's own frame is not paired. Boards A1 and B1 draw it around a dispatch board and a client page; the built frame carries the three sections the backend has routes for, Clients, Referrals and Waitlist, where the design's column lists eight.

**The client's page is B1's frame, narrowed to what the ops routes answer.** It is not paired, since the board draws it around the pieces table, which is not built. Neither is the way into it: the board opens on a client and draws no way of finding one, so the console asks for a mobile number and sends it in the request body, never in a path or a query string. What the board draws there and no data source can give:

| What the board draws                                  | Why it is not built                                                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| "Tier · Standard · mono"                              | Nothing records a tier. The price book names prices, not tiers (`docs/open-points.md`, item 1)              |
| "Technician · Imran Qureshi", the usual one           | Each visit has its technician; nothing says which is the client's                                           |
| "Replacement due · Mar 2028"                          | It comes from the fitted piece, which arrives with the job sheet (P2-M4)                                    |
| The WhatsApp button beside the name                   | It belongs to B1's header, with the pieces table; the console reaches nothing beyond its own origin         |
| B1's pieces table                                     | No piece is recorded yet (P2-M4)                                                                            |
| A consent's source, "App" or "Site"                   | The consent record carries the notice version and the date, not where it was given                          |
| Who last opened a photograph, "AK · 19 Sep"           | Every view is written to the audit log; no route reads it back                                              |
| The Visits, Payments, Referrals, Tasks and Notes tabs | This step builds the two tabs the boards draw, B2 and B3. The record does carry the visits and the payments |

Not built, and not paired: A (the dispatch board) and D (payments, tasks and technicians), which wait for the FSM mirror, and B1 (pieces), which waits for the job sheet.
