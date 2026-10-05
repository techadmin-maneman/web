# 0087. Consumables and their stock, and the job sheet, set in the console

- Status: accepted, on the owner's rulings of 27 September 2026 (`docs/archive/owner-answers-2026-09-27.md`: item 28, "Consumables, stock and FSM" and "Where stock is held"). FSM's two new calls are untried on the org (`docs/open-points.md`, item 25), and the switch that makes them is off everywhere; amended 27 September 2026 by [0085](0085-services-ops-can-edit.md), whose services a service's expected use is now checked against, and 28 September 2026 by the plan's pieces C26, C27 and C28 (`docs/archive/implementation-plan-2026-09-27.md`): writes to one place that land together each count once, what a place holds is kept as its balance, and the hourly check reads FSM's whole catalogue. Amended 4 October 2026 by [0110](0110-field-work-without-fsm.md): FSM's two calls are gone; stock is kept in our own database alone.
- Date: 2026-09-27
- Amends [0061](0061-ops-editable-inputs.md), [0065](0065-a-technicians-writes-reach-fsm.md) and [0073](0073-prices-from-the-price-book.md); follows [0038](0038-offline-writes.md), [0067](0067-alerts-and-silent-failures.md), [0070](0070-vendor-correctness.md) and [0071](0071-what-ops-see-before-a-setting-changes.md)

## Context

The technician's job sheet was code. Each kind of visit's checklist and the four partial reasons were committed in `src/config/job-sheet.ts`, most of them placeholders, waiting for a template the owner was to build in FSM (open point 28), and ADR 0061 counted `PARTIAL_REASONS` among the closed sets ops cannot change. The consumables step offered the board's four, by name, and the API kept whatever name it was sent. `consumables_used` held each job's rows once FSM had the summary, "where a stock count can read it" (ADR 0065), and nothing read them.

FSM keeps no stock. Its catalogue holds services and parts, and a work order can carry parts with quantities, but stock levels and their deduction come only with Zoho Inventory, on FSM Professional, Books Premium and Inventory Professional, and Inventory deducts only when an invoice is sent: a free consultation or a visit paid by credit would never deduct.

The owner ruled on 27 September 2026:

- **The job-sheet template is set in the ops console:** each kind of visit's checklist, the consumables with each service's expected use, and the reasons a job may be left partly done. The technician app reads them, and the consumables reach FSM as parts.
- **Stock is our own ledger.** The consumables and each service's expected use are set in the console and synced to FSM's catalogue as parts; stock on hand, deliveries, counts and reorder alerts are kept in our own system. Books stays on Standard.
- **Consumables are internal.** A job's use is kept in our records and on FSM's job summary, never as lines of the work order, so the client's invoice is unchanged.
- **Stock is held in each technician's kit and a central store.** A job's use comes out of the kit of the technician who did it, ops record deliveries and transfers, and low stock is alerted per kit.

## Decision

The rule is `src/policy/stock.ts`, which quotes the prompt: these are ours because FSM has no place for them, and everything FSM does hold is written to FSM. Migration 0049 adds five tables and three columns, and rebuilds none.

### The consumables

**Ops keep the list** in Settings · Consumables (`consumables`). Each has:

- **a code**, made from its name when it is added and never changed. The phone sends it and the ledger keys on it, so a rename keeps the history and a step queued offline is still understood;
- **a name**, unique whatever its case, since FSM's part is found by it;
- **the unit** it is counted in, in whole numbers: a strip, a millilitre, a sachet;
- **what one costs us**, in paise. Only this panel shows it: the technician's card carries none, and no invoice carries a consumable;
- **two reorder levels**, one for any kit and one for the central store (below);
- **the day it is retired from**, today or later. From that day the app no longer offers it. A job that recorded it keeps it, the stock held stays, and its FSM part is left as it is. It can be restored.

Each change shows the old figure beside the new before it is sent (ADR 0071) and is audited (`consumable.add`, `consumable.change`, `consumable.retire`, `consumable.restore`).

**In tables of their own, not the settings register.** ADR 0061's register held at most ten inputs, each one figure (ADR 0088 has since lifted the cap, but a register input is still one figure or one per key). A list that grows, a row per consumable, is a table, and so are the ledger and the job sheet's lists. Nothing here is a Worker var.

### What each service uses

`consumable_usage` holds how many of each consumable a service is expected to use, and the technician's steppers start there. Ops set it beneath the list, one service at a time, old beside new, audited as `consumable.usage`.

A **service** is a kind of visit at one of the price book's tiers, `(visit_type, tier)`, and the API takes only a pair the book prices: the standard four today. The table of services the owner has asked for (ADR 0025, item 67) is being built beside this, so there is no foreign key to it; once it exists the pair becomes its row, as the migration's header says. Until then every job is taken to be its kind's standard tier, which is what every booking is sold at (ADR 0025, item 35). **Amended 27 September 2026 ([ADR 0085](0085-services-ops-can-edit.md)):** the table of services exists (migration 0050). `POST /api/service-usage` now takes a pair only where the services table holds that `(kind, tier)` row, retired or not, since a visit sold before its service was retired is still done; the price book's pairs no longer decide it. A job's service is its own visit's, `appointments.tier` (the standard tier where the mirror knows no other), so the technician's steppers start at what that service uses. Settings · Consumables lists each service by its name, a kind at a time in the console's order, a retired one marked "retired from" its day. There is still no foreign key: `consumable_usage` comes in migration 0049 and `services` in 0050, and SQLite adds a foreign key only by rebuilding the table, so the pair stays checked in code (`setExpectedUse`, `src/domain/consumables.ts`).

### The technician's step

The job's card carries every consumable offered on the job's day, with its unit and how many the job's service expects: those it expects first, their steppers already at that count, and **Add another** for any of the rest. The step sends `{ code, quantity }` for each used, and an empty list for none. The phone keeps the list with the job, so a basement changes nothing.

- **A step a phone queued before this release** sends `{ name, quantity }`, and is still taken. Each name is matched to a consumable whatever its case; one that matches none is kept as the technician typed it and moves no stock.
- **A code the catalogue never held is refused** (400, `items`). One retired since the phone kept the job is taken: it was used.
- **Board B3 draws four steppers** at a count already made. The departure is recorded in `docs/fidelity-method.md`.

### A job's use

**It lands in our records as the step lands,** not once FSM has the summary, as ADR 0065 had it. Stock is ours, and a job whose FSM write waits or fails still used what it used (`src/domain/job-use.ts`).

- **A row of `consumables_used` for each consumable**, which now also keeps its code, what the job's service expected of it and what one cost that day, so a later change of cost leaves a past job's as it was. Its `fsm_item_id` stays empty: the part is the consumable's, found through its code. One row an event for each consumable, by its code, so a step read again after ops renamed a consumable writes no second row under the new name (amended in review, 27 September 2026). A job's use is its latest event's rows.
- **A movement out of the technician's kit** for each, reason `used`, naming the job and the event.
- **Once, however often the step is replayed.** The use is read from the job's latest consumables step, and what the kit's rows for the job already took is subtracted, so a replay writes nothing, a replay of an older step changes nothing, and a corrected step writes only the difference. A unique index on the event and the consumable holds it under two replays at once.
- **Once when two of the job's steps land together** (amended 28 September 2026, plan piece C26). The Worker serves requests at once, so an older step's use could be read, a newer step land and record its own use from rows that did not yet hold the older one's, and the older one then write its use as well: the job's use taken twice. The kit's rows are now written only while the step they were worked out from is still the job's latest (`INSERT … SELECT … WHERE` the step is the job's latest, in the same statement); the newer step's own request records the use. Nothing is retried: the step that lost is no longer the one to record. Reproduced first by holding the older step's write between its read and its batch (`test/worker/stock.test.ts`).
- **FSM's summary names each consumable as before,** by the name the console gives it now, and no line is written to the work order.

### Stock

`stock_movements` is the ledger. Every movement into or out of a place is a row that is never changed, and what a place holds is the sum of its rows.

- **The places** are the central store and each technician's kit. Stock is in whole units of the consumable.
- **A delivery** is received into the central store; one straight into a kit is a delivery and a transfer.
- **A transfer** is two rows sharing an ID, out of one place and into another; the same place twice is refused.
- **A count** writes the difference from what the rows said, nought when it agrees, and the Stock page says when each place last counted each consumable. A kit's first count is its opening stock. **Amended 28 September 2026 (plan piece C26):** the difference is written only while the place still holds what the count read, and its audit entry only with it; a job's use landing between the read and the write would otherwise be taken twice, once by its own row and once in the difference. The count then reads the place again and works the difference out afresh, three times at most, which only three movements landing at that place in the same moments could exhaust; the fourth answer is an error and nothing is written. A guard rather than a figure worked out in the statement, because the audit entry names what the place held and the difference, and a guard keeps both as the Worker worked them out.
- **A loss** is written off with ops' words for what happened, which it requires.
- **Nothing is refused for leaving a place below nothing.** A job's use cannot be refused, and a delivery may be recorded late. The console says so before a movement is sent, and a count puts it right.

Ops record each on the Stock page, a section of its own beside Technicians. Each movement shows what every place it touches holds now and will hold, before it is sent (ADR 0071), and is written in one batch with its audit entry (`stock.receive`, `stock.transfer`, `stock.count`, `stock.write_off`). The page lists every consumable offered, and any retired one still held, against the central store, each active technician's kit, and the kit of any technician who left still holding stock, with the latest 30 movements beneath.

**What a place holds is kept as its balance** (amended 28 September 2026, plan piece C27). The Stock page summed the whole ledger on each look, and each movement's low-stock check and each count summed the place's rows: reads that grow with every movement ever made, against D1's 5 million rows a day (ADR 0009). Migration 0053 adds `stock_balances`, a row for each consumable at each place, `'central'` or the technician's ID, with what the place holds and when it last counted it.

- **A trigger keeps it,** in the same statement as each row of the ledger is written: every writer moves it, whatever writes the row, and the Worker deployed before this one, which knows nothing of it, keeps it true from the migration to the release. Each place starts at the sum of its rows, and when it last counted is the latest count's, whichever order two counts land in. A statement beside each write in its batch would have left a balance behind every row written without one, from the migration to the release, and behind the fixtures'.
- **The ledger stays the record.** A movement is never changed, and a trigger now refuses an update, which would leave its balance behind. The staging fixtures take their own rows out again (`e2e/tech-staging/seed.ts`, `scripts/staging/seed-technician-tester.ts`), and a third trigger gives each place back what the row moved, with when it last counted from the rows left.
- **The Stock page, the low-stock check and a count read balances.** The latest 30 movements are read along an index of their time. A look, or a count, reads the same rows whether the ledger holds a hundred rows or a thousand (`test/worker/cron-reads.test.ts`).

### Low stock

**One reorder level for any kit and one for the central store,** on each consumable, since the kits carry the same set. A level per kit would be a table ops fill for every new technician; it can come later without touching the ledger. A place is low at or below its level, and a consumable with no level is never low.

**An alert per kit, and one for the store** (`src/domain/alerts.ts`, ADR 0067), keyed `low_stock:kit:<technician's ID>` and `low_stock:central`. A movement that takes a place to its level raises its alert, naming all the place is low on and linking to the Stock page; the message gives the technician's ID, never his name. A place's alert closes once it is low on nothing. Like every alert it is told once, and again only as the movements that find the place low reach 10, 100 and 1,000.

**The Stock page marks each low place in words.** Low stock is not a group on the Tasks board: the board's groups are cases about a client or a visit that someone closes, and low stock is a property of a place that each movement changes, shown where ops act on it.

### FSM's catalogue

**The hourly check keeps the consumables in FSM's catalogue as parts at Rs. 0** (`src/domain/fsm-catalogue.ts`). It is ADR 0073's pass, extended: the same run in the first five minutes of the hour, the same catalogue list, read once, and no call of its own while nothing needs writing.

- **It finds each consumable still offered** among FSM's parts, by the part's ID once linked, else by our name exactly, which links it. A part linked to one consumable is never matched to another by name: a consumable renamed, whose old name ops then give to a new one, would otherwise hand the new one its part, and the two would rename it back and forth every hour (amended in review, 27 September 2026). Settings · Consumables says of each whether it is in FSM, in FSM under another name, not in FSM, or not checked yet. D1 is written only where that changed.
- **With `FSM_CATALOGUE_PUSH` off,** in every environment today, it raises one alert, `fsm_catalogue:consumables`, naming each consumable missing or named otherwise, for ops to add or rename by hand as a part at Rs. 0. It closes once each is linked. The startup guard still refuses the push in staging, which shares the owner's real org, so staging never writes the catalogue.
- **With the push on,** it adds a missing part, or renames one named otherwise, in the pass itself: at most five a pass (`PART_WRITES_A_PASS`), each a call from the cron run's budget, the rest waiting for the next hour. A part is added at Rs. 0 and its price never touched again, and a retired consumable's part is left alone. A write FSM refuses is logged, `fsm_part_push_failed`, and ops hear only if the next hour still finds it unsettled.
- **Both calls are untried on the org** (open point 25), as the provider's header marks them: `POST /fsm/v1/Service_And_Parts` with `Type: "Part"` and `Unit_Price: 0`, and `PUT /fsm/v1/Products/{id}` with a new `Name`. Adding reads the new ID from whichever of the shapes FSM's creates answer in comes back, and an answer with none is a failure, not a part without an ID. The next hour's check reads both back by name. The stub keeps what it was asked to add and rename, and the unconnected provider refuses both, as it refuses every call.
- **The whole catalogue, however large** (amended 28 September 2026, plan piece C28). The list was read at most five pages of 200: a service's item or a consumable's part past the thousandth was never seen, so with the push on the part was added again every hour, and a service's item told missing. The check now reads a page at a time while FSM's answer says there are more (`info.more_records`), each page one call from what the cron run has left (`itemsPage`, on Zoho and on the stub, which pages its catalogue as FSM does). At the top of the hour the jobs before it spend at most 24 of the run's 40 calls (the sweeper's balance check, 20 held bookings sent back, and the reconciliation's two pages and technician list at night) and usually four, so the check can read 16 pages, 3,200 items, at the least, and some 36, 7,200, as a rule. The jobs after it that then find the budget spent carry on at the next run, five minutes on, as they do whenever it runs short.
  - **Where the calls end before FSM's last page,** the check speaks only for what it read: a service or a consumable whose own item was not on those pages is neither told missing, nor made, added, renamed or unlinked, and its alerts are left as they were, so the push can never make or add one twice. Its own item is the one kept on it, where one is: another of its name on a page it read is not taken for it while its own was not read (amended in review, 28 September 2026). One with none kept yet is found by its name, as ever. It logs `fsm_catalogue_unread` with the pages it read, tells ops under `fsm_catalogue:unread` once the next hour cannot read it whole either, and closes that alert on the first hour that does. It starts from the first page again each hour rather than carrying on from where it stopped: what it compares is then one reading of FSM, never pages read an hour apart.
  - **The push from the fsm-sync queue** reads the same way from a budget of its own of `FSM_ITEM_PAGES` pages, what a read of the whole list took before, so its invocation spends no more than it did. Its invocation carries up to ten messages of the fsm-sync queue with no shared count of calls, so it reads no further. Past those pages it writes over each item it found and makes none, and logs `fsm_catalogue_push_failed`, reason `catalogue_unread`, naming each service offered whose item it did not reach; the hourly check's alert, an hour on, tells ops to look for that log and to set the item in FSM by hand, which for an item past those pages is the only way it is set.
  - **A booking, the mirror and a piece** still read the list at once, up to `FSM_ITEM_PAGES` pages (`items()`), within their own request's calls. None of them makes an item, so none can make one twice: past a thousand items a booking whose service's item lies beyond them falls back to its kind's standard item and tells ops (ADR 0085), and a piece whose base's part lies beyond them fails its write to FSM, which is retried and then handed to ops (ADR 0065). Neither is expected of a catalogue that holds a dozen items today.
- **A piece is never built on a consumable's part.** Fitting a piece takes the catalogue's part by its base's name; a consumable's part, by its ID or its name, is left out (`src/domain/pieces.ts`).

### The job sheet

**Ops set each kind of visit's checklist and the partial reasons** in Settings · Job sheet (`checklist_items`, `partial_reasons`), at most 20 and 12 items, each at most 80 characters, no two alike.

- **A list nobody has saved is the committed one,** `src/config/job-sheet.ts`, whose placeholders stand until ops set theirs. The first save makes the rows the list.
- **An item keeps its code** through a rename or a move. A new one's code is made from its words.
- **An item left out is retired, not deleted,** so a phone that queued it offline is still taken, FSM's summary can still name it, and ops can put it back under its own code.
- **The card carries both lists** in ops' order, each item with its code and its words. A step is checked against every code the list ever held, and one never listed is refused.
- **FSM's summary** names the checklist in ops' words, counting only what is still on the list, and the Tasks board names a partial visit's reason in ops' words too, where it gave the code.

Each save shows what is renamed, added, taken off and moved before it is sent (ADR 0071), and is audited (`job_sheet.set`).

## Consequences

- **ADR 0061 is amended:** the partial reasons and the checklists are ops' lists, no longer closed sets in code. The four kinds of visit remain a closed set.
- **The card's `partial_reasons` changed shape,** from codes to `{ id, label }`, and it gained `consumables`. The technician app is not yet released, so only test phones hold cards, and a card an earlier build kept is read in today's shape, each reason worded from its code (`apps/tech/src/store/jobs.ts`).
- **Jobs worked before this release are not replayed into the ledger.** They predate every kit's opening count, which would only undo them; their rows in `consumables_used` stay as they were, by name. A step that landed before the release and reaches FSM after it keeps no row: FSM's summary still names it. Production has no such job, since the technician app is not released there.
- **The Zoho budget.** The check reads the catalogue once an hour, as it did. With the push on, it may add at most five calls a pass until every consumable is linked, and none after. D1 gains a row per consumable used on a job, and the check writes nothing in an hour when nothing changed.
- **Staging holds no consumables** until ops add them; the local stack's seed adds a few (`scripts/dev/seed-local.ts`). The console's words are placeholders (`apps/ops/src/content.ts`).
- **Tests.**
  - `test/node/policy-stock.test.ts`: the rules.
  - `test/node/migration-0049.test.ts`: the migration.
  - `test/worker/consumables.test.ts`: the list, its retirement and what each service uses.
  - `test/worker/stock.test.ts`: the ledger, a job's use written once and corrected, writes that land together, and low stock.
  - `test/node/migration-0053.test.ts`: the balances, started from the ledger and kept by its triggers.
  - `test/worker/cron-reads.test.ts`: the Stock page and a count read no more as the ledger grows.
  - `test/worker/job-sheet-settings.test.ts`: the job sheet, the committed lists and retired items.
  - `test/worker/fsm-catalogue.test.ts`: the parts, with the push off and on, and its bound; a catalogue past a thousand items, read whole and read in part.
  - `test/worker/fsm.test.ts`, `test/worker/fsm-zoho-replies.test.ts`: the two calls, on Zoho, the stub and the unconnected provider.
  - `test/node/dom/fakes-contract.test.ts`: the console's fakes answer as the API does.
  - `test/worker/pieces.test.ts`: a piece is never built on a consumable's part.
  - `test/worker/ops-tasks.test.ts`: a partial visit's reason in ops' words.
  - `test/node/dom/tech-kept.test.ts`: a card an earlier build kept.
  - `e2e/ops/consumables.e2e.ts`, `e2e/ops/job-sheet.e2e.ts`, `e2e/ops/stock.e2e.ts`: the console.
  - `e2e/tech/steps.e2e.ts`: the step.
