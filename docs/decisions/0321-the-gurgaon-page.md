# 0321. The Gurgaon page paid ads land on

- Status: accepted
- Date: 2026-11-25
- Topic: The site

## Context

The owner's launch brief of 25 November 2026 (T10) asks for `/gurgaon`, the page paid traffic lands on, mobile first,
quick to its largest paint on a 4G phone: a transformation film, two client stories, prices with a year-one cost table,
the guarantee, the free consultation, home fitting in three steps, the try-on, questions, and WhatsApp and `/book`, every
link carrying the visitor's attribution and no empty slot drawn. The owner ruled the same day that the page names no
price anywhere, and that the film and the stories are sent to be added to the site, as the home page's material is,
each shown once it is in.

## Decision

1. **The home page's own sections, in the brief's order, and no price:** the hero and its film, the guarantee and the
   founder, how it works at home in three steps, the try-on, the questions, and the close, which books the free
   consultation; the bar at a phone's foot opens WhatsApp or books, as on the home page. One source for each: a word or
   a film changed on the home page changes here. The header's and the footer's section links go to the page's own
   questions, and to the home page for a section it does not have.
2. **No slot without its material.** The two client stories, and a transformation film other than the hero's, are
   added with their material when it is sent; until then the page has no section for them, rather than one hidden.
3. **Attribution goes with the visitor,** as on every page (ADR 0288): the landing is recorded on arrival, the links stay
   on the site under the visitor's cookie, and WhatsApp's message carries the visitor's reference.
4. **Through the site's Worker,** as every page is, for its nonce.

## Consequences

- Lighthouse audits it against the site's budget, a 4G phone's largest paint under 2.5 s; the accessibility, look and
  size checks open it with every other page.
- Tests: `test/node/site/site-worker-pages.test.ts`, `e2e/accessibility.e2e.ts`, `e2e/site-screens.ts`,
  `scripts/ci/lighthouse.ts`.
