# Bookings and Books

Part of the [runbook](../runbook.md), whose opening says how its commands are written.

Our own database is the record of field work (ADR 0110): a booking, a move, a cancel, a technician's steps, pieces and photographs are written there in the request that makes them. Books is written by the cron's Books pass: each client's customer, each finished visit's invoice, and each payment and refund, once an hour for each record. Books is never on the booking path. Production has Books switched off today (`BOOKS_PROVIDER` is `none`).

## A booking left unbooked

A paid booking is written in the request that confirms it: Razorpay's webhook, or the request for a free one (ADR 0068). If that request fails part-way, the hold keeps its time and its payment, and the cron books it half an hour on.

- **"Booking _id_ was paid for, or booked free, and is neither booked nor refunded half an hour on: …"** (`unbooked_hold`), once, with the reason. The cron tries it again every half hour and closes the alert when it is booked or refunded.
- A reason from Razorpay ("Razorpay refused the refund of …", "Razorpay did not answer …") is a payment made too late, or for a client erased since, that is owed back and could not be refunded. Refund it once in Razorpay's dashboard: the next try finds it refunded, lets the hold go and closes the alert.
- Any other reason is usually D1 failing; it passes by itself. If it is still there after a few tries, book the visit for the client from the console, then refund the payment in Razorpay's dashboard.

## Books is down

Symptoms: `books_…_failed` and `invoice_failed` alerts, each on its third failure, and `cron_job:books_sync` once the pass has failed three runs. If calls fail with `Access Denied` or `TOKEN_COOLING_DOWN`, it is the token rather than Books: "Zoho refused a new token", above, with `'books'` for the client.

Nothing a client or a technician does waits on Books. Customers, invoices, payments and refunds wait, and each is tried again an hour later; once Books answers, the pass catches up and the alerts close.

## Invoices and Books

The cron makes each finished visit's invoice in Books from our own figures: one line on its service's item, at the price book's price on the day, with a discount code as the line's discount before tax, under the visit's ID as its reference (ADR 0110). It sends the invoice once Books' total equals what the client was sold the visit for; only then can the client open it. It records each payment and refund in Books and sets a visit's payment against its invoice. Nothing here ever sends a draft made by hand, so a draft ops correct is sent by ops.

- **Held as a draft** (`invoice_draft`), the alert says why. The price differs: correct the draft in Books and send it there, and set the service's item right (provisioning, step 11b, point 7). Nothing says what the visit was sold for: check the draft and send it. Paid with a referral credit: leave it until the CA rules (open point 14). Books would not take a discount code's discount: set the discount the alert names on the visit's line, before tax, and send it there (provisioning, step 11b, point 8).
- **Still a draft an hour after the visit, or Books would not mark it sent** (`invoice_draft`, and `invoice_not_issued` in the logs): send it in Books. Within the hour the pass sees it sent, the client can open it, and the alert closes.
- **Books refused the invoice** (`invoice_refused`): the message gives Books' reason. Put it right, and the next hour's pass makes it; or raise it in Books by hand.
- **No price for the visit's day** (`invoice_unpriced`): raise the invoice in Books by hand, and set the price in the console for the days to come.
- **Books refused a payment, its application or a refund** (`books_…_refused`): the message says what; put it right in Books. It is asked again every hour, and the alert closes when it goes through. `books_…_failed` is Books failing three times in some other way, usually Books being down; nothing to do.
- **Nothing to set a payment against** (`books_unapplied`): it stays in Books as the client's credit. Settle it by hand in Books; how a kept charge is invoiced waits for the CA (open point 16).
- Refunds are recorded in Books only while `BOOKS_REFUND_ACCOUNT_ID` is set (step 11b, point 6).

The console's Tasks board lists every draft invoice. From SQL:

```sql
SELECT id, window_end, fsm_invoice_id, invoice_checked_at FROM appointments
WHERE status = 'completed' AND invoice_issued_at IS NULL AND deleted_at IS NULL ORDER BY window_end;
SELECT id, razorpay_payment_id, captured_at FROM payments WHERE captured_at IS NOT NULL AND books_payment_id IS NULL;
SELECT id, razorpay_refund_id, created_at FROM refunds WHERE status = 'processed' AND books_refund_id IS NULL;
```

`fsm_invoice_id` holds the Books invoice's ID: the column keeps its old name (ADR 0110, rule 1).

## Staging's records in the org

Staging writes to the owner's real Books and CRM, which production shares (open point 19), so staging's records go before production goes live. From that release on, staging's CRM and Books are the stubs, and nothing more of staging's reaches the org unless a Zoho change is being tested. The script lists them, the owner reviews the list, and a second run deletes what the owner kept in it. It uses the scripts' own tokens (provisioning, step 8.7): the CRM's must read and delete leads and contacts. It reads staging's database with wrangler, so run it signed in to Cloudflare.

1. List them:

   ```sh
   node --env-file=.env.books-scripts --env-file=.env.crm-scripts scripts/staging/staging-records.ts
   ```

   It lists every Books payment whose description starts "Staging test: ", with its refunds; every Books invoice of a staging contact; every Books contact, CRM lead and CRM contact named "Staging test" or "Load test"; and every Books customer, payment and invoice and CRM lead whose ID staging's database keeps, read one by one, so an erased or inactive one is listed too. It writes them to `private/staging-records-<date>.json`. It names apart any record that looks like a test but carries neither mark, which it never deletes, and any ID staging's database keeps of a record the org no longer holds.

2. The owner reads the list. To keep a record, take its entry out of the file.
3. Delete: the same command with `--delete private/staging-records-<date>.json`. It reads the org and staging's database again and deletes only what the file keeps and they still hold as staging's, what points at a record before it: Books' refunds and payments, its invoices, its contacts, then the CRM's contacts and leads. Each line says `deleted`, `already gone` or `refused` with the reason. Then it clears staging's database's links to each customer, invoice and lead now gone, so the Books pass makes a client a new customer when they next need one. A payment's and a refund's IDs stay: cleared, the pass would record staging's old payments again, without their refunds.
4. A refusal is usually a record another still points at: run the delete again, and anything freed by the first run goes. What stays refused is put right by hand in Books or the CRM.

## Staging left FSM

Staging switched to our own database on 4 October 2026 (FSM-PR10), and FSM's code was deleted the same day (FSM-PR11). Production never used FSM. Once FSM-PR11 was live on staging, the old queue's consumer was taken off and the queue deleted (4 October 2026):

```sh
W queues consumer remove mm-fsm-sync-staging mm-api-staging
W queues delete mm-fsm-sync-staging
```

FSM's trial lapses around 7 October 2026 with whatever test records it still holds; nothing of ours reads them. The only way back to FSM is to revert FSM-PR11 and FSM-PR10.

---
