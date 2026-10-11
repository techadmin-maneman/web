# 0145. A technician's word from the job card

- Status: accepted
- Date: 2026-10-12
- Topic: Messages and the CRM

## Context

Technicians tell clients they are on the way, at the gate or running late from their own WhatsApp, so the client's thread with us misses it and each side gets the other's number. The support scope gives the job card three presets sent from the office number, under the client's visit-messages consent, offline-safe through the tech app's outbox.

## Decision

1. **The job card offers "On the way", "Running late" and "At the gate"**, the first two with the minutes chosen from 10 to 60. Each goes from our number, as a message about the visit in the client's thread.
2. **It goes through the outbox.** A word tapped without signal is sent when the phone finds it, once, by its event ID.
3. **A word that reaches us too late to help is kept unsent**: after 30 minutes for on the way and running late, after 10 for at the gate. A word for a closed visit is not sent. The API never refuses a word the phone could send again, so the job's queue on the phone carries on.
4. **It needs the client's consent to WhatsApp about visits**, as every visit message does. The card says to call a client without it.
5. **Each word is kept** in technician_updates, by the phone's event ID, with the message about it.

## Consequences

- The client's number stays on the job card until masked calls (support phase 4) take it off.
- The three templates are submitted to WhatsApp with the others in support phase 1. Until then they go through the bridge.
- Tests: `test/worker/field/technician-updates.test.ts`, `test/dom/tech-tell-client.test.ts`.
