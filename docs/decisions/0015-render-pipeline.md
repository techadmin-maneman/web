# 0015. The render pipeline and its budget

- Status: accepted
- Date: 2026-09-21

## Context

AILabTools bills on generation, not delivery. Its results live 24 hours on a host that sometimes stalls, and Pro took 17 to 49 seconds and Premium 80 to 91 when measured (API notes, 7.6 and 7.10). The Worker cannot wait that long in a request, and every queue delivery and R2 write counts against the free tier (docs/decisions/0009).

## Decisions

**One step per delivery** (`src/queues/render.ts`):

| State         | The step                            | Then                                                                           |
| ------------- | ----------------------------------- | ------------------------------------------------------------------------------ |
| `queued`      | Read the photo, check it, submit it | `rendering`, and a retry in 5 s                                                |
| `rendering`   | Poll once                           | Not done: retry in 5 s, or 10 s after 30 s. Done: store the URL, then download |
| `downloading` | Download: 3 tries of 20 s           | Stored: `ready`. Not: retry in 60 s                                            |

- **A job is submitted at most once.** `submit_started_at` is claimed in D1 before submitting. A second delivery of the same message finds it taken, because Queues can run two consumers at once (docs/decisions/0012). A submit that started and never recorded a task is failed by the sweeper after 10 minutes: whether AILabTools took it cannot be known, and submitting again could bill twice.
- **Transient submit failures are tried again**, three times in all. Failed calls bill nothing (7.6), so a network error, a 5xx or a 429 costs only time.
- **The deadline is 180 s from submitting.** A delivery past it still polls once, because a finished render has been billed whatever the clock says.
- **The result URL is stored before downloading.** The queue retries the download three times, a minute apart. Then the sweeper takes over, every 5 minutes for the first few tries and hourly after, until the URL's 24 hours are up. Only then does the job fail, with an alert that a billed image was lost.
- **Results are capped at 6 MB** (`MAX_RESULT_BYTES`). The cap sizes the R2 storage budget, and WhatsApp takes images of 5 MB at most. Staging's first renders will show whether real results come near it.
- **The render consumer** takes batches of 5 and allows 100 retries, since each poll is a retry. It sets no concurrency limit, because jobs are independent.

**Messaging** (`src/queues/messaging.ts`): a send is claimed with a two-minute lease (`sending_at`), so overlapping consumers cannot both send it. A transient failure is retried three times; then the message fails and an alert names it.

## The budget

`scripts/lib/free-tier-budget.ts` works out the worst case from every environment's ceilings, and `test/node/free-tier-budget.test.ts` fails the build if any use passes 80% of its free allowance. Staging and production share one account, so they are added together.

**Queue operations per render: at most 38.**

| Part                                                      | Operations |
| --------------------------------------------------------- | ---------- |
| The render message: write, read, delete                   | 3          |
| Polls: 6 in the first 30 s, 15 to the deadline, 1 past it | 22         |
| Download retries                                          | 3          |
| The result message, with three retries                    | 6          |
| The CRM sync, with its quick retry                        | 4          |
| **Total**                                                 | **38**     |

**With the committed ceilings** (staging 20 renders a day, production 40):

| Allowance                   | Worst case                                                                                                                  | Free       | Share    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------- | -------- |
| Queue operations a day      | 60 × 38 = 2,280, plus 2,500 reserved for leads and the sweeper                                                              | 10,000     | 48%      |
| R2 storage                  | staging 20 × 3 days × 6 MiB (0.38 GB), plus production 40 × 30 × 6 MiB (7.55 GB), plus an hour of photos (0.03 GB): 7.96 GB | 10 GB      | 79.6%    |
| R2 Class A a month (writes) | 31 × (uploads + results) = 5,580                                                                                            | 1,000,000  | under 1% |
| R2 Class B a month (reads)  | 31 × (renders + result reads) = 39,060                                                                                      | 10,000,000 | under 1% |

R2 storage is the tight one: it sits just under the 80% line, and it is what holds production to 40 renders a day. Any higher ceiling fails the build. To raise it:

- measure real result sizes on staging and lower `MAX_RESULT_BYTES`;
- shorten `RESULT_RETENTION_DAYS` in production, which changes what the photo notice may promise;
- or accept R2's paid tier, a new ADR with the owner's sign-off (docs/decisions/0009).

## Consequences

- The budget assumes the sweeper runs. If it stopped, photos would sit until the buckets' 30-day rule, and the alerts would be the warning.
- AILabTools spend follows the render ceilings: at most 60 renders a day across both environments, about 600 to 900 credits.
