# @maneman/ui

The React parts the three Phase 2 apps share: the client app, the ops console and the technician app. What they have in common is written here once, so a fix reaches all three (ADR 0076; the audit's DS-23 and FEA-40). The calls to the API, India's dates, rupees and WhatsApp's links are `@maneman/web-kit`'s. The public site is Astro and Preact, and uses none of it.

| Import                       | What it holds                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `@maneman/ui/base.css`       | The page every app starts from: the box model, the serif's one weight, keyboard focus, less motion |
| `@maneman/ui/Icon`           | A line icon from `@maneman/brand/icons`, at the set's stroke or a heavier one                      |
| `@maneman/ui/Mark`           | The brand's mark, in the surrounding text colour                                                   |
| `@maneman/ui/VisuallyHidden` | Words for a screen reader alone                                                                    |
| `@maneman/ui/Caps`           | The boards' small-caps serif label                                                                 |
| `@maneman/ui/Button`         | `Button` and `ButtonLink`: a variant (the colours) and a size (what it is for), with every state   |
| `@maneman/ui/Sheet`          | A sheet that rises from the foot of the column, as a native modal dialog that Back closes          |
| `@maneman/ui/Dialog`         | A panel opened over the page as a native modal dialog, whose caller decides when it may close      |
| `@maneman/ui/Panel`          | The ops console's bordered panel, headed by its title and its count                                |
| `@maneman/ui/Field`          | `Field` (a label, a hint and an error tied to their control), `TextInput`, `TextArea`, `Checkbox`  |
| `@maneman/ui/CodeField`      | A one-time code's boxes as one labelled field, and `codeDigits()` for a code typed elsewhere       |
| `@maneman/ui/Table`          | The ops console's table at the boards' density, and `FIGURE` for a column of figures               |
| `@maneman/ui/Tabs`           | The ops console's tabs, each a link the app draws with `TAB`'s look                                |
| `@maneman/ui/States`         | `Loading` (board B3's shape) and `Failed` (a line and a retry), in each app's words                |
| `@maneman/ui/ErrorBoundary`  | What stands in for a screen that failed to draw: the app's own fallback                            |
| `@maneman/ui/router`         | `usePath`, `go`, `followsHere` and `Link`: moving between pages without a reload                   |
| `@maneman/ui/useLoad`        | A page's data, fetched as it opens and again on "Try again"                                        |
| `@maneman/ui/useOneAtATime`  | One thing at a time, so two taps on one intent start it once                                       |
| `@maneman/ui/motion`         | `ARRIVE`, the apps' one fade, for a page or an image arriving                                      |
| `@maneman/ui/classes`        | `classes()`, which joins an element's class names                                                  |
| `@maneman/ui/cssToken`       | A token's value as the page has it, for what is drawn outside a stylesheet: a canvas, a checkout   |

## Sizes by app

A button's size is what it is for, and each app says how big that is. `base.css` sets the client app's and the console's (`--action-height` 56 px at 16, `--control-height` 48 at 15, `--small-height` 44 at 15); the technician app sets its own on its body, from its board's "Targets": 64 at 18, 56 at 17 and 48 at 17, its outlined words in the regular weight.

## Rules

- **Tokens only.** Every colour, size and space comes from `@maneman/brand`, as in the apps; `test/node/app-tokens.test.ts` reads these stylesheets too.
- **A screen's own class wins.** `base.css` is the `base` cascade layer and each component's stylesheet the `ui` layer, above it; an app's own rules are in no layer, so they beat both. A screen sets a shared component's margin or width with its own class, and nothing else is needed. It never sets a button's ground, words' colour or edge, which would erase its pressed, disabled and busy looks; `test/dom/ui-button-looks.test.ts` reads every class an app hands a button. Every stylesheet here names the two layers first (`@layer base, ui;`), so the order holds whichever a browser meets first. The visually-hidden recipe alone stays outside the layers, so no screen can bring its words into view.
- **Each app brings its own React.** This package imports `react` but does not install it. Each app's `vite.config.ts` dedupes `react` and `react-dom`, since from here Node would find the repository root's React 18, kept for the fidelity runs (`docs/fidelity-method.md`).
- **No copies in the apps.** `test/node/dom/ui-package.test.ts` fails an app that keeps its own icon, mark, router, loader, tap guard or error boundary, hides words its own way, or calls `/api/` itself.
- **Sources, not builds,** as `@maneman/brand`: each app's Vite compiles what it imports. `packages/ui/tsconfig.json` type-checks and lints the package on its own.
