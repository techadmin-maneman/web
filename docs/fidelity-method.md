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
