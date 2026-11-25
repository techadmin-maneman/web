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
   The launch films came on 25 November, and the owner chose from them:
   - **The hero** takes the page's own footage, clients and the founder before and after, a wide cut and a phone's,
     each with its own first frame; the home page keeps its fit film.
   - **Nitin's fit** follows the hero on navy: the before and after, then his story in his own words. There is one
     client's story, so the second waits for its material.
   - **The founder's own fit** sits with his note: after it on a phone, beneath the guarantee beside it on a laptop.
     His note keeps every word.
   - **A film plays only when it is tapped.** Its poster loads as it nears the screen and the film's file not before the
     tap, so a 4G phone's first paint is the hero's alone. The tap puts the film in the poster's place with the
     browser's own controls, plays it with its sound and moves focus to it. The words said are written into each film,
     so there is no caption track to switch on beside them.
3. **Attribution goes with the visitor,** as on every page (ADR 0288): the landing is recorded on arrival, the links stay
   on the site under the visitor's cookie, and WhatsApp's message carries the visitor's reference.
4. **Through the site's Worker,** as every page is, for its nonce.

## Consequences

- Lighthouse audits it against the site's budget, a 4G phone's largest paint under 2.5 s; the accessibility, look and
  size checks open it with every other page.
- Ten files join `site/src/assets`: the hero's two cuts and two frames, and three films with a frame each, about
  9 MB in all, the phone's hero cut under 800 KB as the home page's is.
- Tests: `test/node/site/site-worker-pages.test.ts`, `test/node/site/site-assets.test.ts`,
  `test/node/site/site-content.test.ts`, `e2e/gurgaon.e2e.ts`, `e2e/accessibility.e2e.ts`, `e2e/site-screens.ts`,
  `scripts/ci/lighthouse.ts`.
