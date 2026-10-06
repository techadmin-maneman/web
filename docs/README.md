# The documents

Where to read, by what you are here to do. The repository's own `README.md` says what the platform is and how its parts fit; this page finds the rest.

## Start

| Document                                 | Read it for                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| [start-here.md](start-here.md)           | New to the code: the first hour, where each feature lives, and a first change walked through |
| [walkthrough.md](walkthrough.md)         | The whole platform as its users meet it: a booking, a visit, a payment, a referral, an alert |
| [getting-started.md](getting-started.md) | Everything running on your laptop, with stub vendors                                         |
| [glossary.md](glossary.md)               | Which word means what, where one thing has several names                                     |
| [front-ends.md](front-ends.md)           | The four front ends: how each is built, run, tested and deployed, and what they share        |

## Change

| Document                                                         | Read it for                                                                               |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [decisions/](decisions/README.md)                                | Every decision, as an ADR; 0025 is the register of the owner's rulings and the departures |
| [architecture.md](architecture.md)                               | How mm-api's code is layered: what may import what, and where a new thing goes            |
| [codebase-upgrade-plan.md](codebase-upgrade-plan.md)             | Where the code is hard for a newcomer, and the phased plan to fix it                      |
| [../CONTRIBUTING.md](../CONTRIBUTING.md)                         | Shipping a change: the branch, the checks, the size, when a person must look              |
| [migrations.md](migrations.md)                                   | Writing a migration D1 will take, and the contract steps waiting                          |
| [frontend.md](frontend.md)                                       | The public site in detail: content, prices, notices, analytics                            |
| [fidelity-method.md](fidelity-method.md), [fidelity/](fidelity/) | How a screen is compared with its design, and the pairs                                   |
| [prompts/](prompts/README.md)                                    | The briefs, word for word                                                                 |

## Operate

| Document                                                                                       | Read it for                                                                             |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [runbook.md](runbook.md)                                                                       | Provisioning, deploys, incidents, every alert, restoring D1, rolling back               |
| [go-live.md](go-live.md)                                                                       | What takes each release to production, in the owner's order                             |
| [open-points.md](open-points.md), [open-points-settled.md](open-points-settled.md)             | What is still owed before production, what staging uses meanwhile, and what was settled |
| [tech-field-test.md](tech-field-test.md), [technician-test-setup.md](technician-test-setup.md) | The technician app's field test, and signing in to it on your own phone                 |
| [env-files.md](env-files.md)                                                                   | The git-ignored files the scripts read their secrets from, and their templates          |
| [turnstile.md](turnstile.md)                                                                   | The Turnstile widgets, their site keys and hostnames                                    |

## Reference

| Document                                                                                               | Read it for                                                                            |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| [api.md](api.md), [api-client.md](api-client.md), [api-ops.md](api-ops.md), [api-tech.md](api-tech.md) | Every route, one page per surface, generated with `openapi*.json` by `npm run openapi` |
| [schema.md](schema.md)                                                                                 | Every table in D1, written from the migrations by `npm run schema`                     |
| [verification.md](verification.md)                                                                     | Each milestone's definition of done, with its evidence                                 |
| [reference/](reference/README.md)                                                                      | The AILabTools API notes, verbatim                                                     |

## Archive

[archive/](archive/README.md) keeps documents that did their job: the owner's answers of 27 September 2026 and the plan they made, the feature inventories, Phase 2's inputs, the address-capture study, and FSM's trial and licensing. None of them describes the system as it stands.
