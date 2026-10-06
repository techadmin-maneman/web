# Codebase upgrade plan

Where the code stands for a developer new to it, and the work that would make it easy to read. Measured on `main`
on 6 October 2026.

## The verdict

**Modular: yes.** The structure is sound, and tests enforce it:

- mm-api is in seven layers. `layers.test.ts` fails on an upward import or a cycle.
- Every vendor sits behind an interface with a stub, so the whole platform runs on a laptop with no vendor accounts.
- Tests decide which modules may write a table or a consent, and which may import a route or a feature.
- TypeScript is strict: 11 casts in about 100,000 lines of code, and no TODOs.
- About 79,000 lines of tests and 23,000 lines of browser tests. Query plans are tested, and every personal-data
  column is labelled.
- The API documents are generated from the routes, and knip finds dead code.
- Size limits are set at 400 lines a file and 80 a function. Files already past them are pinned, so they may shrink
  but never grow.

That is better than most codebases of this size.

**Easy for a new developer: not yet.** The code is correct and well guarded, but it reads as the project's diary.
A newcomer has to learn its history before they can find their way around. Five things stand in the way:

| What                    | Measured                                                                                                                                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Comments carry history  | 275 design-board codes in 148 files ("board F1", "(F3)"); 57 "Phase N"; 71 dated rulings; 106 "the owner"; 1,012 ADR references in 401 files, 59 of which point to more than one ADR. `CONTRIBUTING.md` allows none of the first four and at most one ADR a file. |
| A flat domain folder    | `src/domain/` holds 136 files side by side. Features are spread by prefix (`books-*`, `client-*`, `visit-*`, `referral-*`), or by no prefix at all (`give-back`, `kept-try-ons`, `after-a-ruling`, `needs-a-hand`).                                               |
| Names that need context | Some functions read like English but don't say what they return or do: `besideIt`, `landingOf`, `tellKept`, `inTakingOrder`. There are 24 functions with five or more positional parameters, and 35 calls pass a bare `true` or `false`.                          |
| Large files             | 27 source files are pinned past 400 lines. The largest are `site.ts` at 1,166, `dispatch.ts` at 1,017, the ops clients route at 832 and `public-booking.ts` at 736. 51 test files are past 500 lines, the largest at 1,401.                                       |
| Leftovers               | FSM is gone, but 36 files still name it. The Books invoice number lives in a column called `fsm_invoice_id`.                                                                                                                                                      |

Comments also use "he/his/him" 283 times, and the staff apps' copy another 41 times. Technicians and ops staff are
not all men.

## What a new developer should be able to do

- **In the first hour:** run everything locally and know where each feature lives.
- **On the first day:** make a small change in one feature, with its test, and get it through CI.
- **Throughout:** read any file without knowing the project's history. A name says what a function does. A comment
  says why, never when or who decided.

## The plan

The rules for every phase:

- Sequential, one small pull request at a time.
- No change of behaviour, so CI proves each step.
- No rewrite and no new framework.
- Each phase ends with a test or a lint rule, so the improvement can't drift back.
- Moving a file under the money or personal-data paths still waits for a person's `reviewed` label.
  `SENSITIVE_PATHS` moves with the file, in the same pull request.

### 1. Start here (1 day)

- Add `docs/start-here.md`:
  - a one-hour path through the existing documents;
  - a feature map: each feature's domain folder, routes, screens in each app, and tests;
  - "your first change", walked through on a real, small example.
- Add the code's names to the glossary, for example: `fsm_invoice_id` is the Books invoice.
- Link `start-here.md` first in the repository's `README.md` and in `docs/README.md`.

**Done when** someone new to the code can find a feature's files from the map alone.

### 2. Comments without history (4 days)

- Extend `no-audit-ids.test.ts` to fail on:
  - board codes;
  - "Phase N";
  - dated rulings;
  - "the owner" in code.
- Add a test that a file points to at most one ADR.
- Rewrite comments one folder per pull request, in this order: `lib`, `config` and `policy`; `domain`; `routes`;
  `apps/ops`; `apps/app`; `apps/tech`; `site`; `packages`. A comment that only records history is deleted. A comment
  that gives a reason keeps the reason and drops the date, the code and the name.
- In comments, use "they" for any person.
- The 41 pronouns in the staff apps' copy are a copy change, not a code change. They wait for the owner's word.

**Done when** the tests pass with no exceptions listed.

### 3. Feature folders for the domain (5 days)

Group the 136 files of `src/domain/` into folders named for what the business does. One folder moves per pull
request, and a script updates the imports.

| Folder       | Holds, for example                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------- |
| `booking/`   | availability, holds, slot times, open and asked windows, technician choice and rotation, waitlist |
| `visits/`    | the visit's status, times, changes, facts, check-ins, no-shows, one-visit, the next visit         |
| `dispatch/`  | dispatch, utilisation, leave, blackouts, the roster, technicians' work                            |
| `field/`     | technicians' jobs, job events and records, photos, pieces, stock, consumables                     |
| `money/`     | payments, payment links, refunds, credits, discount codes, the day's money, Razorpay catch-up     |
| `books/`     | the Books customers, invoices, items, sync, kept money                                            |
| `clients/`   | people, profiles, hair profiles, notes, history, address and number changes, places and cities    |
| `referrals/` | referrals, grants, cards, messages, invite lookups                                                |
| `try-on/`    | try-ons, claims, kept try-ons, the render choice                                                  |
| `privacy/`   | consents, deletion, erasure, data export, retention                                               |
| `messages/`  | queued, visit, referral and stop messages, the paced line, lead notices, the home prompt          |
| `ops/`       | alerts, tasks, grievances, disputes and rulings, ops settings, site notices, the audit log        |
| `access/`    | login, sessions, one-time codes, staff, rate limits                                               |
| `platform/`  | cron runs, maintenance, the storage meter, the vendor pass, test records, ceilings, enqueueing    |

- The layers test is unaffected, because it reads the top-level folder.
- `SENSITIVE_PATHS` shrinks to a few folders, such as `src/domain/money/`, `src/domain/books/` and
  `src/domain/privacy/`.
- Test areas take the same names where they differ today.
- Add a test that no file sits directly in `src/domain/`.

**Done when** the feature map in `start-here.md` has one row per folder.

### 4. Names a newcomer can guess (3 days)

- A function's name is a verb and its object: `findAdjacentVisits`, not `besideIt`; `alertKeptMoney`, not
  `tellKept`. Rename one folder at a time, after it has moved.
- One word for each thing, the glossary's word. Where the code and the copy name a thing differently, the code takes
  the glossary's word.
- Add ESLint `max-params` set to 4. A function that needs more takes one object, and a flag is always named, never a
  bare `true`. Fix the 24 functions with five or more parameters, and the 35 calls with a bare boolean.

**Done when** the lint rule passes with no exceptions.

### 5. Split the large files (4 days)

- Source files:
  - `site.ts`: one content file per page.
  - `dispatch.ts`: the board, a move, and where a job lands.
  - The ops clients route: one file per section of the client page.
  - `public-booking.ts`: one file per step.
  - The other 23 pinned files, largest first.
- Test files: split by the behaviour each part checks, with the shared setup in a `-fixtures.ts` beside them
  (`CONTRIBUTING.md` already asks for this).
- Lower or delete each pin as its file shrinks.

**Done when** `PINNED` in `eslint.config.ts` is empty and no test file is past 500 lines.

### 6. FSM's leftovers (2 days, across a production release)

- Rename `fsm_invoice_id` to `books_invoice_id`. Use the expand-and-contract steps of `docs/migrations.md`:
  1. Add the new column.
  2. Write both columns.
  3. Backfill the new column.
  4. Read the new column.
  5. Drop the old column, after a production release.
- Drop `fsm_write_state` and any other `fsm_*` column nothing reads.
- Delete the 6 FSM scripts.
- This sits beside PR12 of the FSM exit plan, which already waits for a production release.

**Done when** `grep -ri fsm src apps packages site scripts` finds nothing.

### 7. Simplify for Workers Paid (2 days)

Workers Free allowed 10 ms of CPU and 50 D1 queries per invocation, and refused work past its daily allowances.
Because of that, much of the cron's machinery exists: call budgets, jobs sliced minute by minute, the alerts on the
daily allowances, and a budget model of a day's reads. Workers Paid, bought on 6 October 2026 (ADR 0112), raises those
limits to 30 seconds of CPU and 1,000 D1 queries, and bills rather than refuses past a month's allowances.

- Make each job one pass where it fits.
- Keep a budget only where a vendor's own limit needs it, such as Zoho's 100 calls a minute.
- Correct the runbook, which says rate limiting needs a paid plan. One rule is free.

**Done when** each remaining budget names the vendor limit it protects.

### 8. Fewer, shorter documents (2 days)

- Split `runbook.md` (1,521 lines) into `runbook/` by task: provisioning, deploys, each alert, restoring D1,
  rolling back.
- Index the 109 ADRs by topic, and mark the superseded ones.
- Outside the ADRs and the open points, documents describe the system as it stands, without rulings' dates.

**Done when** each runbook page answers one task.

## Order and effort

Do the phases in the order above, but phase 7 second, about **23 working days** in all:

- Phase 1 first, because it helps from day one.
- Phase 7 second, now that Workers Paid is bought: it deletes code the later phases would otherwise tidy.
- Phase 3 before phase 4, so each name changes once, in its final place.

The moves and renames conflict with branches in flight, so land each one between feature pull requests, never
alongside a long-lived branch.

| Measure                                   | Now | Target |
| ----------------------------------------- | --- | ------ |
| Files directly in `src/domain/`           | 136 | 0      |
| Board codes, phases and dates in comments | 403 | 0      |
| Files pointing to more than one ADR       | 59  | 0      |
| Source files pinned past 400 lines        | 27  | 0      |
| Test files past 500 lines                 | 51  | 0      |
| Functions with five or more parameters    | 24  | 0      |
| Files naming FSM                          | 36  | 0      |

## Progress

| Phase                       | State                                                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1. Start here               | Done: `docs/start-here.md` and its map test (#485)                                                                |
| 7. Workers Paid             | Done: the database limit, the CPU report, the daily allowances, the budget model and the cron's caps (#479, #484) |
| 2. Comments without history | Done: every folder (#480 to #494), held by `no-history.test.ts`                                                   |
| 3. Feature folders          | Done: `src/domain/` in 16 folders, one a feature (#497)                                                           |
| 4. Names                    | Renames in review (#499); one-object parameters next, for review                                                  |
| 8. Documents                | The ADRs indexed by topic                                                                                         |
| 5, 6                        | Not started                                                                                                       |
