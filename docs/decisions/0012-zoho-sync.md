# 0012. The Zoho sync

- Status: accepted
- Date: 2026-09-21

## Context

The `crm-sync` consumer is the only caller of Zoho. The prompt asks that the `lar_id` and trigger syntax be confirmed against Zoho's v8 documentation, and that a person with only a try-on consent is never chased.

## Zoho v8, as documented (read 21 September 2026)

- **Insert:** `POST {api}/crm/v8/Leads`, body `{ "data": [record], "lar_id": "...", "trigger": [...] }`. `lar_id` sits at the top level, beside `data`: "The unique ID of the assignment rule you want to trigger while inserting a record." Up to 100 records per call.
- **Trigger:** allowed values are `workflow`, `approval`, `blueprint`, `pathfinder` and `orchestration`. "If trigger is not mentioned, the automation actions related to the API will get executed." Workflows are switched off only by sending `[]`.
- **Update:** `PUT {api}/crm/v8/Leads/{id}`, body `{ "data": [record], "trigger": [...] }`.
- **Note:** `POST {api}/crm/v8/Leads/{id}/Notes`, body `{ "data": [{ "Note_Title", "Note_Content" }] }`.
- **Search:** `GET {api}/crm/v8/Leads/search?criteria=(D1_Person_ID:equals:{id})`. No match returns 204.
- **Token:** `POST {accounts}/oauth/v2/token?refresh_token=…&client_id=…&client_secret=…&grant_type=refresh_token`. Access tokens last an hour. The header is `Authorization: Zoho-oauthtoken {token}`.
- **Upsert** (`/Leads/upsert`) does not document `lar_id`, so it is not used.

## Decisions

**One Zoho record per person**, referenced by `people.zoho_lead_id`:

- A person's first lead inserts the record.
- Later leads update it and add a note giving the city, window and proposed date. Notes carry no name or number.
- Before inserting, the sync searches by `D1_Person_ID`. So a retry after Zoho accepted the insert, but before D1 recorded the ID, usually updates the record instead of inserting again.
- **`D1_Person_ID` is unique in Zoho** ("Do not allow duplicate values"). This is the real guarantee against duplicates. The search is not enough on its own: on staging, Zoho's search did not find a new record 25 seconds after it was created, and did by two minutes. An insert that races or repeats is refused with `DUPLICATE_DATA`, the lead is marked failed, and the next attempt finds the record and updates it. `scripts/check-zoho-setup.ts` fails if the field allows duplicates.

**Consent rules** live in `src/providers/crm-rules.ts`, outside the Zoho code, so they hold for any CRM:

| Case                                 | New record             | Update    | Assignment rule | Workflows              |
| ------------------------------------ | ---------------------- | --------- | --------------- | ---------------------- |
| Booking, contactable                 | New                    | New       | yes             | yes                    |
| Waitlist, contactable                | Waitlist               | unchanged | no              | yes                    |
| Try-on, contactable                  | New                    | unchanged | no              | yes                    |
| Anyone not contactable (try-on only) | Try-on — delivery only | unchanged | no              | **no** (`trigger: []`) |

Every implementation calls `assertStatusAllowed` before writing. It throws if a non-contactable person would get any status except delivery-only. `test/worker/crm-rules.test.ts` and `test/worker/zoho.test.ts` prove it.

**Field mapping** uses the design's words:

- `Last_Name` is the name. `Mobile`, `Email` and `City` are the standard fields.
- `Lead_Source` is Booking form, Waitlist or Try-on, set on insert only.
- `Lead_Status` follows the table above.
- Custom fields:
  - `First_Choice_Window`: Weekday morning, Weekday evening, Weekend morning or Weekend evening.
  - `Loss_Extent`: Crown thinning, Receding front or Advanced.
  - `Proposed_Visit_Date`: a date.
  - `Contact_Consent` and `Try_On`: checkboxes.
  - `D1_Lead_ID` and `D1_Person_ID`: text; `D1_Person_ID` is unique.
  - `UTM_Source` and `UTM_Campaign`: text.
- A try-on never overwrites booking details.

**Tokens** are cached in the one-row `zoho_token` table and refreshed a minute before expiry. On a 401 the token is refreshed once and the call repeated.

**Failures:**

- The consumer marks the lead `failed` and stores `Zoho {status} {code}: {message}`, scrubbed of numbers and e-mails. It never stores record data. A timeout is `Zoho 0 TIMEOUT: {step} got no answer within 20 s`.
- A lead's first failure goes back on the queue with a 30-second delay (`message.retry`), so a passing slowdown still lands the lead within about a minute.
- After that, the sweeper re-enqueues failed leads every five minutes until 10 attempts. The tenth failure raises an alert.
- The consumer asks for one batch at a time (`max_concurrency: 1`). That is not a guarantee: on staging, Queues started a second invocation while the first was still running (below). The unique `D1_Person_ID` keeps a race harmless. The worst outcome is an extra update and note on the same record, and a later `synced_at`.

**Timeouts and timing:** each Zoho request has 20 seconds. Every request is logged as `zoho_call` with its step, status and duration, never its URL (the token URL carries the client secret).

On staging on 21 September 2026, the first synced lead's token refresh timed out at the original 10-second limit. The sweeper delivered it five minutes later. The next two consumer runs took 16 and 18 seconds for three Zoho calls, though the same calls from Cloudflare's Delhi edge and from a laptop in India answered in under 200 ms. The consumer does not report where it runs, so the per-step timing is there to find out whether the time goes to Zoho or to D1.

With the timing in place, a normal sync took 2.4 seconds: about 0.9 s for the search, 0.4 s for the insert, and the rest in D1. One run then spent 8 min 40 s before its first Zoho call, which puts the time in its first D1 queries or in the platform. While it waited, Queues ran the next sweep's message in a second invocation (`docs/verification.md`, drill 1). The cause is not known. From inside the Worker, a slow D1 query and a paused invocation look the same. If it recurs, it goes to Cloudflare support with the invocation's time and version. Meanwhile the sweeper, the quick retry and the unique `D1_Person_ID` keep a stalled run from losing or duplicating a lead. It only delays one.

A longer timeout also matters for duplicates. If an insert times out after Zoho saved the record, the retry searches by `D1_Person_ID`, and Zoho's search index may not show the new record yet.

**Hosts** are secrets (`ZOHO_ACCOUNTS_HOST`, `ZOHO_API_HOST`). For Zoho's India data centre the accounts host is `accounts.zoho.in`. The API host depends on the environment of the org: `www.zohoapis.in` for a production org, `developer.zohoapis.in` for a Developer Edition org, `sandbox.zohoapis.in` for a sandbox. The `api_domain` in a token response always names the production host, so it cannot be trusted for the other two; a token used on the wrong host gets a bare 401.

**Scopes:** `ZohoCRM.modules.leads.ALL`, `ZohoCRM.modules.notes.CREATE` and `ZohoSearch.securesearch.READ` for the sync. Plus `ZohoCRM.settings.fields.READ` and `ZohoCRM.settings.assignment_rules.READ`, read-only, so `scripts/check-zoho-setup.ts` can confirm the org is set up as the sync expects.

## Consequences

- Zoho has no assignment rule on update. A try-on-only person who later books through the form gets the `New` status and `Contact_Consent = true` on their existing record. Assigning an owner at that point takes a Zoho workflow on edit (Contact_Consent becomes true), configured in Zoho. See the runbook.
- If Zoho is down for more than about 40 minutes (one quick retry, then eight sweeps), leads stop retrying and an alert fires. Replaying them is in the runbook.
