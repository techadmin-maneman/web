# 0203. A vendor that is down is held off, and a contact change waits in D1

- Status: accepted
- Date: 2026-10-14
- Topic: Messages and the CRM
- Amends [0012](0012-zoho-sync.md) on how the CRM sync gives up

## Context

Each try of a lead counted towards its ten (`MAX_SYNC_ATTEMPTS`), and the sweeper sent failed leads again every fifteen minutes. A day-long Zoho outage spent every lead's ten tries in about two and a half hours, gave each one up with an alert of its own, and logged every failure as an error. Ops then had to send each lead again by hand once Zoho was back. A contact update lived only on the queue: five tries, then an alert to write it by hand, and a message the queue would not take was an alert too.

## Decision

1. **The CRM is held off as a whole** (`vendor_breakers`, src/domain/platform/vendor-breakers.ts). A failure that is the CRM's own, not its refusing a record, counts towards the CRM; at five in a row it is held for fifteen minutes (src/policy/vendor-breakers.ts). While it is held, its work waits: a lead, an erasure or a contact update is left as it is, uncounted, for the sweeper's next pass. The try that holds it, and the first try after a hold, which holds it again at once, count against the CRM and not the record. Ops hear one alert, `vendor_down:crm`, which the first answer closes.
2. **A contact change is owed in D1** (`crm_contact_updates`, src/domain/clients/contact-updates.ts), written as the change is made: one row a client, the invite ops attached noted on it. The update deletes it once the lead has the change as it was read; one made since stays owed. The sweeper sends again what has been owed, or tried, for a quarter of an hour. The queue tries an update three times before leaving it to the sweeper.
3. **Only the CRM refusing the record tells ops to write it by hand.** A message the queue will not take is the sweeper's to send, so the two alerts that asked for that by hand (`contact_sync`, and the invite's `crm_contact_update`) go.

## Consequences

- A lead is given up only for failures that are its own, or after ten tries while the CRM answers others.
- Books, Razorpay and the WhatsApp bridge keep their own handling: the bridge already holds every message while it is down (ADR 0128), and Books and Razorpay are tried by passes that tell ops on their third failure.
