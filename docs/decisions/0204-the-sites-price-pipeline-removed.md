# 0204. The site's price pipeline is removed

- Status: accepted
- Date: 2026-10-15
- Topic: The site
- Supersedes the site half of [0073](0073-prices-from-the-price-book.md); keeps [0103](0103-the-home-pages-first-copy-round.md)'s ruling that the site gives no prices

## Context

ADR 0103 took every price off the site, but the pipeline that wrote them stayed behind a switch (`PRICES_SHOWN`, off): copy with price holes, figures the pages were built with, the Worker asking the price book and writing it into `/`, `/book` and `/r/:code`, the booking island's own copy of the same, and two test files to keep it all working. It typed rupee figures into the source, `Rs. 2,000` and `Rs. 15,000`, the pre-GST amounts, where the terms promise the amount a client pays, GST included. Nothing a visitor saw used it.

## Decision

1. The pipeline is deleted: the price copy and its holes, `src/content/prices.ts`, `src/lib/prices.ts`, the prices section, the invite's price list, the Worker's price book request and rewrite, and `PRICES_SHOWN`. Git keeps them.
2. The one visit (consultation and fit) is always offered on the booking form. It was hidden only when the Worker had written a price book showing no hair system, which it never did while prices were off; the API still refuses it while ops offer none.
3. The production gate still stops a rupee figure typed into the site's copy.
4. `GET /api/published-prices` stays: it is the price book's public read, and what a build would fetch if prices return.

## Consequences

- The site's Worker asks mm-api only for invites, the referral reward and the served cities.
- If prices come back, they are fetched as the site is built and give the amount the terms promise, GST included, under a new ADR.
