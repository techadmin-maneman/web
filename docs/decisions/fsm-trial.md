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

## From Zoho's documentation, before the trial (22 September 2026)

These are what the published documentation says. Each still needs confirming against the trial org. `[API]` is https://www.zoho.com/fsm/developer/help/api/ and `[KB]` is https://help.zoho.com/portal/en/kb/fsm/.

1. **Host and scopes.** Accounts are at `accounts.zoho.in`, the API at `fsm.zoho.in/fsm/v1`, and a Self Client suits a server ([API]auth-request.html). Access tokens last an hour and refresh tokens don't expire ([API]refresh-token.html).
   - Scopes are per module, for example `ZohoFSM.modules.ServiceAppointments.READ`, plus `ZohoFSM.files.*` for attachments. `ZohoFSM.modules.all` covers them all.
   - To confirm: whether `www.zohoapis.in` also answers.
2. **Limits** ([API], root page):
   - Calls a day per org: 5,000 on trial and Free, 25,000 Standard, 50,000 Professional, 100,000 Premium.
   - 5,000 a minute per user.
   - Concurrency: 5 on Free, 15 on the paid editions.
   - To confirm: the status code when a limit is exceeded, which is not documented.
3. **Webhooks** ([KB]automation/articles/create-webhooks, [KB]automation/articles/workflow-rules-actions):
   - They are fired by workflow rules on create, edit or delete of assets, companies, contacts, estimates, requests, appointments, services and parts, and work orders.
   - The payload is ours to design.
   - They are not signed: the only authentication is a static key or token we set in a header or parameter.
   - To confirm: retries, and whether status transitions count as edits.
4. **Reading.** Every module has list and get endpoints, including appointments, work orders, contacts, users, assets, job sheets and service reports ([API]).
5. **Photographs.** Upload a file to `POST /fsm/v1/files` (at most 20 MB), then attach it to a work order, appointment or asset ([API]upload-file-to-zfs.html, [API]add-attachment-to-record.html).
   - There is no bulk export of attachments ([KB]data-administration/articles/exporting-data-from-zoho-fsm).
   - Job-sheet image fields take uploaded file IDs.
6. **Availability.** `GET /fsm/v1/serviceResource/getAvailableServiceResources` returns free technicians, and `POST /fsm/v1/Service_Resources/Available_TimeSlots` returns free slots, within at most 48 hours ([API]fetch-available-time-slots.html).
   - To confirm: whether shifts and leave are respected.
7. **Writes.** Scheduling, dispatch and reschedule are transitions: `PUT /Service_Appointments/{id}/actions/blueprint` ([API]dispatch-service-appointment.html).
   - Assets, job-sheet records, service reports and time sheets can be created and edited ([API]create-asset.html, [API]create-job-sheet-record.html).
   - Assets and job sheets are Professional and above.
   - No idempotency key is documented.
8. **Books.** Invoices raised in FSM appear in Books, and companies, contacts, services and parts sync both ways (https://www.zoho.com/fsm/plan-comparison.html).
   - Books records a taxed customer advance in its interface (https://www.zoho.com/in/books/help/payments-received/functions.html).
   - Its API does not document one.
9. **The job-sheet template.** The forms are built in FSM's settings, not through the API. The owner writes the template.
10. **Technicians and zones.** The people assigned to appointments come from FSM's users. Zones are territories. Users cost nothing up to 200 on Standard and Professional ([KB]faqs/pricing-and-subscription).
