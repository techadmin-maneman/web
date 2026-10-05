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

## Providers

A capability with more than one way to run has a folder: `providers/books/`, `crm/`, `geocode/`, `image/`,
`messaging/`, `payments/`. Its `index.ts` holds the interface the domain calls and the factory that chooses the
implementation from the settings; the vendor's own file sits beside it (`zoho.ts`, `razorpay.ts`, `evolution.ts`,
`ailabtools.ts`, `google-places.ts`); and `stub.ts` is the local and test stand-in, with whatever a test steers it by.
Where a capability is switched off, the factory answers with an implementation that refuses every call. One-file
providers (`alerts.ts`, `codes.ts`, `turnstile.ts`, `cloudflare-access.ts`) and what every vendor shares
(`vendor-fetch.ts`, `vendor-answer.ts`, `zoho-http.ts`, `provider-error.ts`) stay at the top.

A provider answers what the domain is expected to handle as a result (`{ ok: false, reason }`: an address not found,
a photograph refused), and throws a `ProviderError` for a vendor's failure or refusal that the domain only retries or
reports. `PaymentUnanswered` is the one other: a payment the vendor gave no word on, which may or may not have been made.

## The baseline

Two config files name a type from `policy/consents.ts`: the consent purposes are policy's, and the notices and the
message texts say which purpose each serves. They import types only, which load nothing, and the test lists them. Any
other upward import fails the test, and a listed one that is gone must come off the list.

## Routes

A route module sits under the surface that answers it, as `src/app.ts` lists them: `routes/public/`, `routes/client/`,
`routes/ops/`, `routes/tech/`, and the webhooks under `routes/hooks/`. `health.ts`, `client-errors.ts` (every app
reports its own page's errors) and the local `dev-visits.ts` stay at the top. A schema more than one surface answers
with goes in `routes/schemas/`, and a helper two routes share goes to the domain or `http/`. `test/node/route-imports.test.ts`
holds the routes to that, from a baseline of today's imports that only shrinks.
