# 0070. What we write to Zoho is right, written once, and asked for sparingly

- Status: accepted
- Date: 2026-09-25
- Amends [0012](0012-zoho-sync.md), [0015](0015-render-pipeline.md), [0030](0030-one-time-codes.md), [0032](0032-fsm-mirror.md), [0050](0050-crm-in-the-real-org.md), [0054](0054-address-capture.md), [0056](0056-issuing-the-invoice.md) and [0063](0063-the-asked-window.md); follows [0067](0067-alerts-and-silent-failures.md) and [0068](0068-a-paid-hold-is-kept.md)

## Context

The audit of 24 September 2026 found the vendors trusted where they should have been checked, and asked where they should have been left alone:

- **Invoices.** FSM prices a visit's tax invoice from its own catalogue, and staging's "Replacement" was ₹30,000 against the price book's ₹15,000; the invoice pass sends every invoice it raises, and a sent invoice is undone only by a credit note (INT-03). A visit a referral credit paid for was invoiced and sent at that price too, with a balance due (BIZ-08).
- **Written twice.** A Books payment or refund whose answer timed out was recorded again an hour later (INT-04); so was an FSM asset or photograph (INT-11, left from WP-06).
- **Written nowhere.** A client's saved address and a confirmed number change stayed in D1, and FSM's contact kept "To be confirmed with the client" and the old number, as did the CRM lead (REQ-S5-03, LIFE-12). A stored Lead ID the CRM no longer had blocked that person's sync for good (INT-18).
- **Not heard.** FSM's deletion of an appointment was dropped as a repeat of its last edit, and the mirror kept showing it until the night's pass (INT-09).
- **Tokens.** CRM, FSM and Books each held a copy of the token logic, in two tables (ARCH-10). Any 401 minted a new token, even a scope Zoho will not grant, even Zoho's own "Access Denied" after too many; staging and production share the CRM's refresh token (INT-13).
- **Answers.** Refusals were read by naming `ZohoError` in three passes (ARCH-14), answers by casts and `typeof` (ARCH-28), calls a person waits on had the queues' 20 s (INT-25), and a dispatch move FSM half took was reported as refused, nothing moved (INT-25).

## Decision

**An invoice is sent only when it is right.** Before the pass sends an invoice it has just raised, it compares FSM's work-order total with what the client was sold the visit for: the captured payment for it, or, for a visit no payment names, the price book's price on the day (`invoiceHold`, `src/policy/prepayment.ts`). A visit a referral credit paid for is never sent, whatever its total, until the CA rules how one is invoiced (open point 97). A held invoice stays a draft, which can still be corrected or deleted; ops are told once, under the draft's own alert, and it waits as a Draft invoice task. The rule of ADR 0056 then holds unchanged: nothing sends a draft that already exists. This departs from the owner's ruling that an invoice is sent as it is raised (ADR 0025, items 46 and 47). Pushing the price book to FSM's catalogue, so the two agree, is still to come (open point 44). **Built 26 September 2026 ([ADR 0073](0073-prices-from-the-price-book.md)),** behind a switch that stays off until the owner turns it on in production, with an hourly check that tells ops of each item that differs meanwhile.

**A record is looked for before it is made.** A Books payment by our reference for the customer, a refund by Razorpay's refund ID on its payment, an FSM asset by its label among the client's assets, a photograph by its name and size among the appointment's files. One found is kept rather than made again. The Books searches have not been tried on the org (open point 98).

**What changes in D1 reaches FSM and the CRM.** A saved address and a confirmed number change go on the fsm-sync and crm-sync queues (`src/http/contact-sync.ts`). Each consumer reads the person afresh and skips an erased one: FSM's contact takes the number and the service address's street, city and pincode, through the service address's ID as the erasure writes it; the CRM lead takes the number and city, workflows off. Each retries, and the fifth failure tells ops. A contact FSM adds at a first booking takes the saved address's street and pincode where it is in the visit's city. A confirmed change keeps the number it replaced, and the referral rule `same_mobile` compares every number either person holds or held; a change withdrawn or rejected never happened.

**A stale Lead ID is found again.** A write to a stored ID that fails as though the CRM no longer has it is followed by a search by `D1_Person_ID`, and the write goes to the record found, or a new one.

**A deletion is heard.** The webhook's hint joins its event to the dedupe key, and the runbook gives deletion its own webhook with `event=delete`. Until then, and for whatever FSM never says, each reconciliation run re-reads two upcoming visits, the longest unread first.

**One requester, and tokens asked for sparingly** (`src/providers/zoho-http.ts`). The CRM, FSM and Books go through one requester, with both clients' tokens in `zoho_access_tokens` (migration 0041, seeded from the two old tables, which are dropped in a later contract step).

- **The contract step waits for production.** Production still runs code from before this package (#125, 6ef2ddb), and that code reads and writes `zoho_token` (0002) and `zoho_tokens` (0010). They are dropped only by a migration after production has run #125's code, carrying `-- contract: docs/decisions/0070-vendor-correctness.md`; until then no migration touches them. `docs/migrations.md` lists the step.

- A token is asked for only when the one held has under a minute to run, or a 401 names it invalid. Any other 401 is thrown as it is.
- One caller asks at a time, under a lease in D1. Another waits for its token; one that finds the token replaced since its own was refused uses the new one.
- After Zoho refuses a token ("Access Denied"), none is asked for ten minutes, and every call fails at once meanwhile.

**Refusals are the vendor's word, not Zoho's.** `ProviderError` carries the status, the vendor's code and whether it refused the record; `isRefusal` is what a pass asks. A 401 or a 429 is our access or our pace and never the record's refusal, nor is a token Zoho would not give, so a pass tries that record again rather than leaving it for a person. The stub FSM refuses as FSM does (`refuseNext`).

**Answers are read with zod** in the Zoho adapters (the CRM's records, the token) and in AILabTools', in place of casts and `typeof`.

**A person waiting gets an answer sooner.** Zoho's calls inside a request give up after 8 s; the queues and the cron keep 20 s. A dispatch move FSM half took (the technician, not the time) is read again from FSM into the mirror, and ops are told `fsm_partly` rather than that nothing moved.

**Smaller fixes in the same package.** The asked-window pass stamps a visit FSM refuses and retries one it failed on an hour later (`asked_failed_at`). Only a login code that is sent counts against the day's ceiling, and a number nobody knows costs its address, 20 a day (ADR 0030). The try-on gate promises a WhatsApp copy only where the allowlist lets one go; a lead's limits are counted after its city is checked; a gated visitor's new photo keeps their session (ADR 0014); a try-on result over 5 MB, or not an image, fails at once (ADR 0015).

## Consequences

- A tax invoice no longer goes out for a sum nobody paid. Until FSM's catalogue follows the price book, a visit priced differently in the two waits for ops.
- A credit visit has no tax invoice until the CA rules; the client's visit screen still says one is being made.
- Every Zoho call added here that the org has not answered yet is listed in open point 98, with how staging proves it.
- The owner's actions this package cannot take: the account Books records Razorpay's payments into against the one refunds leave from (INT-05, the CA's ruling); narrower token scopes and the plaintext access tokens in D1 (INT-19); and deleting the seeded ₹30,000 receipt `4242595000000065003` from the real Books (INT-23).
