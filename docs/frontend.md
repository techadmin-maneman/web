# The public site

The site is an Astro build of the design (`design/Mane Man Site v2.dc.html`), served as static assets by the `mm-site` Worker. Why it is built this way: `docs/decisions/0021-public-site.md`. Where it differs from v2: `docs/decisions/0022-site-departures-from-v2.md`.

## Running it

```sh
npm run dev:site                       # the dev server, as local, at http://localhost:4321
npm run build:site -- --env local      # or staging; output in site/dist/<env>
npm run test:e2e                       # browser tests at 390 and 1440 px, against site/dist/local
npm run fidelity                       # design and build side by side, into docs/fidelity/
npm run check:site                     # type-checks the .astro templates
```

`npm run build` builds the site for local and staging before its dry runs. A production build is refused until the content is ready; see "Going live" below.

## Where things are

| What                                      | Where                                                    |
| ----------------------------------------- | -------------------------------------------------------- |
| Every string and image name               | `site/src/content/site.ts`                               |
| The design's placeholder material, frozen | `site/src/content/design-placeholders.ts`                |
| Colours, sizes, spaces                    | `site/src/styles/tokens.css`                             |
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

## Approving a notice

The three consent notices (booking, photo, gate) are the backend's, in `src/config/notices.ts`. The page shows that text, and a consent row records its version.

- **Once counsel approves a notice,** set its `approved` to `true` in `site.ts`.
- **To change the wording,** add a new version in `src/config/notices.ts`, point `CURRENT_NOTICE` at it, and approve that version. A published version is never edited.

## Changing a preset label

The six looks are the backend's presets, in `src/config/presets.ts`, in its order. The page shows each label split at its first " · ": "Full density · Natural hairline · short" becomes "Full density" over "Natural hairline · short". Change the label there. The API works on the preset's `id`, so a label change is safe.

## Rules the tests enforce

- **Tokens.** Every colour, size and space comes from `tokens.css`, and `test/node/site-tokens.test.ts` fails on a raw value. Media query conditions keep their pixels, since CSS custom properties cannot be used there.
- **No inline styles.** A component renders no `style` attribute; an island that must move something sets a CSS variable from script instead.
- **Placeholder tags and `noindex`.** Staging and local show the design's tags and are not indexed. Production shows no tags and is indexed.
- **Previewing a screen.** Outside production, `?state=` opens any try-on screen (`/try?state=gate`) or booking state (`/book?state=waitlist`). The screenshots and tests use it.

## Going live in production

Production still serves `site/placeholder/production`. To go live:

1. Publish or leave out every placeholder block, supply the privacy and terms text, and have counsel approve the three notices, until `npm run build:site -- --env production` passes.
2. In `site/wrangler.jsonc`, point production's `assets.directory` at `./dist/production`.
3. In `deploy-production.yml`, build the production site before "Deploy mm-site".
4. Finish F4: analytics and conversion tags, SEO, the security headers and the performance budgets.
