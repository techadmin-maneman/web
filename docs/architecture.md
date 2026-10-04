# How src/ is layered

mm-api's code stands in layers. A module imports its own layer and those below it, never one above, and no module
imports itself back through others. `test/node/layers.test.ts` holds src/ to this: a new upward import or a new cycle
fails it.

| Layer                        | Folders                                                         | What it holds                                                                                                                       |
| ---------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1. lib                       | `lib/`, `log.ts`                                                | Small helpers with no business in them: India's time, durations, hashes, signed tokens, the logger.                                 |
| 2. config                    | `config/`                                                       | Data: environments, settings, limits, the booking choices, notices, message texts and kinds, what the queues carry (`pipeline.ts`). |
| 3. policy                    | `policy/`                                                       | The business rules, as pure functions over that data, and the register of what ops may set (`ops-settings.ts`).                     |
| 4. domain and providers      | `domain/`, `providers/`                                         | What the rules act on, in D1 (bookings, visits, payments, invoices), and each vendor behind its interface, with its stub.           |
| 5. wiring, requests and jobs | `dependencies.ts`, `guard.ts`, `http/`, `queues/`, `scheduled/` | What a request, a queue message or the cron carries, and the consumers and jobs that call the domain.                               |
| 6. routes                    | `routes/`                                                       | One module per route or group of routes, zod schemas included.                                                                      |
| 7. the app                   | `app.ts`, `index.ts`, `openapi.ts`                              | The Worker: requests by host, the queue consumers, the cron, and the OpenAPI documents.                                             |

Within a layer, modules import each other freely, as long as no cycle forms.

## Where a thing goes

- **A rule** that needs no database goes in `policy/`, and the data it reads in `config/`. The front ends import both
  directly (`apps/*`, `site/`), so neither may import the Worker's types.
- **A queue's message and its retry ceiling** go in `config/pipeline.ts`, so whoever sends to the queue and the
  consumer that reads it share the contract without importing each other.
- **Sending to a queue** is `domain/enqueue.ts`, which the domain, the routes and the jobs all use.
- **A vendor's error** is `providers/provider-error.ts`, which the domain reads without naming the vendor.

## The baseline

Two config files name a type from `policy/consents.ts`: the consent purposes are policy's, and the notices and the
message texts say which purpose each serves. They import types only, which load nothing, and the test lists them. Any
other upward import fails the test, and a listed one that is gone must come off the list.
