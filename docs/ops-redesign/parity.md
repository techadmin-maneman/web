# Ops console redesign: parity with today's console

Status: step 1 of the brief, `docs/prompts/ops-redesign.md`, done 22 Nov 2026 on `main` at 37d84511e. Adwate decided
every open item the same day (below and in `01-changes-for-approval.md`). The bugs in "Your notes from testing" are
fixed first, as their own batch, and then the redesign is built in the brief's PR order.

### Decided, 22 Nov 2026

- **D1:** keep the searched home with its map pin and the km reach, in the new form. No "Area they cover", no home
  pincode.
- **D2:** Book a visit offers "Anyone available (allotted the evening before)" first, with named technicians and their
  drive times below it. Picking one pins the visit. This is built after allotment phase 2 lands.
- **D3:** keep the whole custom-order flow (six states, send on WhatsApp, cancel, refund with its reasons) and add
  "Copy link".
- **D4:** access stays grant-based, as today. The prototype's role views are examples only.
- **D5:** the Dispatch day runs from the Day times settings, not a fixed 9 am to 8 pm.
- **D6:** make the Areas map interactive, with the Google Maps JavaScript API (pan, zoom, click a pincode). This is new
  work: an API key restricted to the console's origins, a content-security-policy change, and usage kept within
  Google's free monthly allowance.
- **D7:** A1–A9 and A11 are approved. A10 is approved in part: keep the rename warning and drop the format hint. A12
  is no change. Section C is built in full.
- **Testing notes:** reproduce and fix them before the redesign, as one bug batch.

How this was made, from the code rather than the prototype:

- Every API call the console makes: 316 calls, 204 of them writes, each traced to the screen that makes it
  (appendix below). A call is something a person can see or do, so a call with no home in the redesign is lost
  functionality.
- Every word the console shows: 5,164 strings from `apps/ops/src/content/`, each checked against the prototype's text
  (`parity-strings.tsv`, one row each, with `in_prototype` yes or no).
- Each control with no counterpart in the prototype was checked by hand against the prototype's screen it belongs to.
- Behaviour a screen can't show (allotment, payment links, the custom-order chain, access rules) was read in
  `src/`.

## Decisions that were needed

Each of these lost or changed something today's console does. The answers are under "Decided, 22 Nov 2026" above.

| #   | What                                        | Today (code)                                                                                                                                                                                                          | Prototype                                                                                                                                                                    | Recommendation                                                                                                                                                                                                    |
| --- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Where a technician works                    | A home address found by search, pinned on the map, and a reach in km around it (`POST /api/technicians/{id}/home`, `/reach`). Allotment phase 1 (#949, merged) scores visits by this km radius and its overflow ring. | "Area they cover" (Whole city or NCR zone) and a home pincode.                                                                                                               | Keep the searched home and the km reach in the new form. A pincode is too coarse for the radius and the drive estimate, and the zone choice has no meaning to allotment.                                          |
| D2  | Choosing the technician when booking        | "Anyone available" is a choice, and allotment phase 2 (in progress) keeps the technician a draft until the 6 pm lock. Ops placing a visit by hand pins it.                                                            | A "Technician" dropdown that starts on "Best available: Sandeep Yadav, 9 min".                                                                                               | Offer "Anyone available (we allot it the evening before)" first, with named technicians and their drive times below it, picking one pins it. Build this after allotment phase 2 lands, since both change booking. |
| D3  | Custom orders                               | Six states, sending the link on WhatsApp, cancel, and a refund with three reasons (see "Custom orders" below).                                                                                                        | Only "Awaiting payment", copying the link, and cancel.                                                                                                                       | Keep all of today's flow, and add the prototype's "Copy link". Confirm that "send on WhatsApp" stays.                                                                                                             |
| D4  | Who can do what                             | Access comes from each person's grants on the Staff page, checked by the server per call (`staff.may_call`).                                                                                                          | Six fixed role views (`DENY` in `design/ops-redesign-2026-11-22/prototype/src/core.js`). Finance can't see Dispatch or Messages, and Dispatch can't see Staff or Pay grades. | Keep today's grant model (B19). Treat the prototype's role views as examples only.                                                                                                                                |
| D5  | Dispatch day view hours                     | The day runs from the Day times settings, and a visit outside them still shows.                                                                                                                                       | A fixed 9 am to 8 pm.                                                                                                                                                        | Take the day's range from the settings. A fixed range would hide early or late visits.                                                                                                                            |
| D6  | Areas map                                   | A Google Static Maps picture (`/api/service-area/map`), so it can't be panned or clicked.                                                                                                                             | Not drawn.                                                                                                                                                                   | Keep the picture. Making it interactive is new work: it needs the Maps JavaScript API, a CSP change and its cost.                                                                                                 |
| D7  | The A items in `01-changes-for-approval.md` |                                                                                                                                                                                                                       |                                                                                                                                                                              | A1 to A12 each still need your yes or no.                                                                                                                                                                         |

### Corrections to `01-changes-for-approval.md`

- **C1, "Consultation and first fit" as a new visit type:** this exists today. It is the "one visit", booked as
  "Consultation and fit together" (`one_visit` on a booking). So it needs no new server type. What C1 adds is its own
  colour, filter chip and label on Dispatch.
- **C4, hair profile versions:** these exist today. Every version is kept, and `GET /api/clients/{id}/hair-profile`
  returns `latest` and `versions`. What C4 adds is the "was X" differences and opening an old version read-only.
- **A2, typed settings:** every setting is already typed on the server (a number with a minimum, maximum and unit, a
  choice, or an hour). So A2 changes only the screen, and no setting needs migrating.
- **A9, "Kit short":** `GET /api/stock/demand` already returns booked demand per place over a window (`days`). What A9
  needs is that window set to 4 weeks and shown per kit.

## Kept, though the prototype doesn't draw it (to add to section B)

The prototype has a home for each of these, being the screen or panel listed. Each is built there, restyled.

- **Shell**
  - The SOS banner over every screen, with "Mark handled".
  - "Your session has expired. Reload to sign in."
  - The banner shown to a person who isn't on the staff list.
  - The "a new version is ready" notice.
- **Tasks**
  - "Needs a hand" system alerts: CRM or Books erasure incomplete, CRM lead not updated, WhatsApp disconnected and
    scheduled job failing, each with "Send again" and "Resolve".
  - Resending a payment link and recording a UPI payment, from a task.
  - Approving or refusing a technician's leave request.
  - Each task kind's close form: what the kit showed, what was agreed, made to order "Ordered".
- **Dispatch**
  - Assigning from the "No technician" lane.
  - Proposing a new day to the client, and withdrawing it.
  - "Told them by phone".
  - "Move anyway" and "Move and notify".
  - The visit's story (arrived, started, checklist, signed off, closed), with "Send back".
  - The board refreshing when it changes.
- **Client page**
  - Closing a visit by hand (outcome, finished at).
  - The reason a lead was lost.
  - Adding or removing free service visits.
  - Invoices.
  - The payment links list and its states.
  - "How they heard of us" from a call.
  - Alerts for technicians: raise and take off.
- **Messages**
  - The photos a client sent with a report.
  - Linking a chat to a client, and saving an unknown number as a client.
  - Raising a city matter.
  - "Show older chats".
- **Care team**
  - Days off, leave, the name clients see, on or off shift, and moving all of a person's clients.
- **Cities**
  - A city's own rules, overriding national ones, and resetting them to national.
  - City prices, added and withdrawn.
  - GST registrations with their Books branch.
  - Zones: add, rename, delete.
- **Areas**
  - Pausing the service area, with its impact.
  - Scheduling and cancelling a launch, its readiness check, and "Launch anyway".
  - Telling those waiting, the reach check, and "next to open".
  - The ten-district limit on the directory.
- **Purchasing**
  - Sending an order.
  - Closing an order short.
  - The receipt's exchange rate, freight, customs duty and clearing, and a photo.
  - Claims: send, withdraw, settle.
  - Returned pieces: claim or write off.
- **Stock**
  - Adding hair-system pieces (units) and labelling a lot.
  - Finding a piece by its code.
  - Transfers in transit: receive or send back.
- **Technicians**
  - Revoking a phone, and allowing sign-in again.
  - Cancelling leave.
  - Reassigning a switched-off technician's visits on the board.
- **Money**
  - Partner payouts (record, delete) and the statement download.
  - Technician pay statement by month.
  - The charge preview before charging a no-show.
- **Settings**
  - Withdrawing a scheduled change to day times or a price.
  - Restoring a retired item or supplier.
  - Generating discount codes in bulk.
  - The job sheet's four reason lists.
  - Staff enforcement on and off, and service tokens.
  - Words: history and "Back to the code's wording".

## Custom orders, end to end

Today's flow (ADR 0174, `src/domain/purchasing/custom-orders.ts`), and where each step lives in the redesign.

| Step                   | Today                                                                                                                                                                                                                                         | Redesign home                                        | Status                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------- |
| 1. Check stock first   | "Stock that matches" on the Hair systems tab (`GET /api/clients/{id}/stock-match`)                                                                                                                                                            | Hair systems tab, Stock that matches                 | Drawn                                                                       |
| 2. Raise               | "Raise a custom order", made to the latest hair profile: supplier, supplier's price, price to the client, promised by, wave, note. "Raise and send the link" sends the payment link on WhatsApp. It is refused until the profile is complete. | Hair systems tab, "Raise a custom order" panel       | Drawn. Its button must keep "and send the link" (D3).                       |
| 3. Awaiting payment    | The client pays in full by link, shown in the client app's home card (`pay_url`). Ops see the link and "Send link again", but only while it has never been sent (`CustomOrders.tsx:83`).                                                      | Custom orders card: "Payment link"                   | The prototype copies the link. Keep send and add copy (D3).                 |
| 4. Paid, being ordered | On payment it is ordered on a purchase order of its own (`custom-order-po.ts`).                                                                                                                                                               | Inventory › Purchasing                               | Not drawn: the order list must show the custom order's PO and its CU number |
| 5. Ordered             | The PO is approved and sent like any order. "Late" comes from the setting "A custom order is late, past its promised date, after 7 days".                                                                                                     | Purchasing; Settings › Inventory › Purchasing        | Drawn (the setting is in the prototype)                                     |
| 6. Arrived             | The receipt brings the piece in and reserves it for the client (`receipts.ts`, migration 0148).                                                                                                                                               | Purchasing receipt; Stock                            | Not drawn                                                                   |
| 7. Fit                 | A "Made to order" task asks ops to book the fit with the reserved piece.                                                                                                                                                                      | Tasks (the kind is in the prototype's task settings) | Drawn as a kind; its close action "Ordered" isn't drawn                     |
| 8. Refund or cancel    | Cancel while unpaid (the link stops working). "Refund in full" with a reason: not yet ordered, supplier late past the grace, or failed its check.                                                                                             | Custom orders card                                   | Cancel drawn. Refund not drawn: keep it.                                    |

## Your notes from testing

These are about today's console. I read the code for each, but **none is reproduced yet**. Per the repo rules, each
gets reproduced and its cause confirmed before any fix, as a separate bug batch rather than inside the redesign PRs.

1. **"It says payment link is open, but the customer does not see anything."** Two leads, both unconfirmed:
   - The console shows the link from `short_url`, but the client app shows its pay link only when `pay_url` is set
     (`apps/app/src/home/CustomOrderCard.tsx:23`). If the two can differ, ops see an open link that the client never
     gets.
   - "Send link again" disappears once the link was sent once, so ops can't re-send a link that didn't arrive.
2. **"Custom order flow is broken; nothing to do after placing the order."** By design, after raising, the next step
   is the client paying: until then, ops can only send again (see 1) or cancel. The screen doesn't say what happens
   next. Reproduce to see whether something else stops.
3. **"Custom order into the warehouse is not working."** The custom order's arrival is in `src/domain/purchasing/receipts.ts`.
   Reproduce with a paid order through its PO's receipt.
4. **"Already booked, or a payment link is open for one", when booking.** This refusal fires when the client already has
   a visit of that kind still to come, or a booking of that kind held on an unpaid payment link until its grace ends
   (`visit-booking.ts`, `alreadyToCome` and `linkStillOpen`). The message doesn't say which, or how to clear it. Likely
   fix: name the visit or the open link, and offer to release the held booking. Confirm by reproducing.
5. **"Technician slots: earliest available slot is 9:30."** Not yet traced. Candidates are the Day times setting, the
   first drive from home, or the lead time for today. Reproduce on staging with the settings in force.
6. **"Area they cover for technician."** This is D1.
7. **"Are places added automatically when technicians, cities or zones are added?"**
   - A technician's kit: yes. A database trigger creates it when the technician is added (`technicians_kit`, migration
     0133).
   - Cities and zones: no. Hubs (per zone) and stockrooms (per city) are added by hand on Stock › Places.
8. **"The map in Settings › Business › Areas is not interactable."** It's a static picture by design. This is D6.

## Server changes the new features need

The smallest change for each, and only where something is missing:

| Feature                                    | Today                                                                                        | Change                                                                                                                                                                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Technician start date (C5)                 | None                                                                                         | Migration: `ALTER TABLE technicians ADD COLUMN started_on TEXT` (an ISO date, null for those already on the roster). Add it to `GET`/`POST`/`PATCH /api/technicians`.                                                           |
| Hair profile versions (C4)                 | Exist (ADR 0106; latest and versions returned)                                               | None                                                                                                                                                                                                                            |
| Consultation and first fit (C1)            | Exists (`one_visit`)                                                                         | None. Dispatch reads the flag to colour and filter it.                                                                                                                                                                          |
| Retire and delete (A11)                    | Packages: retire, restore, delete. Discount codes: off, delete. Cities and pincodes: delete. | Hair systems: add a retire and sell-again route, plus a `retired_at` column on the stock code (one migration). The linked-record checks on delete (cities, pincodes, codes) need confirming route by route before A11 is built. |
| Discount code uses (C9)                    | Totals only (`GET /api/discount-codes`)                                                      | A read route listing each use (client, visit, amount, day). This is a query over the bookings that carry the code, so no migration.                                                                                             |
| Reorder level per item                     | Exists: an item's "low at" for kit, hub and warehouse, and a hair system's reorder levels    | None                                                                                                                                                                                                                            |
| Booked use per kit, next 4 weeks (A9, C10) | `GET /api/stock/demand` (`days`, `demand`, `at_risk`)                                        | A 4-week window, per kit, with who needs what. Extend the read; no migration.                                                                                                                                                   |

No other server rule changes.

## Appendix: every call the console makes, by screen

Status key:

- **Drawn:** the prototype shows this control.
- **Not drawn:** the prototype has the screen or panel but not this control. It is built there.
- **A# or D#:** changed by an approved change, or waiting on a decision above.

The full word inventory is in `parity-strings.tsv`.

### Shell (header, search, SOS) and shared reads

| Call                                 | What it does (code name) | Used in                                           | Status                                                                             |
| ------------------------------------ | ------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `POST /api/clients/find`             | findClients              | Stranger.tsx, FindClientScreen.tsx, Search.tsx    | Keep: drawn                                                                        |
| `POST /api/dispatch/moves/{id}/told` | toldByPhone              | useBoardCalls.ts, CallAboutMove.tsx               | Keep: not drawn in the prototype, build it in its home                             |
| `POST /api/sos/{id}/handled`         | sosHandled               | SosBanner.tsx                                     | Keep: not drawn in the prototype, build it in its home                             |
| `GET /api/clients/{id}`              | client                   | ChatClient.tsx, ClientPanel.tsx, QuickReplies.tsx | Keep: drawn                                                                        |
| `GET /api/sos`                       | openSos                  | SosBanner.tsx                                     | Keep: not drawn in the prototype, build it in its home                             |
| `GET /api/stock`                     | stock                    | OnHand.tsx, RecordMovement.tsx, StockForm.tsx     | A8: opens on the warehouse; 'Whose stock' picker; 'Every place, side by side' kept |
| `GET /api/tasks`                     | tasks                    | ClientList.tsx, OpenTasks.tsx, CountsScreen.tsx   | Keep: drawn                                                                        |
| `GET /api/tasks`                     | tasksWithLapsed          | TasksScreen.tsx                                   | Keep: drawn                                                                        |
| `GET /api/technicians`               | roster                   | ChatClient.tsx, Search.tsx                        | Keep: drawn                                                                        |
| `GET /api/whoami`                    | whoami                   | access.ts                                         | Keep: drawn                                                                        |

### Reports › Activity

| Call                | What it does (code name) | Used in            | Status      |
| ------------------- | ------------------------ | ------------------ | ----------- |
| `GET /api/activity` | activity                 | ActivityScreen.tsx | Keep: drawn |

### Settings › Business › Areas; Growth › Waitlist

| Call                                     | What it does (code name) | Used in                                        | Status                                                 |
| ---------------------------------------- | ------------------------ | ---------------------------------------------- | ------------------------------------------------------ |
| `POST /api/pincode-launches`             | schedule                 | Chosen.tsx, Launches.tsx, activity.ts          | Keep: drawn                                            |
| `POST /api/pincode-launches/{id}/cancel` | cancelLaunch             | Launches.tsx                                   | Keep: not drawn in the prototype, build it in its home |
| `POST /api/pincodes`                     | addPincode               | AddPincode.tsx                                 | Keep: drawn                                            |
| `DELETE /api/pincodes/{pin}`             | deletePincode            | PincodeDrawer.tsx                              | A11                                                    |
| `POST /api/pincodes/{pin}/launch`        | launch                   | LaunchPanel.tsx, NotReady.tsx, ServedParts.tsx | Keep: drawn                                            |
| `POST /api/pincodes/from-directory`      | addFromDirectory         | OpenCity.tsx                                   | Keep: drawn                                            |
| `POST /api/service-area`                 | setServiceArea           | useAreaSaves.ts                                | Keep: drawn                                            |
| `POST /api/service-area/pause`           | pause                    | Chosen.tsx, Launches.tsx, ServedParts.tsx      | Keep: not drawn in the prototype, build it in its home |
| `GET /api/pincode-demand/next`           | nextToOpen               | Demand.tsx                                     | Keep: drawn                                            |
| `GET /api/pincode-directory/districts`   | districts                | OpenCity.tsx                                   | Keep: drawn                                            |
| `GET /api/pincode-directory/pincodes`    | directory                | OpenCity.tsx                                   | Keep: drawn                                            |
| `GET /api/pincode-directory/states`      | states                   | Launches.tsx, OpenCity.tsx, Remedies.tsx       | Keep: drawn                                            |
| `GET /api/pincode-launches`              | launches                 | Chosen.tsx, Launches.tsx                       | Keep: drawn                                            |
| `GET /api/pincode-launches/readiness`    | readiness                | Launches.tsx, Reach.tsx                        | Keep: not drawn in the prototype, build it in its home |
| `GET /api/pincode-launches/recent`       | recentLaunches           | Demand.tsx                                     | Keep: drawn                                            |
| `GET /api/service-area`                  | serviceArea              | Served.tsx                                     | Keep: drawn                                            |
| `GET /api/service-area/reach`            | reach                    | Reach.tsx, activity.ts, TechnicianHours.tsx    | Keep: drawn                                            |
| `GET /api/service-area/stop-impact`      | stopImpact               | Chosen.tsx                                     | Keep: not drawn in the prototype, build it in its home |
| `GET /api/waitlist`                      | waitlist                 | Waiting.tsx                                    | Keep: drawn                                            |

### Growth › Campaign links

| Call                                   | What it does (code name) | Used in                                                            | Status      |
| -------------------------------------- | ------------------------ | ------------------------------------------------------------------ | ----------- |
| `POST /api/campaign-links`             | add                      | AddPincode.tsx, OpenCity.tsx, Served.tsx                           | Keep: drawn |
| `POST /api/campaign-links/{id}/retire` | retire                   | CampaignLinksScreen.tsx, activity.ts, Retirement.tsx               | A11         |
| `GET /api/campaign-links`              | list                     | CampaignLinkForms.tsx, CampaignLinksScreen.tsx, MessagesScreen.tsx | Keep: drawn |

### Messages; Settings › Care; Reports › Care numbers; client page

| Call                                        | What it does (code name) | Used in                                              | Status                                                 |
| ------------------------------------------- | ------------------------ | ---------------------------------------------------- | ------------------------------------------------------ |
| `POST /api/care-team/days-off`              | setDaysOff               | CareTeam.tsx                                         | Keep: drawn                                            |
| `POST /api/care-team/leave`                 | addLeave                 | CareTeam.tsx                                         | Keep: drawn                                            |
| `POST /api/care-team/leave/{id}/delete`     | deleteLeave              | CareTeam.tsx                                         | Keep: drawn                                            |
| `POST /api/care-team/move-all`              | moveAllClients           | CareTeam.tsx                                         | Keep: not drawn in the prototype, build it in its home |
| `POST /api/care-team/name`                  | setCareName              | CareTeam.tsx                                         | Keep: drawn                                            |
| `POST /api/care-team/shift`                 | setOnShift               | CareTeam.tsx                                         | Keep: drawn                                            |
| `POST /api/clients/{id}/care-person`        | moveCarePerson           | CarePerson.tsx                                       | Keep: drawn                                            |
| `POST /api/clients/{id}/remedies`           | giveRemedy               | Remedies.tsx                                         | Keep: drawn                                            |
| `POST /api/conversations/{id}/city-matter`  | raiseCityMatter          | CityMatter.tsx                                       | Keep: drawn                                            |
| `POST /api/conversations/{id}/close`        | closeChat                | Composer.tsx                                         | Keep: drawn                                            |
| `POST /api/conversations/{id}/link`         | linkChat                 | Stranger.tsx                                         | Keep: drawn                                            |
| `POST /api/conversations/{id}/notes`        | noteChat                 | Composer.tsx                                         | Keep: drawn                                            |
| `POST /api/conversations/{id}/replies`      | replyChat                | Composer.tsx                                         | Keep: drawn                                            |
| `POST /api/conversations/{id}/save`         | saveStranger             | Stranger.tsx                                         | Keep: drawn                                            |
| `POST /api/quick-replies`                   | addQuickReply            | QuickReplies.tsx                                     | Keep: drawn                                            |
| `PATCH /api/quick-replies/{id}`             | changeQuickReply         | QuickReplies.tsx                                     | Keep: drawn                                            |
| `POST /api/quick-replies/{id}/retire`       | retireQuickReply         | QuickReplies.tsx                                     | Keep: drawn                                            |
| `POST /api/remedies/{id}/approve`           |                          | (shared)                                             | Keep: drawn                                            |
| `POST /api/remedies/{id}/decline`           |                          | (shared)                                             | Keep: drawn                                            |
| `GET /api/care-numbers`                     | careNumbers              | CareNumbersScreen.tsx                                | Keep: drawn                                            |
| `GET /api/care-team`                        | careTeam                 | CarePerson.tsx, CareTeam.tsx                         | Keep: drawn                                            |
| `GET /api/conversations`                    | conversations            | ClientChat.tsx, MessagesScreen.tsx, CareHome.tsx     | A7: 'My clients' view renamed 'Mine'                   |
| `GET /api/conversations/{id}`               | conversation             | MessagesScreen.tsx, Thread.tsx                       | Keep: drawn                                            |
| `GET /api/conversations/{id}/report-photos` | reportPhotos             | ReportPhotos.tsx                                     | Keep: not drawn in the prototype, build it in its home |
| `GET /api/quick-replies`                    | quickReplies             | QuickReplies.tsx                                     | Keep: drawn                                            |
| `GET /api/remedies`                         | remedies                 | CareNumbersScreen.tsx, Remedies.tsx, HairProfile.tsx | Keep: drawn                                            |

### Settings › Business › Cities

| Call                                                          | What it does (code name) | Used in                                   | Status                                                 |
| ------------------------------------------------------------- | ------------------------ | ----------------------------------------- | ------------------------------------------------------ |
| `POST /api/cities`                                            | addCity                  | CityForm.tsx                              | Keep: drawn                                            |
| `DELETE /api/cities/{name}`                                   | deleteCity               | CityRecord.tsx                            | A11 delete only while nothing is linked                |
| `PATCH /api/cities/{name}`                                    | changeCity               | CityRecord.tsx                            | A10 helper lines removed; C7 a panel per city          |
| `POST /api/cities/{name}/prices`                              | addPrice                 | CityPrices.tsx                            | Keep: not drawn in the prototype, build it in its home |
| `DELETE /api/cities/{name}/prices/{item}/{tier}/{valid_from}` | removePrice              | CityPrices.tsx                            | Keep: not drawn in the prototype, build it in its home |
| `DELETE /api/cities/{name}/rules/{rule}`                      | removeRule               | CityRecord.tsx                            | Keep: not drawn in the prototype, build it in its home |
| `PATCH /api/cities/{name}/rules/{rule}`                       | setRule                  | CityRecord.tsx                            | Keep: not drawn in the prototype, build it in its home |
| `POST /api/gst-registrations`                                 | addGstRegistration       | Registrations.tsx                         | Keep: drawn                                            |
| `DELETE /api/gst-registrations/{state_code}`                  | removeGstRegistration    | Registrations.tsx                         | Keep: drawn                                            |
| `POST /api/zones`                                             | addZone                  | Zones.tsx                                 | Keep: drawn                                            |
| `PATCH /api/zones/{name}`                                     | renameZone               | Zones.tsx                                 | Keep: drawn                                            |
| `DELETE /api/zones/{name}`                                    | deleteZone               | Zones.tsx                                 | Keep: drawn                                            |
| `GET /api/cities`                                             | cities                   | OpenCity.tsx, Served.tsx, ServedParts.tsx | Keep: drawn                                            |

### Clients; client page; Book a visit

| Call                                                | What it does (code name) | Used in                                    | Status                                                                                                                                                         |
| --------------------------------------------------- | ------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/clients/{id}/address`                    | saveGivenAddress         | GivenAddress.tsx                           | Keep: drawn                                                                                                                                                    |
| `POST /api/clients/{id}/address/suggestions`        | addressSuggestions       | GivenAddress.tsx                           | Keep: drawn                                                                                                                                                    |
| `POST /api/clients/{id}/alerts`                     | raiseClientAlert         | ClientAlerts.tsx                           | Keep: drawn                                                                                                                                                    |
| `POST /api/clients/{id}/alerts/{alert_id}/take-off` | takeOffClientAlert       | ClientAlerts.tsx                           | Keep: drawn                                                                                                                                                    |
| `POST /api/clients/{id}/credits`                    | adjustCredits            | Payments.tsx                               | Keep: not drawn in the prototype, build it in its home                                                                                                         |
| `POST /api/clients/{id}/custom-orders`              | raiseCustomOrder         | RaiseCustomOrder.tsx                       | Keep: drawn                                                                                                                                                    |
| `POST /api/clients/{id}/erasure`                    | eraseClient              | Erase.tsx                                  | Keep: drawn                                                                                                                                                    |
| `POST /api/clients/{id}/hair-profile`               | correctHairProfile       | HairProfile.tsx                            | Keep: drawn                                                                                                                                                    |
| `POST /api/clients/{id}/heard-from`                 | setHeardFrom             | FoundUs.tsx                                | Keep: drawn                                                                                                                                                    |
| `POST /api/clients/{id}/notes`                      | writeStaffNote           | StaffNotes.tsx                             | Keep: drawn                                                                                                                                                    |
| `POST /api/clients/{id}/notes/{note_id}/take-off`   | takeOffStaffNote         | StaffNotes.tsx                             | Keep: drawn                                                                                                                                                    |
| `POST /api/clients/{id}/package`                    | setPackage               | ClientPackage.tsx                          | Keep: drawn                                                                                                                                                    |
| `POST /api/clients/{id}/photos/view`                | openPhotos               | Photos.tsx                                 | Keep: not drawn in the prototype, build it in its home                                                                                                         |
| `POST /api/clients/{id}/pieces/{code}/failure`      | markPieceFailed          | PieceFailure.tsx                           | Keep: drawn                                                                                                                                                    |
| `DELETE /api/clients/{id}/pieces/{code}/failure`    | undoPieceFailure         | PieceFailure.tsx                           | Keep: drawn                                                                                                                                                    |
| `POST /api/clients/{id}/referral`                   | attachInvite             | Invite.tsx                                 | Keep: drawn                                                                                                                                                    |
| `POST /api/clients/{id}/stop-sharing`               | stopSharing              | FoundUs.tsx                                | Keep: drawn                                                                                                                                                    |
| `POST /api/custom-orders/{id}/cancel`               | cancelCustomOrder        | CustomOrders.tsx                           | Keep: drawn                                                                                                                                                    |
| `POST /api/custom-orders/{id}/refund`               | refundCustomOrder        | CustomOrders.tsx                           | Keep: not drawn in the prototype, build it in its home                                                                                                         |
| `POST /api/custom-orders/{id}/send-link`            | sendCustomOrderLink      | CustomOrders.tsx                           | Keep: not drawn in the prototype, build it in its home                                                                                                         |
| `POST /api/leads/call`                              | leadFromCall             | CallLead.tsx                               | A6: renamed 'Add a client', pincode added                                                                                                                      |
| `POST /api/payments/{id}/refund`                    | refundPayment            | RefundPayment.tsx                          | Keep: drawn                                                                                                                                                    |
| `POST /api/visits`                                  | bookVisit                | BookVisit.tsx                              | Decision D2                                                                                                                                                    |
| `POST /api/visits/{id}/cancel`                      | cancelTerms              | CancelVisit.tsx                            | Keep: drawn                                                                                                                                                    |
| `POST /api/visits/{id}/cancel`                      | cancelVisit              | CancelVisit.tsx                            | Keep: drawn                                                                                                                                                    |
| `POST /api/visits/{id}/close`                       | closeVisit               | CloseVisit.tsx                             | Keep: not drawn in the prototype, build it in its home                                                                                                         |
| `POST /api/visits/{id}/discount-code`               | enterVisitCode           | VisitCode.tsx                              | Keep: drawn                                                                                                                                                    |
| `POST /api/visits/{id}/discount-code/remove`        | removeVisitCode          | VisitCode.tsx                              | Keep: drawn                                                                                                                                                    |
| `POST /api/visits/{id}/lost-reason`                 | setLostReason            | LostReason.tsx                             | Keep: not drawn in the prototype, build it in its home                                                                                                         |
| `GET /api/clients`                                  | clientList               | ClientList.tsx                             | Keep: drawn                                                                                                                                                    |
| `GET /api/clients/{id}/alerts`                      | clientAlerts             | ClientAlerts.tsx                           | Keep: drawn                                                                                                                                                    |
| `GET /api/clients/{id}/attribution`                 | attribution              | FoundUs.tsx, GivenAddress.tsx              | Keep: drawn                                                                                                                                                    |
| `GET /api/clients/{id}/consents`                    | clientConsents           | Consents.tsx                               | Keep: drawn                                                                                                                                                    |
| `GET /api/clients/{id}/custom-orders`               | customOrders             | CustomOrders.tsx                           | Keep: drawn                                                                                                                                                    |
| `GET /api/clients/{id}/hair-profile`                | clientHairProfile        | HairProfile.tsx                            | Keep: drawn                                                                                                                                                    |
| `GET /api/clients/{id}/notes`                       | staffNotes               | StaffNotes.tsx                             | Keep: drawn                                                                                                                                                    |
| `GET /api/clients/{id}/photos`                      | clientPhotos             | Photos.tsx                                 | Keep: drawn                                                                                                                                                    |
| `GET /api/clients/{id}/pieces`                      | clientPieces             | AtFault.tsx, PieceFailure.tsx, Pieces.tsx  | Keep: drawn                                                                                                                                                    |
| `GET /api/clients/{id}/stock-match`                 | stockMatch               | StockMatch.tsx                             | Keep: drawn                                                                                                                                                    |
| `GET /api/dispatch`                                 | board                    | DayBoard.tsx, DispatchScreen.tsx, Grid.tsx | Keep: drawn                                                                                                                                                    |
| `GET /api/tasks`                                    | clientTasks              | OpenTasks.tsx                              | Keep: drawn                                                                                                                                                    |
| `GET /api/visits/availability`                      | visitAvailability        | BookVisit.tsx                              | Decision D2: prototype picks 'Best available: <name>' at booking; today 'Anyone available' is allowed (and allotment phase 2 drafts the technician until 6 pm) |

### Inventory › Counts

| Call                                       | What it does (code name) | Used in                       | Status      |
| ------------------------------------------ | ------------------------ | ----------------------------- | ----------- |
| `POST /api/consumables/{code}/count-class` | setCountClass            | CountClasses.tsx              | Keep: drawn |
| `POST /api/count-tasks`                    | startCount               | StartCount.tsx                | Keep: drawn |
| `POST /api/count-tasks/{id}/counts`        | recordCounts             | CountTask.tsx                 | Keep: drawn |
| `POST /api/count-tasks/{id}/recounts`      | askRecount               | CountTask.tsx                 | Keep: drawn |
| `POST /api/count-tasks/{id}/sign-off`      | signOff                  | CountTask.tsx, VisitStory.tsx | Keep: drawn |
| `GET /api/count-tasks`                     | countTasks               | CountsScreen.tsx              | Keep: drawn |
| `GET /api/count-tasks/{id}`                | countTask                | CountTask.tsx                 | Keep: drawn |
| `GET /api/count-tasks/{id}/differences`    | differences              | CountTask.tsx                 | Keep: drawn |

### Requests › Deletion requests

| Call                                        | What it does (code name) | Used in             | Status      |
| ------------------------------------------- | ------------------------ | ------------------- | ----------- |
| `POST /api/deletion-requests/{id}/decision` | decideDeletion           | DeletionsScreen.tsx | Keep: drawn |
| `GET /api/deletion-requests`                | deletionRequests         | DeletionsScreen.tsx | Keep: drawn |

### Settings › Prices › Discount codes

| Call                                   | What it does (code name) | Used in                                                 | Status                        |
| -------------------------------------- | ------------------------ | ------------------------------------------------------- | ----------------------------- |
| `POST /api/discount-codes`             | makeDiscountCodes        | DiscountCodeForm.tsx                                    | Keep: drawn                   |
| `PATCH /api/discount-codes/{id}`       | changeDiscountCode       | DiscountCodeForm.tsx                                    | Keep: drawn                   |
| `POST /api/discount-codes/{id}/delete` | deleteDiscountCode       | CodeRecord.tsx                                          | A11                           |
| `POST /api/discount-codes/{id}/off`    | switchOffDiscountCode    | CodeRecord.tsx                                          | A11: 'Retire' in the redesign |
| `GET /api/discount-codes`              | discountCodes            | CodeRecord.tsx, discount-draft.ts, DiscountCodeForm.tsx | Keep: drawn                   |

### Dispatch (day, week, visit panel, move)

| Call                                         | What it does (code name) | Used in                                     | Status                                                 |
| -------------------------------------------- | ------------------------ | ------------------------------------------- | ------------------------------------------------------ |
| `POST /api/dispatch/assign`                  | assign                   | filters.ts, activity.ts, DispatchScreen.tsx | Keep: drawn                                            |
| `POST /api/dispatch/move`                    | move                     | CarePerson.tsx, CareTeam.tsx, activity.ts   | Keep: drawn                                            |
| `POST /api/dispatch/proposals/{id}/withdraw` | withdrawProposal         | useBoardCalls.ts                            | Keep: not drawn in the prototype, build it in its home |
| `POST /api/dispatch/propose`                 | propose                  | useMove.ts                                  | Keep: drawn                                            |
| `POST /api/visits/{id}/let-in`               | letIn                    | BlockDrawer.tsx, ChangePanel.tsx, LetIn.tsx | Keep: drawn                                            |
| `POST /api/visits/{id}/send-back`            | sendBack                 | SendBack.tsx, VisitStory.tsx, InTransit.tsx | Keep: not drawn in the prototype, build it in its home |
| `GET /api/dispatch`                          | board                    | DayBoard.tsx, DispatchScreen.tsx, Grid.tsx  | Keep: drawn                                            |
| `GET /api/dispatch/day`                      | dispatchDay              | DayRoutes.tsx                               | Keep: drawn                                            |
| `GET /api/dispatch/room`                     | room                     | rooms.ts, Suggestions.tsx                   | Keep: not drawn in the prototype, build it in its home |
| `GET /api/dispatch/version`                  | boardVersion             | useBoard.ts                                 | Keep: not drawn in the prototype, build it in its home |
| `GET /api/visits/{id}/story`                 | story                    | SendBack.tsx, VisitStory.tsx                | Keep: not drawn in the prototype, build it in its home |

### Growth › Funnel

| Call                          | What it does (code name) | Used in          | Status      |
| ----------------------------- | ------------------------ | ---------------- | ----------- |
| `GET /api/growth/acquisition` | acquisition              | FunnelScreen.tsx | Keep: drawn |

### Requests › Concerns

| Call                                | What it does (code name) | Used in                            | Status      |
| ----------------------------------- | ------------------------ | ---------------------------------- | ----------- |
| `POST /api/grievances/{id}/resolve` | resolveGrievance         | GrievancesScreen.tsx               | Keep: drawn |
| `GET /api/grievances`               | grievances               | GrievancesScreen.tsx, CityHome.tsx | Keep: drawn |

### Inventory › Items

| Call                                   | What it does (code name) | Used in                                                   | Status                                                 |
| -------------------------------------- | ------------------------ | --------------------------------------------------------- | ------------------------------------------------------ |
| `POST /api/consumables`                | addConsumable            | ConsumableForm.tsx                                        | Keep: drawn                                            |
| `POST /api/consumables/{code}`         | changeConsumable         | ConsumableRecord.tsx, HairSystems.tsx                     | Keep: drawn                                            |
| `POST /api/consumables/{code}/delete`  | deleteConsumable         | ConsumableRecord.tsx, HairSystems.tsx                     | Keep: drawn                                            |
| `POST /api/consumables/{code}/restore` | restoreConsumable        | Retirement.tsx, HairSystems.tsx                           | Keep: not drawn in the prototype, build it in its home |
| `POST /api/consumables/{code}/retire`  | retireConsumable         | Retirement.tsx, HairSystems.tsx                           | Keep: drawn                                            |
| `POST /api/hair-systems`               | addHairSystem            | HairSystems.tsx                                           | Keep: drawn                                            |
| `POST /api/service-usage`              | setServiceUsage          | ServiceUsage.tsx                                          | Keep: drawn                                            |
| `GET /api/consumables`                 | consumables              | ConsumableForm.tsx, ConsumableRecord.tsx, Consumables.tsx | Keep: drawn                                            |

### Money › Payments

| Call                       | What it does (code name) | Used in                                                      | Status      |
| -------------------------- | ------------------------ | ------------------------------------------------------------ | ----------- |
| `GET /api/payments`        | day                      | Launches.tsx, CampaignLinkForms.tsx, CampaignLinksScreen.tsx | Keep: drawn |
| `GET /api/payments/ledger` | ledger                   | LedgerScreen.tsx                                             | Keep: drawn |

### Requests › Number changes

| Call                                     | What it does (code name) | Used in                 | Status      |
| ---------------------------------------- | ------------------------ | ----------------------- | ----------- |
| `POST /api/number-changes/{id}/decision` | decideNumberChange       | NumberChangesScreen.tsx | Keep: drawn |
| `GET /api/number-changes`                | numberChanges            | NumberChangesScreen.tsx | Keep: drawn |

### Settings › Prices › Packages

| Call                                | What it does (code name) | Used in                                                | Status         |
| ----------------------------------- | ------------------------ | ------------------------------------------------------ | -------------- |
| `POST /api/hair-systems`            | addHairSystem            | HairSystems.tsx                                        | Keep: drawn    |
| `POST /api/packages`                | add                      | AddPincode.tsx, OpenCity.tsx, Served.tsx               | Keep: drawn    |
| `PATCH /api/packages/{code}`        | change                   | CampaignLinkForms.tsx, QuickReplies.tsx, CityForm.tsx  | Keep: drawn    |
| `DELETE /api/packages/{code}`       | remove                   | ActivityScreen.tsx, Registrations.tsx, VisitCode.tsx   | A11 (packages) |
| `POST /api/packages/{code}/restore` | restore                  | activity.ts, DispatchScreen.tsx, Retirement.tsx        | Keep: drawn    |
| `POST /api/packages/{code}/retire`  | retire                   | CampaignLinksScreen.tsx, activity.ts, Retirement.tsx   | A11            |
| `POST /api/packages/order`          | order                    | PackageFoot.tsx, OrderPanel.tsx, OrderSheet.tsx        | Keep: drawn    |
| `GET /api/packages`                 | packages                 | ClientPackage.tsx, PackageFoot.tsx, PackagesScreen.tsx | Keep: drawn    |

### Money › Partner commission

| Call                                                       | What it does (code name) | Used in               | Status                                                 |
| ---------------------------------------------------------- | ------------------------ | --------------------- | ------------------------------------------------------ |
| `POST /api/partner-statements/{id}/payouts`                | recordPartnerPayout      | PayoutForm.tsx        | Keep: not drawn in the prototype, build it in its home |
| `POST /api/partner-statements/{id}/payouts/{month}/delete` | deletePartnerPayout      | PartnerCommission.tsx | Keep: not drawn in the prototype, build it in its home |
| `GET /api/partner-statements`                              | partnerStatements        | PartnerCommission.tsx | Keep: drawn                                            |

### Money › Charges

| Call                                      | What it does (code name) | Used in           | Status                                                 |
| ----------------------------------------- | ------------------------ | ----------------- | ------------------------------------------------------ |
| `POST /api/no-shows/{id}/decision`        | decideNoShow             | NoShowsScreen.tsx | Keep: drawn                                            |
| `POST /api/no-shows/disputes/{id}/ruling` | ruleOnDispute            | Disputes.tsx      | Keep: drawn                                            |
| `GET /api/no-shows`                       | noShows                  | NoShowsScreen.tsx | Keep: drawn                                            |
| `GET /api/no-shows/{id}/charge`           | chargePreview            | NoShowsScreen.tsx | Keep: not drawn in the prototype, build it in its home |
| `GET /api/no-shows/decided`               | decidedNoShows           | NoShowsScreen.tsx | Keep: drawn                                            |
| `GET /api/no-shows/disputes`              | disputes                 | Disputes.tsx      | Keep: drawn                                            |
| `GET /api/payments`                       | dayMoney                 | NoShowsScreen.tsx | Keep: drawn                                            |

### Settings › Prices › Services and fees; Packages

| Call                                           | What it does (code name) | Used in                                   | Status                                                 |
| ---------------------------------------------- | ------------------------ | ----------------------------------------- | ------------------------------------------------------ |
| `POST /api/prices`                             | setPrice                 | PriceRow.tsx                              | Keep: drawn                                            |
| `POST /api/prices/withdraw`                    | withdrawPrice            | PriceRow.tsx                              | Keep: not drawn in the prototype, build it in its home |
| `POST /api/services/{kind}/{tier}/description` | describeService          | Services.tsx                              | Keep: drawn                                            |
| `POST /api/services/{kind}/{tier}/length`      | setServiceLength         | Services.tsx                              | Keep: drawn                                            |
| `POST /api/services/{kind}/{tier}/name`        | renameService            | Services.tsx                              | Keep: drawn                                            |
| `POST /api/standard-costs`                     | setStandardCost          | PackageRecord.tsx                         | Keep: drawn                                            |
| `GET /api/services`                            | services                 | BookSteps.tsx, BookVisit.tsx, History.tsx | Keep: drawn                                            |
| `GET /api/standard-costs`                      | standardCosts            | PackagesScreen.tsx                        | Keep: drawn                                            |

### Inventory › Purchasing

| Call                                       | What it does (code name) | Used in                                                    | Status                                                 |
| ------------------------------------------ | ------------------------ | ---------------------------------------------------------- | ------------------------------------------------------ |
| `POST /api/purchase-orders`                | draftOrder               | DraftOrder.tsx                                             | Keep: drawn                                            |
| `POST /api/purchase-orders/{id}/approve`   | approveOrder             | OrderPanel.tsx                                             | Keep: drawn                                            |
| `POST /api/purchase-orders/{id}/cancel`    | cancelOrder              | CustomOrders.tsx, OrderPanel.tsx                           | Keep: drawn                                            |
| `POST /api/purchase-orders/{id}/close`     | closeOrder               | Receiving.tsx                                              | Keep: not drawn in the prototype, build it in its home |
| `POST /api/purchase-orders/{id}/receipts`  | receive                  | activity.ts, ReceiveForm.tsx, Receiving.tsx                | Keep: drawn                                            |
| `POST /api/purchase-orders/{id}/send`      | sendOrder                | OrderPanel.tsx                                             | Keep: drawn                                            |
| `POST /api/purchase-orders/letterhead`     | setLetterhead            | Letterhead.tsx                                             | Keep: drawn                                            |
| `POST /api/returned-pieces/{id}/claim`     | claimReturned            | ReturnedPieces.tsx                                         | Keep: not drawn in the prototype, build it in its home |
| `POST /api/returned-pieces/{id}/write-off` | writeOffReturned         | ReturnedPieces.tsx                                         | Keep: not drawn in the prototype, build it in its home |
| `POST /api/supplier-claims/{id}/decide`    | decideClaim              | ClaimSteps.tsx                                             | Keep: not drawn in the prototype, build it in its home |
| `POST /api/supplier-claims/{id}/send`      | sendClaim                | ClaimSteps.tsx                                             | Keep: drawn                                            |
| `POST /api/supplier-claims/{id}/withdraw`  | withdrawClaim            | ClaimSteps.tsx                                             | Keep: not drawn in the prototype, build it in its home |
| `GET /api/purchase-orders`                 | orders                   | CustomOrders.tsx, PurchasingScreen.tsx, SupplierScores.tsx | Keep: drawn                                            |
| `GET /api/supplier-claims`                 | claims                   | Claims.tsx, ClaimSteps.tsx, SupplierScores.tsx             | Keep: drawn                                            |
| `GET /api/supplier-scorecard`              | scorecard                | SupplierScores.tsx                                         | Keep: drawn                                            |

### Inventory › Quality

| Call                           | What it does (code name) | Used in                             | Status      |
| ------------------------------ | ------------------------ | ----------------------------------- | ----------- |
| `POST /api/recalls`            | raiseRecall              | Recall.tsx                          | Keep: drawn |
| `POST /api/recalls/{id}/close` | closeRecall              | Recall.tsx                          | Keep: drawn |
| `GET /api/quality/failures`    | failures                 | Failures.tsx                        | Keep: drawn |
| `GET /api/recalls`             | recalls                  | QualityScreen.tsx                   | Keep: drawn |
| `GET /api/recalls/{id}`        | recall                   | book-choices.tsx, QualityScreen.tsx | Keep: drawn |
| `GET /api/stock/expiry-risk`   | expiryRisk               | ExpiryRisk.tsx                      | Keep: drawn |

### Growth › Referrals; Settings › Growth › Partners

| Call                                     | What it does (code name) | Used in                                    | Status      |
| ---------------------------------------- | ------------------------ | ------------------------------------------ | ----------- |
| `POST /api/referral-channels`            | addPartner               | PartnerForm.tsx                            | Keep: drawn |
| `PATCH /api/referral-channels/{id}`      | changePartner            | PartnerRecord.tsx                          | Keep: drawn |
| `POST /api/referral-channels/{id}/pause` | pausePartner             | PartnerRecord.tsx                          | Keep: drawn |
| `POST /api/referrals/{id}/decision`      | decideReferral           | ReferralsScreen.tsx                        | Keep: drawn |
| `GET /api/referral-channels`             | partners                 | Partners.tsx                               | Keep: drawn |
| `GET /api/referrals/held`                | held                     | Launches.tsx, OpenCity.tsx, StockMatch.tsx | Keep: drawn |
| `GET /api/referrers`                     | referrers                | ReferralsScreen.tsx                        | Keep: drawn |

### Settings (rule pages, Day times, Closed days, Job sheet, Purchasing checks, Console)

| Call                                          | What it does (code name) | Used in                                               | Status                                                                                 |
| --------------------------------------------- | ------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `POST /api/blackouts`                         | addBlackouts             | Blackouts.tsx                                         | Keep: drawn                                                                            |
| `POST /api/blackouts/remove`                  | removeBlackouts          | Blackouts.tsx                                         | Keep: drawn                                                                            |
| `POST /api/job-sheet/checklists/{visit_type}` | setChecklist             | JobSheet.tsx                                          | Keep: drawn                                                                            |
| `POST /api/job-sheet/failure-reasons`         | setFailureReasons        | JobSheet.tsx                                          | Keep: drawn                                                                            |
| `POST /api/job-sheet/lost-reasons`            | setLostReasons           | JobSheet.tsx                                          | Keep: drawn                                                                            |
| `POST /api/job-sheet/not-fitted-reasons`      | setNotFittedReasons      | JobSheet.tsx                                          | Keep: drawn                                                                            |
| `POST /api/job-sheet/partial-reasons`         | setPartialReasons        | JobSheet.tsx                                          | Keep: drawn                                                                            |
| `POST /api/qc-points`                         | add                      | AddPincode.tsx, OpenCity.tsx, Served.tsx              | Keep: drawn                                                                            |
| `PATCH /api/qc-points/{id}`                   | change                   | CampaignLinkForms.tsx, QuickReplies.tsx, CityForm.tsx | Keep: drawn                                                                            |
| `DELETE /api/qc-points/{id}`                  | delete                   | OpenCity.tsx, Served.tsx, activity.ts                 | Keep: drawn                                                                            |
| `POST /api/settings/{name}`                   | setSetting               | RuleFields.tsx                                        | A2: value only, typed control (settings are already typed on the server: no migration) |
| `POST /api/slot-times`                        | setSlotTimes             | WindowTimes.tsx                                       | Keep: drawn                                                                            |
| `DELETE /api/slot-times/{applies_from}`       | withdrawSlotTimes        | WindowTimes.tsx                                       | Keep: not drawn in the prototype, build it in its home                                 |
| `GET /api/blackouts`                          | blackouts                | rooms.ts, Blackouts.tsx                               | Keep: drawn                                                                            |
| `GET /api/blackouts/booked`                   | blackoutsBooked          | Blackouts.tsx                                         | Keep: drawn                                                                            |
| `GET /api/job-sheet`                          | jobSheet                 | JobSheet.tsx, ListEditor.tsx                          | Keep: drawn                                                                            |
| `GET /api/qc-points`                          | points                   | ReceiveForm.tsx, QcPoints.tsx                         | Keep: drawn                                                                            |
| `GET /api/settings`                           | settings                 | More.tsx, Navigation.tsx, Shell.tsx                   | Keep: drawn                                                                            |
| `GET /api/slot-times`                         | slotTimes                | WindowTimes.tsx                                       | Keep: drawn                                                                            |
| `GET /api/storage`                            | storage                  | Rules.tsx                                             | Keep: drawn                                                                            |

### Growth › Spend

| Call                          | What it does (code name) | Used in                                                            | Status         |
| ----------------------------- | ------------------------ | ------------------------------------------------------------------ | -------------- |
| `POST /api/spend`             | add                      | AddPincode.tsx, OpenCity.tsx, Served.tsx                           | Keep: drawn    |
| `POST /api/spend/{id}/remove` | remove                   | ActivityScreen.tsx, Registrations.tsx, VisitCode.tsx               | A11 (packages) |
| `POST /api/spend/import`      | import                   | activity.ts, SpendImport.tsx, SpendScreen.tsx                      | Keep: drawn    |
| `GET /api/spend`              | list                     | CampaignLinkForms.tsx, CampaignLinksScreen.tsx, MessagesScreen.tsx | Keep: drawn    |

### Settings › Team › Staff

| Call                                    | What it does (code name) | Used in                                                  | Status      |
| --------------------------------------- | ------------------------ | -------------------------------------------------------- | ----------- |
| `POST /api/staff`                       | saveStaff                | StaffForm.tsx, StaffRecord.tsx                           | Keep: drawn |
| `POST /api/staff/delete`                | deleteStaff              | StaffRecord.tsx                                          | Keep: drawn |
| `POST /api/staff/enforcement`           | setEnforcement           | Staff.tsx                                                | Keep: drawn |
| `POST /api/staff/service-tokens`        | addServiceToken          | Staff.tsx                                                | Keep: drawn |
| `POST /api/staff/service-tokens/remove` | removeServiceToken       | Staff.tsx                                                | Keep: drawn |
| `GET /api/staff`                        | staff                    | CampaignLinkForms.tsx, ClientAlerts.tsx, HairProfile.tsx | Keep: drawn |

### Inventory › Stock (5 views)

| Call                                       | What it does (code name) | Used in                                                 | Status                                                 |
| ------------------------------------------ | ------------------------ | ------------------------------------------------------- | ------------------------------------------------------ |
| `POST /api/stock/counts`                   | recordCount              | StockForm.tsx                                           | Keep: drawn                                            |
| `POST /api/stock/deliveries`               | recordDelivery           | StockForm.tsx                                           | Keep: drawn                                            |
| `POST /api/stock/lots/{id}/label`          | labelLot                 | Labels.tsx                                              | Keep: not drawn in the prototype, build it in its home |
| `POST /api/stock/places`                   | addStockPlace            | PlacesPanel.tsx                                         | Keep: drawn                                            |
| `POST /api/stock/places/{id}`              | changeStockPlace         | PlacesPanel.tsx                                         | Keep: drawn                                            |
| `POST /api/stock/transfers`                | recordTransfer           | StockForm.tsx                                           | Keep: drawn                                            |
| `POST /api/stock/transfers/{id}/receive`   | receiveTransfer          | InTransit.tsx                                           | Keep: not drawn in the prototype, build it in its home |
| `POST /api/stock/transfers/{id}/send-back` | sendBack                 | SendBack.tsx, VisitStory.tsx, InTransit.tsx             | Keep: not drawn in the prototype, build it in its home |
| `POST /api/stock/units`                    | addUnits                 | Labels.tsx                                              | Keep: not drawn in the prototype, build it in its home |
| `POST /api/stock/write-offs`               | recordWriteOff           | StockForm.tsx                                           | Keep: drawn                                            |
| `GET /api/stock/demand`                    | demand                   | Demand.tsx                                              | Keep: drawn                                            |
| `GET /api/stock/units`                     | units                    | CityRecord.tsx, PackageRecord.tsx, holdings.ts          | Keep: not drawn in the prototype, build it in its home |
| `GET /api/stock/units/{code}`              | unit                     | CountTask.tsx, ConsumableForm.tsx, ConsumableRecord.tsx | Keep: not drawn in the prototype, build it in its home |

### Inventory › Suppliers

| Call                                           | What it does (code name) | Used in                                          | Status                                                 |
| ---------------------------------------------- | ------------------------ | ------------------------------------------------ | ------------------------------------------------------ |
| `POST /api/suppliers`                          | addSupplier              | SupplierForm.tsx                                 | Keep: drawn                                            |
| `POST /api/suppliers/{id}`                     | changeSupplier           | SupplierRecord.tsx                               | Keep: drawn                                            |
| `POST /api/suppliers/{id}/items`               | setSupplierItem          | SupplierItems.tsx                                | Keep: drawn                                            |
| `POST /api/suppliers/{id}/items/{code}/remove` | removeSupplierItem       | SupplierItems.tsx                                | Keep: drawn                                            |
| `POST /api/suppliers/{id}/restore`             | restoreSupplier          | SupplierRecord.tsx                               | Keep: not drawn in the prototype, build it in its home |
| `POST /api/suppliers/{id}/retire`              | retireSupplier           | SupplierRecord.tsx                               | Keep: drawn                                            |
| `GET /api/suppliers`                           | suppliers                | RaiseCustomOrder.tsx, Claims.tsx, DraftOrder.tsx | Keep: drawn                                            |

### Inventory › Supply plan

| Call                                       | What it does (code name) | Used in                     | Status      |
| ------------------------------------------ | ------------------------ | --------------------------- | ----------- |
| `POST /api/demand-events`                  | addDemandEvent           | DemandEvents.tsx            | Keep: drawn |
| `POST /api/demand-events/{id}/remove`      | removeDemandEvent        | DemandEvents.tsx            | Keep: drawn |
| `POST /api/supply-plan/draft`              | draftPlan                | SupplyPlanScreen.tsx        | Keep: drawn |
| `POST /api/supply-plan/lines/{id}/approve` | approveLine              | LineGroup.tsx, PlanLine.tsx | Keep: drawn |
| `POST /api/supply-plan/lines/{id}/reject`  | rejectLine               | PlanLine.tsx                | Keep: drawn |
| `GET /api/demand-events`                   | demandEvents             | Planning.tsx                | Keep: drawn |
| `GET /api/stock/forecast`                  | forecast                 | Forecast.tsx                | Keep: drawn |
| `GET /api/stock/forecast-accuracy`         | accuracy                 | Accuracy.tsx                | Keep: drawn |
| `GET /api/supply-plan`                     | plan                     | SupplyPlanScreen.tsx        | Keep: drawn |

### Settings › Business › Targets

| Call                       | What it does (code name) | Used in           | Status      |
| -------------------------- | ------------------------ | ----------------- | ----------- |
| `POST /api/targets`        | setTarget                | TargetsScreen.tsx | Keep: drawn |
| `POST /api/targets/remove` | removeTarget             | TargetsScreen.tsx | Keep: drawn |
| `GET /api/targets`         | targets                  | TargetsScreen.tsx | Keep: drawn |

### Tasks; task panel

| Call                                     | What it does (code name) | Used in                                       | Status                                                 |
| ---------------------------------------- | ------------------------ | --------------------------------------------- | ------------------------------------------------------ |
| `POST /api/alerts/{id}/resolve`          | resolveAlert             | NeedsAHand.tsx                                | Keep: not drawn in the prototype, build it in its home |
| `POST /api/alerts/{id}/send-again`       | sendAlertAgain           | NeedsAHand.tsx                                | Keep: not drawn in the prototype, build it in its home |
| `POST /api/leave-requests/{id}/decision` | decideLeave              | LeaveDecision.tsx                             | Keep: not drawn in the prototype, build it in its home |
| `POST /api/payment-links/{id}/resend`    | resendPaymentLink        | PaymentLinkActions.tsx                        | Keep: not drawn in the prototype, build it in its home |
| `POST /api/tasks/{group}/{id}/close`     | closeTask                | BulkActions.tsx, TaskActions.tsx              | Keep: drawn                                            |
| `PUT /api/tasks/{group}/{id}/owner`      | setTaskOwner             | BulkActions.tsx, TaskActions.tsx              | Keep: drawn                                            |
| `POST /api/visits/{id}/upi-payment`      | recordUpiPayment         | UpiPaymentAction.tsx                          | Keep: drawn                                            |
| `GET /api/alerts`                        | alerts                   | Waiting.tsx, ClientAlerts.tsx, NeedsAHand.tsx | Keep: drawn                                            |

### Money › Technician pay; Settings › Team › Pay grades

| Call                                          | What it does (code name) | Used in           | Status                                                 |
| --------------------------------------------- | ------------------------ | ----------------- | ------------------------------------------------------ |
| `POST /api/technician-pay/grades`             | addPayGrade              | PayForms.tsx      | Keep: drawn                                            |
| `PATCH /api/technician-pay/grades/{id}`       | renamePayGrade           | PayForms.tsx      | Keep: drawn                                            |
| `POST /api/technician-pay/grades/{id}/delete` | deletePayGrade           | PayForms.tsx      | Keep: drawn                                            |
| `POST /api/technician-pay/rates`              | setPayRate               | PayForms.tsx      | Keep: drawn                                            |
| `POST /api/technician-pay/technicians/{id}`   | setPayGradeOf            | TechnicianPay.tsx | Keep: drawn                                            |
| `GET /api/technician-pay`                     | technicianPay            | TechnicianPay.tsx | Keep: drawn                                            |
| `GET /api/technician-pay/statement`           | payStatement             | PayStatement.tsx  | Keep: not drawn in the prototype, build it in its home |

### Technicians; technician page (5 tabs)

| Call                                                 | What it does (code name) | Used in                                                         | Status                                                                                                                     |
| ---------------------------------------------------- | ------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/technicians`                              | addTechnician            | TechnicianForms.tsx                                             | Keep: drawn                                                                                                                |
| `PATCH /api/technicians/{id}`                        | changeTechnician         | TechnicianForms.tsx                                             | Keep: drawn                                                                                                                |
| `POST /api/technicians/{id}/allow-sign-in`           | allowSignIn              | TechnicianPhones.tsx                                            | Keep: not drawn in the prototype, build it in its home                                                                     |
| `POST /api/technicians/{id}/deactivate`              | switchOff                | TechnicianSwitch.tsx                                            | Keep: drawn                                                                                                                |
| `POST /api/technicians/{id}/delete`                  | deleteTechnician         | TechnicianForms.tsx                                             | Keep: drawn                                                                                                                |
| `POST /api/technicians/{id}/devices/{device}/revoke` | revokeDevice             | TechnicianPhones.tsx                                            | Keep: not drawn in the prototype, build it in its home                                                                     |
| `POST /api/technicians/{id}/home`                    | setHome                  | TechnicianHours.tsx                                             | Decision D1: prototype asks a home pincode; today a searched address with a map pin                                        |
| `POST /api/technicians/{id}/home/suggestions`        | homeSuggestions          | TechnicianHours.tsx                                             | Decision D1                                                                                                                |
| `POST /api/technicians/{id}/hours`                   | setHours                 | TechnicianHours.tsx                                             | Keep: drawn                                                                                                                |
| `POST /api/technicians/{id}/leave`                   | recordLeave              | TechnicianLeave.tsx                                             | Keep: drawn                                                                                                                |
| `POST /api/technicians/{id}/leave/{leave}/cancel`    | cancelLeave              | TechnicianLeave.tsx                                             | Keep: drawn                                                                                                                |
| `POST /api/technicians/{id}/reach`                   | setRadius                | TechnicianHours.tsx                                             | Decision D1: prototype has 'Area they cover' (whole city or zone) and a home pincode in place of a home pin and a km reach |
| `POST /api/technicians/{id}/reactivate`              | switchOn                 | TechnicianForms.tsx, TechnicianScreen.tsx, TechnicianSwitch.tsx | Keep: drawn                                                                                                                |
| `GET /api/dispatch`                                  | board                    | DayBoard.tsx, DispatchScreen.tsx, Grid.tsx                      | Keep: drawn                                                                                                                |
| `GET /api/technicians`                               | technicians              | Reach.tsx, ChatClient.tsx, CityList.tsx                         | Keep: drawn                                                                                                                |
| `GET /api/technicians/{id}/leave`                    | standingLeave            | TechnicianLeave.tsx                                             | Keep: drawn                                                                                                                |
| `GET /api/technicians/work`                          | technicianWork           | TechnicianHead.tsx, TechniciansScreen.tsx, TechnicianWeek.tsx   | Keep: drawn                                                                                                                |

### Today

| Call                       | What it does (code name) | Used in                                              | Status                                                                             |
| -------------------------- | ------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `GET /api/care-numbers`    | care                     | CareHome.tsx                                         | Keep: drawn                                                                        |
| `GET /api/conversations`   | waiting                  | Demand.tsx, Served.tsx, ServedParts.tsx              | Keep: drawn                                                                        |
| `GET /api/count-tasks`     | counts                   | ClientList.tsx, OnHand.tsx, TaskFilters.tsx          | Keep: drawn                                                                        |
| `GET /api/dispatch`        | board                    | DayBoard.tsx, DispatchScreen.tsx, Grid.tsx           | Keep: drawn                                                                        |
| `GET /api/payments`        | money                    | CancelVisit.tsx, BoardControls.tsx, MoneyFigures.tsx | Keep: drawn                                                                        |
| `GET /api/payments/ledger` | payments                 | ClientPanel.tsx, ClientAside.tsx, ClientScreen.tsx   | Keep: drawn                                                                        |
| `GET /api/recalls`         | recalls                  | QualityScreen.tsx                                    | Keep: drawn                                                                        |
| `GET /api/stock`           | stock                    | OnHand.tsx, RecordMovement.tsx, StockForm.tsx        | A8: opens on the warehouse; 'Whose stock' picker; 'Every place, side by side' kept |

### Inventory › Usage

| Call                   | What it does (code name) | Used in                                        | Status      |
| ---------------------- | ------------------------ | ---------------------------------------------- | ----------- |
| `GET /api/stock/usage` | usage                    | activity.ts, ServiceUsage.tsx, UsageScreen.tsx | Keep: drawn |

### Settings › Growth › Words

| Call                      | What it does (code name) | Used in                              | Status                                                 |
| ------------------------- | ------------------------ | ------------------------------------ | ------------------------------------------------------ |
| `POST /api/words`         | setWord                  | WordForm.tsx                         | Keep: drawn                                            |
| `POST /api/words/publish` | publishWords             | WordsPublish.tsx                     | Keep: drawn                                            |
| `GET /api/words`          | words                    | Chosen.tsx, landing.ts, PhoneDay.tsx | Keep: drawn                                            |
| `GET /api/words/history`  | wordHistory              | WordHistory.tsx                      | Keep: not drawn in the prototype, build it in its home |
