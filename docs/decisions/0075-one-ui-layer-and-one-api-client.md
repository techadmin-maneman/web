# 0075. One component layer and one API client for the front ends

- Status: accepted
- Date: 2026-09-27
- Amends [0037](0037-shared-packages.md)

## Context

The audit of 24 September 2026 found the three Phase 2 apps built side by side rather than on anything shared:

| Finding        | What it found                                                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DS-23          | No shared component layer: the primary button written sixteen times, the bottom sheet three, the page states three, the hiding recipe twelve, tables five and tabs three.                         |
| FEA-40, FEO-29 | ADR 0037 promised `packages/web-kit` "the API client"; each app wrote its own fetch wrapper, router, loader, icon and mark, and India's offset and WhatsApp's links were written again and again. |
| FEA-30, FEO-30 | The client app wrote seven answers and every request body by hand; the console typed its answers but not its requests or its error codes.                                                         |
| DS-22          | No pressed, busy or hover state anywhere, and three different looks for a button that cannot be pressed yet (VIS-24).                                                                             |
| FEA-41, FEO-32 | Nested ternaries choosing between three screens or three messages.                                                                                                                                |
| FEO-27, FEO-28 | The try-on and the referral landing were one island of 850 lines each; the console's four decision queues each carried their own copy of the same card.                                           |

## Decision

**`packages/ui` (`@maneman/ui`) is the apps' component layer.** It holds what the three React apps draw alike: `Button` and `ButtonLink`, `Sheet`, `Dialog`, `Panel`, the form fields, `Table`, `Tabs`, the page states, `ErrorBoundary`, `Icon`, `Mark`, `VisuallyHidden` and `Caps`; and the hooks behind them, the router (`usePath`, `go`, `Link`), `useLoad` and `useOneAtATime`. Its `README.md` lists each import.

- **Cascade layers keep the order plain.** `base.css` and every component stylesheet name `@layer base, ui;` first; an app's own rules are in no layer, so a screen's class always wins, whatever its specificity. A screen's class places a shared component (its margin, its width) and, where a board draws it differently, its colour: the profile's outlined buttons keep the paper's own line, as board G2 draws them.
- **A button is a look and a size.** The variant is the colours a board draws (`primary`, `light`, `gold`, `outline`, `outlineOnInk`, `danger`, `destructive`); the size is what the button is for (`action`, `control`, `small`), and each app sets the size's height and type in custom properties: the client app's action is 56 px, the technician app's 64, for a gloved hand. The console edges its filled buttons as its outlined ones (`--filled-edge`).
- **Every button presses, rests under a pointer, waits and refuses the same way** (DS-22). Hover exists only where there is a pointer; a busy button says so to a screen reader and ignores a second tap; one that cannot be pressed yet is drawn in the ground's shade with quiet words on every surface, where the console used to fade it to half its opacity (VIS-24).
- **The apps keep no copies.** `test/node/ui-package.test.ts` fails an app that defines its own icon, mark, router, loader, tap guard or error boundary, hides words its own way, or calls `/api/` other than through the shared client. The service workers are the exception the test also holds: registered as classic scripts, they cannot import a module the app's build shares, so they import only their own files.

**`packages/web-kit/api.ts` is the one API client** (FEA-30, FEO-30). Each app makes its client from its own surface's document, which `npm run openapi` writes into its `api-schema.ts`, so every path, query, body, answer and error code is checked against the API as it is. Every answer reads the same: a success with its body and whether the service worker answered from its copy; a refusal with the API's code and the fields it names; "offline" for a call that never reached the API, gave up waiting or met something that is not the API; and a session that has ended heard in one place. Each app says only what differs: the technician app's patience and its superseded writes, the console's Access redirect (`signed_out`), the client app's clock. A file answer, such as a photograph the console opens, is kept as it came. The checking found two console requests out of step with the contract, and the settings listing now names its rules with the same enum as the path that sets one.

**`packages/web-kit` holds the rest of what the front ends share:** India's dates, with India's offset written once (`inIndia`, `indiaDate`, `indiaInstant`); rupees, one formatter written "Rs." in the apps as the Phase 2 boards do and with its own sign on the public site as its design does (VIS-24); and WhatsApp, the business's number and every link. A test fails any other front-end file that formats rupees, adds India's offset, writes the number or builds a link.

**A screen that chooses between three things says so in a function that returns early.** ESLint's `no-nested-ternary` holds `apps/`, `packages/` and `site/src/` to it.

**The site's two large islands are folders.** `site/src/islands/tryon/` is an explicit state machine (`machine.ts`, walked by a unit test), the countdown and polls (`hooks.ts`), a component per screen, and the island that does the work between. `site/src/islands/invite/` is the landing: what the page reads from itself, the pincode check, the two forms, which send through one `useTurnstileForm`, and the confirmations. The console's four decision queues are one `DecisionQueue` (FEO-28).

## Consequences

- **Every screen looks as it did.** Each step was shot before and after: the client app's, the console's and the technician app's pairs, and every `?state=` of `/try`, `/book` and `/r/:code` at 390 and 1440, regenerate byte-identical except where a finding asked for a change: the console's rows at 34 px (OPS-24), the console's buttons that cannot be pressed yet (`a2-move-reason`, `d1-no-shows`), the photographs panel's heading drawn in the serif's one weight, and Home offline, whose Reschedule was a browser button beside a link and 6 px wider than Add a note.
- **Two defects went with it.** "Still working on it" was centred on the whole comparison while the result rendered, so the photograph beside it and the handle hid half (CLI-28); it now sits in the part the photograph leaves showing. A browser that has had its look is shown it on arrival, not after choosing and agreeing to a photograph it could not use (CLI-29); a look made after the page opened is still met by the upload's refusal.
- **What stays for a later package:** the two service workers and their build helpers (`apps/app/pwa.ts`, `apps/tech/sw-build.ts`) are still two, since a worker cannot share the app's modules at run time; the two countdowns count different things (the client app's to a deadline on the API's clock, the technician app's from the moment a code was sent); and the tokens' own scale (DS-06, DS-14, DS-17, DS-18, DS-20) is a package of its own.
