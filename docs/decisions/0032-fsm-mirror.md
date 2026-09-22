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

**The access token is kept in D1,** in `zoho_tokens` (migration 0010), one row per client. Every invocation uses the same token until a minute before it expires. The code that refreshes it is shared with the CRM (`src/providers/zoho-http.ts`); the CRM keeps its own one-row `zoho_token`, unchanged.

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
  - Each hint is kept once in `webhook_inbox`. FSM sends no event ID, so a repeat is the same record at the same modified time.
  - The hint goes on the `fsm-sync` queue, whose consumer reads the appointment afresh.
  - A failed read is retried after 30 s, 1, 2 and 4 minutes; the fifth failure alerts, and the reconciliation picks it up.
- **The queue fits the Phase 2 budget** (ADR 0039): 2,000 queue operations a day for FSM hints and messages.
- **An erased person stays erased.** Their FSM contact still leads to their row, which erasure has blanked. Deleting the client in FSM itself is P2-M6's.

## Consequences

- **Staging reads and writes the real org.** Its catalogue was created there on 22 September 2026. Its test records must be removed before go-live (`docs/open-points.md`, item 10).
- **Books has no GST set up yet,** so staging's documents carry no tax (`docs/open-points.md`, item 3).
- **The FSM and Books trials end around 6 October 2026** (`docs/open-points.md`, item 9). After that FSM drops to its Free edition, which has no assets or job sheets.
