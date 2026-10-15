# 0077. A token scale written once, and names for what a value is for

- Status: accepted
- Date: 2026-09-27
- Topic: Platform
- Amends [0037](0037-shared-packages.md); follows [0076](0076-one-ui-layer-and-one-api-client.md)

## Context

The audit of 24 September 2026 found the tokens covering every colour and size but not holding them to a scale:

| Finding | What it found                                                                                                                                   |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| DS-06   | 263 line-heights and weights written as numbers across the site and the apps, which the token tests never read: they caught no unitless value.  |
| DS-14   | `--ease` and `--ease-progress` each bundled a duration with the curve; the second named a sheet's rise as a progress bar's; a fade copied.      |
| DS-15   | `--fs-app-title` and `--fs-34` both held 34 px, so a change to one would leave the other behind.                                                |
| DS-17   | Focus rings drawn with `--rule-strong` and offset with `--sp-2` or `--sp-3`; the brand's README and ADR 0037 describing a layer that had grown. |
| DS-18   | Tokens named for their values, and a test that no value is written raw: coverage without a scale.                                               |
| DS-20   | The token tests blind to durations, curves, colours by name or function, the viewport's newer units, and unitless weights and leading.          |

## Decision

**A scale is named for its value, and holds each value once.** Spaces (`--sp-16` is 16 px), type sizes (`--fs-15`) and now leading (`--lh-145` is 1.45) are the scales the designs draw from. `test/node/packages/brand-package.test.ts` fails a scale that writes one value twice.

> **Amended 11 October 2026 (audit finding DS-01; the owner accepted small drift from the boards).** A scale holds few values, not every value a board drew. The fixed spaces are a 4-point scale (2, 4, 8, 12, 16, 20, 24, 28, 32, 36, 48, and the apps' 40 and 64), each retired space moved to the nearest multiple of 4. The leadings are five (1, 1.15, 1.3, 1.45, 1.6), each retired leading moved to the nearest. A new value joins a scale only where none of its values will do. The site's fluid type is sixteen sizes, near-twins merged into a heading ramp (`--fs-h1` to `--fs-h5`, `--fs-large`, `--fs-lead`); it and each page's frame and spaces, which only the site uses, live beside the site in `site/src/styles/tokens-site.css`, and `packages/brand/tokens.css` keeps what the site and the apps share.

**A name for what a value is for points at the scale.** `--fs-app-title` is `var(--fs-34)`, not a second 34 px. Where a role has no single scale value behind it, it is named for what it does: the weights (`--weight-regular`, `--weight-medium`), the focus ring (`--focus-width`, `--focus-offset`, `--focus-offset-wide`), motion (`--duration-quick`, `--duration-travel`, and the one `--ease-house`), and each app's button sizes in `packages/ui/base.css`.

**No stylesheet writes a value of its own.** `test/node/raw-values.ts` is the one list both token tests read. It covers:

- a colour by hex, by function or by name;
- a length, including the viewport's units other than the whole height;
- a duration or an easing curve;
- a weight or a leading written as a number.

The three viewport values no board draws are tokens, each with its reason, in `tokens.css`, as the brand's README asks of any value a board does not draw. The fade the client app wrote twice is `packages/ui`'s `ARRIVE`.

## Consequences

- **Nothing on screen moved.** Every page and `?state=` of the site shoots byte-identical at 390 and 1440. So does every client-app, console and technician-app pair.
- **The site's build changes** (its stylesheets name the new tokens) but draws the same page. This is a change meant for the site, as the brand's README requires.
- **What is left:**
  - Spaces still stand in for sizes in about fifty places: an icon's width or a dot's height written with `--sp-16`, say.
  - Most component stylesheets still address the value-named scale directly.
  - A role layer across every screen, which DS-18 describes, is a redesign of the tokens rather than a refactor, and would move nothing on screen. It waits for a design need.

## Amendment, 5 October 2026: a screen's own sizes

The audit of 2 October (CQ-72, UX-43) found the shared brand package holding sizes one screen alone draws. Changing a single console column meant editing `packages/brand`. It also found two values the token tests never read: the browser bar's colour, written as hex into each app's `index.html`, and an SVG line's `stroke-width`.

- **A screen's own sizes** sit at the top of its stylesheet, in one `:root` block of `--local-*` properties, each named and explained: the console's table columns, the dispatch board's tray, say. That block is the only place a stylesheet may write a value; `test/node/raw-values.ts` reads it out and holds the rest of the stylesheet to the tokens. A size two screens draw stays in `packages/brand`. The 23 console sizes one stylesheet alone used have moved out of `tokens-apps.css`.
- **The bar's colour** is named by its token in `index.html` (`content="--ink"`), and the build writes in the value (`themeColor()`, `packages/web-kit/pwa.ts`).
- **A stroke width** written as a number is a raw value. The capture guide's two lines, in the drawing's own units, are local sizes.
- **Still waiting for a design need:** the role layer (`--text-body`, `--text-label` and so on) and the site's single-use sizes. The site's build would change for no change on screen.

## Amended 14 October 2026: one scale, named styles, roles and each app's own sizes

- **One type scale**, in `packages/brand/tokens.css`, which every surface loads: 13 to 18, then 22, 24, 26, 28, 30, 32, 34, 40 and 56. The steps a single place drew (19, 20, 21, 25) went to their neighbours; the site's landing sizes and the apps' role sizes point at the scale. Body text has its leading (`--lh-145`), and bold is the weight the fonts load.
- **Named text styles** (`packages/ui/type.module.css`, `typeLook("title-3")`): display, title 1 to 3, body large, body, label, caption and figure, each a size with its leading, tracking and family. The console's panel and drawer titles are title 3.
- **Colour roles** (`--surface`, `--on-surface`, `--on-surface-muted`, `--border-subtle`, `--status-error`, `--status-saved`, `--status-note`) are aliases of the palette, redefined under `[data-ground="ink"]`; the shared panel, drawer, empty state and inline message read them. The role layer this record left waiting is begun, with the parts that every surface shares.
- **Each app's own sizes** are its own file: `apps/ops/src/styles/tokens.css` and `apps/tech/src/styles/tokens.css`. A shared part reads its room from a property each app may set (`--drawer-width`, `--table-row-height`, `--check-row-height`, `--check-box-size`, defaults in `packages/ui/base.css`). The console's wide tables share `--ops-table-min`.
- **A size is written once** in the files a surface loads together; another name for it is an alias (`test/node/front-ends/token-values.test.ts`, `type-scale.test.ts`).
