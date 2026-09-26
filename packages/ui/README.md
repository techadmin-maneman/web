# @maneman/ui

The React parts the three Phase 2 apps share: the client app, the ops console and the technician app. What they have in common is written here once, so a fix reaches all three (ADR 0037; the audit's DS-23 and FEA-40). The public site is Astro and Preact, and uses none of it.

| Import                       | What it holds                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `@maneman/ui/base.css`       | The page every app starts from: the box model, the serif's one weight, keyboard focus, less motion |
| `@maneman/ui/Icon`           | A line icon from `@maneman/brand/icons`, at the set's stroke or a heavier one                      |
| `@maneman/ui/Mark`           | The brand's mark, in the surrounding text colour                                                   |
| `@maneman/ui/VisuallyHidden` | Words for a screen reader alone                                                                    |
| `@maneman/ui/Caps`           | The boards' small-caps serif label                                                                 |
| `@maneman/ui/classes`        | `classes()`, which joins an element's class names                                                  |

## Rules

- **Tokens only.** Every colour, size and space comes from `@maneman/brand`, as in the apps; `test/node/app-tokens.test.ts` reads these stylesheets too.
- **A screen's own class wins.** Each component's stylesheet puts its rules in the `ui` cascade layer, which any rule outside a layer beats. A screen sets a shared component's margin or width with its own class, and nothing else is needed. `base.css` and the visually-hidden recipe stay outside the layer: they are the page's.
- **Each app brings its own React.** This package imports `react` but does not install it. Each app's `vite.config.ts` dedupes `react` and `react-dom`, since from here Node would find the repository root's React 18, kept for the fidelity runs (`docs/fidelity-method.md`).
- **Sources, not builds,** as `@maneman/brand`: each app's Vite compiles what it imports. `packages/ui/tsconfig.json` type-checks and lints the package on its own.
