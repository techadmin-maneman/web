# 0059. A client's history, and where a customer lives in the CRM

- Status: accepted for the derivation, the ops console and the client app; the CRM half waits on the owner. Amended 25 September 2026: Home carries the prompt (section 4). Amended 4 October 2026 by [0110](0110-field-work-without-fsm.md): the history is read from our own database alone.
- Date: 2026-09-24
- Amends [0050](0050-crm-in-the-real-org.md), which moved the CRM to the real org and left every person in Leads

## Context

The owner asked whether the CRM holds a complete record of a customer — his details, how many times he was serviced, how many replacements he has bought. It does not, and until now nothing else did either. Every CRM call in this repository goes to `/crm/v8/Leads`; `LEAD_STATUSES` is a closed set of three (New, Waitlist, Try-on — delivery only); nothing marks a lead as converted. A client with a first fit and four services reads as "New", the same as yesterday's enquiry that never came back.

Their ruling: **"Do all 3. It needs to be in the CRM for marketing/retargeting, it needs to be on the ops dashboard for the ops team, and it needs to be in the client app as well for the clients."**

Then the correction that decides the shape of the third: **"Service history is of customers, not leads, right? Wouldn't the right approach be to convert relevant leads into customers and then store the data against it?"** A Lead is a pre-qualification record. A CRM full of "New" leads who are in fact four-visit clients breaks every standard report, view and segment the product gives them, which is what they want it for.

One person can have three identities: a CRM Lead (`people.zoho_lead_id`), an FSM Contact (`people.fsm_contact_id`), and a Books customer through the FSM contact's `ZBilling_Id`. ADR 0050 named the problem and deferred it: "FSM's contact and the CRM lead are the same person; keeping them apart makes ops read two orgs and blocks any later link between them."

## What the real org actually holds (read-only, 24 September 2026)

One access token, cached and reused, because Zoho mints only ten per ten minutes per refresh token. Nothing was created, changed or deleted. Only counts, field names and record IDs were read; no name, number, e-mail or address.

| Read                                                               | Answer                                                                                                                                                                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /crm/v8/settings/fields?module=Leads`                         | 64 fields, including our nine (`D1_Person_ID`, `D1_Lead_ID`, `Contact_Consent`, `Try_On`, `Loss_Extent`, `First_Choice_Window`, `Proposed_Visit_Date`, two UTM)                        |
| `GET /crm/v8/Leads` (ids and statuses only)                        | 15 leads. **None converted**: `Converted__s` and `Converted_Contact` empty on every one. New 4, Waitlist 1, and 10 moved by hand into Zoho's stock statuses                            |
| `GET /crm/v8/settings/fields?module=Contacts`                      | 60 fields, **every one stock Zoho**. No `D1_Person_ID`. No FSM field of any kind                                                                                                       |
| `GET /fsm/v1/Contacts` (ids only)                                  | Every one of the first 20 carries a **populated `ZCRM_Id`**, in the same org's id namespace as the CRM field ids (`1431113…`)                                                          |
| The CRM refresh token's scope                                      | `ZohoCRM.modules.leads.ALL ZohoCRM.modules.notes.CREATE ZohoSearch.securesearch.READ ZohoCRM.settings.fields.ALL ZohoCRM.settings.assignment_rules.READ ZohoCRM.settings.layouts.READ` |
| `GET /crm/v8/Contacts`, `/Accounts`, `/Deals`, `/settings/modules` | **401 `OAUTH_SCOPE_MISMATCH`**, all four                                                                                                                                               |

Three things follow, and together they settle the CRM question.

**The customer record already exists, and we did not make it.** FSM and CRM are the same Zoho org, and FSM's contact sync has already created the CRM-side record for every contact — including every contact our own `POST /fsm/v1/Contacts` created. `ZCRM_Id` is the link, and it is on our side of the join already: `people.fsm_contact_id` → FSM's contact → `ZCRM_Id`. Nothing has to be converted to produce a customer; one exists for every client we have. This also answers question 8 of `fsm-trial.md`, "how FSM links to Zoho Books and Zoho CRM": `ZBilling_Id` for Books, `ZCRM_Id` for CRM, both fields of the FSM contact. Which CRM module `ZCRM_Id` names could not be confirmed from this side, because the token cannot open it; the owner's console shows it in one click.

**Converting a lead would make a second record for one person.** Zoho's `POST /crm/v8/Leads/{id}/actions/convert` creates a new Contact from the Lead. It does not merge into a Contact that already exists, and it has no way to be told about one. Every fitted client would become two CRM records for one human being — the duplication the owner is trying to get rid of, doubled. Its `Deals` argument is optional and an Account is made from the Lead's `Company`, which ours never set; but none of that matters once the first record is a duplicate.

**And we could not write to either of them.** The token reaches Leads and nothing else. Worse than not being able to push the history: **erasure would break**. `erasePerson` blanks the Lead (ADR 0019). A Contact our token cannot reach is a person we cannot erase from the CRM, and the seven days ADR 0049 promises would be a promise about a record we have no way to touch. Converting today would trade a reporting problem for a DPDP one.

## Decision

### 1. One derivation, read by every surface

`src/domain/visits/client-history.ts` counts a client's record from the rows that already exist, at the moment someone looks, as board D2's tasks and board D1's money are. There is no counts table and there is not going to be one: a tally kept anywhere could drift from the visits behind it, and the client and ops would be told different numbers about the same person. One statement of scalar subqueries answers the whole record, so a client's page costs one D1 read however many visits they have had.

A visit done is a **completed** appointment with a window — the same rule `isFitted` and the client's own list of past visits already use. A visit FSM terminated did not happen and is counted nowhere.

| Figure                         | Derived from                                                   | What it cannot say                                                                                   |
| ------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| visits, services, replacements | `appointments` by `type`, completed, with a window             | —                                                                                                    |
| first fit                      | the earliest completed `first_fit`                             | **null**, not a date, for a client whose earlier visits FSM never held. That is not the same as none |
| last visit                     | the latest completed visit                                     | null before the first one                                                                            |
| lifetime spend                 | `payments.amount - refunded_amount` where captured, in paise   | GST included; a visit covered by a credit cost nothing and adds nothing                              |
| replacement due                | the piece in wear's `replacement_due_at` (`failed_at IS NULL`) | **null**, not a distant date, when the client is wearing no piece                                    |

**Could not be derived at all**, because nothing records them: the tier and the usual technician the design's page head draws, and how many pieces a client has bought outside a replacement _visit_. They stay part of open point 50.

A count of nought is written as a nought, because it is true. A figure the system cannot know is written in words — "No first fit on record", "No piece fitted, so no date" — never as a dash, a zero or a date. That rule is the standing lesson of the fabricated `0 m` on the no-show screen (PR #89) and the ₹0 dispute that did not exist (PR #100).

### 2. A replacement date is a promise the moment a client can read it, so the client is told a month

The owner ruled the replacement cycle to 180 days for every base on 24 September (open point 129), and `syncPieces` works `replacement_due_at` out afresh from FSM's `Installation_Date` on **every sync**. A day shown to a client can therefore move under them after they have read it, without anybody deciding to move it.

**The client is told the month and never the day.** The design had already reached the same answer without being asked to: board B1 of the Client App writes "Your replacement piece is due in March.", and the Ops Console's page head writes "Mar 2028". `GET /api/visits` answers the client `{ month: "2028-03" }` and carries no day at all, so no client-side change can leak one.

**Ops keep the day**, on the History tab and in the pieces table, because they order stock against a date and board D2's task queue already names one ("MM-STD-4417-C · due 1 Mar 2028"). The asymmetry is deliberate: ops act on the date, the client is being made a promise.

### 3. The ops console: a History tab, and the head's fifth line

`/clients/:id/history` stands after the three tabs the boards draw, because the design draws no History tab at all. It is rendered from the record the page has already loaded, so moving on to it costs **no request**, and the rule that moving between a client's tabs must not re-read the record is kept honest by the test that counts them.

The page head gains "Replacement due", the fifth of the five lines board B1 draws under the name, as a month and in brass. Three of the five are now answered; the tier and the usual technician are still recorded nowhere.

### 4. The client app: their own record, at the foot of Visits

The record sits **beneath** board C1's two lists rather than above them, so the board's own order stands where it is drawn and its fidelity pair still lines up row for row. Nothing is drawn at all until there is something true to say: a client with no visit and no piece sees C1 exactly as designed.

Board B1's Home prompt — the design's own place for the due line — is **not** built here. Filling it would put the history read on `/api/me`, the route the app calls every time it opens, for a line the client can also see one tap away on Visits. It stays with the credit tile as a known B1 departure.

**Amended 25 September 2026.** The departure was challenged: the front-end prompt's B1 requires "the credit tile with its expiry; one contextual prompt", and the audit found Home and Visits telling a newly fitted client different things. Both are built. The credit tile reads the balance `/api/me` already carried. The prompt is not the history read: `src/domain/clients/home-prompt.ts` answers it in one statement of its own — whether an address is given, the earliest piece in wear's due date, the latest invoice issued in a fortnight — and hands the client the month alone, as Visits does. `/api/me` gains that one statement and nothing else. The order of the three, and the fortnight, are ADR 0025, item 44.

### 5. The CRM is not changed, and this is what it is waiting for

Nothing in this change writes to Zoho, creates a Zoho field or adds a lead status. Guessing at the shape to keep the pull request whole would mean building on a record we cannot write to.

**Not the Lead.** History on a Lead is the thing the owner corrected.

**Not a conversion.** It would make a second CRM record for every client, and the one it made would be out of our reach.

**The Contact FSM has already made.** It exists, it is linked from a column we already hold, and it is where the standard reports look. Three things have to happen before anything can be written to it:

1. **A CRM refresh token with `ZohoCRM.modules.contacts.ALL`.** Only the owner can mint it, as a Self Client in `https://api-console.zoho.in` (provisioning, step 8). `ZohoCRM.settings.fields.ALL` is already held, so `scripts/ops/setup-crm.ts` can create the custom fields on Contacts as soon as the module can be written to. **Erasure must be extended in the same change**, never after it: a Contact we can write to is a Contact we must be able to blank, and `src/routes/erasure.ts` queues a blanking that today reaches Leads only.
2. **The owner's confirmation** that FSM's auto-created Contact is the customer record they mean, and what ops should then do with the Lead — leave it, or mark it so nobody works a client as a fresh enquiry.
3. **Counsel's ruling on the lawful basis**, below.

**When the push would happen, and what it costs.** A write per visit close is the obvious shape and the wrong one: it sits on the FSM webhook path, which is already the busiest; it rewrites six fields that barely move; and it would miss the replacement date entirely, because that changes on a piece sync and not on a visit close. Instead, **a pass on the existing five-minute cron**, beside the invoices and Books passes: take the clients whose history has changed since it was last pushed and write them in one call. Zoho CRM takes up to 100 records in one `PUT /crm/v8/Contacts`.

At the volumes the dispatch board plans — four technicians, about twenty finished visits a day — that is **one API call a day**, and never more than `ceil(changed / 100)` per pass. It mints no access token of its own: it runs inside the Worker that already caches one for the hour, so the ten-tokens-per-ten-minutes limit that has already cost this project refunded bookings is untouched. It needs one column to remember what was pushed, which is a migration deferred with the rest.

**Marketing is a different lawful basis from service, and the consents do not cover it.** Migration 0009 allows eight purposes: `contact`, `tryon_photo`, `result_delivery`, `photos_own_record`, `photos_referral_cards`, `photos_marketing`, `whatsapp_visits`, `whatsapp_launches`. `people.contactable` is the `contact` consent, given on the booking form so that ops may call and message about the service. The only purposes with marketing in them are about **photographs** — a photograph on a referral card, a photograph in our marketing — and `whatsapp_launches` is one message when an area opens.

**None of them is consent to be profiled for marketing.** Under the DPDP Act 2023, consent is for a specified purpose (s.6(1)) and the notice must say what the data will be used for (s.5). No notice we have shown anyone says that their visit count, replacement count and lifetime spend will be held in a CRM to segment or retarget them. So the figures **may not be pushed for retargeting on any consent we hold**, and the push is gated on a consent the client has not been asked for.

What the contact consent _would_ permit, and the only CRM change this ADR would allow without asking anyone anything new, is the plain fact that a person is a client rather than an enquiry. That makes our record of them accurate, which s.8(3) requires where the data is used to make a decision about them, and it **narrows** who gets chased rather than widening it. It is deliberately not built here, because whether it belongs on a Lead or a Contact is exactly what is waiting on the owner.

**If conversion is wanted anyway, the rule is the first completed first fit.** A booked consultation is a prospect; a booked first fit is still a prospect until the technician has been. `isFitted` already draws that line for both apps, so the CRM would use the same rule rather than inventing a second one. **A try-on-only lead never converts**, whatever else is true: `src/providers/crm/rules.ts` holds that a person with only a result-delivery consent is never chased, `assertStatusAllowed` is the last line of defence, and `test/worker/vendors/crm-rules.test.ts` pins it for every source. Conversion is one-way, so `people.zoho_lead_id` would stop being a Lead id and start being a Contact id; it gets a companion column saying which module it names, never an overload.

## Consequences

- **Three surfaces, one set of numbers.** A worker test reads both routes and asserts the shared figures are equal, so a client cannot be told one thing while ops are told another.
- **A client's page still costs what it cost.** The history is one more statement on `GET /api/clients/{id}`, and the History tab adds no request at all. `GET /api/visits` gains one statement. `/api/me`, the hottest route, was untouched by this change; Home's prompt has since added one small statement of its own (amended above, 25 September 2026).
- **A date that can move is never shown as a day to the person it is a promise to**, and the design agreed before it was asked.
- **The CRM is no worse than it was**, and now has a written account of why it is as it is. Erasure needs no extension in this change, and the reason it needs none is that nothing new was written to Zoho.
- **The Leads sync is unchanged**: the three statuses, the try-on rule and its tests all stand.
- **Open point 50 shrinks.** The pieces table and the replacement date are answered; the tier and the usual technician are still recorded nowhere.
- **Three new open points** carry what is left: the Contacts scope, the marketing consent, and the conversion ruling.
- **What is only reasoned, not proved:** that `ZCRM_Id` names a CRM **Contact** rather than some other module. Proving it needs either the owner's console or a token scope we do not have; converting a throwaway lead to find out would have left a Contact in the owner's real org that we could not delete.
