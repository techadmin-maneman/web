# 0325. Search pages and the business's opening hours

- Status: accepted. Amended by [ADR 0326](0326-one-page-per-city.md): a city's page is the home page's sections,
  with the areas we cover there and the home page's questions; Gurgaon's own words and questions are dropped.
- Date: 2026-11-25
- Topic: The site

## Context

The owner's launch brief of 25 November 2026 (T18) asks for six pages a search finds (a hair system in Gurgaon, the
price and what is included, fitting at home, the bases compared, upkeep, a hair system against a transplant), their
copy drafted and marked for the founder's review before publishing, and for the business's structured data to give its
service area, its hours (9:30 am to 7 pm daily) and its WhatsApp, with an FAQ where there is one, a sitemap and page
metadata. The owner ruled the same day that the site says "hair system", never "hair patch", even on the Gurgaon page,
and the site gives no price (ADR 0204). Five of the six were already published guides: Hair system or hair transplant,
How a hair system is fitted at home, Materials and construction (the bases), Looking after a hair system, and What
decides the cost of a hair system (what you pay for, and when you hear the price). Gurgaon had its city page,
`/areas/gurgaon`, which said little more than that a technician comes. The sitemap and each page's title, description
and canonical link were already built. The city pages, though, were built for a list of five cities typed into the
site (the FAQ's old Delhi NCR), not for the cities ops serve: on staging, ops serve Gurgaon, Noida and Mumbai, so three
pages, their sitemap lines and the business's service area named cities served nowhere, and Mumbai had no page.

## Decision

1. **The guides stand for five of the six pages.** They answer those searches already, in published words; no second
   page is written for the same search.
2. **Gurgaon's page gains words of its own**: being fitted at home there, what you pay for, life after the fit, and
   three questions, one of them the home page's own, its answer copied so each page's words are published apart. They
   are a draft for the founder: shown on staging, tagged so, and left out of production until they are published
   (`cityWords` in `site/src/content/guides.ts`). Its questions are the page's FAQ for search engines while they are
   shown; a page whose questions are not shown has none.
3. **The business's hours are Customer Care's**, every day, as ops set them in the console (ADR 0322), never typed into
   the site. Each deploy's build reads them from its environment's `/api/site-words`, beside the published words and the
   visit lengths, and the business's structured data gives them as its opening hours, and as the hours of its contact
   point, its WhatsApp. A build that reads none, as a local one, has the policy's own, 9:30 am to 7 pm.
4. **The cities are the ones ops serve.** The same build reads `/api/served-cities`; a city page, its sitemap line and
   its place in the business's service area exist for each, and for no other. A build that cannot read them stops, as
   for the words; a local build has the content's list, for its tests. The site's Worker still writes in, at each
   request, the cities served at that moment.

## Consequences

- A change to Care's times, or a city served or no longer served, reaches the site at its next deploy or the next
  publish of the words, which rebuilds it.
- A production served nowhere has no city pages: the cities ops serve must be set in production's console before the
  release that builds them.
- The founder's approval of Gurgaon's words is one change: `publish: true`.
- Tests: `test/node/tooling/site-words.test.ts`, `test/worker/words/words-publish.test.ts`, `e2e/launch.e2e.ts`,
  `e2e/guides.e2e.ts`.
