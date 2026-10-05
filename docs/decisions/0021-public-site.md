# 0021. The public site: Astro in site/, on staging first

- Status: accepted
- Date: 2026-09-22

## Context

The front-end prompt (rev 2) asks for the final design, v2, rebuilt as an Astro site served by `mm-site`, in four milestones (F1–F4), ending in one production release. On 22 September 2026 the owner asked for the site on staging only for now; production will go live in one release later.

## Decisions

### Where it lives

- The Astro project is `site/`, which already held `mm-site`'s config. One `package.json` at the root serves both Workers.
- The content is `site/src/content/site.ts`. Pages and sections are in `site/src/pages` and `site/src/components`, and the interactive parts in `site/src/islands`.
- The design export is `design/`, read-only. Only the files the prompt names are there.

### One build per environment

`MM_ENV` picks the environment (`npm run build:site -- --env staging`) and the output goes to `site/dist/<environment>`. Each build differs:

- the `mm-environment` meta tag;
- the design's "Placeholder" tags, shown everywhere but production;
- `noindex` headers and a disallow-all `robots.txt`, everywhere but production.

`site/wrangler.jsonc` serves `dist/local` and `dist/staging`. **Production still serves its placeholder page.** `deploy-staging` builds the staging site before uploading `mm-site`, while `deploy-production` is unchanged. Going live is a short list in `docs/frontend.md`.

### The production build is gated

A production build stops (`site/src/lib/publish-gate.ts`) while:

- a published block still holds any of the design's placeholder material, listed once in `site/src/content/design-placeholders.ts`. The check compares the material itself, not a flag someone might forget to change;
- any consent notice is unapproved;
- the privacy or terms page has no text, since the try-on's consent screen links to `/privacy`.

`test/node/site/site-content.test.ts` ("the publish gate") checks that the gate stops for exactly those reasons, and lets through a block whose material is replaced. `test/node/site/site-production-gate.test.ts` runs the production build as it stands and checks that it passes the gate and ships none of the design's placeholder text, photographs or footage. (Corrected 27 September 2026: this said the second test checks that the build fails; since the terms and the business number were published on 22 September 2026, the build passes, and the refusals are the first test's.)

The prompt lists six placeholder blocks. v2 tags more of its images "Placeholder" (the hero footage, the plate opening "What it is", the how-it-works photographs and the base photographs), so each of those is a placeholder block too, as are the two legal pages. That leaves production with nothing to tag. An unpublished block renders nothing in production: its section, or its image, collapses.

### Words come from one place

- The three consent notices are the backend's (`src/config/notices.ts`): the page shows the same text, line for line, that a consent row records by version. `site.ts` adds only whether counsel has approved each.
- The stages, visit windows and presets are imported from the backend's `src/config`, so the ids the page sends are the ids the API accepts. A preset's label is the backend's, split at its first " · " as v2 shows it.

### Styling and type

- Plain CSS, scoped per component, with every colour, size and space taken from `site/src/styles/tokens.css` (now `packages/brand/tokens.css`, ADR 0037). `test/node/site/site-tokens.test.ts` fails on a raw colour, `px`, `vw` or `em` value anywhere else, and on an undefined token.
- The fonts are self-hosted from `@fontsource`: EB Garamond 400 and Instrument Sans 400 and 500, the only weights v2 uses. Each ships Google's latin and latin-ext subsets, with `unicode-range`, so latin-ext loads only for a character such as ₹.
- No inline `style` attribute is rendered, so F4's content security policy can stay strict. The only inline script is the hash-route redirect, which F4 allows by its hash.

### Interactive parts

- The try-on, the booking form and the before/after slider are Preact islands. The try-on and booking islands load only on their own pages. The slider hydrates when it scrolls into view.
- The FAQ uses `<details>` elements sharing a `name`, which gives a real disclosure, one open at a time, with no script.
- The hero video and the redirects from v2's `#tryon` and `#book` are a few lines of script each.

### Checks

- **`npm run fidelity`** renders v2 headless beside the build, at 390 and 1440 px, and writes each pair to `docs/fidelity/`. React, ReactDOM and Babel come from `node_modules`, not unpkg.
- **`npm run test:e2e`** runs the Playwright tests in `e2e/`, at both widths. CI runs them in the "site (browser tests)" job.
- **`npm run check:site`** type-checks the templates, as part of `npm run typecheck`.

## Consequences

- Production keeps the placeholder until the go-live release. Until then, a production release of `mm-api` redeploys the placeholder site, as it does today.
- The production build cannot pass until the owner supplies the privacy and terms text and counsel approves the three notices. Real material or an unpublished block is needed for everything the design calls a placeholder.
