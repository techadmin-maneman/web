# 0055. The invoice for a finished job

- Status: accepted; amended by [0056](0056-issuing-the-invoice.md) on 23 September 2026
- Date: 2026-09-23

## Context

P2-M2 asks that "the invoice PDF opens". The staging proof of 23 September could not run that check. `POST /fsm/v1/Invoices` answered `500 INTERNAL_ERROR` however the body was shaped, `/Work_Orders/{id}/actions/create_invoice` was a 404, and the work order's blueprint offered Complete, Cancel, Terminate and Close and no invoice step. It was written up as a manual step: someone presses Create Invoice in FSM after every job, and until they do `appointments.fsm_invoice_id` stays null and the app answers `409 not_ready`.

The owner then raised the invoice for work order WO13 by hand, and that record answered it.

**Zoho documents the call.** [Create an Invoice](https://www.zoho.com/fsm/developer/help/api/create-invoice.html) makes three fields mandatory: `Work_Order`, `$Service_Line_Items` — the IDs of the lines to bill — and `$finance_data`, which carries the date, the payment terms and a `discount_preference`. Ours sent the work order and left the other two out.

**Tried against the owner's org on 23 September**, on a work order made for it:

| Body                                                       | Answer                                                            |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| `Work_Order` alone                                         | `500 INTERNAL_ERROR`, no detail                                   |
| `Work_Order` and `$Service_Line_Items`, no `$finance_data` | `200`, code `2031`, "One or more line items are already invoiced" |
| all three                                                  | `201`, with the new invoice and Books' ID for it                  |

So the 500 was ours: with no line IDs to walk, FSM's Invoices module throws before it validates anything, and the error it throws is the one we were reading as "FSM cannot do this". With the line IDs it answers a plain business refusal instead, so the missing field was never reported.

**An invoice in FSM is a link, not the document.** `GET /fsm/v1/Invoices/{id}` answers Zoho Books' own invoice payload — line items with Books item IDs, `payment_terms_label`, `record_actions` including "Unlink Invoice" — wrapped in a handful of FSM fields, of which `ZBilling_InvoiceId` names the Books invoice. The create answers the same ID under `data.Invoices[0].finance_data.Invoice_Id`. FSM does not hold invoices; Books does, and FSM's Invoices module is the door to them. Plan input 11 asked whether invoices belong in FSM or Books. They are in both, and it is one document.

**The other half of the open point is finding an invoice once it exists**, which the proof found the mirror could not do. The appointment's own `Invoice_Id` is the reason: FSM leaves it **null** on AP-14 although WO13 is `Billing_Status: "Invoiced"`, and the mirror was writing that null into `appointments.fsm_invoice_id` — the column `GET /api/documents/{visit_id}` hands to **Books**, where FSM's own ID would not have been found either.

The proof proposed listing `/fsm/v1/Invoices` and matching `Work_Order.id`, and recorded that the work order "carries no invoice ID at all". That is true of the work order's own fields and not of its **service lines**: WO13's line SVC-16 carries `Invoice_Id: "8229000000304418"`, FSM's INV-000001, put there when the owner raised it by hand. So the link is one read of the work order we are already asking about, and the list — which takes no filter and grows with every job the business ever does — is not needed.

## Decision

**FSM raises the invoice, by API, and Books holds it.** `fsm.invoiceWorkOrder(workOrderId)` reads the work order, bills every service line on it, and answers the invoice: FSM's record and Books' ID for the document.

- The create always carries the line IDs and `$finance_data`, because leaving either out is what the 500 was.
- The terms are "Due on Receipt" with no discount and no adjustment, and the date is the day it is raised in India. Clients pay before the visit, so nothing is ever owed on terms. This is the shape the owner's own hand-made invoice has.
- **Raising it and finding it are one call.** A work order whose lines already name an invoice is not billed again: that invoice is read, and its `ZBilling_InvoiceId` answered. So a job the owner invoiced by hand in FSM's screen comes back the same as one we raised, and the manual step stays safe as a fallback — if Zoho ever takes the create away, finding still works and the owner can press the button.
- **Nothing lists `/fsm/v1/Invoices`.** The module's list takes no filter and would be read in full to find one invoice.
- **A work order with nothing on it is not billed.** A free consultation totals nothing, and `null` is the answer.

**`appointments.fsm_invoice_id` holds Books' ID.** That is what `books.invoicePdf` and `books.invoice` take, and what they always took; nothing else read the column. The FSM mirror no longer writes it — an appointment's `Invoice_Id` is null even when its work order is invoiced — and `FsmAppointment` no longer carries a field nothing could use.

**The pass runs on the five-minute cron** (`src/domain/fsm-invoices.ts`), just before the Books pass and never in a client's path. It runs where both FSM and Books are connected, since the ID it keeps is Books'.

- Each run takes up to five completed visits whose invoice we do not hold, oldest first, and offers their work orders to FSM.
- A work order FSM will not bill, or refuses, is stamped `invoice_checked_at` (migration 0029) and waits an hour, so a free consultation is not offered again every five minutes for ever.
- A refusal — a 4xx — is logged as `invoice_refused` with FSM's own code and the pass carries on. Anything else fails the pass, which the next run repeats.

## Consequences

- **The manual step is gone.** A closed job is invoiced within five minutes, and `GET /api/documents/{visit_id}` streams the PDF from Books. Nobody has to remember.
- **The first run bills the backlog.** Every finished visit already in the mirror without an invoice is offered, five a pass. On staging that is the proof runs' own completed jobs, so the first hour after this is deployed puts a few more draft invoices in the owner's real Books, labelled like the rest and to be cleared with them (open point 10). In production there is no backlog: nothing has been mirrored yet.
- **The invoice is a draft.** FSM creates it in Books as a draft, as the owner's hand-made one is, and sending it is Books' own step that nothing of ours presses. ADR 0044 has the payments pass wait while an invoice is a draft, so **a client's advance is still not set against their invoice**: that is `docs/open-points.md` item 70, for the owner and the CA to rule on with the rest of section 6.
  > **Amended by [docs/decisions/0056](0056-issuing-the-invoice.md), 23 September 2026:** the owner ruled that the invoice is marked sent as part of raising it, so it is a valid tax invoice and the advance settles against it. An invoice that already exists as a draft is still never sent by code. The rest of this ADR stands.
- **No tax on it.** GST is off in Books and 0% in the price book (open points 2 and 3), so the invoice carries the price and nothing else. When GST goes on, the invoice is FSM's to compute, not ours.
- **Consultations get no invoice**, because they are free. If the owner ever prices one, it is invoiced like everything else with no change here.
- **One invoice per work order**, and our work orders carry one service line each. A work order with some lines invoiced and some not is answered with the invoice the first billed line names, and the rest are left; nothing of ours makes such a work order.
- Ops are not told when FSM refuses to bill a job. The log line is there, and a board for it belongs with the payments screen that open point 57 still wants.
