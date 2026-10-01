# 0056. The invoice is issued, and shown beside the visit

- Status: accepted; amended 1 October 2026 by [0108](0108-discount-codes.md): a discount code on the visit is written onto the draft as its line discount, before tax, before its total is checked and the draft issued
- Date: 2026-09-23

## Context

ADR 0055 has a finished job invoiced within five minutes, and `GET /api/documents/{visit_id}` streams the PDF from Books. Two things were left.

**The invoice is a draft.** FSM creates it in Books as a draft, as the owner's own hand-made one is. A draft can be edited, renumbered or deleted; it is not a valid tax invoice, and ADR 0044 has the payments pass wait while an invoice is a draft, so a client's advance is never set against it. Sending it is one Books call and an accounting act, so ADR 0055 left it to the owner and the CA as `docs/open-points.md` item 115.

**The invoice is only under Payments.** The client app shows it on the payment's screen (board E2), and the visit's own screen (board C9) says nothing about it. The owner's words on 23 September 2026: _"We can't wait for the CA to send the invoice. Once the invoice is generated, it needs to be shown to the user in the app next to the service."_

The same day they also ruled that a free visit must say so. `document_id` was null both for a visit whose invoice had not been raised and for a consultation that will never have one, and the app's only line for a null was "The invoice is still generating. Usually ready within the hour." — a promise nothing would ever keep.

## Decision

**The invoice is issued as it is raised.** `POST /books/v3/invoices/{id}/status/sent` follows the create in the same pass, and only then is the invoice a document the client may see. Open point 115 is settled by this.

> **Amended 25 September 2026 ([ADR 0070](0070-vendor-correctness.md), audit findings INT-03 and BIZ-08):** only when it totals what the client was sold the visit for, and never for a visit a referral credit paid for. FSM prices the invoice from its own catalogue, and staging's "Replacement" item was ₹30,000 against the price book's ₹15,000, so an irreversible invoice for twice what was paid was one pass away. The work order's total is now compared, before the send, with the visit's captured payment, or with the price book's price on the day for a visit no payment names (`src/policy/prepayment.ts`). Otherwise, and for every credit-paid visit until the CA rules how one is invoiced (open point 14), the invoice stays a draft that can still be corrected or deleted: ops are told once, under the draft's own alert, and the Tasks board's Draft invoice group lists it. The rule below then holds as it always has: nothing sends a draft that already exists.

**Only an invoice this code has just raised is ever sent.** `fsm.invoiceWorkOrder` already answered either the invoice it raised or one the work order already had; it now says which, and the send happens on the first only.

- Nothing sweeps Books for drafts, and no draft that already existed is ever sent, including one an earlier pass raised and failed to send. A draft the owner can delete must stay deletable: an issued invoice can only be undone with a credit note, and nothing here can tell a draft of ours from one the owner means to delete. The staging backlog put about five drafts in the owner's real Books, and turning five deletable records into five irreversible ones is not a thing to risk on a retry.
- **A send that fails is not tried again.** The invoice is kept, the client is shown nothing, `invoice_not_issued` is logged and ops are alerted with the Books invoice ID, as a failed refund is (ADR 0046). A person sends it in Books, or fixes what Books refused over and deletes the draft so the next pass raises a fresh one.
- **An invoice raised by hand becomes the client's when Books says it is no longer a draft.** The pass reads its status rather than sending it, so the owner's own fallback — press Create Invoice, then Send, in Zoho's own screens — still ends with the client able to open it.

**`appointments.invoice_issued_at` (migration 0030) is what the client app reads.** `fsm_invoice_id` says which invoice a visit has, and is written the moment FSM answers, so a failed send can never cost us the ID and have the next pass raise a second invoice. `invoice_issued_at` says the invoice may be shown. Everything the client can reach — `document_id` on the visit, `documents.invoice` on a payment, and `GET /api/documents/{id}` itself — waits for the second, and answers `409 not_ready` until then, exactly as it did before the invoice was raised. **A document is never shown and then taken away.**

**The visit's own screen tells three states apart, not two.**

| The API answers                              | The app says                                                      |
| -------------------------------------------- | ----------------------------------------------------------------- |
| `document_id` set                            | Tax invoice, a link that opens the PDF in a new tab               |
| `document_id` null, `invoice_expected` true  | "The invoice is still generating. Usually ready within the hour." |
| `document_id` null, `invoice_expected` false | "No charge for this visit, so there is no invoice."               |

`invoice_expected` is new on `VisitDetail`, rather than a third meaning for `document_id`. The API works it out from the price book and the visit's type: a visit is billed when its type costs something on the day it happened, which is the same fact that makes FSM raise an invoice at all (ADR 0055, "A work order with nothing on it is not billed"). **The app never infers it from a price it happens to be showing**, and if the owner ever prices a consultation, the app follows the price book with no change here. A visit whose service item is none of ours is unpriced here and counts as billed: FSM knows its total, we do not. A visit FSM has not completed is not billed yet, and its screen says nothing about an invoice at all.

**Nobody is told.** The invoice appears beside the service the next time the client opens it. No message is sent, no consent is added, and there is no "notify me" — the payments screen's Notify me (board E3) is a WhatsApp message to ops and stays where it is.

## Consequences

- **A client who prepaid sees an invoice that is settled.** The payments pass (ADR 0044) waits while an invoice is a draft; issued invoices are no longer drafts, so the advance is applied on the next five-minute run and the invoice's balance falls to nil. Nothing else was needed.
- **Every invoice this raises is a real accounting record**, in the owner's real org from staging (open point 19). It cannot be deleted, only voided with a credit note. The first pass after this is deployed issues the invoices for staging's finished jobs, so the backlog's drafts should be dealt with by hand **before** it is deployed; after that they are sent as they are raised. Anything already a draft when this ships is never touched by the pass.
- **GST is still off** (open points 2 and 3), so what is issued carries the price and nothing else. When GST goes on, the invoice is FSM's to compute, and issuing does not change.
- The visit screen departs from board C9, which draws no invoice row; the departure is recorded in `docs/fidelity-method.md`.
- Ops learn of a failed send from the alert. A board for invoices that could not be raised or sent still belongs with the payments screen that open point 60 wants.
