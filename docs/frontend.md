# The public site

The site is an Astro build of the design (`design/Mane Man Site v2.dc.html`), served as static assets by the `mm-site` Worker, which answers first only on the pages that show a price and on the referral landing (`site/src/worker.ts`). Why it is built this way: `docs/decisions/0021-public-site.md`. Where it differs from v2: `docs/decisions/0022-site-departures-from-v2.md`. How it sits beside the three Phase 2 apps, and what they share: `docs/front-ends.md`.

## Running it

```sh
npm run dev:site                                  # the dev server, as local, at http://localhost:4321
npm run build:site -- --env local                 # or staging; output in site/dist/<env>
npx playwright test --project=390 --project=1440  # the site's browser tests, against site/dist/local
npm run fidelity                                  # design and build side by side, into docs/fidelity/
npm run check:site                                # type-checks the .astro templates
```

`npm run build` builds the site for local and staging before its dry runs. A production build is refused until the content is ready; see "Going live" below.

## Where things are

| What                                      | Where                                                    |
| ----------------------------------------- | -------------------------------------------------------- |
| Every string and image name               | `site/src/content/site.ts`                               |
| Prices                                    | The price book, set in the ops console (see "Prices")    |
| The design's placeholder material, frozen | `site/src/content/design-placeholders.ts`                |
| Colours, sizes, spaces, fonts, icons      | `packages/brand` (shared with the Phase 2 apps)          |
| Pages                                     | `site/src/pages`                                         |
| Home sections, header, footer             | `site/src/components`                                    |
| The try-on, the booking form, the slider  | `site/src/islands` (Preact)                              |
| Real photographs                          | `site/src/assets` (the design's stay in `design/assets`) |

A component holds no copy of its own. To change words, change `site.ts`.

## Changing an image

Put the file in `site/src/assets` and write its name in `site.ts`. A name there wins over the same name in `design/assets`. Astro serves it as AVIF and WebP at the widths each section asks for.

## Publishing a placeholder block

A placeholder block in `site.ts` carries `publish: false` and holds v2's material, and the list of placeholder blocks is in `design-placeholders.ts`. In staging it shows with the design's "Placeholder" tag. In production an unpublished block shows nothing, and its section or image collapses.

To publish one:

1. Replace the material in `site.ts`: the names, words and numbers, and the photographs (in `site/src/assets`).
2. Set `publish: true`.
3. Build production. If anything of v2's material is left, the build names it and stops.

Never edit `design-placeholders.ts` to let a build through.

The referral landing's copy (`referral.ts`) is Phase 2's, and marks a line still waiting for the owner's wording with a `PLACEHOLDER` comment, as the apps' `content.ts` files do. A production build of the site, or of an app, names each marked line and stops (`scripts/lib/content-gate.ts`). Staging builds them as they are (ADR 0025, item 27).

## Prices

Every price on the site and the landing is the price book's, which ops set in the console (`docs/decisions/0073-prices-from-the-price-book.md`). A sentence that gives one holds a hole for each figure, `"{firstFit}, then {service} a month"`, and `site/src/lib/prices.ts` fills it, the totals computed. A page is built with the book's figures of 22 September 2026 (`site/src/content/prices.ts`); the Worker fills the same sentences again from `GET /api/published-prices` on every page it serves, and builds the structured data again. The local build and the browser tests show the built figures on the home page, since no Worker runs there; the booking form's island asks the local API.

- **To change a price,** set it in the ops console. No release.
- **Premium** is not in the book yet (ADR 0025, "Which tier the app books"): its figures are the owner's, in `site/src/content/prices.ts`, until the owner rules on the tier.
- **Never type a figure into a sentence.** A production build names any rupee figure in `site.ts` or `referral.ts` and stops; only what a transplant and medication cost elsewhere, in the comparison, is allowed.

## Approving a notice

The site shows five consent notices, each the backend's, in `src/config/notices.ts`: the try-on's photograph and gate notices, the booking form's agreement on `/book` and `/r/:code`, and the waitlist's agreement and its optional launch alert (`notices` in `site/src/content/site.ts`). The page shows that text, and a consent row records its version. The try-on's two, `photo-v3` and `gate-v3`, send its look to WhatsApp only and keep a client's try-on (ADR 0104, ADR 0084); every build shows them, with the privacy page's try-on sentences to match, so production's build refuses until counsel approves them (`docs/open-points.md`, item 146).

- **Once counsel approves a notice,** add its version to `APPROVED_NOTICES` in `site.ts`.
- **To change the wording,** add a new version in `src/config/notices.ts`, point `CURRENT_NOTICE` at it, and approve that version. A published version is never edited.

The privacy and terms pages (`legalPages` in `site.ts`) carry `approved` too. Their Phase 2 wording is a draft, so production's build refuses until counsel approves it.

- **Once counsel approves a page,** set its `approved` to `true`. A paragraph writes the business number as `{whatsapp}`, which the page shows as a WhatsApp link.

## Changing a preset label

The six looks are the backend's presets, in `src/config/presets.ts`, in its order. The page shows each label split at its first " · ": "Full density · Natural hairline · short" becomes "Full density" over "Natural hairline · short". Change the label there. The API works on the preset's `id`, so a label change is safe.

## Talking to the API

The site calls `mm-api` on its own host, `/api/*`. The request and response types in `site/src/lib/api-schema.ts` are generated from `docs/openapi.json` by `npm run openapi`; never edit them by hand. `site/src/lib/api.ts` holds the calls.

- **Turnstile.** A booking and a try-on upload link carry a Turnstile token; the gate's claim takes none (ADR 0022, 20). The widget is managed, rendered invisibly, and appears only if Cloudflare needs the visitor to act (`site/src/lib/turnstile.ts`, site keys in `docs/turnstile.md`).
- **Idempotency.** Each submission attempt sends a new `Idempotency-Key`.
- **Attribution.** The first page of a visit stores its campaign tags, referring site and landing path in `sessionStorage` (`site/src/lib/attribution.ts`). Never a query string.

- **The try-on.** `site/src/lib/tryon.ts` chains the calls. On arrival the page asks whether this browser has had its look and whether the try-on runs (`GET /api/tryon/look` and `GET /api/tryon/availability`). Continue on the consent screen prepares the photograph (`photo.ts`: resize, re-encode and the hair colour from `hair-colour.ts`) and uploads it, then, under the notice that keeps a client's try-on, its small copy (`@maneman/web-kit/small-jpeg`, ADR 0084). The look goes to WhatsApp only (ADR 0104): the gate's _Send my look_ claims the try-on with the name and number, then asks for the render, and the sent screen watches it every 3 seconds until it is ready, in case it fails. The page never asks for the look. A browser that has had its look is told it was sent. `tryon-errors.ts` decides which error the visitor sees.

The browser tests run the site against a local `mm-api` with stub providers (`playwright.config.ts`). Run `node scripts/ensure-dev-vars.ts && npm run db:local` once first.

## Rules the tests enforce

- **Tokens.** Every colour, size and space comes from `tokens.css`, and `test/node/site-tokens.test.ts` fails on a raw value. Media query conditions keep their pixels, since CSS custom properties cannot be used there.
- **No inline styles.** A component renders no `style` attribute; an island that must move something sets a CSS variable from script instead.
- **Placeholder tags and `noindex`.** Staging and local show the design's tags and are not indexed. Production shows no tags and is indexed.
- **Previewing a screen.** Outside production, `?state=` opens any try-on screen (`/try?state=gate`) or booking state (`/book?state=listed`), with stand-in images and no API calls. `/try?state=error&kind=busy` shows another error (`renderFailed`, `busy` or `unavailable`), and `/try?state=sent&kind=returning` a returning visitor's sent screen. The screenshots and tests use it.
- **No photographs of people in tests.** The try-on tests upload a drawn head (`test/node/drawn-head.ts`).

## Adding the analytics IDs

The IDs go in `site/src/lib/analytics-ids.ts`, one set for each environment: a GA4 measurement ID, the Google Ads account ID with a conversion label for bookings and one for try-on claims, and a Meta Pixel ID.

- Staging's IDs must be test or debug streams, never production's. GA4 marks everything outside production as debug traffic anyway.
- A tag with no ID is not loaded. Setting one adds its hosts to the content security policy on the next build.
- The events and what each carries are in `docs/decisions/0023-launch-hardening.md`. The browser tests fail if a name, a number or an image reference reaches a tag.

## Headers, budgets and fonts

- **Headers.** The build writes `_headers`: the content security policy, HSTS, the referrer policy, and the camera allowed on `/try` only. Inline scripts and styles are allowed by hash, computed from the built pages, so nothing needs listing by hand. Never add a `style` attribute or a `data:` URL: the policy refuses both, and the browser tests fail.
- **Lighthouse.** `npm run lighthouse` audits the local build's `/`, `/try` and `/book` against the budgets, and CI runs it after the browser tests. Reports go to `lighthouse/`.
- **Fonts.** ₹ is drawn from a one-glyph file. If the site starts using another character outside latin, add it in `scripts/subset-fonts.ts`, run `npm run fonts`, and take it out of the latin-ext ranges in `packages/brand/fonts.css`.

## Going live in production

Production still serves `site/placeholder/production`. To go live:

1. Make `npm run build:site -- --env production` pass. It passed from 22 September 2026, when the terms and the phone number were published, until 1 October 2026: since then the try-on's look goes to WhatsApp only, and its notices that say so, `photo-v3` and `gate-v3`, wait for counsel (ADR 0104; `docs/open-points.md`, item 146). `test/node/site-production-gate.test.ts` holds the build refusing those two and nothing else, and checks what it ships once it passes. **A passing build is not a finished home page:** every placeholder block is left out of it, so today's production home page has no photograph or film at all.
2. **Look at the production build's home page before going live** (`npm run build:site -- --env production`, then serve `site/dist/production`). Each unpublished block is an open point (`docs/open-points.md`, items 73 to 81): the owner supplies its cleared material, or the section goes. The build ships none of the design's placeholder files, even unlinked, and the gate test checks that too.
3. Add production's analytics IDs (`docs/open-points.md`, item 84). Bot Fight Mode is off, by the owner's ruling of 22 September 2026 (ADR 0025, item 12), so it needs no decision here.
4. In `site/wrangler.jsonc`, point production's `assets.directory` at `./dist/production`.
5. In `deploy-production.yml`, build the production site before "Deploy mm-site".
