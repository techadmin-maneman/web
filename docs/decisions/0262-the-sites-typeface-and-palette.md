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
   text link. Gold appears nowhere else. Where the header's filled Book shares a screen with a section's own filled
   button, as the boards draw it, the owner rules which goes (PLAN.md, departure 2).
4. **The focus ring** is brass `#B98B45` on navy (5.1:1). On white and cool brass is 3.0:1 and 2.8:1, under WCAG
   1.4.11's 3:1 for what shows a state, so there the ring is the same metal darkened, `--gold-700` `#8A6A2F` (4.9:1 and
   4.5:1): a departure from the brief's token, listed for the owner.
5. **A control's edge** is `--stone` on white (3.0:1) and `--ink-500` on cool (5.2:1), where stone is 2.8:1;
   the cool bands take it as PR 4 builds them.
6. **Square corners.** Radius 0 everywhere; circles only for radio dots, the spinner and the slider knob (the client
   app's ruling 10).
7. **Tokens.** The primitives live in `packages/brand/tokens.css`; three are new, `--cool-100`, `--gilt-hover` and
   `--white-055`. The site's roles (`--site-*`) in `site/src/styles/tokens-site.css` map onto them, with one type
   scale written in `clamp()` from 390 to 1440 px and one space scale. `/book` and `/try` read the client app's look
   roles, so the parts both draw look the same (ADR 0121).

## Consequences

- The fidelity harness pairs the site with `design/site-redesign/boards`; v2's board stays in `design/` as history.
- `test/node/site/site-tokens.test.ts` keeps refusing a raw value and holds the brief's colours; it and
  `e2e/site-look.e2e.ts` fail a stylesheet that names, or a built page that loads, a font other than Plex. A built
  page that draws paper or wash fails the same browser test once every section is rebuilt (PR 8).
- Production's coming-soon page (`scripts/build/coming-soon.ts`) takes Plex and the navy ground too.
- Print colours stay in `packages/brand` for the job sheet and anything printed.
