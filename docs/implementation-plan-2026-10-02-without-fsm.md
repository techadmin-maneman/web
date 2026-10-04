# Field work without Zoho FSM: scope and implementation plan

- Date: 2 October 2026
- Status: **approved 2 October 2026** ("Go ahead"). D1 is settled; D3 to D6 proceed on the recommendations unless the owner rules otherwise before the PR that needs each; D2 is the owner's.
- Amended at the start, 2 October 2026: PRs 1 and 2 land as one foundations PR (Books' token row needs the migration); PR 4 runs in the first wave and routes today's status writers through the new module, so nothing it adds is unused; deactivating a technician is refused while he has upcoming visits, because the dispatch board draws active technicians only. Open PRs had taken migrations 0068 to 0070 and ADR 0109, so this programme's ADR is 0110 and its migrations take the next free number when each PR lands.
- Sources: a read-only scoping pass over `main` at `8ab8579a` (write paths; data model and surfaces; money and CRM), Zoho's published Books and CRM documentation, and the 2 October audit's fix plan.

> **For agentic workers:** each PR below gets its own step-by-step plan (superpowers:writing-plans format, TDD, exact code) when it starts, written against `main` as it then stands. This document fixes the scope, the order, the interfaces and what each PR must prove. Use superpowers:subagent-driven-development to run it.

**Goal:** D1 becomes the record of bookings, visits, technicians and pieces. Zoho Books is written directly for customers and invoices. Books' own Zoho CRM integration carries customers into CRM Contacts. Zoho FSM is removed.

**Architecture:** every FSM call today goes through `FsmProvider` (`src/providers/fsm.ts:215-296`), and the apps already read D1 rather than FSM. So the change is on the write side: each FSM write becomes a D1 write in the same request, and the mirror, the webhook, the reconciliation and the `fsm-sync` queue go. Books gains customer and invoice creation. During the build, `FSM_PROVIDER` picks the path: `zoho`/`stub` keep today's FSM path, and `none` means "D1 is the record". Production already runs `none`. Staging flips with one variable, and flipping it back is the rollback.

**Tech stack:** Cloudflare Workers, D1 (SQLite), Queues, R2; Hono with zod-openapi; React apps (`apps/app`, `apps/tech`, `apps/ops`); vitest, Playwright; Zoho Books API v3 (`www.zohoapis.in/books/v3`), Zoho CRM API v8.

---

## 1. Why now

- **Production has never used FSM.** `wrangler.jsonc:296-297` sets `FSM_PROVIDER` and `BOOKS_PROVIDER` to `none` in production, and `SELF_SERVE_BOOKING` to `false`. There is no production data to migrate. Only staging has FSM records, and they are test records.
- **Staging can no longer book into FSM.** The trial ran out of appointment credits at AP-66 (cycle 22 September to 6 October), and the owner chose not to add more. Bookings are held for FSM.
- **The trials end around 7 October.** The owner ruled to subscribe to FSM Professional (open point 18). That decision should wait on this plan.
- **Most of the 2 October audit's worst findings are FSM's.** Four of its eight distinct P0s exist only because of FSM: the attach answer (FLD-01), Start Work (FLD-02), photos left in FSM (PS-03), and the appointment allowance (PLAT-01). A fifth, erasure (PS-02), shrinks to Books and the CRM. Section 9 lists the audit packages this makes unnecessary.

## 2. What FSM does today, and what replaces it

| What FSM does | Where | Replacement |
|---|---|---|
| Record of each booking: contact, work order, appointment | `bookings.ts:353-422` (`bookNewVisit`), via the `fsm-sync` queue | One D1 batch at confirmation (PR 6) |
| Holds a booking FSM refuses, retries hourly, ops act on held bookings | ADR 0095; `held-bookings.ts`, `routes/ops-bookings.ts`, `HeldBookings.tsx` | Gone: there is no outside call to fail |
| Moves and reassignments | `dispatch.ts:563-588` | One D1 batch (PR 7) |
| Client cancels | `visit-changes.ts:393-405` | D1 only (PR 6) |
| A technician's steps as blueprint transitions, in order | `job-sheet.ts`, `fsm-sync.ts:290-372`, ADR 0065 | Status changes in D1 as each step lands, plus the `visits` row at the outcome (PR 4, PR 7) |
| Mirror back into D1 (webhook, 5-minute reconciliation, nightly pass) | `fsm-mirror.ts`, `fsm-hook.ts`, `reconcile-fsm.ts` | Gone: our own code writes every fact the mirror derives |
| Technician list (FSM users) | `syncTechnicians`, `fsm-mirror.ts:269` | Technician management in the console (PR 5) |
| Pieces as FSM assets | `pieces.ts:144-208` | `pieces` written when the step lands (PR 7) |
| Photos attached in FSM; copied from FSM's app | `tech-photos.ts:209-240`, `visit-photos.ts` | R2 only; the technician app is the only capture (PR 7) |
| Client's note, contact updates, erasure in FSM | `fsm-sync.ts:408-569` | Gone in FSM; Books gets updates and erasure (PR 7, PR 8) |
| Catalogue: service items, consumable parts | `fsm-catalogue.ts` | Books items per service (PR 8); consumables stay D1-only |
| Raising the invoice (FSM to Books) | `fsm-invoices.ts`, `fsm-zoho.ts:693-739` | We create the invoice in Books from the price book (PR 8) |
| Creating the Books customer (every 2-3 hours) | `books-sync.ts:143` (`ZBilling_Id`) | We create the customer in Books directly (PR 8) |
| Creating CRM Contacts (`ZCRM_Id`) | FSM's own integration | Books' Zoho CRM integration, two-way (owner setting, section 6) |
| Ops booking, cancelling and closing visits in FSM's screens | Tasks `consultation_request`, `first_fit_to_book`, `replacement_order`; runbook | Book, cancel and close a visit in the console (PR 9) |

FSM features we never used, and don't need: its availability API (we use our own slot claims), Time Off (our own leave, ADR 0062), job-sheet forms (ADR 0087), its mobile app, route maps and service reports.

## 3. Decisions for the owner

Each is needed before the PR named. My recommendation comes first.

| # | Decision | Recommendation | Needed by |
|---|---|---|---|
| D1 | Go ahead, and do it before production launch | **Yes.** Production has no FSM data, so this is the cheapest time. It also removes about 32 engineer-days of FSM-only audit fixes (section 9). | Start |
| D2 | The FSM subscription due around 7 October | **Don't buy the annual plan.** Staging already can't book into FSM. Let the trial lapse; FSM's Free edition has no assets, so staging's piece writes fail as well until the switch in PR 10. Buy one month only if staging must book through FSM before then. | 7 Oct |
| D3 | How Books syncs with the CRM | **Two-way, Contacts only, transaction sync off, duplicates "Skip".** Transaction sync would put a client's spend into the CRM, which open point 22 forbids until counsel rules. Leads stay Leads; Zoho doesn't sync them. | PR 10 |
| D4 | An invoice of ours that is still a draft | **Allow it to be sent if Books holds it under our reference and its total matches.** ADR 0056 never sends a draft that already existed, because FSM's drafts could be the owner's own. Ours are found by reference, so a pass that failed after creating one can finish it rather than leaving it stuck. | PR 8 |
| D5 | What "Book a visit" in the console covers | **Every kind: consultation, first fit, one visit, service, replacement.** A paid visit goes out as a payment link; a free or credit visit books at once. | PR 9a |
| D6 | Erasing a client in Books | **Rename the customer "Erased client", clear contact persons, phones, e-mail and addresses, and mark it inactive.** Books cannot delete a customer that has invoices. Counsel confirms (open point 23). | PR 7 |

**Owner actions in Zoho** (no API exists for these):
- **Before PR 3's proof:** mint a Books Self Client for the Worker and one for scripts, with scopes `ZohoBooks.contacts.ALL`, `invoices.ALL`, `customerpayments.ALL`, `creditnotes.ALL`, `settings.READ`, `settings.CREATE` and `settings.UPDATE`. Also add a Books Contacts custom field **"MM person ID"** with unique values, which is what makes customer creation safe to retry.
- **At PR 10:** turn off FSM's workflow rule and webhook, and its Books and CRM integrations. Then set up Books → Settings → Zoho Apps → Zoho CRM as in D3, mapping "MM person ID" to a CRM Contacts field.

## 4. Design decisions locked in by this plan

1. **Keep the `fsm_id` columns and write our own ID into them** (`fsm_id = id`) for `appointments`, `technicians` and `pieces`.
   - Why: all three are `NOT NULL UNIQUE`, and `appointments` has 19 foreign keys pointing at it from 16 tables, 14 triggers and a view. SQLite can't drop a UNIQUE column, and the repo forbids rebuilding a referenced table (`docs/migrations.md`, rule 4).
   - Precedent: hand-written technicians already carry invented IDs (`0046`, `e2e/technicians.ts`).
   - `fsm_id = id` marks a row made without FSM. `docs/schema.md` documents the column as "FSM's ID for rows FSM made, otherwise the row's own ID".
2. **`FSM_PROVIDER` picks the path until FSM's code is deleted.**
   - `src/config/field-record.ts` exports `fieldRecord(settings): "fsm" | "ours"`: `zoho` and `stub` map to `"fsm"`, `none` maps to `"ours"`. Each changed path branches on it. PR 11 deletes the branches and the helper.
   - The identity guard (`settings.ts:348-353`) stops refusing `FSM_PROVIDER=none` with the client surface on, and keeps refusing `BOOKS_PROVIDER=none`.
3. **Books is never on the booking path** (ADR 0044's rule, kept). The Books customer is created by the Books pass on the five-minute cron, not when someone books. A payment waits at most one pass, not 2-3 hours.
4. **Statuses stay the seven the schema already allows**: `scheduled`, `dispatched`, `in_progress`, `completed`, `cancelled`, `terminated`, `other`. Triggers, a view and partial indexes name them, so the CHECK list can't change. `other` is simply never written any more.
5. **The `visits` row is written when the outcome lands**, in the same batch as the status change. Today only the mirror writes it.
6. **Invoices are built from our own figures.** One line on the visit's Books item:
   - the rate is the price book's tax-inclusive price on the day;
   - a discount code is the line's discount, applied before tax;
   - `reference_number` is the appointment ID;
   - `gst_treatment` is `consumer`, and `place_of_supply` is the state code of the visit's city.

   Books' computed total is read back and must equal what the client paid, or the invoice stays a draft for ops (ADR 0070's check, kept).
7. **Migrations follow expand and contract.** PR 1's migration works with today's code (CI's `old-code-on-new-schema` job runs the base branch's tests on it). Drops wait for PR 12, a release later.

## 5. Order and lanes

```
Lane A (field)    PR4 status machine ─► PR6 booking & cancels ─► PR7 dispatch, steps, pieces, photos, erasure
Lane B (money)    PR1+2 schema and Books client ─► PR3 Books provider ─────────────► PR8 customers, invoices, items
Lane C (console)  PR5 technicians ─────────────── (after PR6) ─► PR9a book a visit ─► PR9b cancel & close a visit
Then, in order    PR10 switch staging ─► PR11 delete FSM ─► PR13 ADR, runbook, privacy ─► (one release later) PR12 contract migration
```

- Three lanes fit the three-agent limit.
- Each PR merges to `main` and deploys to staging. Until PR 10, staging stays on the FSM path, so nothing changes for staging's users.
- PRs 3, 6, 7, 8, 9a, 9b, 10 and 11 touch payments, refunds or personal data. They take the reviewer agent and the `hold-for-review` label.

## 6. The PRs

Sizes are engineer-days, in the same unit as the audit's plan.

### PR 1 — Schema expand (1 d; lands with PR 2 as one PR)

**Migration `00NN_field_record_ours.sql`** (the next free number when it lands; open PRs hold 0068 to 0070):

```sql
-- contract: docs/decisions/0110-field-work-without-fsm.md
ALTER TABLE people ADD COLUMN books_customer_id TEXT;
CREATE UNIQUE INDEX people_by_books_customer ON people (books_customer_id) WHERE books_customer_id IS NOT NULL;
ALTER TABLE services ADD COLUMN books_item_id TEXT;
-- appointments.fsm_status and fsm_modified_at become nullable: a visit made without FSM has neither.
-- Swap each in place as migration 0035 did (add, copy, drop, rename); neither is named by an index, trigger or view.
-- zoho_access_tokens: rebuild with CHECK (client IN ('crm', 'fsm', 'books')); nothing points at it (precedent 0044).
```

- **Files:**
  - `migrations/00NN_field_record_ours.sql`
  - `scripts/lib/schema-doc.ts` (PURPOSES lines, then `npm run schema`)
  - `test/node/migrations-on-a-live-database.test.ts` (rows for the new migration)
- **Proves:**
  - `npm run check:migrations` passes;
  - the `old-code-on-new-schema` CI job passes;
  - a worker test inserts an appointment with `fsm_status` NULL.

### PR 2 — Books gets its own Zoho client (1 d; lands with PR 1)

- **What changes:**
  - New secrets `ZOHO_BOOKS_CLIENT_ID`, `ZOHO_BOOKS_CLIENT_SECRET` and `ZOHO_BOOKS_REFRESH_TOKEN`, and vars `ZOHO_BOOKS_ACCOUNTS_HOST` and `ZOHO_BOOKS_API_HOST`. `ZOHO_BOOKS_ORG_ID` and `BOOKS_REFUND_ACCOUNT_ID` stay.
  - `ZohoClientName` becomes `"crm" | "fsm" | "books"` (`zoho-http.ts:54-55`). `createBooksProvider` stops reading `settings.zohoFsm` (`books.ts:188-190`, `dependencies.ts:95-96`).
  - Until the owner mints Books' own client, the same refresh token is put under the new names. Its scopes already cover customers, invoices and payments.
- **Files:**
  - `src/config/settings.ts` (new `ZohoBooksSettings`, `readZohoBooks`)
  - `src/providers/zoho-http.ts`, `src/providers/books.ts`, `src/dependencies.ts`
  - `wrangler.jsonc` (vars for each environment), `.dev.vars.example`
  - `src/worker-configuration.d.ts` (`npm run types`)
  - `scripts/lib/zoho-script-token.ts` (`ZOHO_BOOKS_SCRIPTS_REFRESH_TOKEN`)
  - runbook step 11b
- **Proves:** guard tests for missing Books settings, and `zoho-tokens.test.ts` for a third client. On staging: secrets set before deploy, `/api/health` checked after (an empty required secret takes the Worker down).

### PR 3 — Books provider: customers, invoices, items (2.5 d)

**New `BooksProvider` methods**, each with a zod-validated answer, a stub that records `made`, `failNext`/`refuseNext`/`loseAnswer`, and adapter tests on recorded answers:

```ts
export interface NewBooksCustomer {
  readonly personId: string;            // written to the "MM person ID" custom field; upsert key
  readonly name: string;
  readonly mobile: string;              // E.164
  readonly email: string | null;
  readonly stateCode: string | null;    // place of contact, e.g. "HR"; null where the city is not one we know
  readonly address: { street1: string; street2: string | null; city: string; state: string | null; pincode: string } | null;
}

export interface NewBooksInvoice {
  readonly customerId: string;
  readonly reference: string;           // the appointment's ID
  readonly date: string;                // YYYY-MM-DD, India
  readonly placeOfSupply: string | null;
  readonly line: {
    readonly itemId: string;
    readonly name: string;
    readonly description: string;
    readonly rate: number;              // paise, tax-inclusive
    readonly discount: number;          // paise, before tax; 0 for none
  };
}

// added to BooksProvider
upsertCustomer(customer: NewBooksCustomer): Promise<string>;              // PUT /contacts, X-Unique-Identifier-Key, X-Upsert: true
updateCustomer(customerId: string, customer: NewBooksCustomer): Promise<void>;
eraseCustomer(customerId: string): Promise<void>;                          // rename, blank, then POST /contacts/{id}/inactive (D6)
findInvoice(reference: string): Promise<BooksInvoice | null>;              // GET /invoices?reference_number=, exact match after
createInvoice(invoice: NewBooksInvoice): Promise<BooksInvoice>;            // POST /invoices, is_inclusive_tax, is_discount_before_tax
items(): Promise<BooksItem[]>;                                             // GET /items, paged
createItem(item: { name: string; rate: number }): Promise<string>;        // POST /items, product_type service
updateItem(itemId: string, item: { name: string; rate: number }): Promise<void>;
```

- `discountInvoice` goes once PR 8 builds the discount into the line.
- Books allows 2,000 calls a day on Standard, **shared by staging and production because they share the org.** Every call is charged to the cron run's `CallBudget`, as today.
- **Files:** `src/providers/books.ts`; `test/worker/books-provider.test.ts` (new); `test/fixtures/vendors/books/*.json` (recorded answers, scrubbed)
- **Proves:** a staging script, `scripts/books-proof.ts`, run with the scripts token. It creates one customer and one invoice named "Staging test", reads them back, and deletes them. The results go in `docs/verification.md`.

### PR 4 — The visit status machine (1 d)

- **What changes:** `AppointmentStatus`, `statusOf` and `VISIT_OUTCOMES` move out of `fsm-mirror.ts` into `src/domain/visit-status.ts`. Today's writers of a step-driven status (the job sheet's status after FSM accepts a step, a client's cancel, a replaced visit retired) and the mirror's `visits` write go through it, so it lands with callers. It gains:

```ts
export type Step = "check_in" | "start" | "done" | "partial" | "cancel";
/** The statuses a visit may be in for this step to apply, and where it goes. */
export const STEPS: Readonly<Record<Step, { from: readonly AppointmentStatus[]; to: AppointmentStatus }>>;
/** One guarded UPDATE: changes nothing unless the visit is in an allowed status. */
export function moveVisit(db: D1Database, appointmentId: string, step: Step, at: string): D1PreparedStatement;
/** The visits row a closed job becomes, from the job's own event times. */
export function closeVisit(db: D1Database, appointmentId: string, outcome: "done" | "partial", times: VisitTimes, partialReason: string | null): D1PreparedStatement;
```

- `terminatedAs` (`fsm-mirror.ts:180-193`) moves here.
- **Files:** `src/domain/visit-status.ts`, `src/domain/fsm-mirror.ts` (imports from it), `test/worker/visit-status.test.ts`
- **Proves:** a table test for every step from every status, covering both refusals and moves.

### PR 5 — Technicians in the console (2.5 d)

- **Routes:**
  - `POST /api/technicians` (name, mobile, zone)
  - `PATCH /api/technicians/{id}` (name, mobile, zone)
  - `POST /api/technicians/{id}/deactivate` and `/reactivate`
  - All on the ops host, audited.
- **Behaviour:**
  - Deactivating is refused (409 `has_upcoming_visits`, listing them) while he has scheduled or dispatched visits to come: the dispatch board draws active technicians only, so his visits would vanish from it. Ops move them first; his phones can be revoked at once either way. Once deactivated, his next call ends his session (ADR 0052) and his sessions are revoked.
  - A new row writes `fsm_id = id` and `hand_written = 1`, so FSM's sync leaves it alone until PR 11 removes the sync.
  - A mobile number held by another active technician is refused.
- **Ops screen:** `apps/ops/src/technicians/` gains Add, Edit and Deactivate, through a design pass (`docs/fidelity-method.md`).
- **Files:** `src/routes/ops-technicians.ts`, `src/domain/technicians.ts`, `apps/ops/src/technicians/*`, `apps/ops/src/content.ts`, `npm run openapi`
- **Proves:** worker tests for add, duplicate mobile, deactivate ending sessions, and sign-in by the new number. A browser test for the screen.

### PR 6 — Booking and client changes write D1 (3 d)

When `fieldRecord` is `"ours"`:
- **`confirmBooking`** (`bookings.ts:251`) books in one D1 batch, guarded by `WHERE state = 'held'`. The appointment row has `fsm_id = id`, `fsm_work_order_id = NULL`, `fsm_status = NULL` and `status = 'scheduled'`, with the type, tier, technician and window from the hold. The rest of the batch is unchanged: hold booked, claims released, payment and referral linked, then `afterBooked`.
- **The Razorpay webhook and the free-hold route call `confirmBooking` directly** instead of queuing (`razorpay-hook.ts:132-135`, `client-booking.ts:413-416`, `public-booking.ts:456`). `requeueUnbookedHolds` stays as the safety net and also confirms directly.
- **Moving in place and retiring a replaced visit** are D1 updates (`bookings.ts:567-698`).
- **A client cancel** is the claim plus the update in one batch, then the refund (`visit-changes.ts:393-405` skipped).
- **Fixes the filters that treat a visit without a work order as not real:**
  - `visit-changes.ts:81`, `asked-windows.ts:43`, `tasks.ts:170`;
  - `fsm-invoices.ts:100` is replaced in PR 8.

  They test "not cancelled and not deleted" instead of `fsm_work_order_id IS NOT NULL`.
- **Files:** `src/domain/bookings.ts`, `src/domain/visit-changes.ts`, `src/routes/razorpay-hook.ts`, `src/routes/client-booking.ts`, `src/domain/public-booking.ts`, `src/domain/asked-windows.ts`, `src/domain/tasks.ts`, `src/config/field-record.ts`, `src/config/settings.ts` (the guard)
- **Proves:** worker tests with `FSM_PROVIDER: "none"`:
  - a paid booking is visible to the client in the same request;
  - a free booking;
  - a move in place;
  - a replacement retires the old visit;
  - a cancel refunds;
  - a webhook delivered twice books once.

  `money-path.test.ts` runs both modes.

### PR 7 — Dispatch, the technician's steps, pieces, photos, notes, erasure (3.5 d)

When `fieldRecord` is `"ours"`:
- **Dispatch:** `moveJob` (`dispatch.ts:522`) writes the claim, the appointment and the move row in one batch, with the clash test inside the batch. The FSM block at 563-588 is skipped, and `fsm_refused`/`fsm_partly` can't arise.
- **Steps:** `landJobEvent` (`job-events.ts:84`) adds `moveVisit(...)` to its batch:
  - `check_in` → `dispatched`;
  - `start` → `in_progress`;
  - `outcome` → `completed` or `terminated`, plus `closeVisit(...)` with times from `occurred_at` (ADR 0065's bounded phone clock).

  The event is stored with `fsm_write_state = 'written'`, which the tech app's cached copy already accepts. Nothing is queued.
- **Pieces:** `recordFittedPiece` and `recordFailedPiece` write `pieces` when the step lands, with `fsm_id = id`. A piece code already used by another client is refused with 409 `piece_code`. The audit's P1-37 rule moves here.
- **Photos:** stored in R2 only. `attachPhotosToFsm` is skipped, and nothing copies from FSM.
- **Client note:** D1 only.
- **Number or address change:** queues a Books customer update (PR 8's `updateCustomer`) instead of FSM's.
- **Erasure:** blanks the Books customer (D6) and the CRM Lead as today. The CRM Contact Books' sync made is blanked by Books' own two-way sync; PR 10 proves this. If the proof fails, add CRM Contacts access (open point 21) and blank the Contact directly, about 1 more day.
- **Files:** `src/domain/dispatch.ts`, `src/domain/job-events.ts`, `src/routes/tech-jobs.ts`, `src/domain/pieces.ts`, `src/domain/tech-photos.ts`, `src/routes/client-notes.ts`, `src/http/contact-sync.ts`, `src/domain/erasure.ts`, `src/routes/ops-profile.ts`
- **Proves:** worker tests with `FSM_PROVIDER: "none"`:
  - a whole job from check-in to done ends `completed` with a `visits` row and the right duration;
  - a partial job ends `terminated` with its reason;
  - a no-show;
  - a reassign plus move;
  - a piece fitted and failed;
  - a duplicate piece code refused;
  - an erasure reaching Books.

  `field-operations.test.ts` runs both modes.

### PR 8 — Books customers, invoices and items (4 d)

When `fieldRecord` is `"ours"`:
- **Customers:** a new first step in `syncBooks` (`books-sync.ts:67`). For each person with a captured payment or a billable completed visit and no `books_customer_id`, call `upsertCustomer` and store the ID. `paymentsToRecord` joins on `people.books_customer_id`, not the FSM contact (`books-sync.ts:121-143`).
- **Invoices:** `src/domain/books-invoices.ts` replaces `fsm-invoices.ts`. Each run takes up to five completed visits with no issued invoice whose service is priced on the day:
  1. `findInvoice(appointment id)`, else `createInvoice` with the line from section 4, item 6.
  2. Store the ID in `appointments.fsm_invoice_id`, which already holds Books IDs (ADR 0055; the name is documented, not renamed).
  3. Read back the total. If it equals what the client paid, `issueInvoice`; otherwise leave the draft and alert ops, as today.
  4. A credit-paid visit stays a draft until the CA rules (open point 14).
  5. A one-visit booking is invoiced on the product chosen, at the price paid by link (closes open point 169).
  6. A free consultation gets no invoice.
- **Items:** an hourly check takes each service offered that day without a `books_item_id`, matches a Books item by name or creates one, and alerts when a name or rate differs. This replaces `fsm_catalogue`.
- **Cron:** `invoices` and `books_sync` change from `needs: "fsm_and_books"` to `needs: "books"`. `fsm_catalogue`, `asked_windows` and `unbooked_holds` don't run in `"ours"`.
- **Files:** `src/domain/books-invoices.ts` (new), `src/domain/books-sync.ts`, `src/domain/books-items.ts` (new), `src/scheduled/cron.ts`, `src/policy/prepayment.ts` (unchanged rules, new caller), `src/domain/client-payments.ts`, `src/domain/discount-code-uses.ts`, a migration for the invoice pass's partial index without `fsm_work_order_id`
- **Proves:** worker tests:
  - a paid first fit is invoiced, issued and the payment applied;
  - a discounted visit's invoice shows price, discount and total;
  - a lost answer on create finds the invoice by reference and makes no second one;
  - a total that differs is held;
  - a credit visit is held;
  - a one visit is invoiced on its product;
  - a consultation is not invoiced;
  - the customer is created once across two passes;
  - the call budget runs out mid-pass.

  `query-plans.test.ts` covers the new index.

### PR 9a — Book a visit from the console (3 d)

- **Route:** `POST /api/visits` on the ops host (audited) with client, kind, tier, technician, day, window, one-visit flag and code. It reuses the availability and clash check and `confirmBooking`. A paid visit is booked and sent a payment link (`payment-links.ts`); a free or credit visit is booked at once. The asked window is set at booking, so the `asked_windows` pass isn't needed in `"ours"`.
- **Screen:** "Book a visit" on the client page and on each Tasks row that today says "book it in FSM" (`consultation_request`, `first_fit_to_book`, `replacement_order`), after a design pass.
- **Files:** `src/routes/ops-visits.ts` (new), `src/domain/bookings.ts`, `src/domain/tasks.ts`, `apps/ops/src/clients/*`, `apps/ops/src/tasks/*`, `apps/ops/src/content.ts`
- **Proves:** worker tests for each kind, a clash refused, and a task closing once its visit is booked. A browser test for the screen.

### PR 9b — Cancel and close a visit from the console (2 d)

- **Cancel:** `POST /api/visits/{id}/cancel`. Ops give a required reason and choose refund or keep, and the default is free to the client (the audit's owner decision, option C). It refunds or restores the credit and sends the client's message. This is the audit's P1-06 built here.
- **Close:** `POST /api/visits/{id}/close` (done or partial, with times and a reason) for work that only lived on a lost phone. It replaces "enter it in FSM by hand" in the runbook.
- **Files:** `src/routes/ops-visits.ts`, `src/domain/visit-changes.ts`, `src/domain/visit-status.ts`, `apps/ops/src/dispatch/*`, `apps/ops/src/clients/*`
- **Proves:** worker tests for a cancel with a refund, a cancel keeping the payment, a cancel of a credit visit, a close by hand writing `visits`, and a closed visit refusing a second close.

### PR 10 — Switch staging off FSM (2 d)

In this order:

1. **Clear what is in flight on staging:**
   - the 21 held bookings, released or refunded through the existing held-booking actions;
   - `job_events` pending at zero;
   - the `mm-fsm-sync-staging` backlog empty.
2. **Run `scripts/staging-records.ts --delete`** to clear FSM, Books and CRM test records from the owner's org.
3. **The owner turns off FSM's workflow rule and webhook, and its Books and CRM integrations.** Then they set up Books ↔ CRM as in D3.
4. **Run a one-off script, `scripts/link-books-customers.ts`.** For each staging person with an `fsm_contact_id`, read the FSM contact once and store its `ZBilling_Id` as `books_customer_id`.
5. **Set `FSM_PROVIDER` to `none` for `staging` and `local`** in `wrangler.jsonc`, and deploy. The `fsm-sync` consumer acknowledges FSM-bound messages without acting, with a log line.
6. **Update e2e seeds** that assumed FSM (`e2e/ops/held-bookings.e2e.ts` goes; the `fsm_write_state` checks in `e2e/tech/*`).
7. **Run the live proof on staging** under the live-testing rules (as a real user, backdating instead of waiting). Record each check below in `docs/verification.md`.

| # | Check |
|---|---|
| 1 | A consultation booked on the site |
| 2 | A paid first fit booked in the app |
| 3 | A visit booked by ops |
| 4 | Dispatch move and reassign |
| 5 | A technician's whole day on a phone |
| 6 | A partial job |
| 7 | A no-show |
| 8 | A cancel with a refund |
| 9 | Invoice issued and payment applied, receipt and PDF open |
| 10 | The CRM Contact appears after Books' Instant Sync, with "MM person ID" |
| 11 | An erasure blanks Books, and the CRM Contact follows. Fallback in PR 7 if it does not. |
| 12 | A new technician added in the console signs in |

**Rollback:** set `FSM_PROVIDER` back to `zoho`. Visits booked in between stay in D1 and simply have no FSM record.

### PR 11 — Delete FSM (4 d)

- **Delete these files:**
  - `src/providers/fsm.ts`, `src/providers/fsm-zoho.ts`
  - `src/queues/fsm-sync.ts`
  - `src/domain/fsm-mirror.ts`, `fsm-contacts.ts`, `fsm-catalogue.ts`, `fsm-invoices.ts`
  - `src/domain/job-sheet.ts`, `src/domain/visit-photos.ts`
  - `src/scheduled/reconcile-fsm.ts`
  - `src/routes/fsm-hook.ts`, `src/routes/ops-bookings.ts`
  - `src/policy/held-bookings.ts`, most of `src/domain/held-bookings.ts`
  - `src/config/field-record.ts` and every `"fsm"` branch
  - `apps/ops/src/clients/HeldBookings.tsx`
- **Rename** `src/routes/dev-fsm.ts` to `dev-visits.ts` (local "close a visit" through `visit-status.ts`).
- **Config:**
  - `FSM_PROVIDER`, `FSM_WEBHOOK_TOKEN`, `ZOHO_FSM_*` and `FSM_CATALOGUE_PUSH` go.
  - The `FSM_QUEUE` producer and consumer leave `wrangler.jsonc` for every environment.
  - Cron jobs `unbooked_holds`, `fsm_reconcile`, `fsm_catalogue` and `asked_windows` go.
  - Run `npm run types`.
- **Contracts:**
  - Error codes `fsm_refused` and `fsm_partly`, the held-booking paths and schemas, and the ops-only `fsm_*` fields go.
  - The client and tech apps keep their field names, since they are cached PWAs; only the descriptions change.
  - Run `npm run openapi`.
- **Tests:**
  - Delete about 5,700 lines of FSM-only tests: `fsm*.test.ts`, `reconcile-fsm`, `visit-photos`, `asked-windows`, `held-bookings`, `fsm-fixtures.ts`.
  - Rewrite the rest to the `"ours"` path only. `test/worker/helpers.ts` loses `fsm`. `job-fixtures.ts` stops building a stub FSM.
- **Ops copy:** the 44 strings in `apps/ops/src/content.ts` that name FSM.
- **Scripts:** `setup-fsm.ts` goes. `staging-records.ts` becomes Books and CRM only. Optionally add a read-only `setup-books.ts --check` for the org, taxes, items and refund account; it absorbs the audit's P0-18 Books half.
- **Staging runbook step:** `wrangler queues delete mm-fsm-sync-staging` once the deploy is live. Production's queue was never created (open point 85 closes).

### PR 12 — Contract migration (0.5 d, one release after PR 11 reaches production)

- **Drop tables:** `webhook_inbox`, `sync_cursors`.
- **Drop the FSM partial indexes** and the dead nullable columns:
  - `leads.fsm_request_id`, `fsm_request_tried_at`, `fsm_queued_at`
  - `slot_holds.fsm_tried_at`, `fsm_work_order_id`, `fsm_appointment_id`, `fsm_held_at`, `fsm_refusal`
  - `consumables.fsm_item_id`, `fsm_name`, `fsm_checked_at`
  - `services.fsm_item_id`
  - `people.fsm_erased_at`, `fsm_erasure_attempts`
  - `appointments.reconciled_at`, `fsm_note_written_at`
- **Kept and documented:**
  - the three `fsm_id` columns;
  - `photos.fsm_attachment_id` (UNIQUE);
  - `fsm_items`, which `consumables_used` points at, left empty;
  - `fsm_write_state` on `job_events` and `dispatch_moves` (indexed, and part of the move lock).

### PR 13 — The record, the runbook, the privacy page (1.5 d)

- **One ADR**, `0110-field-work-without-fsm.md`. It supersedes 0032, 0064, 0095, 0098, 0099 and 0101, and marks `fsm-licensing.md` and `fsm-trial.md` as history. It amends these by one line each on their Status line:
  - 0019, 0025 (items 26, 30, 31, 47), 0028, 0034, 0038
  - 0044, 0046, 0049, 0052, 0054, 0055, 0056, 0059
  - 0063, 0065, 0066, 0068, 0069, 0070, 0073
  - 0085, 0087, 0105

  Run `npm run adr-index`.
- **Runbook:** rewrite the "FSM and Books" section, step 11b, the alerts table, erasure, "a technician's lost phone" and "work stuck on a phone". Update `docs/glossary.md`, `docs/go-live.md` and `docs/schema.md` (`npm run schema`).
- **Open points:**
  - Settle 24, 26, 27, 29, 31, 57, 85, 155, 160 and 169.
  - Settle the FSM halves of 18, 19 and 28.
  - Reword 3, 9, 11, 14, 20, 23, 25, 32, 36 and 149.
- **The privacy page** (`site/src/content/site.ts:248`) stops naming Zoho FSM as a processor. Counsel sees the wording first (open point 149).

## 7. Sizes

| PR | Days | PR | Days |
|---|---|---|---|
| 1 Schema expand | 1 | 8 Books customers, invoices, items | 4 |
| 2 Books client | 1 | 9a Book a visit | 3 |
| 3 Books provider | 2.5 | 9b Cancel and close a visit | 2 |
| 4 Status machine | 1 | 10 Switch staging | 2 |
| 5 Technicians | 2.5 | 11 Delete FSM | 4 |
| 6 Booking and cancels | 3 | 12 Contract migration | 0.5 |
| 7 Field steps and erasure | 3.5 | 13 ADR, runbook, privacy | 1.5 |
| | | **Total** | **31.5** |

In lanes, with three agents:
- Lane A takes about 8.5 days, and lanes B and C about 7.5 each. Lane C waits on PR 6.
- The tail (PR 10, 11, 13) is about 7.5 days in order.
- So staging is off FSM, with FSM's code gone, about **18 lane-days** after the go. PR 12 follows the next production release.

## 8. Risks

| Risk | What we do |
|---|---|
| Books' 2,000 calls a day are shared by staging and production | Every call goes through the cron's `CallBudget`; a visit costs about 8-10 calls. Staging load tests stay small. A staging Books org of its own is worth asking Zoho for. |
| Books ↔ CRM matches duplicates by name only | "Skip", not "Overwrite". "MM person ID" travels to the CRM Contact as the real link. |
| An erasure might not reach the CRM Contact through Books' sync | Proved in PR 10. Fallback: CRM Contacts access (open point 21) and a direct blank, about 1 day. |
| D1 is now the only record of field work | The audit's P0-17 (an off-Cloudflare backup proven to load) is already on the go-live path. It matters more now. |
| No FSM screens to fall back on | PR 9a/9b give ops booking, cancelling and closing in the console. Moving and reassigning already exist. |
| Messages in flight at the switch | PR 10 drains them first, and the consumer acknowledges FSM-bound messages without acting. |
| The invoice's GST once GST is on | Books computes CGST/SGST or IGST from the item's tax preferences and the place of supply. Proved on staging when the CA's rates are set (open points 2 and 3), as it would have been with FSM. |
| Cached technician phones expect `fsm_write_state` | Field kept, and always "written" on the new path. |

## 9. What it removes from the 2 October audit plan

**No longer needed: 20 packages, about 32 engineer-days.** Most are on the go-live path.

| Package | Days | Package | Days |
|---|---|---|---|
| P0-05 FSM attach answer | 1 | P1-33 FSM outage and resend | 2 |
| P0-06 Other clients' FSM assets | 1 | P1-36 Bases in FSM's catalogue | 1.5 |
| P0-08 Start Work early | 2 | P1-45 Mirror overwriting a move | 2 |
| P0-09 FSM appointment allowance | 2 | P1-50 FSM contact de-duplication | 1.5 |
| P0-11 Photos left in FSM | 2 | P1-54 fsm-sync subrequests | 0.75 |
| P1-11 "Being booked in FSM" | 2.5 | P1-70 Mirror bringing an erased client back | 2 |
| P1-12 Payment waits on the FSM contact | 2 | P2-20 Held-booking panel | 1 |
| P1-24 Reassign in FSM | 2 | P4-05 FSM writes on a busy day | 2.5 |
| P1-28 Address to the FSM visit | 1.5 | P4-06 Nightly FSM pass | 1.5 |
| P1-29 FSM's "91-" numbers | 1 | P4-07 FSM's history | 0.5 |

**Smaller:**
- P0-04 (Zoho errors: Books and CRM only)
- P0-10 (erasure: Books and CRM only)
- P0-18 (org check: Books only)
- P0-19 (no FSM checklist)
- P1-04 and P1-05 (cancels have no FSM step)
- P1-30 (deactivation is ours)
- P1-34 (fewer Tasks groups)
- P1-43 (no unknown FSM items)
- P1-48 (contract probe: Books and CRM)
- P1-52 (no FSM hook)
- P1-60, P1-65, P1-69 (FSM halves gone)
- P3-07 (no "held for FSM" stage)
- P3-13 (no fsm-sync port)

**Built here instead:**
- P1-06 (ops cancel, PR 9b)
- P1-20's contact half (GST state on the Books customer, PR 3 and PR 8)
- P1-37 (piece recorded when it lands, PR 7)

**The audit's owner decisions that go away:** buying FSM credits and sizing FSM's plan; FSM's early-start setting; re-reading FSM's users on a refusal.

**Net:** the programme costs about 31.5 days and removes about 32 days of FSM-only fixes plus part of a dozen more. On effort it is roughly even. The gain is a system with one record instead of two, no unsigned webhooks, no mirror drift, no appointment cap, and no FSM subscription.

## 10. What happens next

1. The owner rules on D1 to D6 and on the FSM subscription.
2. On "go": PR 1, PR 2 and PR 5 start in three lanes. Each PR's step-by-step plan is written as it starts.
3. FSM-only audit packages (section 9) are taken off the fix programme. The audit's other lanes go on in parallel, but not in the files this plan changes:
   - `bookings.ts`, `dispatch.ts`, `job-events.ts`
   - `books-sync.ts`, `fsm-*`
   - `visit-changes.ts`, `pieces.ts`, `tech-photos.ts`
