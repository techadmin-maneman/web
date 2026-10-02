# Zoho FSM trial findings

- Status: **answered on 22 September 2026**, from the documentation and a trial run against the real org (below). Webhooks are confirmed in P2-M2; question 4's coordinate was corrected on 23 September and question 8's CRM half answered on 24 September, both at the end.
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

## Trial results (22 September 2026)

Run through the API against the org the owner confirmed as the real one, while it was still empty. Every test record was named "Mane Man API test", used an `example.com` address, and was deleted afterwards. Books was checked read-only.

1. **Host and scopes.**
   - A Self Client's refresh token works on `accounts.zoho.in`, and the token names `www.zohoapis.in` as its API domain. FSM answers on both `fsm.zoho.in/fsm/v1` and `www.zohoapis.in/fsm/v1`.
   - `ZohoFSM.modules.all` does not cover time sheets, which need `ZohoFSM.modules.TimeSheets.READ` of their own.
   - An empty list answers **204 with no body**, not 200 with an empty list.
   - A create answers `data[0].details.id`, but a file upload answers a single `data` object with `file_id`.
2. **Limits.**
   - Every FSM answer carries `x-ratelimit-limit` (2,500 on the trial), `x-ratelimit-remaining` and `x-ratelimit-reset`.
   - Zoho allows **10 new access tokens per 10 minutes** per refresh token, and refuses more with "Access Denied". The integration must cache its access token for the hour it lasts.
   - Books allows 1,000 calls a day on its trial (`x-rate-limit-*` headers).
3. **Webhooks.** Not tested: webhooks are set up in FSM's settings, not through the API, and need a receiving route. That is tested in P2-M2 once the route exists.
4. **Reading.** Contacts, work orders, appointments, assets, territories, users (with each user's service resource and territory) and job-sheet forms all read as documented. Work orders and appointments carry `Status`, `Billing_Status`, `Retainer_Received` and `Invoice_Id`.
   - ~~**FSM geocodes service addresses itself** (`Service_Latitude`, `Service_Longitude`).~~ **Wrong on both counts; corrected 23 September 2026.** It does not geocode a contact created through the API, and the coordinate is not on those fields. See "Question 4, the coordinate" at the end of this document. The street FSM holds is still the placeholder `"To be confirmed with the client"` for every contact we create.
5. **Photographs.**
   - A JPEG and a WebP were uploaded to `/files`, attached to a work order, and listed.
   - Both downloaded through `/files?file_id=` **byte for byte identical**, with the right content type.
6. **Availability.**
   - `getAvailableServiceResources` returns each technician with `is_available` and any `conflicting_appointments`.
   - `Available_TimeSlots` returns free slots of the asked length (90 minutes tried), and leaves out booked time.
   - The working day is FSM's own setting: slots began at 09:00.
   - ~~Within at most 48 hours, as the documentation says.~~ **Wrong; corrected 24 September 2026.** See "Question 6, how far ahead, and leave" at the end of this document. The 48 hours was read off the documentation page and never tried past a day; both calls answer for any date asked.
7. **Writes.**
   - Creating an appointment works. Each work order's service line can be in **one appointment only**.
   - **Rescheduling must use `PUT /Service_Appointments/{id}/actions/reschedule`.** A plain edit of the times answers "record updated" but changes nothing.
   - The transitions offered are Dispatch, Cancel, Terminate and Reschedule.
   - **Cancelling is a blueprint transition** (tried 22 September 2026): `GET /{module}/{id}/actions/blueprint/transitions` lists each with its ID, and `PUT /{module}/{id}/actions/blueprint` with `{ blueprint: [{ transition_id, data: { Notes } }] }` makes it. The note is mandatory. There is no `/actions/cancel`.
   - Cancelling an appointment sends its work order back to "New", and its service line can take a new appointment. **Cancelling the work order cancels its appointments too**, which is what ADR 0046 uses.
   - **FSM accepted an overlapping appointment** for the same technician even with `$allow_overlapping: false`, so the org's "Allow overlapping appointments" setting is on. Our own clash check (`slot_claims`, ADR 0034) is needed either way. Turning the setting off is an open point.
   - An asset needs a `Product` (a part item) and keeps our label in `Asset_Number`.
   - Items are deleted at `/Products/{id}`, not `/Service_And_Parts/{id}`. Other records delete at their module's path.
   - No idempotency key is offered anywhere.
8. **Books.**
   - The organisation exists (Delhi, financial year from April, Premium trial), and its retainer invoice, customer payment, invoice, credit note, contact and item endpoints answer.
   - **GST is not set up yet:** there is no GSTIN and no tax rates, so no GST document can be issued until it is.
9. **The job-sheet template.** None exists yet (`meta/job_sheet_forms` is empty). It is built in FSM's settings.
10. **Technicians and zones.** The org has one user (the owner, an active service resource of type Agent) and one territory, "Mane Man".

## Question 4, the coordinate: answered 23 September 2026

Tried against the real FSM org with one synthetic contact per case — "Mane Man API test", an `example.com` address and a Gurugram street that does not exist — each read back and then deleted. Nothing was left behind; a listing afterwards found no test contact.

**FSM accepts a coordinate we supply, and keeps it.** A contact created with `Service_Address` carrying `Latitude` and `Longitude` read back with exactly those values.

**The coordinate is a field of the address record, not of the contact.** `GET /Contacts/{id}/Addresses` and `GET /Contacts/{id}/Addresses/{addressId}` return `Latitude` and `Longitude`. The contact's own `Service_Latitude` and `Service_Longitude` stayed **null** throughout, on a record that demonstrably had a coordinate. The earlier note under question 4 named the wrong fields.

**Only one path writes it.** Moving an existing pin needs a contact write with the address nested and its `id` named:

- `PUT /Contacts/{id}` with `{ data: [{ Service_Address: { id, Latitude, Longitude } }] }` — **200, and the coordinate moved** (28.4595/77.0266 to 28.4089/77.3178).
- `PUT /Addresses/{id}` — 400 `INVALID_MODULE`.
- `PUT /Contacts/{id}/Addresses` — 400 `INVALID_DATA`.

**FSM did not geocode anything.** A second contact created the same way but with **no** coordinate read back with `Latitude` null, `Longitude` null and `Google_Geocodedtime` null, after a wait. The field exists, so FSM can geocode somewhere — in its own interface, or under a setting this org does not have on — but it does not do so when a contact is created through the API. There is a `Google_Geocodedtime` on the address record, and it was null in both cases, so nothing re-geocoded over the coordinate we supplied either.

This retires the premise of ADR 0036, which had the coordinates coming from FSM's own geocoding of the service address: there is nothing there to read. It also settles what a client-placed pin is worth — it reaches the field, on the record the technician's own navigation uses. Our D1 stays the record the geofence measures against regardless (`docs/decisions/0054-address-capture.md`).

## Question 8, the link to Zoho CRM: answered 24 September 2026

The Books half was answered on 22 September: an FSM contact carries `ZBilling_Id`, and invoices raised in FSM appear in Books. The CRM half was left open. It is answered by reading the real org, read-only, with one cached access token; nothing was created, changed or deleted, and only field names and record IDs were read.

**FSM links a contact to CRM itself, through `ZCRM_Id`.** `GET /fsm/v1/Contacts` returns the field on every contact, and every one of the first twenty had it populated — including contacts our own `POST /fsm/v1/Contacts` created. Its values are in the same org's ID namespace as the CRM's own field IDs (`1431113…`), so FSM and CRM are one org and FSM's contact sync has already made the CRM-side record.

**The CRM side could not be opened from here.** The Worker's CRM refresh token is scoped `ZohoCRM.modules.leads.ALL`, notes, search and the settings reads; `GET /crm/v8/Contacts`, `/Accounts`, `/Deals` and `/settings/modules` each answer 401 `OAUTH_SCOPE_MISMATCH`. So `ZCRM_Id` is a link we can follow from our own side (`people.fsm_contact_id` → FSM's contact → `ZCRM_Id`) but not one we can yet read or write at the far end. What that means for a client's history is ADR 0059; the scope itself is open point 21.

**The CRM's Contacts module is stock.** `GET /crm/v8/settings/fields?module=Contacts` lists 60 fields, every one of Zoho's own: no `D1_Person_ID` and no FSM field. Whatever the integration syncs, it syncs into the standard fields.

## Question 6, how far ahead, and leave: answered 24 September 2026

Read-only against the real org, on the credentials the Worker uses, with the
access token cached for the hour it lasts. Nothing was written.

**Both availability calls answer for any date.** The 48 hours under the
documentation above is not a limit this org enforces:

| Asked                                                        | FSM answered                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `Available_TimeSlots`, tomorrow                              | 200, eleven hour-long slots from 09:00                                               |
| `Available_TimeSlots`, six days out                          | 200, and the morning missing: the 09:30 appointment already on that day was left out |
| `Available_TimeSlots`, twenty days out                       | 200, the full day                                                                    |
| `getAvailableServiceResources`, one, six and twenty days out | 200 each, the one technician with `is_available: true`                               |

Their parameters are not the ones first tried, and a wrong name is refused
plainly: `getAvailableServiceResources` wants `start_date_time` and
`end_date_time` in its query, and `Available_TimeSlots` wants a body of
`date_time_range: { start, end }`, `duration` and `service_resources`.

**Neither answers leave, and FSM has nowhere we can write it.** The calls give
free time, never the reason time is not free. FSM does hold leave, in a
**`Time_Off`** module, and that module cannot be used through the API here:

- `GET /fsm/v1/Time_Off` answers **204**, which is this API's empty list: the
  module exists and holds nothing. `Shifts`, `Service_Resource_Shifts`, `Leaves`,
  `Holidays`, `Working_Hours`, `Availability` and `Service_Resource_Availability`
  all answer `400 INVALID_MODULE`, so they are not modules at all. `Crews` and
  `Trips` answer 204 as well.
- A create is refused first with `Time_Off_Type is missing` and then, with any
  value supplied, `Invalid value provided for Time_Off_Type`. It is a lookup, not
  a word we can choose.
- Its list cannot be read: `Time_Off_Types` and every spelling tried is
  `400 INVALID_MODULE`, and `GET /fsm/v1/settings/fields?module=Time_Off` is
  `401 OAUTH_SCOPE_MISMATCH` on this refresh token.

Time-off types are built in FSM's Setup screens, which the API does not reach —
the same wall as the workflow rules and the job-sheet template. So leave is
recorded on our side (`docs/decisions/0062-leave-on-the-dispatch-board.md`).

## Question 7, the Request's conversion: answered 24 September 2026

The blueprint transition **"Convert to Work Order" is a write of `Status` and
nothing else**, which is why it answers `SUCCESS` and leaves the Request with no
work order. The transitions list says so: `Cancel` and `Terminate` each declare a
mandatory `Notes` field, and `Convert to Work Order` declares **no fields at
all**. FSM's answer is `"message": "record updated"`.

What converts a Request is `POST /fsm/v1/Work_Orders` carrying a **`Request`**
field. Tried on our own test contact: 201, the work order came back naming the
Request, and the Request moved itself to "Work In Progress" with that work order
in its `Work_Orders`, with no blueprint call. Every record made for it was
labelled "Staging test" and deleted the same session
(`docs/decisions/0064-converting-a-request.md`).

## Text FSM keeps: tried 30 September 2026

Tried with the scripts' own token (`docs/runbook.md`, step 8.7) on records
already labelled "Staging test": contact `8229000000309607`, whose street was
put back as it was, and appointment AP-22, `8229000000306647`.

- **A service address's `Street_1` and `Street_2` take 255 characters each.**
  256 is refused: `400 INVALID_DATA` with `"maximum_length": 255`,
  `"api_name": "Street_1"` and `"parent_api_name": "Service_Address"`.
- **FSM keeps text only up to its first character past U+FFFF.** An emoji such
  as 🙏 or 🇮🇳, or 𝐁, in a street or a note is answered `200 SUCCESS`, and
  everything from it on is gone when read back: "ring 🙏 twice" is kept as
  "ring ". ✅, ❤️ and ★, which come before U+FFFF, are kept, as are Hindi, the
  rupee sign, curly quotes, newlines, and `<b>` and `&amp;` as typed.
- **An appointment takes notes.** `POST /fsm/v1/Service_Appointments/{id}/Notes`
  with `{ data: [{ Note_Content }] }` answers 201 with the note's ID under
  `data[0].details.id`; `GET` on the same path lists them, and
  `PUT /fsm/v1/Service_Appointments/{id}/Notes/{note id}` changes one. The
  appointment's note is listed under its work order's Notes too. A note of
  40,000 characters is kept whole, and a `Note_Title` beside it is kept.
- **An empty note blanks it.** `PUT` with `Note_Content: ""` answers 200, and
  the note reads back with no content.
- **A note cannot be deleted by the API.** `DELETE` on the note's path, on
  `/Notes/{id}` and with `?ids=` each answer `400 INVALID_MODULE`. What the
  erasure cannot delete it blanks (`docs/decisions/0099-the-clients-note-in-fsm.md`).

The one note made is left on AP-22, reading "Staging test: a client's note,
tried 30 September 2026", for the staging clean-up (`docs/open-points.md`,
item 19).
