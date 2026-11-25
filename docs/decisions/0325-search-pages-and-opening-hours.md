# 0325. Search pages and the business's opening hours

- Status: accepted
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
and canonical link were already built.

## Decision

1. **The guides stand for five of the six pages.** They answer those searches already, in published words; no second
   page is written for the same search.
2. **Gurgaon's page gains words of its own**: being fitted at home there, what you pay for, life after the fit, and
   four questions. They are a draft for the founder: shown on staging, tagged so, and left out of production until they
   are published (`cityWords` in `site/src/content/guides.ts`). Its questions are the page's FAQ for search engines
   while they are shown; a page whose questions are not shown has none.
3. **The business's hours are Customer Care's**, every day, as ops set them in the console (ADR 0322), never typed into
   the site. Each deploy's build reads them from its environment's `/api/site-words`, beside the published words and the
   visit lengths, and the business's structured data gives them as its opening hours, and as the hours of its contact
   point, its WhatsApp. A build that reads none, as a local one, has the policy's own, 9:30 am to 7 pm.

## Consequences

- A change to Care's times reaches the site's structured data at its next deploy, as a change to the words does.
- The founder's approval of Gurgaon's words is one change: `publish: true`.
- Tests: `test/node/tooling/site-words.test.ts`, `test/worker/words/words-publish.test.ts`, `e2e/launch.e2e.ts`,
  `e2e/guides.e2e.ts`.
