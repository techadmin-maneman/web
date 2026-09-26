# 0032. The FSM mirror, and Books documents

- Status: accepted
- Date: 2026-09-22

## Context

The Phase 2 backend prompt makes Zoho FSM the system of record for field work: clients, appointments, technicians, job sheets and pieces. The apps read a D1 mirror of it, kept current by FSM's webhooks and a nightly reconciliation. Books holds the invoices and receipts the client app shows.

Two things set the constraints:

- **The trial.** `docs/decisions/fsm-trial.md` records how the real org's API behaves:
  - an empty list answers 204;
  - a reschedule needs its own endpoint;
  - webhooks are unsigned;
  - Zoho mints at most 10 access tokens per 10 minutes.
- **The owner's rulings** (ADR 0025, items 26 and 27):
  - the trial's org is the real one;
  - staging runs on placeholders until production.

## Decision

This ADR grows with P2-M2. Its first part is the connection.

**One Zoho client for FSM and Books,** in the real org. It is separate from the CRM's client, because the CRM is still in the Developer Edition org (ADR 0020).

- Its ID, secret and refresh token are the Worker secrets `ZOHO_FSM_CLIENT_ID`, `ZOHO_FSM_CLIENT_SECRET` and `ZOHO_FSM_REFRESH_TOKEN`.
- Its hosts and the Books organisation are vars (runbook, step 11b).

**The access token is kept in D1,** in `zoho_tokens` (migration 0010), one row per client. Every invocation uses the same token until a minute before it expires. The code that refreshes it is shared with the CRM (`src/providers/zoho-http.ts`); the CRM keeps its own one-row `zoho_token`, unchanged. **Since 25 September 2026** one requester serves the CRM, FSM and Books, with both clients' tokens in `zoho_access_tokens` (migration 0041), a lease so one caller refreshes at a time, and a ten-minute cool-down after Zoho refuses a token ([ADR 0070](0070-vendor-correctness.md)).

**Two providers, each with a stub.**

- `src/providers/fsm.ts` reads appointments, clients, technicians, the catalogue and attachments, and downloads files. Its Zoho side (`fsm-zoho.ts`) uses only the calls the trial tried.
  - It validates the fields it reads with zod, so a changed answer fails loudly instead of being misread.
  - It reads an empty 204 as "none".
- `src/providers/books.ts` reads an invoice and streams its PDF. Documents are read from Books when a client opens one, never copied to R2. This departs from the prompt's `client-docs` cache, as the Phase 2 plan's R2 budget set out.

`FSM_PROVIDER` and `BOOKS_PROVIDER` take `zoho`, `stub` or `none`:

- **`none`** answers every call with a plain error. Production holds it until Phase 2's release, as it holds `SMS_PROVIDER` at `none`.
- **The guard refuses `none` wherever the client surface is on,** since visits and documents come from Zoho there.

**Visit types come from FSM's catalogue.** An appointment's line items name service items. The mirror maps the items called Consultation, First fit, Service visit and Replacement to our four visit types (`src/config/visit-types.ts`).

- `scripts/setup-fsm.ts` creates those items and the Standard base part where they are missing, at the designs' prices.
- The prices are placeholders (`docs/open-points.md`, item 1). The app's prices come from the price book in D1; the items' prices only price FSM's own invoices.

### The mirror (P2-M2.2)

- **FSM is the record; D1 holds copies** (migration 0011). A copy is never edited on its own; it is rewritten from FSM whenever FSM changes. The copies are:
  - `appointments`: each with its visit type, window, lead technician, status and place;
  - `visits`: what a closed appointment became;
  - `technicians`: display name and initials only;
  - `fsm_items`: the catalogue, to read visit types.
- **One appointment at a time** (`src/domain/fsm-mirror.ts`). The mirror reads the appointment afresh from FSM and writes over its copy, with its client, technician and type, in one batch. It asks FSM for the client, the technician list or the catalogue only when it meets one it does not know.
- **The client is matched by mobile number, once.** After that the person carries the FSM contact's ID. A contact whose number matches no one becomes a new person, since ops add clients in FSM too; they are not contactable until they consent. A contact with no usable number stays unknown.
- **Times are kept in UTC,** as everywhere else in D1. FSM sends India's offset.
- **Statuses** are stored in our words: scheduled, dispatched, in progress, completed, cancelled or terminated, with FSM's own word alongside. A word the mirror does not know is kept as "other". Completed makes a visit that is done; terminated, a partial one. The partial reason waits for the job-sheet template.
- **An appointment FSM no longer has is marked gone,** not deleted.
- **Webhooks are hints.**
  - FSM's workflow rule posts the appointment's ID and modified time to `POST /api/hooks/fsm/<token>`, as JSON or a form.
  - FSM does not sign webhooks, so the secret is in the URL, as Evolution's is. Without `FSM_WEBHOOK_TOKEN` the route answers 404.
  - Each hint is kept once in `webhook_inbox`. FSM sends no event ID, so a repeat is the same record at the same modified time, for the same event where the rule names one (`event`, amended 25 September 2026: a deletion keeps its last edit's modified time, and was dropped as that edit's repeat; runbook, step 11b).
  - The hint goes on the `fsm-sync` queue, whose consumer reads the appointment afresh.
  - A failed read is retried after 30 s, 1, 2 and 4 minutes; the fifth failure alerts, and the reconciliation picks it up.
- **The queue fits the Phase 2 budget** (ADR 0039): 2,000 queue operations a day for FSM hints and messages.
- **An erased person stays erased.** Their FSM contact still leads to their row, which erasure has blanked. Deleting the client in FSM itself is P2-M6's.

### The reconciliation (P2-M2.3)

The reconciliation repairs whatever the webhooks missed (`src/scheduled/reconcile-fsm.ts`, migration 0012). It runs with the sweeper on the existing five-minute cron, and adds no cron of its own. It only puts appointments on the `fsm-sync` queue: the consumer reads them afresh, as it does for a webhook.

- **Every run** reads the first page of FSM's appointments, the 50 changed most recently, and queues each whose copy is missing or older than FSM's. A missed webhook is repaired within five minutes.
- **Every run also** queues two upcoming visits, the ones read longest ago, so that an appointment deleted in FSM, which is on no page, leaves the mirror within hours rather than the next night (added 25 September 2026, audit finding INT-09). The consumer's read costs FSM about 580 calls a day.
- **Overnight,** from 1 am to 5 am India time, it also walks the whole list, one page a run, and marks each copy it sees.
- **At the end of the pass,** it queues every copy the pass did not see, 50 a run. FSM may have deleted those; the consumer marks them gone if it did.
- **Then it alerts once** if the pass repaired anything. A copy less than 10 minutes behind FSM does not count, since its webhook may still be on the way.
- **The place in the list** is `sync_cursors`, one row. A new night starts a new pass. A pass that has not finished by 5 am starts again the next night, which covers 2,400 appointments; more would need a longer night.
- **A failure is logged and left for the next run.** The sweep that runs first is unaffected.
- **Cost:** a run is one FSM call, plus the night's pages: about 300 calls a day, against FSM's 5,000 on the trial and 50,000 on Professional. Only copies that are behind are queued, within ADR 0039's queue allowance.

### Photographs (P2-M2.4)

- **Where they are stored.** Each visit's photographs, five angles before and five after, are copied from FSM into `mm-<env>-client-photos` (migration 0013: `photo_sets` and `photos`). The bucket has no lifecycle rule: a photograph is only ever deleted on purpose, and audited.
- **Their names.** While technicians photograph in FSM's own app, a photograph gives its phase and angle by its file name, e.g. `before-front.jpg` or `after hair.jpg`. Other attachments are left alone. When the job-sheet template exists, its image fields can replace the names (`docs/open-points.md`, item 13). From P2-M4 our technician app takes the photographs itself and knows each angle.
- **When they are copied.** The `fsm-sync` consumer copies them once it has written a completed or terminated appointment, and not once its set of ten is complete.
- **Checking the image.** Each file's bytes are checked to be a JPEG or PNG, and its width and height are read from them.
- **Retakes.** The newest file for an angle becomes the photograph. One it replaces stays in the bucket under the visit's prefix, `visits/<appointment>/`, so that an erasure finds it, rather than being deleted automatically.
- **A retry, hourly.** The reconciliation looks again at visits closed in the last three days that are still short of ten photographs, 20 an hour. Consultations are left out.

## Consequences

- **Staging reads and writes the real org.** Its catalogue was created there on 22 September 2026. Its test records must be removed before go-live (`docs/open-points.md`, item 10).
- **Books has no GST set up yet,** so staging's documents carry no tax (`docs/open-points.md`, item 3).
- **FSM's app uploads photographs at full size,** several megabytes each, where the Phase 2 budget (ADR 0039) assumes about 270 KB. Until our technician app re-encodes them on the phone (P2-M4), R2's 10 GB fills faster (`docs/open-points.md`, item 34).
- **The FSM and Books trials end around 6 October 2026** (`docs/open-points.md`, item 9). After that FSM drops to its Free edition, which has no assets or job sheets.

## Leads into FSM (P2-M2.7)

A consultation booked on the public site reaches FSM as well as the CRM, so ops schedule it where the field work lives.

- **What goes.** A booking in a served city: not a waitlist entry, and not a try-on. The lead route puts `{ lead_id }` on the fsm-sync queue wherever `FSM_PROVIDER` is not `none`; the consumer sends it (`src/domain/fsm-leads.ts`) with the same retries and final alert as an appointment.
- **The contact.** The person becomes an FSM contact once, with their mobile number in E.164 (which the mirror matches on), their city and its state as the place of supply, and a street "To be confirmed with the client" (since 25 September 2026, the street of the client's saved address where they have one, which a later change of address or number also writes over the contact: ADR 0054). Its ID is kept on the person at once, so a retry does not add the contact twice. The territory is the org's first until territories follow pincodes (P2-M4).
- **The Request.** A Consultation line, with the day the booking proposed as its preferred date and due date, and the window in words ("Morning, 9 am to 12 pm") as its note. The Request's ID on the lead marks it sent. On staging its summary begins "Staging test:", since staging shares the real org (ADR 0025, item 26).
- **Then ops.** In FSM, ops convert the Request to a work order, schedule it and assign a technician. The appointment comes back through the webhook and the mirror, matched to the person by mobile number, and the client sees it in the app.
- **FSM's webhook sends its fields in the query string,** with an empty form body, as the first delivery to staging showed on 22 September 2026. The hook reads them from there, or from a JSON or form body.
