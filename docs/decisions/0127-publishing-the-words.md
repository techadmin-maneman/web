# 0127. Publishing the site's words

- Status: accepted
- Date: 2026-10-11
- Topic: The ops console

## Context

The Words page records new words for the site's lines (ADR 0126). The owner's scope had the site publish them by a rebuild, so the site stays a fast static page with nothing fetched at visit time. Staging and production each have their own database, console and site.

## Decision

1. **A publish is a snapshot.** Publish, on the Words page, keeps every line of the site changed there, as it stands, in `site_word_publishes`; each line says whether the site's last publish has its wording. Growth's Manage publishes; it is audited.
2. **The build lays it over the copy.** A deploy builds the site with `--words`, which reads that environment's latest publish from its own site (`GET /api/site-words`, past Access on staging) into `site/.words.json`. A Vite plugin then has each copy module set its published lines on its own exports, so the pages and the islands both carry them (`site/src/lib/published-words.ts`). A deploy that cannot read the publish stops rather than put the code's wording back. A build without `--words`, as every test's is, reads nothing over the network.
3. **Staging within minutes.** `.github/workflows/site-words.yml` asks staging for its latest publish every ten minutes and builds and deploys mm-site for one not yet built, sharing staging's deploy queue. Every staging deploy builds with the published words too.
4. **Production with a release.** Production's site takes its words whenever it is built; its deploy builds no site while production keeps its placeholder, and a production site build adds `--words` as staging's does. A publish never deploys production by itself.
5. **The messages are not published here**: they switch once WhatsApp approves them (phase 3).

## Consequences

- A line whose place in the copy moved since a publish is left as the code has it, and shows as changed on the page until published again.
- Tests: `test/worker/words/words-publish.test.ts`, `test/node/site/site-published-words.test.ts`, `test/node/tooling/site-words.test.ts`, `test/dom/ops-words.test.ts`, `e2e/ops/words.e2e.ts`.
