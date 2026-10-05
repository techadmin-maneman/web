# 0085. Services ops can edit

- Status: accepted, on the owner's rulings of 27 September 2026 (ADR 0025, items 67 and 35; `docs/open-points.md`, items 1, 11 and 13). The push to FSM's catalogue is built and stays off until the owner switches it on in production (item 11); amended 28 September 2026 by the plan's piece C28, whose hourly check reads FSM's whole catalogue ([0087](0087-consumables-and-stock.md)). Amended 4 October 2026 by [0110](0110-field-work-without-fsm.md): a service is synced to Books' items; the push to FSM's catalogue is gone.
- Date: 2026-09-27
- Amends [0073](0073-prices-from-the-price-book.md) and [0061](0061-ops-editable-inputs.md), and, built beside it the same day, [0086](0086-the-next-visit-is-offered.md), whose visit offered now names a service, and [0087](0087-consumables-and-stock.md), whose expected use is now checked against the services; follows [0035](0035-window-slot-map.md) for the half-slots a day is counted in, [0068](0068-a-paid-hold-is-kept.md) for what a hold keeps, [0070](0070-vendor-correctness.md) for the invoice check and [0071](0071-what-ops-see-before-a-setting-changes.md) for what ops see before a change

## Context

Until now the code fixed four visit types, each with one price a day. The console could price each and add a price for a new tier (ADR 0061), but nothing could name, time or offer a tier: the price book, the hold and FSM's catalogue had one service a type, and the app booked the standard tier and sent a client measured for premium to WhatsApp ("Premium? Message us"). The site's Premium column showed the owner's own figures, typed into `site/src/content/prices.ts` (ADR 0073).

The owner asked, on 27 September 2026:

> "I can't remove/edit the set services and prices. Make it editable. Is the price/product synced to all other sources (CRM/FSM)?"

and ruled the same day (`docs/archive/owner-answers-2026-09-27.md`):

> "The price book will keep getting updated. The source of truth needs to be the one entered on the ops dashboard which should then sync to FSM and every other thing." (item 1)

> "The services should be selected via the ops table which should sync with FSM. Clients should see all the available options. There should be no message us for anything." (item 13)

- **The model:** every service belongs to one of four kinds (consultation, first fit, service visit, replacement), and the kind decides the technician's steps, the booking rules and which fees apply. Within a kind ops add, rename, price, reorder and retire services from the console, each synced to FSM. A new kind needs a release. Retiring a service stops clients seeing it from a date and changes nothing already sold; prices stay dated rows.
- **Visit length:** each service carries its own length, starting from its kind's (consultation 60 minutes, service 90, replacement 135, first fit 180), and the scheduler reserves that length.
- **The CRM:** through FSM only. FSM's own sync carries the catalogue to Books and, where its CRM integration is on, to the CRM. We write no products to the CRM.
- **The push:** production only (item 11). Staging's FSM is the owner's real org and its book holds placeholders (ADR 0025, item 26).

## Decision

### A service is a kind and a tier, and the tier is the price book's own key

**`services` (migration 0050)** holds one row a service: its `kind`, its `tier`, its `name`, its `minutes`, its `sort` within the kind, the `retired_date` it is offered until, and the `fsm_item_id` of its item once found or made. Its key is `(kind, tier)`, the price book's own `(item, tier)` for a visit. So:

- **No price row moves.** Every price the book holds stays where it is, and a hold, a payment and an invoice keep the price they were sold at (ADR 0068).
- **The four services there have always been** are seeded as each kind's `standard` tier, named as FSM names its items (`FSM_SERVICE_NAMES`): Consultation, First fit, Service visit and Replacement, at 60, 180, 90 and 135 minutes.
- **A tier's code is made from the service's first name** (`tierCodeOf`, `src/policy/services.ts`): "Premium" is `premium`, "Lace, front" is `lace_front`. Ops may type another, and must where the name gives none. **It never changes**: a rename changes the name only, so a service's prices stay its own whatever it is called. The console makes the code with the same function before anything is sent.
- **A name is the service's alone**, whatever its case, since FSM's item is found by it. It starts with a letter or a digit, so a spreadsheet opening an exported list never reads it as a formula, and runs to 60 characters in any script.
- **A kind is code.** `VISIT_TYPES` stays a closed set (ADR 0061, "Genuinely structural"). The kind decides the steps, the booking rules (one live consultation and first fit at a time, the stage a client may book at) and the fees.

### Ops add, rename, time, price, order, retire and restore, audited, and nothing already sold moves

`/api/services` on the ops surface (`src/routes/ops/services.ts`):

| Call                                       | Does                                                                                                     |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `GET /api/services`                        | every service, offered or retired, with every price it has had and is to have, and the late fees         |
| `POST /api/services`                       | adds a service to a kind, at the kind's length unless ops give another; clients see it once it is priced |
| `POST /api/services/{kind}/{tier}/name`    | renames it; its code, and so its prices, stay                                                            |
| `POST /api/services/{kind}/{tier}/length`  | how long it is booked for, from now on                                                                   |
| `POST /api/services/{kind}/order`          | the kind's services in another order, as the console and the app list them                               |
| `POST /api/services/{kind}/{tier}/retire`  | no longer offered from a day, today or later                                                             |
| `POST /api/services/{kind}/{tier}/restore` | offered again, or a retirement still to come taken back                                                  |

- **Each change is a `db.batch` of the change and its audit entry** (ADR 0031): `service.add`, `service.rename`, `service.length`, `service.reorder`, `service.retire` and `service.restore`, each with the Access identity and the before and after. A refused change writes nothing.
- **A kind always has something to book.** A service may be retired only while another of its kind has no retirement set and is priced by that day (`retireRefusal`, `409 last_of_kind`). To replace a kind's last service, ops add and price the new one first.
- **A name taken is refused** (`409 service_exists`), and so is a code taken within the kind.
- **Nothing already sold moves.** A hold copies its service's code, price, late fee and length as it is made (`slot_holds.tier` and `.minutes`), so a rename, a new length, a new price or a retirement changes what is sold from then on and nothing before. An appointment keeps its service's tier (`appointments.tier`), from the hold that booked it or from its FSM item.
- **A length** is whole minutes from 30 to 360, which is the day's eight half-slots at 45 minutes each (`SERVICE_MINUTES`): a longer visit could never be placed.

### Prices are validated against the services, and a price still to come can be corrected

`POST /api/prices` (ADR 0061) now refuses a price for a code no service of that kind has, and a price from a day the service is retired by (`400 service_retired`), rather than creating a tier by pricing it. A late fee stays one figure a kind, its standard tier's: whichever of the kind's services was booked, moving it inside 24 hours costs the kind's late fee.

A price still to come could only be taken back. **`POST /api/prices/correct`** takes back the row and sets the corrected one in one batch, from the same day or another, with both audit entries, so a wrong figure typed for next month is put right without a moment where the book holds neither. Back-dating is still refused, and the price in force and the spent ones still stay (ADR 0061).

### The day keeps each visit's own length

One rule turns a length into what the day holds (`src/policy/visit-length.ts`): **`max(2, ceil(minutes / 45))` half-slots**. At the four kinds' own lengths it gives the design's blocks exactly (`VISIT_BLOCKS`: a consultation and a service visit two, a replacement three, a first fit four), and it still starts no first fit in the evening, since four half-slots do not fit the evening's two (ADR 0035). A visit shorter than 90 minutes still holds a whole slot, since a technician holds one live job a window.

- **Availability and a hold place the service's length**, and FSM books the visit for it.
- **A visit already booked holds the longer of its service's length and FSM's** (`bookedLength`). So a length ops shorten later, or a visit ops lengthened by hand in FSM, leaves no room for a clash, and a visit whose service is unknown keeps its kind's length.
- The dispatch board draws each visit as wide as its own length, and a move on the board carries it.

### Clients see every service offered to them, and choose

- **`/api/me`** lists every service offered and priced for the kinds the client may book now (`booking.services`), a kind at a time in the console's order, each with its length and its price on the first day it can be booked.
- **The app's booking sheet** asks the client to pick one when there is more than one, each with how long it takes and what it costs, the inclusive figure beside it once GST applies; with one, it goes straight to the date as before. The pick goes with the availability and the hold, and the pay step names the service. "Premium? Message us" is gone (ADR 0025, item 70).
- **A button that books one kind offers that kind's services** (ADR 0086's next visit, and the other kind beside it); one that names no kind offers every kind open to the client, a kind at a time.
- **The visit the app offers next names its service** (ADR 0086, amended): the one the client's last completed visit of that kind was, while it is still offered, else the kind's first offered in the console's order. The sheet opens with it chosen; where the kind offers more than one, the client may pick another, and the sheet then opens on the day and window offered.
- **A hold with no tier is the kind's standard service** while it is offered, which is what the app deployed before this sends. A move keeps its own visit's service.
- **The badge, the dispatch board and the invoice check** read the visit's own service's price, not its kind's standard one.

### FSM: each service is its own item, found by its ID, then its name

- **A booking goes on its service's own item**: the one whose ID is kept on the service, else the one with its name, whose ID is then kept, so the two stay together whatever either is renamed to (`itemForService`, `src/domain/fsm-catalogue.ts`).
- **Where FSM has no item for the service yet, the booking goes on its kind's standard item**, rather than failing: FSM then invoices the visit at that item's price, and ADR 0070's check holds the invoice as a draft where that is not what the client paid. Each fallback is logged (`fsm_item_fallback`), and ops are told once, under `fsm_item_fallback:<kind>/<tier>`, until the service has its item.
- **The mirror maps an item back to its service** by the same ID and name, and a visit a hold booked keeps the hold's tier, since the hold is what was sold and FSM may hold it on its kind's item.
- **The hourly check** (ADR 0073) compares every service offered today, its name and its price that day, with its item, reading FSM's catalogue 200 items a page, up to `FSM_ITEM_PAGES` (5) pages from the run's budget. **Amended 28 September 2026 (plan piece C28; [ADR 0087](0087-consumables-and-stock.md)):** it reads on while FSM says there are more, a page a call from what the run has left, and where the calls end first it speaks only for the items it read: a service whose item it did not reach is neither told missing nor made by the push, and ops are told if the next hour cannot read the whole list either. A difference, or an item missing, is told once with the item's ID and both names and figures. A kind's standard service keeps the alert key its kind had before, `fsm_catalogue:<kind>`, so an alert already open stays the one alert; another service's is `fsm_catalogue:<kind>/<tier>`.
- **The push, still behind `FSM_CATALOGUE_PUSH` and still off in every environment**, makes an item FSM does not have (`POST /fsm/v1/Service_And_Parts`, a Service with its name and price) and writes the console's name and the book's price over each that differs (`PUT /fsm/v1/Products/{id}`). A change in the console that FSM should follow today queues it at once; a price from a later day is found by the check on its day. `test/worker/platform/guard.test.ts` still refuses the push in staging.
- **Not tried on the org:** the create, and whether `Name` is written with `Unit_Price` by the update. Both cite open point 25; the first push after the owner switches it on proves them, and the next check reads them back.

### The site's Premium is the book's

- `GET /api/published-prices` keeps the standard first fit, service visit and replacement, which the site's Standard column and every sentence already read, and adds every service offered today (`services`).
- **The Premium figures typed into `site/src/content/prices.ts` are gone.** The site's Premium is the book's services coded `premium`. A page is built without it: the column, the premium base's price and the FAQ's premium clause are built hidden, and mm-site's Worker shows them, with the book's figures, once the book prices a first fit coded `premium`. The search engines' price range runs across both tiers' first fits then, and is the standard first fit alone before.
- **A service visit or replacement with no service coded `premium`** is shown in the Premium column at its standard price, which is what a client with a premium base then books.
- **An answer with no `services`**, from an mm-api deployed before this, is read as one with no Premium. The minute's cache and the page served as built when mm-api cannot answer stay as ADR 0073 made them.

## What stays in code

- **The four kinds** and what each decides (`VISIT_TYPES`; ADR 0061).
- **The late fees**, one figure a kind, set as prices.
- **The half-slot arithmetic** (`MINUTES_PER_UNIT`, `UNITS_PER_DAY`, `WINDOW_SLOT_MAP`; ADR 0035), which a length is turned into.
- **The code a tier is made from its name by**, which the API and the console share by test, not by import.

## Consequences

- **Ops can name, time, price, order and retire what clients book**, and a client sees every service offered to them. Nothing already sold changes with any of it.
- **A new service reaches FSM only by hand while the push is off.** Until the owner switches it on in production, its bookings go on the kind's standard item, FSM invoices them at that price, and ADR 0070 holds each invoice as a draft for ops. Ops are told once, with what to make. Making the item in FSM, named as the console names the service, closes it.
- **The site shows no Premium until the book prices it.** Production's console needs the premium services and their prices before launch (open points 1 and 13), or the site shows the Standard column alone.
- **A late fee does not follow the service.** A premium first fit moved late costs the kind's late fee. A late fee for one service alone would need rows of its own in the book, and a ruling.
- **The app's Visits and Home name a visit by its kind**, not its service: `VisitSummary` does not carry the service yet. The pay step and the booking sheet do.
- **`scripts/setup-fsm.ts` is unchanged.** It makes the four kinds' standard items; any other service's item is made by hand or by the push.
- **A consumable's expected use is a service's** (ADR 0087, amended): `POST /api/service-usage` takes a pair the services table holds, retired or not, Settings · Consumables names each service by its name, and a job's steppers start at what its own visit's service uses. `consumable_usage` has no foreign key to `services`, since its migration, 0049, comes before this one, 0050.
- **Contract:** `/api/services` and `/api/prices/correct` on the ops surface, `tier` on `/api/availability` and `/api/holds`, `service` on a hold and an availability, `booking.services` and `booking.next.tier` on `/api/me`, `tier` on its `next_visit` and `replacement_due` prompts, `name` and `retired_date` on each service of `/api/consumables`, `services` on `/api/published-prices`, and the error codes `service_exists`, `last_of_kind` and `service_retired`. The OpenAPI documents, `docs/api*.md` and `docs/schema.md` are regenerated.

## Not built

- **A foreign key from `consumable_usage` to `services`**, which would need that table rebuilt; the pair is checked in code.
- **A service's own late fee**, as above.
- **Naming the service on Visits and Home.**
