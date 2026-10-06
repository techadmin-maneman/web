# Erasure within the day

Part of the [runbook](../runbook.md), whose opening says how its commands are written.

The photo notice promises that a person's data is deleted the same day they ask. Whoever takes the request erases it before the end of that day, in the ops console; there is no other way. What is erased, and what is not, is in `docs/decisions/0019-erasure.md`, `0049-dpdp.md` and `0066-erasure-all-or-nothing.md`.

The console has two doors, and both run the same erasure, written to `audit_log` under your Access identity in the erasure's own batch. Both need Customer Care at Manage, and a service token can use neither.

- A request a client made in their app waits in **Deletion requests** ("A client's account" below).
- A request made any other way, on WhatsApp, on the phone or in person, is erased from the person's own page (`person.erase`). Anyone who gave us a number has one, client or not.

1. **Check the request comes from the number's owner.** Reply to that number on WhatsApp, or call it.
2. **Erase.** Find them in **Clients** by name or number, open their **Consents** tab, and press **Erase**. The console says what is deleted and what is kept, and asks you to confirm you have checked the request with them on their own number. Someone with a request open from their app has no Erase button: decide it in Deletion requests, which tells them when it is done.

   **A visit booked, a payment held, or a link unpaid.** Nothing is erased while the person has a visit or a booking still to happen (a booking paid for or free that is not yet a visit counts), a payment we captured with no visit behind it, or a payment link unpaid, and the console says which (`docs/decisions/0066-erasure-all-or-nothing.md`). Cancel each visit on their page (Visits, **Cancel**): it refunds what was paid, gives a visit credit back and tells the client. Refund a payment with no visit behind it in Razorpay. A link waits to be paid, or for its booking's link to close. Then erase. If they cannot be settled today, tick the line the console shows and press **Erase anyway**: the person is erased, their bookings not yet visits are let go, their open payment links are cancelled at Razorpay, the audit entry records it (`settled_by_hand`, with the number of visits, bookings, payments and links), the Worker logs `erasure_override`, and the visit and payment must still be cancelled and refunded the same day. A refund needs none of the person's details. A link Razorpay would not cancel raises `erased_link:<link>`: cancel it in Razorpay's dashboard.

   The files (photos, results, visit photographs, the referral card) are deleted just after the rest. If R2 fails, the person is erased all the same and the cron finishes the files within five minutes; `files_erased_at` on the person is set once they are gone. A deletion request of theirs still open is closed by the erasure, under your name, so it neither waits in the queue nor alerts.

3. **Check Zoho within a few minutes.** The erasure queues the CRM's blanking at once: in the CRM the last name becomes "Erased", mobile and e-mail are emptied, and Contact Consent is unticked. Books' customer is erased by the cron's own pass: deleted where no invoice or payment names it, otherwise renamed "Erased client", blanked and made inactive. That pass waits up to a day for a payment of theirs still on its way to Books. Then it blanks and deletes the CRM Contact that Books' CRM integration made of the customer, whose ID it read from the customer first. The person's ID is in the address of their page: in the CRM, search Leads by **D1 Person ID** with it and check the lead.

   ```sql
   SELECT erased_at, crm_erased_at, crm_erasure_attempts, crm_erasure_error, books_erased_at, crm_contact_erased_at
   FROM people WHERE id = '<person_id>';
   ```

   If `crm_erased_at` stays empty, `crm_erasure_error` says why. The sweeper tries 10 times, then alerts, and the alert waits under Tasks' Needs a hand. Once Zoho is back, **Send again** there. To finish it by hand instead, find the record in Zoho by `D1_Person_ID`, blank those fields, then **Mark done** (Customer Care Manage): that records the person as erased in the CRM. If Books will not erase the customer, or the CRM the Contact, after 10 tries, ops are alerted once with what to do by hand.

4. **Delete the chat** with the number in the Mane Man WhatsApp account, if there is one.
5. **Tell the person** it is done, in the chat they asked in.

Someone who used the try-on but never passed the gate never gave a number, and their photo is deleted within the hour anyway.

**Zoho's history.** Blanking the fields may leave the old values in the record's timeline. If the person or legal asks for full removal, delete the record in Zoho, then delete it from the recycle bin as well. D1's lead history is unaffected.

**A client's account (Phase 2).** A request from the app waits in the ops console's **Deletion requests**. Check it with the client on their own number first, as in step 1 above: the console asks you to confirm you have, and says what the deletion destroys and what it keeps before it will take it. Processing it runs the same erasure, and also tells the client on WhatsApp that it is done (`deletion_done_v1`), so step 5 is not needed. It is sent once, straight after the erasure; the log's `deletion_done_failed` means it did not arrive, and with the number gone it cannot be sent again. Delete the chat (step 4) after it.

Rejecting a request sends the client your reason on WhatsApp (`deletion_rejected_v1`), and their app shows it for 30 days, so write it for them to read.

A request waiting 5 days alerts ops: process it before its 7 days run out. The console counts the days left against each request. Invoices stay in Books for 8 years, by law.

**A grievance, and a change of number.** Both are answered in the console too: **Grievances** holds what a client has said about the way we use their data, and recording your answer closes it — it messages nobody, so send your answer on WhatsApp yourself first. The client sees what you record, word for word, under Your data in their app. A client may raise five new grievances a day. **Number changes** holds the changes whose codes both numbers have already proven; confirming one is what moves the client onto the new number. Every decision on all three is written to `audit_log` under the Access identity that made it.

---
