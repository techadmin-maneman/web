# 0301. The console's look, to the 22 November redesign

- Status: accepted
- Date: 2026-11-23
- Topic: The ops console
- Amends [0208](0208-the-console-redesigned.md) on the console's colours, type and density: what is done and saved
  is green, not the text's ink; the dark theme takes the redesign's palette; boxes and buttons are 34 px, small
  ones 28

## Context

The owner's redesign of the console, given on 22 November, is a clickable prototype whose stylesheet holds its colours,
type and sizes (docs/prompts/ops-redesign.md). The brief puts the design system and the frame first, for every screen
at once, and each screen's layout after it, in PRs 2 to 7; the owner ruled on 23 November that the first ships so, and
staging may look mixed until the layouts follow. Production moves only at the weekly release.

The console draws in roles alone (`--ui-*`, `--status-*`, `--nav-*`, held by
test/node/apps/ops/ops-theme-roles.test.ts), so a new look is new values for the roles, not a change to any screen.

## Decision

1. **The console's palette is its own**, `--console-*` in apps/ops/src/styles/tokens.css. The brand's palette is the
   phase 2 boards', and its test holds it to them; the prototype stays out of the repository. Where the prototype's
   colour is the brand's own, the role reads the brand's token: navy is `--ink`, the red `--red-700`, the green
   `--green-700`, the muted words `--ink-500`. Only the colours the brand lacks are named, and each one named is used.
2. **The roles are set in the light theme in tokens.css and in the dark in theme.css**, written twice there as before,
   for a choice of dark and for the computer's. White panels on a grey canvas, the frame navy, each state in its own
   colour; the dark theme takes the same palette's dark side, the frame still navy, a filled button light.
3. **IBM Plex Sans throughout on screen**, titles and figures too. A printed order sheet or label keeps the brand's
   faces, so the fonts change under `@media screen` alone.
4. **The prototype's sizes**: buttons and boxes 34 px high, small ones 28; a panel's head at least 52 px; corners 6 px,
   on a button and a box alike. The prototype's 4 px corner on an item inside a control, a segment or a menu's entry,
   comes with the screens' own PRs, which draw those.
5. **Where the prototype falls short of WCAG AA, the role keeps its hue a shade deeper.** The console's contrast test
   (test/node/apps/ops/ops-theme-contrast.test.ts) holds words on each ground and a control's edges, in both themes:
   - a control's edge, a day's and a time's, a choice card's, and a text link's underline are `#858C96`, 3.1:1 on the
     canvas, where the prototype's lines are 1.3:1 on white, short of a control's 3:1;
   - amber words are the brand's `--brass-text`, where the prototype's amber is 4.46:1 on its own wash;
   - the focus ring stays navy in the light theme, where the prototype's brass is 2.8:1 on the canvas; the dark theme
     keeps brass, which clears 3:1 there.
6. **A shared part the console colours differently takes a role of its own**, defaulting to what every other app
   draws: a text link's underline (`--link-underline`, the line's colour) and a side navigation's counts
   (`--nav-count-text`, the label's).

## Consequences

- Every console screen changes look at once, while its layout stays as it was until its own PR.
- A colour added to the console is named in its palette and set through a role; its contrast is checked for both
  themes by the console's own test.
- The client app, the technician app and the site are unchanged: their roles keep the brand's values.
