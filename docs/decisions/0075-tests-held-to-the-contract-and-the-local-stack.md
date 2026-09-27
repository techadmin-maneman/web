# 0075. Tests held to the API's contract, and the whole system on a laptop

- Status: accepted
- Date: 2026-09-27
- Amends [0006](0006-deployment-pipeline.md) (the coverage gate) and [0032](0032-fsm-mirror.md) (when the reconciliation runs); follows [0026](0026-hosts-and-surfaces.md), [0030](0030-one-time-codes.md) and [0044](0044-payments-mirror.md)

## Context

The audit of 24 September 2026 found the tests trustworthy where they reached the real code and loose where they did not (TCD-01, TCD-03, TCD-07, A11Y-23), and the local stack unable to run anything past a booking (LIFE-17, TCD-18):

- About 140 of the 146 ops browser tests, and every technician one, answer the API in the browser. Nothing tied those answers to what mm-api sends; five of the generated OpenAPI schemas could not validate any real answer at all, because zod-openapi writes `.extend()` as `allOf` of two closed parts.
- The coverage gate was 85% of lines. The vendor clients passed it while their branches went untested: Zoho FSM's client at 51%, Razorpay's real client at 25%, never called by any test.
- Locally the cron never ran, the Razorpay webhook answered 404, the FSM stub remembered nothing so no visit ever closed, share links pointed at mm-api's port, which has no pages, and the browser tests' seeds had left 155 active copies of one technician.

## Decision

### The fakes answer only what the API would

Each fixture the ops and technician browser tests serve is typed with `satisfies` against the app's generated API types, and every reply either fake sends is validated, as it is sent, against the committed `docs/openapi-ops.json` or `docs/openapi-tech.json` with every object read as closed (`e2e/contract.ts`). A route the document lacks, a status it never sends, or a field it never writes fails the test. A test in Node validates every exported fixture before any browser runs. The ops fake answers by method and path. What any route can answer besides its own replies, the database check's 503 and the error handler's 500, and mm-api's own 404 for a path it has no route for, are allowed everywhere.

A fake that deliberately answers outside the contract, to show the app surviving a broken release, does so without the check and says so beside it.

The generated OpenAPI documents write each `.extend()`ed component as the one closed object it means, and the contract test fails on any `allOf` whose closed part refuses a field another part adds.

### Coverage is held on branches, with floors for the vendors

`vitest.config.ts` fails a run below 90% of lines or 80% of branches in `src/`, and counts `src/` only (the pattern had also matched the apps' and the site's own `src/`). The vendor clients and the payments mirror have floors of their own: `src/providers/**` 90/85, `razorpay.ts` 95/95, `fsm-zoho.ts` 95/90, `src/domain/payments.ts` 90/90. Recorded-reply tests, in the shapes each vendor answers, are how those are met.

### A run whose files stop reporting ends with their names

Vitest has no timeout for a file that never says it has finished. The Worker tests' queue producers name queues nobody consumes, since a consumer run after its test had ended was what broke the pool's channel and hung CI; and a reporter ends a run in which no test has reported for three minutes while files are open, naming them (`test/stalled-files.ts`).

### The whole system runs on a laptop

- `npm run dev:all` starts mm-api with the local login code and raised limits, the built public site on :4321 with `/api/*` passed to mm-api, and the three apps under Vite on their own `*.localhost` hosts. `scripts/lib/local-stack.ts` holds the ports and mm-api's local vars, which the browser tests read too; each port moves with an `MM_*_PORT` variable.
- `npm run db:seed:local` runs the browser tests' own seeds and adds a technician to sign in as. Each e2e seed names one fixed technician, and retires those earlier runs added.
- `npm run tick` runs the cron (`wrangler dev --test-scheduled`); `npm run pay:local` sends Razorpay's signed webhook for the last booking held, under a placeholder secret in `.dev.vars.example` that the stub now reads; `npm run close:local` closes a visit as FSM would once its technician closes it.
- The close is `POST /api/dev/appointments/:id/close`, a local-only route. It exists only where `DEV_ROUTES=on`, which the startup guard refuses outside local, and only a local app registers it; tests prove it answers 404 on staging and production config even with the switch set. It is in no API document.
- Links in messages and invites point at the site: locally `http://localhost:4321`, where `/r/:code` is answered.

### The FSM repair needs the real FSM

The reconciliation trusts FSM's word on which appointments exist. The stub keeps none, so locally every visit it re-read looked deleted. It now runs only where `FSM_PROVIDER` is `zoho` (the cron's `fsm_record` need). Staging runs it as before; production, whose FSM is off, skips it as before.

## Consequences

- A change to a route's schema that leaves a browser fake behind fails the tests that use it, and the Node test, instead of passing on a fake nobody updated. `npm run openapi` and then the named fake are what fix it.
- A new vendor call needs a recorded-reply test to keep its file above its floor.
- New local vars go in `scripts/lib/local-stack.ts`, never in `wrangler.jsonc`, whose environments are held to 64 vars and secrets (ADR 0009).
- `docs/getting-started.md` is the guide to all of it.
