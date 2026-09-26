# 0073. Prices from the price book, on the site and in FSM's catalogue

- Status: accepted
- Date: 2026-09-26
- Amends [0027](0027-referral-landing.md) and [0039](0039-phase-2-budget.md); adds item 39 to [0022](0022-site-departures-from-v2.md); completes what [0061](0061-ops-editable-inputs.md) and [0070](0070-vendor-correctness.md) left of open point 44

## Context

Ops set every price in the console, each from the day it applies (ADR 0061). Two places still did not read it (open point 44), and the audit of 24 September 2026 found both wrong:

- **The site and the referral landing typed their prices** in `site/src/content/site.ts` and `referral.ts`: ₹25,000 for a first fit, ₹1,500 for a service visit and ₹17,000 for a replacement, where the price book has held ₹30,000, ₹2,000 and ₹15,000 since 22 September 2026. The first year's totals (₹43,000, ₹64,000) and the search engines' price range were typed too, and the production gate did not look at the landing at all (FEO-22).
- **FSM prices a visit's tax invoice from its own catalogue**, whose "Replacement" was ₹30,000 against the book's ₹15,000 (INT-03). ADR 0070 stops such an invoice going out; nothing yet brought the catalogue into line.

Two constraints shape both answers. The account is on the free plan, where a Worker request past 100,000 a day fails (ADR 0009), and the site's content security policy allows scripts by hash and connections to itself only. And **staging's FSM is the owner's real org, shared with production** (ADR 0025, item 26), while staging's price book holds placeholder figures.

## Decision

### The site shows the book's prices, written into the page by mm-site's Worker

There were two ways to show a price that changes without a release on a site that is built once:

1. **At the edge.** mm-site's Worker, which already answers `/r/:code` (ADR 0027), also answers the pages that show a price, reads `GET /api/published-prices` over its service binding to mm-api, and rewrites each figure with `HTMLRewriter` before the page leaves Cloudflare.
2. **In the browser.** A small island on each page fetches `GET /api/published-prices` and replaces the figures after the page has loaded.

Both fit the free plan and the policy. Each costs one Worker request per page view (mm-site's in the first, mm-api's in the second), and neither needs the policy changed: the first writes text and an attribute, and JSON-LD is data the policy does not hash; the second is a same-origin fetch from a bundled script.

**We take the first.** The page that leaves Cloudflare is right: a search engine's crawler, the price range and the FAQ it reads as structured data, a visitor without JavaScript, and nobody sees a wrong figure replaced by a right one. The home page's prices need no script, and the Worker, its binding and the config check that allows them exist already. The island's one advantage is that a page stays up when the account's requests run out; by then booking and the try-on are down with it, and ADR 0009 accepts an outage at a limit.

- **Which pages.** `run_worker_first` names `/`, `/book` and `/r/*`, the three that show a price. Every other page is served straight from the assets, as before.
- **What they show.** The standard tier's first fit, service visit and replacement in force today in India, **before GST**, the main figure as the backend's rule has it (`src/policy/prices.ts`). GST is off today, so the two are equal; how the site says so once it is on is open point 44's. Totals are computed: the first year is the first fit and twelve service visits. The search engines' price range runs from the cheaper tier's first fit to the dearer's.
- **Premium.** The book knows one tier (ADR 0025, item 35), so the Premium column keeps the owner's own figures, from `site/src/content/prices.ts`, until the owner rules on the tier (open point 78). They are the only rupee figures the site holds.
- **How.** Each figure on a page carries its sentence as a template, `data-price="{firstFit}, then {service} a month"`, and the Worker fills it from the book. The two JSON-LD blocks are built again from the same figures. The booking form's island draws its own prices, so the Worker also writes the book's answer onto `<body>` as `data-prices`, and the island starts from it, as it starts from the invite.
- **A minute, per isolate.** The Worker keeps the book's answer for 60 seconds, the console's own staleness (ADR 0061), so mm-api is asked about once a minute however busy the site is. A rewritten page carries no `ETag`, so a browser never keeps last week's figures by revalidating against the unchanged file.
- **When mm-api cannot answer**, the Worker keeps the last answer it had, and failing that serves the page as built. The build carries the book's own figures of 22 September 2026 (`site/src/content/prices.ts`); the booking form's island then asks `GET /api/published-prices` itself. The local build and the browser tests serve pages without the Worker (ADR 0027), so they show these figures, and the island there reads the local book.
- **`GET /api/published-prices`** is on the public host, read-only, cacheable for a minute: the three figures, each with GST and its rate, and the day they are in force. It answers `503` if the book lacks one, and the pages are then served as built. It is not the ops host's `GET /api/prices`, which is the whole book, past and to come.
- **The production gate** stops a build while any price the site or the landing publishes is a rupee figure typed into its sentence rather than a hole the book fills: `referral.ts` is now covered (FEO-22).

The words "free consultation" are copy, not a price. A consultation the book does not have free is not bookable from the site in any case (ADR 0068).

### FSM's catalogue follows the price book, behind a switch that is off

**The comparison, always.** A cron job, `fsm_catalogue`, runs once an hour (the run in the first five minutes of each hour, UTC) and costs one call from the run's budget: FSM's catalogue list. Each visit type's service item, found by its name (`FSM_SERVICE_NAMES`), is compared with the book's standard price before GST in force today. A difference, or an item FSM does not have, is told once through `alertOnce` under `fsm_catalogue:<type>`, with the item's ID and name and both figures, and never anything about a client. The alert closes when the two agree. It reads only: the base part and the late fees have no catalogue item to compare.

**The push, off.** `FSM_CATALOGUE_PUSH` is a constant per environment in `src/config/environments.ts`, off in every one. **Amended 26 September 2026:** it was first a Worker var, which took mm-api to 65 vars and secrets, past the Workers Free limit of 64, and staging's deploy was refused (code 10055); a fixed value belongs in code (ADR 0009, rule 6).

- **Off:** a price change queues nothing to FSM, and the hourly comparison tells ops the item and the figure to set by hand.
- **On:** a price the console sets that is in force today (the standard tier, a visit type) queues `{ catalogue_sync: true }` on the fsm-sync queue, and the hourly comparison queues the same when it finds a difference, which is how a price set for a later day reaches FSM on that day. The consumer reads the book and the catalogue afresh and writes only the items that differ, `Unit_Price` in rupees before GST. However often it runs, it writes the same figure, so a repeated or concurrent message changes nothing. It tries once: the next hour's comparison is its retry, and tells ops if FSM still differs an hour after a push was queued (`after: 2`). An item FSM does not have is told at once either way: the push only writes prices, and making an item is `scripts/setup-fsm.ts`'s.
- The item's tax stays as FSM holds it. ADR 0070's check compares the invoice's total with GST, so a tax that differs still holds the invoice as a draft.

**Why off.** A price change on staging must not rewrite the real catalogue by itself. With the push on in staging, a placeholder typed into staging's console would reprice the owner's real items. The startup guard refuses the push in staging for as long as staging shares the org.

**Who switches it on, and where.** The owner, **in production only**, once production's price book holds the owner's prices and production connects FSM (its `FSM_PROVIDER` is `"none"` today). Staging's stays off. Until the owner switches it on, a price change is set in FSM by hand, and the comparison names each item to set.

**Not tried on the org.** The write is `PUT /fsm/v1/Products/{id}` with `Unit_Price`: the trial deletes an item at `/Products/{id}`, not `/Service_And_Parts/{id}`, and `scripts/setup-fsm.ts` creates one with `Unit_Price` (docs/decisions/fsm-trial.md). The list's `Unit_Price` is the field that script wrote, and the audit's read of 24 September 2026 found each figure it had written. The write is listed in open point 98; the first push after the switch proves it, and the next comparison reads it back.

## Consequences

- The site, the landing, the app and FSM's invoices answer to one book. A price ops change reaches the site within a minute and, once the owner switches the push on, FSM's catalogue within seconds, or at the next hour for a price from a later day.
- **Staging's comparison alerts today**: its "Replacement" is ₹30,000 against the book's ₹15,000. That is true, and it is what ADR 0070 holds those invoices for. `scripts/setup-fsm.ts` now makes a new "Replacement" at the book's ₹15,000; it never changes an item that exists.
- **mm-site now counts toward the account's requests** on `/`, `/book` and `/r/*` (ADR 0039 said only mm-api did); one request a view, and mm-api's price reads about one a minute. A day at the limit takes those three pages down with the rest (ADR 0009).
- **ADR 0027's Worker answers three paths.** The config check allows exactly `/`, `/book` and `/r/*` and the one binding to mm-api, as before.
- **Owed by the owner:** the Premium tier and its prices (open point 78), how the site words GST once it is on, and switching the push on in production (open point 44).
