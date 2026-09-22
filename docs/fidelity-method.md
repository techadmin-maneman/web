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

## The client app (P2-F1)

`npm run build:app -- --env local && npm run fidelity:app` writes `docs/fidelity/client-app/`: board A1 to A3, B2, B3's three states, G1 and G2.

- **The app's API is answered with the design's own example,** Rohit Malhotra with a consultation on Sat 21 Sep. No mm-api runs. The login's timers run on Playwright's clock, so A2 is shot 30 seconds after the code was sent, as it is drawn.
- **The status bar the phone frames draw is cropped off,** and the app is shot 44 px shorter to match. A2 and A3 draw their back arrow in that band, so both keep it and are shot at the full 844 px.
- **B3 and G2 are not phone screens.** B3 draws three small frames, and G2 the account's three cards on their own. Each is set beside the app's whole screen, or its three cards.

These differences are known and stand:

| Pair     | Difference                                                                                     | Why                                                                                                  |
| -------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| A1       | The design shows the typed number masked                                                       | A client sees the digits they type                                                                   |
| A2       | "If +91 98xxx x4417 has a booking with us, a code is on its way on WhatsApp", and a link to A3 | The owner's neutral ruling (ADR 0030)                                                                |
| A3       | Titled "No booking on this number?"                                                            | The same ruling                                                                                      |
| B3 error | No "Your visit is still booked.", and centred on the screen                                    | Until Home has its own visit data (P2-F2), the app cannot know there is a visit (ADR 0043)           |
| G1       | The address includes the house; the design shows the area only                                 | **An open question for the owner:** the form asks for the house, and the profile shows what it holds |
| G1       | A fifth consent, "WhatsApp about launches"                                                     | The waitlist's launch alert (ADR 0042); its wording is a placeholder                                 |
| G2       | The cards sit inside the page's 20 px margins                                                  | The design draws them on their own, 390 px wide                                                      |
