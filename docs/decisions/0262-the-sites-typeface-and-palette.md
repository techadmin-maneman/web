# 0262. The site's typeface and palette

- Status: accepted
- Date: 2026-11-17
- Topic: The site
- Amends [0077](0077-a-token-scale-written-once.md) and [0216](0216-the-sites-polish-pass.md) on what the site draws

## Context

The site has drawn v2's look since launch: EB Garamond titles and Instrument Sans text on warm paper (`#E9E4D8`) and
wash (`#F4F0E8`). The client app's redesign (ADR 0252) moved the apps to IBM Plex Sans on white with navy, and the
owner approved a prototype of the site in that look on 17 November 2026 (`design/site-redesign/`), with rulings 3, 4, 5
and 9 of `docs/prompts/site-redesign.md`.

## Decision

1. **One typeface.** IBM Plex Sans 400, 500 and 600, from `packages/brand/fonts-plex.css`, the files the apps already
   self-host. EB Garamond and Instrument Sans leave the site's build, the hero included. Plex draws ₹ from its
   Devanagari file, which `fonts-plex.css` already ranges over U+20B9, so the one-glyph rupee file
   (`eb-garamond-rupee-400.woff`) leaves the site too; the site writes "Rs." in any case.
2. **Grounds.** White `#FDFDFB` and a cool grey `#F1F3F6`, alternating section by section, with navy `#16233A` bands.
   No two neighbouring sections share a ground. Paper and wash are print colours and appear nowhere on the site.
3. **One filled button per view.** Navy on a light ground, gold `#C9A363` on navy. Everything else is an outline or a
   text link. Gold appears nowhere else but the focus ring, which is brass `#B98B45`.
4. **Square corners.** Radius 0 everywhere; circles only for radio dots, the spinner and the slider knob (the client
   app's ruling 10).
5. **Tokens.** The primitives live in `packages/brand/tokens.css`; two are new, `--cool-100` and `--gilt-hover`. The
   site's roles (`--site-*`) in `site/src/styles/tokens-site.css` map onto them, with one type scale written in
   `clamp()` from 390 to 1440 px and one space scale. `/book` and `/try` read the client app's look roles, so the parts
   both draw look the same (ADR 0121).

## Consequences

- The fidelity harness pairs the site with `design/site-redesign/boards`; v2's board stays in `design/` as history.
- `test/node/site/site-tokens.test.ts` keeps refusing a raw value; a new test fails any built page or site stylesheet
  that draws paper or wash, or loads a font other than Plex.
- Print colours stay in `packages/brand` for the job sheet and anything printed.
