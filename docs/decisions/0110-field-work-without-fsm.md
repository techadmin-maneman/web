# 0110. Field work without Zoho FSM

- Status: accepted, on the owner's ruling of 2 October 2026. Built: staging left FSM on 4 October 2026, and FSM's code was deleted the same day. Supersedes [0032](0032-fsm-mirror.md), [0064](0064-converting-a-request.md), [0095](0095-a-booking-fsm-refuses-is-held.md), [0098](0098-the-door-in-fsms-address.md), [0099](0099-the-clients-note-in-fsm.md) and [0101](0101-phase-1s-path-into-fsm-removed.md); [fsm-licensing.md](../archive/fsm-licensing.md) and [fsm-trial.md](../archive/fsm-trial.md) are history.
- Date: 2026-10-02
- Topic: Field work

## Context

- Production has never used FSM: it runs with `FSM_PROVIDER` and `BOOKS_PROVIDER` set to `none`, so there is no production data to move. Only staging holds FSM records, and they are test records.
- Staging can no longer book into FSM: the trial ran out of appointment credits, and the trials end around 7 October 2026.
- The apps already read D1, not FSM. FSM is written through one provider and read back through a mirror, a webhook, a reconciliation and the `fsm-sync` queue.
- Four of the 2 October audit's eight distinct P0s exist only because of FSM.

## Decision

**D1 becomes the record of bookings, visits, technicians and pieces. Zoho Books is written directly for customers and invoices, and Books' own Zoho CRM integration carries customers into CRM Contacts. FSM is removed, before production launch.** The owner ruled so on 2 October 2026, on these points:

- **The subscription:** FSM's trial lapses; no plan is bought.
- **Books and the CRM:** two-way, Contacts only, transaction sync off, duplicates skipped. A Books Contacts field "MM person ID" is mapped to a CRM Contacts field. Leads stay Leads.
- **A draft invoice of ours:** sent when Books holds it under our reference and its total matches what was paid. Any other draft stays for ops, and a draft made by hand is never touched.
- **Booking from the console:** every kind of visit. A paid visit goes out as a payment link; a free or credit visit books at once.
- **Erasure in Books:** the customer is renamed "Erased client", its contact persons, phones, e-mail and addresses cleared, and it is marked inactive. A customer with no invoices is deleted.

The build follows these rules:

1. **The `fsm_id` columns stay**, on `appointments`, `technicians` and `pieces`. A row made without FSM holds its own ID there (`fsm_id = id`). The columns are `NOT NULL UNIQUE`, and `appointments` is pointed at by too many tables to rebuild.
2. **`FSM_PROVIDER` picks the path until FSM's code is deleted:** `zoho` and `stub` keep FSM's, `none` makes D1 the record. Staging changes with that one variable, and changing it back is the rollback.
3. **Books is never on the booking path.** The Books customer is made by the five-minute Books pass, not when someone books.
4. **A visit's statuses stay the seven the schema allows.** `other` is no longer written.
5. **The `visits` row is written when the outcome lands**, in the same batch as the status change.
6. **An invoice is built from our own figures:** one line on the visit's Books item, at the price book's tax-inclusive price on the day, a discount code as the line's discount before tax, and the appointment's ID as its reference. Books' total is read back and must equal what was paid, or the invoice stays a draft for ops.
7. **Migrations expand first and contract a release later.** Columns only FSM used are dropped once no deployed Worker reads them.

## Consequences

- Migration 0070 adds `people.books_customer_id` (unique), `services.books_item_id`, lets `appointments.fsm_status` and `fsm_modified_at` be empty, and lets `zoho_access_tokens` hold a token for Books' own client.
- Until staging switches, nothing changes for its users: each changed path keeps FSM's way under `zoho` and `stub`.
- D1 is the only record of field work once FSM goes, so a restore that is proven to work matters more.

## FSM's code removed, 4 October 2026

Staging switched to `FSM_PROVIDER: "none"` and ran on our own database first (FSM-PR10). Then FSM's code went (FSM-PR11):

- **Gone:** FSM's providers, the `fsm-sync` queue and its consumer, the mirror, FSM's webhook, the reconciliation, held bookings and their console panel, `FSM_PROVIDER` and every `ZOHO_FSM_*` setting, and the cron jobs that only FSM needed.
- **A booking is written in the request that confirms it.** A paid hold whose request failed part-way is booked by the cron within the half hour, and ops are told once of one that still cannot be.
- **The `fsm_*` columns stay** until a release after this one reaches production, when a contract migration drops those nothing reads (rule 7). `fsm_id` stays for good (rule 1).
- **Rule 2 has done its work.** There is one path, so changing a variable no longer rolls staging back to FSM.
