# Ops console redesign — source files

Received from the owner on 2 November 2026 with the brief "Ops console redesign: layout and interaction (desktop and phone)". Read-only. Do not edit these files; raise disagreements in a PR or an ADR (ADR 0225).

| File                         | What it is                                                                                                                                                                                                                                           | Build status                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `Ops Console.dc.html`        | The desktop prototype, drawn at 1440 px and clickable: the frame, Today, Tasks, Dispatch with its visit drawer, Book a visit, Clients and a client's page, Messages, a technician's page, Inventory, Money and Settings, with the city and Place pickers | **Build, for layout only.** Option A wherever a board offers two. Source of truth for `mm-ops` at 1440 |
| `Ops Console Mobile.dc.html` | The phone frames at 390 px: Today, Tasks, Dispatch's day, Messages, Book a visit as a sheet, and Settings under More                                                                                                                                   | **Build, for layout only.** Source of truth for `mm-ops` at 390                                       |
| `support.js`                 | The Claude Design prototype runtime. Byte-identical to `design/support.js`                                                                                                                                                                            | Needed only to render the design files                                                               |

These files supersede `design/phase2/Ops Console.dc.html` for layout alone. The Phase 2 board still wins wherever these files say nothing.

## What is not taken from them

- **Words.** Every heading, line, label, hint, empty state, name, price and figure in both files is a placeholder. The console keeps its own strings (`apps/ops/src/content.ts` and each screen's content). A slot the new layout adds, with no string of the console's to fill it, is written under the console's copy rules (the owner's ruling of 2 November 2026) and listed in [COPY-TODO.md](COPY-TODO.md) for review.
- **Figures and states.** Each comes from the API. One the API does not return is left out, not drawn from the mock.
- **Colours and sizes.** The files write raw hex and inline styles; the build draws in `@maneman/brand` tokens, through the `--ui-*` roles so the dark theme follows. The brief's table maps each design value to its token.

## Rendering these files for fidelity checks

Use the method in `docs/fidelity-method.md`: the files load React 18.3.1, ReactDOM 18.3.1 and `@babel/standalone` 7.29.0 from unpkg, and fonts from Google; route those to the local copies (`scripts/lib/fidelity.ts`, `routeDesignLibraries`). Compare the desktop prototype at 1440 px and the phone frames at 390 px, each against the built screen in the same state; the phone board's caption, notes and canvas are not part of the product, nor is the status bar each frame draws.
