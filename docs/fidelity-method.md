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

`npm run build:app -- --env local && npm run fidelity:app` writes `docs/fidelity/client-app/`: board A1 to A3, B1, B2, B3's three states, C1, C9, D1, D2, D3's empty, loading and download states, E1, E2, E3's empty and unavailable states, G1 and G2.

- **The app's API is answered with the design's own example,** Rohit Malhotra with a consultation on Sat 21 Sep, or, fitted, his next service visit on Thu 19 Sep with Imran. No mm-api runs. The login's timers run on Playwright's clock, so A2 is shot 30 seconds after the code was sent, as it is drawn. The payments are shot with the clock in 2027, the year the design dates them in.
- **The design's photographs are ink blocks with the angle written on them.** The app's are answered with blocks of the same inks (D2's two sides differ, as drawn), and carry no captions.
- **The status bar the phone frames draw is cropped off,** and the app is shot 44 px shorter to match. A2 and A3 draw their back arrow in that band, so both keep it and are shot at the full 844 px.
- **B3, D3, E3 and G2 are not phone screens.** B3, D3 and E3 draw small frames, each with a caption, and G2 the account's three cards on their own. Each is set beside the app's whole screen in that state, or its three cards.

These differences are known and stand:

| Pair     | Difference                                                                                     | Why                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| A1       | The design shows the typed number masked                                                       | A client sees the digits they type                                                                |
| A2       | "If +91 98xxx x4417 has a booking with us, a code is on its way on WhatsApp", and a link to A3 | The owner's neutral ruling (ADR 0030)                                                             |
| A3       | Titled "No booking on this number?"                                                            | The same ruling                                                                                   |
| B3 error | Centred on the screen                                                                          | The error is the whole screen, where the board draws a small frame                                |
| B1       | No credit tile and no prompt                                                                   | They arrive with the credits (P2-M3) and the pieces (P2-M4)                                       |
| B1       | Reschedule and Add a note are the same width                                                   | As on B2, whose pair matched; the design pads the second button                                   |
| C1       | No "Prepaid"                                                                                   | Prepayment arrives with booking (P2-M5)                                                           |
| C9, D1   | The photographs carry no captions; C9 has no "What was done"                                   | The prompt: "no captions"; what was done arrives with the job sheet (P2-M4)                       |
| D3       | The photograph opens large in a sheet, above the download line, with Close                     | A tap on a thumbnail shows the photograph; the board draws the download line alone                |
| E1       | Newest first, and no charge or credit                                                          | The board lists its entries in no order; charges and credits arrive with P2-M5 and P2-M3          |
| E2       | "UPI", without the UPI app                                                                     | Razorpay does not always say which app paid; the owner ruled to show "UPI" (ADR 0025, item 29)    |
| E3       | The pair shows the receipt's line, a placeholder                                               | Receipts wait for the invoicing route (`docs/open-points.md`, item 35)                            |
| G1       | The address includes the house; the design shows the area only                                 | The owner ruled on 22 September 2026 that the profile shows the whole address (ADR 0025, item 23) |
| G1       | A fifth consent, "WhatsApp about launches"                                                     | The waitlist's launch alert (ADR 0042); its wording is a placeholder                              |
| G2       | The cards sit inside the page's 20 px margins                                                  | The design draws them on their own, 390 px wide                                                   |
