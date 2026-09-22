# Zoho FSM trial findings

- Status: **pending**. The owner supplies the findings; P2-M2 cannot start without them.
- Referenced by: `docs/prompts/phase2-backend.md` ("Before you start", point 2)

The Phase 2 backend reads field operations from Zoho FSM and writes them back to it. Where the trial finds a capability missing, the build stops and an ADR records the fallback. The roadmap's fallbacks are our own availability logic and our own photo-capture PWA.

The trial must answer each of these, against the FSM trial org on the India data centre:

| #   | Question                                                                                                                                                                                                          | Used by                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 1   | Which API version and host, and which OAuth scopes each call needs                                                                                                                                                | P2-M2                          |
| 2   | The API's credit and concurrency limits, per org and per minute                                                                                                                                                   | P2-M2 (mirror, reconciliation) |
| 3   | Webhooks: which events exist (appointment, work order, job sheet, asset), how they are signed or authenticated, retries, and whether they carry an event ID                                                       | P2-M2                          |
| 4   | Reading clients, appointments, technicians, job sheets, outcomes and assets (pieces)                                                                                                                              | P2-M2                          |
| 5   | Photo export: the webhook the roadmap relies on, and whether photographs can be attached to a job sheet by API                                                                                                    | P2-M2, P2-M4                   |
| 6   | Availability by API: technician calendars and leave, or none (then our own availability logic)                                                                                                                    | P2-M4, P2-M5                   |
| 7   | Writes: reassign, reschedule, start and close a job, job-sheet fields (checklist, consumables, outcome, partial reason, duration), asset updates, attachments. Does FSM accept an idempotency key on any of them? | P2-M4                          |
| 8   | The retainer invoice as the prepay record, and how FSM links to Zoho Books and Zoho CRM                                                                                                                           | P2-M2, P2-M5                   |
| 9   | The job-sheet template: checklist items per visit type, the consumables list, the full list of partial reasons                                                                                                    | P2-M4                          |
| 10  | How a technician is marked an active field technician, and how zones are held                                                                                                                                     | P2-M4                          |

Record the answers here, one section per question, with the date checked and the documentation page or API response that shows it.
