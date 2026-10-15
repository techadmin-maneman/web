# 0126. The Words page

- Status: accepted
- Date: 2026-10-11
- Topic: The ops console

## Context

The owner asked on 11 October 2026 for the team to change the site's words and the WhatsApp messages to clients without a developer. The scope agreed then: a Growth page listing every editable line, checked before anything saves, with each line's history and a way back; the site publishing the new words by a rebuild, staging first; the messages switching once WhatsApp approves them. This records phase 1, the page.

## Decision

1. **One list of every line.** `src/config/words.json` holds each line the page may change: the site's copy by its module, export and path ("site:home/hero.title"), and every message to a client by its template ("message:visit_reminder_v1"), with where it appears and its wording in the code. `npm run words` writes it from the copy itself (`scripts/lib/words-catalogue.ts`), and `npm run gen` with the rest, and a test fails while it is out of date.
2. **What stays locked** is left out of the list: the legal pages and the consent notices, which counsel approves; prices and the price book's holes; images, links, slugs and numerals; the business's structured details; lines with figures built in, which are functions in the code; and the login code's message, whose text DLT and WhatsApp fix.
3. **Checks before anything saves** (`src/policy/word-checks.ts`): the holes the page or the message fills are kept, none added; no price and no count of referral visits typed by hand, as the production build already refuses; no placeholder text; at most half again the code's length; and for a message, a first line naming no hair system, fitting or visit and carrying only its own details, since a locked phone shows it, and no ending on a detail unless the code's wording does.
4. **Every wording is kept.** `word_versions` holds each line's wordings, the newest in force; going back to an earlier one, or to the code's, is another row. Growth's View reads the page, Manage changes it; each change is audited by the line's key.
5. **Which lines a copy review has read.** `src/config/words-reviewed.json` keeps each line's code wording as the last copy review read it, and the list marks a line `reviewed` while its wording is still that one. A line written or changed since shows "Not reviewed" on the page, and Find words lists those alone. After a review, `npm run words:reviewed` and then `npm run words` mark every line read (added 15 October 2026).

## Consequences

- Phase 2 publishes the site with the words set here, staging first; phase 3 sends the messages with them once WhatsApp approves. Until then the page records the words.
- A line whose code wording changes keeps its key while its place in the copy does; one moved or renamed in the code starts afresh.
- Tests: `test/node/words/`, `test/node/policy/word-checks.test.ts`, `test/worker/ops/words.test.ts`, `e2e/ops/words.e2e.ts`.
