# @maneman/brand

The design values every Mane Man front end shares: the public site now, and the Phase 2 client, ops and technician apps as they arrive. Phase 2 extends these files and never forks them (`docs/prompts/phase2-frontend.md`).

| Import                           | What it holds                                                                                                                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@maneman/brand/tokens.css`      | Every colour, size and space of the Phase 1 site, its weights, leading and motion, and the values no board draws, each with why                                                                     |
| `@maneman/brand/tokens-apps.css` | What Phase 2 adds: seven colours (four of them WhatsApp's own), the apps' type sizes and targets, the ops console's frame and density. Load it after `tokens.css`; it adds names and redefines none |
| `@maneman/brand/fonts.css`       | EB Garamond and Instrument Sans, self-hosted, with ₹ from a one-glyph file (`npm run fonts` rebuilds it)                                                                                            |
| `@maneman/brand/icons`           | `ICONS` (Phase 1, frozen), `APP_ICONS` (the nine Phase 2 glyphs), `GLYPHS` (the apps' chevron and tick), `HEAD_OUTLINE` and `ICON_STROKE`                                                           |
| `@maneman/brand/marks`           | The mark and both cuts of the wordmark, as path data from `design/brand`                                                                                                                            |
| `@maneman/brand/colours`         | `colourOf()`, a colour token's value read from `tokens.css`, for what is drawn outside a stylesheet at build time: icons, card images, the house card                                               |

The brand kit's SVG files stay in `design/brand/`, which is the owner's export.

## Rules

- **The site's builds must not change** when this package changes, unless the change is meant for the site. `node scripts/build/dist-hash.ts --out before.json` before, and `--compare before.json` after, show every file that differs.
- **`ICONS` is frozen.** A new glyph goes into a new set, so the site's island bundles stay as they are.
- **A value is written once.** The scales (`--sp-`, `--fs-`, `--lh-`) are named for their value, and each holds a value once; a name for what a value is for (`--fs-app-title`) points at the scale's token. Stylesheets write no colour, length, weight, leading, duration or curve of their own (`test/node/site/site-tokens.test.ts`, `test/node/apps/app/app-tokens.test.ts`).
- **Values come from the design.** `test/node/packages/brand-package.test.ts` checks the glyphs and drawings against the design files, and each Phase 2 value, colour or size, against a spec board. A value no board draws goes in `tokens.css` with its departure recorded, as `--paper-control` is.
- **Fonts are relative to the repository's `node_modules`**, where npm installs this package's `@fontsource` dependencies.
