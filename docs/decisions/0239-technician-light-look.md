# 0239. The technician app's new look: white, navy and Plex, screen by screen

- Status: accepted
- Date: 2026-11-10
- Topic: Field work

## Context

The owner's redesign brief (`docs/prompts/tech-redesign.md`) moves the technician app from the ink to a white ground,
with navy for what to act on, brass for the one thing a screen marks, IBM Plex Sans in English and Hindi, and corners a
little round. It names its own colour tokens and asks that nothing else be drawn. The owner ruled on 10 November that
each PR replaces the live screens it covers, with no switch, and that the technician app alone takes Plex
(`docs/technician-redesign/PLAN.md`, section 2). The shared parts in `packages/ui` already draw their paper looks in the
`--ui-*` roles, which the console's dark theme remaps.

## Decision

1. **The brief's colours are brand tokens under the brief's names** (`packages/brand/tokens.css`): `--navy-900` is the
   brand's `--ink` and `--brass-500` its `--brass`, which already hold the brief's values; the rest are new. Each comes
   in with the first screen that draws it: this PR adds what the parts draw, and the wash, the mist, the placeholder
   and the camera's chrome follow with their screens.
2. **One look, by roles, scoped to the screens redrawn.** `apps/tech/src/styles/look.css` gives the `--ui-*` roles, the
   ground roles, the corners, the faces and the sizes their new values under `[data-look="light"]`. A redrawn screen
   carries the attribute; one not yet redrawn keeps the ink, so a technician never meets a screen half in each. The
   attribute moves to the app's root when the last old screen goes.
3. **New roles in `packages/ui/base.css`, each defaulting to what every app draws now:** a button's and a box's corner
   (`--ui-radius-button`, `--ui-radius-box`, square), a title's face and weight, an action's weight, a radio's size, a
   choice's words, a field label's colour and weight, and the screen's gutter. The console, the client app and the
   site look as they did.
4. **IBM Plex Sans and IBM Plex Sans Devanagari, self-hosted,** 400, 500 and 600, as one family split by
   `unicode-range` (`packages/brand/fonts-plex.css`), loaded by the technician app alone.
5. **The new parts** (`packages/ui`): `SectionHead` (a title under the 2 px rule), `ActionBar` (the foot's actions,
   with the helper line that says what is missing and describes the button), `StepProgress` and `ProgressLine`, a
   `ProblemCard`, and `Stepper`. `Radio` takes a second line. The parts the brief draws that already exist (Button,
   Field, ChoiceGroup, Checkbox, ToggleButton as a reason chip) take the look through the roles.
6. **A parts page at `/_parts`, in local builds alone,** as the console's `/_kit`, for each PR's screenshots at 360 and
   390 px and with system text at 130%.
7. **The new look's colours are held to the brief's 4.5:1** (`test/node/apps/tech/tech-contrast.test.ts`), beside the
   older screens' 5.8:1, and a role a redrawn screen names is checked as the look sets it.

## Where the build departs from the brief, and why

- **A control's edge is `--stone`, not `--line-200`:** the brief edges inputs in `--line-200`, 1.35:1 on the white;
  WCAG 1.4.11 and this codebase hold a control's edge to 3:1 (ADR 0025, item 36). `--stone`, which the brief already
  uses for a radio's and a box's edge, is 3.04:1. Rules between rows keep `--line-200`.
- **The primary action is 56 px,** the top of the brief's 52–56 px, on the scale's `--btn-lg`; a row's least height is
  the scale's 64 px where the prototype draws 60, and a radio 24 px where it draws 22.
- **A step bar, a scan's progress and the wait are 3 px,** the prototype's, as `--progress-line`.
- **The SOS hold and the in-app notification come with what they show** (PR 8 and PR 10). A push notification itself
  is drawn by the phone.

## Consequences

- Each redesign PR sets `data-look="light"` on the screens it replaces and deletes the old ones.
- `--navy-700` is also the primary action pressed, which the brief does not draw.
