# The database schema

What each table in D1 holds, as the migrations leave it. This file is written by `npm run schema`, which applies `migrations/` in order to an empty database and reads every table back; `test/node/database/schema-doc.test.ts` fails until it is run after a migration changes a table. How to write a migration is `docs/migrations.md`.

## Times and dates

A column ending `_at` holds an instant, as ISO 8601 in UTC (`2026-09-27T06:30:00.000Z`). One ending `_date` holds a calendar day in India, `YYYY-MM-DD`, and a day is never cut from an instant's UTC string: it is read as India's date (`src/lib/india-time.ts`). Two `_at` columns hold a day, from before the rule was written (`docs/migrations.md`, rule 7):

- `pieces.fitted_at`: The day FSM's asset says the piece was installed (`Installation_Date`), or the day the technician's app fitted it (`src/domain/inventory/pieces.ts`).
- `pieces.replacement_due_at`: The fitted day plus the base's cycle; the Tasks board reads it as midnight in India on that day (`instantOf`, `src/domain/ops/tasks.ts`).

## What a restore undoes

What each group of tables means if it is left as it was at `<T>`, and how it is put back (`docs/runbook.md`, "Restoring D1"). A table may be in more than one group. Every table is in one: the test fails on a table that is not, until it is added to `RESTORE_GROUPS` (`scripts/lib/restore-groups.ts`).

| What | Tables | Left at `<T>` | Put back by |
| --- | --- | --- | --- |
| Consents given and withdrawn | `consents` | Someone who said stop is messaged again | Adding the rows since `<T>`: they are only ever added |
| Revoked sessions and phones | `sessions`, `technician_devices` | A lost phone, or a session that was ended, works again | Revoking again: a phone in the console, a client's session with `sessions.revoked_at` |
| Erasures | `people`, `addresses`, `waitlist_entries`, `number_change_requests`, `photos`, `photo_sets`, `hair_profiles`, `grievances`, `no_show_disputes`, `task_closures` | Erased people come back in D1, with their own words. Their files stay gone, since R2 is not restored | Erasing again (runbook, "Erasure within the day"). List them before restoring: `SELECT id FROM people WHERE erased_at >= '<T>';` |
| Number changes, deletion requests, grievances | `number_change_requests`, `people`, `deletion_requests`, `grievances` | A client's new number stops working; a request, or its answer, is lost | Deciding each again in the console |
| Payments and refunds | `payments`, `refunds`, `razorpay_events`, `payment_links` | Money Razorpay took or gave back is unrecorded, and Razorpay does not send it again. A payment link sent since has no row, though a payment on it still finds its visit | Adding the rows since `<T>`, checked against Razorpay's dashboard |
| Discount codes | `discount_codes`, `discount_code_uses` | A code made or switched off since goes back, and a use since is forgotten, so a single-use code works again | Making or switching off the code again in the console. `discount_code_uses` is only ever added to |
| Bookings and moves | `appointments`, `slot_holds`, `slot_claims`, `dispatch_moves`, `move_proposals`, `visit_changes`, `consultation_requests`, `first_fit_requests` | A visit booked, moved or cancelled since is lost, and its time can be booked again | The rows since `<T>`, before the switch is turned off |
| Messages | `outbound_messages` | The sweeper sends again what was sent since | The rows since `<T>`, before the switch is turned off |
| The Care inbox | `conversations`, `chat_messages`, `care_owners`, `care_weekly_off`, `care_leave`, `care_names`, `city_matters`, `quick_replies`, `remedies`, `technician_updates` | A message written since, the client's or ours, is gone from its thread | The rows since `<T>`; WhatsApp's own copy shows what was said |
| Technicians' steps, pieces and photographs | `job_events`, `checkins`, `visit_outcomes`, `consumables_used`, `no_show_cases`, `no_show_disputes`, `no_show_refunds`, `pieces`, `photos`, `photo_sets` | Steps, check-ins, outcomes, pieces fitted, no-shows, disputes and the refunds they owe since are lost; a photograph's file is kept with no row | The rows since `<T>` |
| Hair profiles | `hair_profiles` | A profile recorded since is lost, and one an erasure blanked since is whole again | Adding the rows since `<T>`: they are only ever added. Erasing again blanks the rest |
| Purchase orders | `purchase_orders`, `po_lines`, `receipts`, `receipt_lines`, `supplier_claims`, `custom_orders` | An order drafted since is gone, one approved, sent, received or cancelled since goes back to where it stood, a receipt since is lost with the stock it brought, and a claim or custom order since is gone or back at its earlier step | Adding the rows since `<T>`, and each order's, claim's and custom order's state from the audit log and Razorpay |
| Stock | `stock_movements`, `stock_places`, `stock_lots`, `stock_lot_moves`, `stock_transfers`, `stock_units`, `stock_unit_events`, `piece_returns` | A delivery, transfer, count or loss recorded since, or a job's use, is lost, so what each place holds is wrong; a hub or stockroom added or changed since goes back, and each piece is where it was | Adding the rows since `<T>`, and setting each unit where its latest line of history puts it |
| Referrals and credits | `referral_codes`, `referral_attributions`, `credit_ledger`, `waitlist_entries`, `referral_channels`, `channel_attributions`, `partner_payouts`, `spend_entries` | A credit, a grant, a partner, a partner's payment, an entry of offline spend or a place on a waitlist disappears | The rows since `<T>`. `credit_ledger` is only ever added to |
| Ops' settings and what we sell | `ops_settings`, `price_book`, `po_letterhead`, `standard_costs`, `targets`, `services`, `slot_times`, `serviceable_pincodes`, `technician_leave`, `visit_blackouts`, `city_blackouts`, `cities`, `city_prices`, `city_settings`, `gst_registrations`, `zones`, `consumables`, `hair_systems`, `consumable_usage`, `suppliers`, `supplier_items`, `checklist_items`, `partial_reasons`, `lost_reasons`, `pay_grades`, `visit_pay_rates`, `word_versions`, `site_word_publishes` | A price, service, rule, area, day's times, day off, consumable, supplier, job-sheet list, pay rate or wording set since goes back | Setting it again in the console, which audits it |
| Staff and access | `staff`, `staff_grants`, `staff_service_tokens`, `staff_access_mode` | Someone taken off the Staff list since, or a grant taken back, is let in again | Setting it again on the Staff page, before anything else |
| Tasks | `task_owners`, `task_closures`, `task_spans`, `stock_risks` | A task closed since opens again, one given to someone since is nobody's, a task's span closed since closes again the next night, dated then, and a fit's stock risk is found or cleared again within the hour | Closing or giving it again on the Tasks board |
| The audit log | `audit_log` | Who did what since `<T>` | Adding the rows since `<T>`: they are only ever added |
| New people, leads, addresses and try-ons | `people`, `leads`, `addresses`, `tryon_jobs`, `crm_contact_updates` | Bookings and leads made since are lost here; the CRM has the leads | The rows since `<T>` |
| Technicians, and the old catalogue table | `technicians`, `fsm_items` | A technician added or changed since goes back | The rows since `<T>`; ops can add one again on the Technicians page |
| Recalls | `recalls`, `recall_pieces` | A recall raised since is gone though its lot stays blocked and its pieces stay due; one closed since is open again | Raising the recall again on the Quality page names the same lot, already blocked, so it is refused: ask the engineer |
| Cycle counts | `count_tasks`, `count_lines` | A count since is open again, though the ledger keeps what it took; a task raised since is raised again the next morning | Counting the task again on the Counts page: the ledger takes a count that agrees with it as nought |
| The demand forecast | `forecast_runs`, `forecast_lines`, `demand_events`, `plan_lines`, `forecast_accuracy` | A forecast run since is gone and the last before stands until the next is due, an event ops added or took off since is gone or back, a plan line decided since is proposed again, though its transfer or order stands, and a period measured since is measured again from the movements | Adding the events again on the Supply plan page; the next run is due within the planning period |
| Worked out from other tables | `last_visits`, `ops_settings_snapshot`, `stock_balances`, `stock_lot_balances` | Nothing of their own: triggers keep each from the table it is worked out from | Putting back that table |
| The storage meter | `stored_objects`, `storage_meter` | Objects stored or deleted since are counted wrongly, as R2 is not restored | The rows since `<T>` |
| Housekeeping | `alerts`, `vendor_breakers`, `board_version`, `cron_jobs`, `cron_runs`, `credit_expiry_cursor`, `counters`, `idempotency`, `number_codes`, `otp_challenges`, `tryon_sessions`, `events`, `zoho_access_tokens` | Nothing that lasts | Nothing |
| The database's identity, and the restore's own switch | `deployment_identity`, `maintenance` | The identity is the same at every minute. Going back undoes the switch, so the steps turn it on again | Nothing |

## Tables

- [addresses](#addresses): Each address a client has given, in the app or to ops on the phone, who then saved it for them (`given_to_staff`). The current one has `replaced_at` empty; earlier ones stay for the visits booked to them (ADR 0042, ADR 0054, ADR 0092).
- [alerts](#alerts): One row per alert while it is open, kept once it is resolved; raising it again counts it (ADR 0067).
- [appointments](#appointments): Each visit, mirrored from FSM or booked without it: when, with whom, of what type and in what state, and what we have learnt of each since, such as the window asked for and its invoice. `fsm_id` is FSM's ID for a visit FSM holds, otherwise the row's own (ADR 0032, ADR 0110).
- [audit_log](#audit_log): Every ops action that reads or changes a client's data, and who took it. An entry is never changed (ADR 0031).
- [board_version](#board_version): One row: a number that triggers raise whenever a visit, a move, leave, a technician or the day's slot times change, so the open dispatch board reads itself again only then (ADR 0069).
- [care_leave](#care_leave): Leave for a Care team member, from one date to another; their chats are covered meanwhile (ADR 0134).
- [care_names](#care_names): The first name each Care team member is known by to clients, as their Support card shows it (ADR 0136).
- [care_owners](#care_owners): Each client's named Care person, given at their first chat and moved by a Customer Care manager (ADR 0131).
- [care_weekly_off](#care_weekly_off): Each Care team member's weekly days off, as a Customer Care manager sets them (ADR 0134).
- [channel_attributions](#channel_attributions): A person who came through a partner's code, and what the friend and the partner earned once fitted (ADR 0123).
- [chat_messages](#chat_messages): Every message in a Care inbox thread: what the client wrote, our replies, and notes only staff see (ADR 0129).
- [checkins](#checkins): Each "I have arrived", passed or not, with the distance measured and the radius in force (ADR 0065); an erasure blanks where the phone was (ADR 0094).
- [checklist_items](#checklist_items): Each kind of visit's checklist as ops set it, an item they took off kept as retired; a kind with no rows takes the committed list (ADR 0087).
- [cities](#cities): Our cities, each a row ops edit at Admin › Cities: its state for GST, its zone, whether it is served and offered. A lead, a pincode, a technician and a stock place name one, and a zone groups them for staff access (ADR 0109, ADR 0198).
- [city_blackouts](#city_blackouts): Days on which no visit is offered in one city alone (ADR 0119).
- [city_matters](#city_matters): A matter Customer Care sent from a chat to the client's city, on that city's Tasks until it is closed (ADR 0135).
- [city_prices](#city_prices): A price a city sets apart from the book's, from a day, which comes first there (ADR 0198).
- [city_settings](#city_settings): A rule a city sets apart from the national one: its check-in radius or reminder hour (ADR 0198).
- [consents](#consents): What each person agreed to, under which notice's version, and where (ADR 0094). Rows are only ever added (ADR 0042, ADR 0049).
- [consultation_requests](#consultation_requests): A consultation asked for while self-serve booking is off, for ops to fix the hour (ADR 0060).
- [consumable_usage](#consumable_usage): What each service, a kind of visit at a tier of the price book, is expected to use of each consumable: where the technician's steppers start (ADR 0087).
- [consumables](#consumables): The consumables ops keep: name, unit, what one costs, the reorder levels, the day it is retired from, and FSM's part for it (ADR 0087).
- [consumables_used](#consumables_used): The consumables a technician recorded at a job's third step, with what its service expected and what one cost that day (ADR 0038, ADR 0087).
- [conversations](#conversations): The Care inbox: one thread for each number that writes to our WhatsApp number, matched to its client where we know the number (ADR 0129).
- [count_lines](#count_lines): Each item a count task counted: what the ledger held, which the counter never saw, the count, any recount, and whether the ledger took it (ADR 0185).
- [count_tasks](#count_tasks): Each cycle count of one class of items at one place: raised once its period comes round, counted blind, counted again where it differs, signed off where that stands (ADR 0185).
- [counters](#counters): Fixed-window counters for the rate limits and the daily ceilings (ADR 0011).
- [credit_expiry_cursor](#credit_expiry_cursor): One row: how far the pass that closes expired credits has got, so it reads only the grants that expired since.
- [credit_ledger](#credit_ledger): Service-visit credits, entry by entry, each drawing on the grant it spends; a balance is summed, never kept (ADR 0033).
- [crm_contact_updates](#crm_contact_updates): A client's contact change still owed to their CRM lead, which the sweeper sends again until the lead has it (ADR 0203).
- [cron_jobs](#cron_jobs): Each job of the cron, and how many runs in a row it has failed (ADR 0067).
- [cron_runs](#cron_runs): One row: when the cron's latest run started and its last finished run ended, so a run cut short is told by the next.
- [custom_orders](#custom_orders): Each hair system made for one client to their exact spec: the spec, supplier and price, its payment link and payment, and the order it was bought on (ADR 0174).
- [deletion_requests](#deletion_requests): A client's request to be erased, waiting for ops, and what ops decided (ADR 0042, ADR 0078).
- [demand_events](#demand_events): The calendar of uplifts ops keep, each an event in a city or every city, which lifts the forecast's baseline (ADR 0179).
- [deployment_identity](#deployment_identity): Which environment's database this is, so a Worker refuses to serve on another's (ADR 0003).
- [discount_code_uses](#discount_code_uses): Each time a discount code was entered on a booking, its hold or its visit: by whom, and what it took off before GST once the price was known. Never deleted: one taken off is marked removed (ADR 0108).
- [discount_codes](#discount_codes): The discount codes ops make: a percentage with an optional cap or an amount, the kinds of visit each covers, its last day and limits, and whether it is switched off (ADR 0108).
- [dispatch_moves](#dispatch_moves): Every move ops make on the dispatch board: from where to where, by whom, why, what FSM said, and whether the client was told (ADR 0069).
- [events](#events): What happened, for analysis, with no personal data in its payload.
- [first_fit_requests](#first_fit_requests): A first fit asked for on the site's form with the consultation; a person's latest stands (ADR 0086). The form no longer asks for one (ADR 0105), and only the data export, erasure and an old consultation request's line still read it.
- [forecast_accuracy](#forecast_accuracy): How right each forecast run was: its first period's expected use and high case of each stock code in each city beside what the kits used (ADR 0183).
- [forecast_lines](#forecast_lines): Each forecast run's expected use of each stock code in each city and period, with what each of its four layers gave (ADR 0179).
- [forecast_runs](#forecast_runs): Each demand forecast run, once a planning period: its period, horizon and the rates it learned (ADR 0179).
- [fsm_items](#fsm_items): FSM's catalogue, to read each appointment's visit type from its service item and to compare FSM's prices with the price book (ADR 0032, ADR 0073).
- [grievances](#grievances): A client's grievance, and the answer ops recorded (ADR 0049, ADR 0078).
- [gst_registrations](#gst_registrations): A state's own GST registration, which supplies the visits in it, and its Books branch (ADR 0198).
- [hair_profiles](#hair_profiles): Every version of a client's hair profile, the fit spec and the history: the technician's at a visit, once for each of the phone's events, and ops' corrections. Never changed, only blanked (ADR 0106).
- [hair_systems](#hair_systems): Each hair system kept in stock: its product, base size, colour, grey and density, matched exactly to a client's profile; its stock code is a row of `consumables`, counted in pieces (ADR 0156).
- [idempotency](#idempotency): The stored answer to each `Idempotency-Key`, so a request sent again gets its first answer (ADR 0011).
- [job_events](#job_events): The technician app's writes, each once by the ID the phone gave it, and whether it has reached FSM (ADR 0038, ADR 0065).
- [last_visits](#last_visits): Each client's last first fit, service or replacement done, and last consultation done, kept from the view `last_visits_now` by each write that changes their visits (src/domain/visits/visit-upkeep.ts); the Tasks board's At-risk client and First fit to book read it (ADR 0086), the second along `last_visits_unfitted`, the clients not fitted since their consultation.
- [leads](#leads): Each booking, waitlist sign-up and try-on claim as the CRM receives it, and whether it has reached the CRM and FSM (ADR 0011, ADR 0012).
- [lost_reasons](#lost_reasons): Why a client is not going ahead with a fit after their consultation, as ops set them, one they took off kept as retired; none means the committed list (ADR 0149).
- [maintenance](#maintenance): One row while D1 is being restored: the cron and the queue consumers stand still until it is deleted (runbook, "Restoring D1").
- [move_proposals](#move_proposals): A move to another day ops asked a client to confirm: where the visit would go, until when, and whether it was accepted, taken back or made moot (ADR 0115).
- [no_show_cases](#no_show_cases): The evidence a no-show is ruled on, the ruling, and what a charge cost the client (ADR 0065, ADR 0072, ADR 0096).
- [no_show_disputes](#no_show_disputes): A client's dispute of a no-show's charge, one a charge, and ops' ruling on it, refunded or upheld, with their reason (ADR 0096).
- [no_show_refunds](#no_show_refunds): What a no-show's ruling gives back of the visit's payment, kept as owed with the ruling until it is refunded or left to ops (ADR 0096).
- [number_change_requests](#number_change_requests): A client's change of mobile number: the codes proven on both numbers, and what ops decided (ADR 0042, ADR 0078).
- [number_codes](#number_codes): Each WhatsApp code sent to prove a number typed into the site, with the number and the code only as hashes (ADR 0081, ADR 0104).
- [ops_settings](#ops_settings): The business inputs ops set in the console, a row each; a row that is not there means the committed default (ADR 0061).
- [ops_settings_snapshot](#ops_settings_snapshot): One row holding every `ops_settings` value, kept by that table's triggers: the one row a request reads (ADR 0088).
- [otp_challenges](#otp_challenges): Each one-time code sent, as a hash, with its sends and attempts (ADR 0030, ADR 0052).
- [outbound_messages](#outbound_messages): Each WhatsApp message, from queued to sent, delivered and read (ADR 0041).
- [partial_reasons](#partial_reasons): The reasons a job may be left partly done, as ops set them, one they took off kept as retired; none means the committed list (ADR 0087).
- [partner_payouts](#partner_payouts): Each month's payment to a partner, as Finance made it from the payout tool, with its reference (ADR 0124).
- [pay_grades](#pay_grades): The seniority grades Finance names for technicians' pay per visit (ADR 0122).
- [payment_links](#payment_links): The Razorpay payment link a consultation and fit in one visit is paid by once the client is fitted: one a visit, the product and its price, when Razorpay made and texted it, and the payment that paid it (ADR 0105).
- [payments](#payments): The mirror of Razorpay's payments, and where each stands in Books (ADR 0044).
- [people](#people): One row per person, keyed by mobile number. D1 owns the identity; the CRM's and Books' IDs are only references (ADR 0011, ADR 0110).
- [photo_sets](#photo_sets): A visit's set of photographs, before or after (ADR 0028).
- [photos](#photos): One photograph of a set, by its angle, and where it and its thumbnail are kept in R2 (ADR 0028, ADR 0093).
- [piece_returns](#piece_returns): Each piece that came off a client at a replacement, held in the technician's kit as returned until handed in (ADR 0163).
- [pieces](#pieces): Each piece fitted, its base and lot, the day it was fitted and the day it falls due, and a failure with its reason. `fsm_id` is FSM's ID for a piece mirrored from FSM, otherwise the row's own (ADR 0032, ADR 0110).
- [plan_lines](#plan_lines): Each move the supply plan proposes from a forecast run, a transfer or an order, with the figures behind it and what ops decided (ADR 0180).
- [po_letterhead](#po_letterhead): One row, once ops set it: the legal name, GSTIN and delivery address a printed purchase order carries (ADR 0166).
- [po_lines](#po_lines): Each line of a purchase order: the stock code, how many, the price it was ordered at, and how many have arrived (ADR 0166).
- [price_book](#price_book): Every price from its date, and the only source of prices; an old row stays for what was sold under it (ADR 0045, ADR 0061).
- [purchase_orders](#purchase_orders): Each purchase order to a supplier: its state from drafted to closed or cancelled, who approved, sent or cancelled it, and when (ADR 0166).
- [quick_replies](#quick_replies): Saved answers Customer Care pick in a chat, kept by a Customer Care manager (ADR 0141).
- [razorpay_events](#razorpay_events): Each Razorpay webhook event, once, by its event ID (ADR 0044).
- [recall_pieces](#recall_pieces): Each fitted piece a recall made due for replacement, and the day it was due before (ADR 0187).
- [recalls](#recalls): Each lot recalled: why, who raised it and when, and when it was closed once dealt with (ADR 0187).
- [receipt_lines](#receipt_lines): What a receipt brought of each order line: accepted, damaged, failed its check, its lot, and what one cost landed (ADR 0167).
- [receipts](#receipts): Each receipt against a purchase order at the warehouse: who received it, the supplier's invoice, the rupee rate and the freight, duty and clearing (ADR 0167).
- [referral_attributions](#referral_attributions): A person who came through an invite, to the first invite they used, what became of its grant, and who attached it and why where ops did (ADR 0048, ADR 0089).
- [referral_channels](#referral_channels): Partners who send us clients on their own code: the friend's reward and the partner's commission (ADR 0123).
- [referral_codes](#referral_codes): A client's invite code, the version of their card, and how often the invite was opened (ADR 0048).
- [refunds](#refunds): The mirror of Razorpay's refunds, and where each stands in Books (ADR 0044).
- [remedies](#remedies): Free service visits Customer Care gave a client, with why: given within the limit, or awaiting a manager (ADR 0143).
- [serviceable_pincodes](#serviceable_pincodes): Every NCR pincode, its area and city, and whether and since when we serve it (ADR 0048, ADR 0061).
- [services](#services): What clients may book: each kind of visit's services, their names, the line clients read under each, lengths and order, when each is retired, and its item in FSM's catalogue and in Books; the price book prices each by its kind and tier (ADR 0085, ADR 0110).
- [sessions](#sessions): The client app's and the technician app's sessions: whose, from which device, and when each ends or was revoked (ADR 0029, ADR 0052).
- [site_word_publishes](#site_word_publishes): Each publish of the site's words from the Words page: the changed lines as they stood, which each build of the site lays over its copy (ADR 0127).
- [slot_claims](#slot_claims): What a hold or a visit takes of a technician's day, a row per half-slot and window, so no time is taken twice (ADR 0034, ADR 0069).
- [slot_holds](#slot_holds): A slot held while a client pays, at Checkout or by a payment link ops sent, and what became of it (ADR 0045, ADR 0068).
- [slot_times](#slot_times): Each change of the day's half-slot times ops set, from the day it applies; never changed (ADR 0102).
- [spend_entries](#spend_entries): A month's offline spend to win clients, for a city or national, by channel, as typed on the console's Spend page; one taken off kept, with who and when (ADR 0150).
- [staff](#staff): Each member of staff on the console's Staff list, by their Access e-mail, and whether they are let in (ADR 0109).
- [staff_access_mode](#staff_access_mode): One row: whether the console enforces the Staff list yet, and who last switched it (ADR 0109).
- [staff_grants](#staff_grants): What each member of staff may do: a department, at a level, over a place, national, a zone or a city (ADR 0109).
- [staff_service_tokens](#staff_service_tokens): The Access service tokens let in as every caller was before the Staff list, such as CI's (ADR 0109).
- [standard_costs](#standard_costs): What each first fit and replacement product costs us, from its date, for the margin figures until stock lots carry what was paid; an old row stays for the visits under it (ADR 0152).
- [stock_balances](#stock_balances): What each place holds of each consumable, and when it last counted it: the sum of its rows in `stock_movements`, kept by triggers as each is written (ADR 0087).
- [stock_lot_balances](#stock_lot_balances): What each place holds of each lot: the sum of its rows in `stock_lot_moves`, kept by triggers as each is written (ADR 0157).
- [stock_lot_moves](#stock_lot_moves): What each movement moved of each lot, soonest to expire first, at the movement's place (ADR 0157).
- [stock_lots](#stock_lots): Each lot of a stock code a delivery brought: the supplier's lot, or the day it was received, and the day it expires (ADR 0157).
- [stock_movements](#stock_movements): Every movement of a consumable into or out of the central store or a technician's kit, never changed; what a place holds is the sum of its rows (ADR 0087).
- [stock_places](#stock_places): Where stock is kept, as a tree: the national warehouse, zone hubs, city stockrooms and a kit for each technician, which a trigger adds with them (ADR 0155).
- [stock_risks](#stock_risks): Each fit booked ahead found with no hair system in its city, or no profile to match one by, and when it was no longer at risk (ADR 0178).
- [stock_transfers](#stock_transfers): Each transfer sent to a warehouse, a hub or a stockroom: what left, from where, to where, and whether it arrived, in full or short, or was sent back (ADR 0158).
- [stock_unit_events](#stock_unit_events): Each unit's history, only ever added to: the state it moved into, where, and by which movement (ADR 0161).
- [stock_units](#stock_units): Each hair system piece labelled: its label, stock code and lot, and where it is now, held at a place, in transit, fitted or gone (ADR 0161).
- [storage_meter](#storage_meter): What the apps' two buckets, client-photos and referral-cards, hold together: one row, the sum of `stored_objects` kept beside it, and the last mark of the share ops were told of (ADR 0093); and the last mark of the database's own size they were told of.
- [stored_objects](#stored_objects): Each object client-photos and referral-cards hold, and its size, written as it is stored and deleted as it is, so the storage meter never counts one twice (ADR 0093).
- [supplier_claims](#supplier_claims): Each claim on a supplier: what arrived damaged or failed its check, or a returned piece in warranty, and whether it was sent, credited, replaced, rejected or withdrawn (ADR 0169).
- [supplier_items](#supplier_items): What each supplier supplies of a stock code: their code, price in their currency, pack, minimum order and lead time (ADR 0165).
- [suppliers](#suppliers): Each supplier we buy stock from: its terms, currency and warranty, retired rather than deleted (ADR 0165).
- [targets](#targets): Each month's target for a city, by measure, as set on the console's Targets page; set again, it is replaced (ADR 0154).
- [task_closures](#task_closures): A task on the Tasks board ops closed without doing its thing, a visit left partly done alone, with why, who and when, by the task's group and its row's id (ADR 0092).
- [task_owners](#task_owners): The member of staff a task on the Tasks board is theirs, by Access e-mail, by the task's group, its row's id and, where that row can be a new task again, its episode; a task with no row for it is nobody's (ADR 0092).
- [task_spans](#task_spans): Each task the Tasks board has held, by its group, row and episode: the client's city, when it opened and the night it was first found gone, from which the reporting copy counts Care cases (ADR 0147).
- [technician_devices](#technician_devices): The phones technicians work from, each bound to a session and revocable by ops (ADR 0052).
- [technician_leave](#technician_leave): A technician's leave in whole days, which the clash check reads beside `slot_claims` (ADR 0062).
- [technician_updates](#technician_updates): A technician's word to the client from the job card: on the way, at the gate, or running late, sent from our number (ADR 0145).
- [technicians](#technicians): Each technician: name, initials, mobile number, zone and city, as ops keep them on the Technicians page. `fsm_id` is the ID FSM gave a technician it once held, otherwise one of ours. `city` places them for staff access (ADR 0032, ADR 0052, ADR 0109, ADR 0110).
- [tryon_jobs](#tryon_jobs): One try-on render: the photograph, the look, the provider's job and the result (ADR 0014, ADR 0015).
- [tryon_sessions](#tryon_sessions): The try-on gate's session, which showed a visitor their result (ADR 0014); written no more since the look goes to WhatsApp only (ADR 0104).
- [vendor_breakers](#vendor_breakers): Each vendor's failures in a row, and until when its work waits while it is held off (ADR 0203).
- [visit_blackouts](#visit_blackouts): Days on which no visit is offered.
- [visit_changes](#visit_changes): Each move or cancel a client made, and each cancel ops made, with its notice and what it cost (ADR 0046).
- [visit_outcomes](#visit_outcomes): What an appointment became once it closed, or ops closed it by hand: the outcome, its reason and its times (ADR 0032, ADR 0074).
- [visit_pay_rates](#visit_pay_rates): What a visit pays a technician, beside their salary: per grade and kind of visit, for every city or one, from a date (ADR 0122).
- [waitlist_entries](#waitlist_entries): Someone waiting for us to reach their pincode, and whether they were told it launched (ADR 0048).
- [word_versions](#word_versions): Every wording a line of the site or a WhatsApp message has had on the Words page; the newest is in force (ADR 0126).
- [zoho_access_tokens](#zoho_access_tokens): Each Zoho client's access token, the CRM's, FSM's and Books', and the lease one caller holds while it asks for a new one (ADR 0070, ADR 0110).
- [zones](#zones): A region made of cities, as NCR is, which a grant of staff access may name (ADR 0109).

## addresses

Each address a client has given, in the app or to ops on the phone, who then saved it for them (`given_to_staff`). The current one has `replaced_at` empty; earlier ones stay for the visits booked to them (ADR 0042, ADR 0054, ADR 0092).

Made by `0008_profile.sql`; changed by `0028_address_pin.sql`, `0056_task_owners.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `person_id` | TEXT | no |  | → `people.id` |  |
| `created_at` | TEXT | no |  |  |  |
| `line1` | TEXT | no |  |  |  |
| `line2` | TEXT | yes |  |  |  |
| `locality` | TEXT | no |  |  |  |
| `city` | TEXT | no |  |  |  |
| `pincode` | TEXT | no |  |  |  |
| `access_notes` | TEXT | yes |  |  | "Gate code 4417 · park in visitor bay B": for the technician, from the day before the visit. |
| `lat` | REAL | yes |  |  | Filled once a geocoder is chosen (plan input 16), for the check-in's distance (P2-M4). |
| `lng` | REAL | yes |  |  |  |
| `geocoded_at` | TEXT | yes |  |  |  |
| `replaced_at` | TEXT | yes |  |  |  |
| `building` | TEXT | yes |  |  | The building or society as the client chose it from the suggestions, kept apart from line1 so the old free-text addresses keep their meaning. |
| `flat` | TEXT | yes |  |  | "Flat 1203", "House 4417": the part no map knows and only the client can give. |
| `floor` | TEXT | yes |  |  |  |
| `tower` | TEXT | yes |  |  |  |
| `landmark` | TEXT | yes |  |  | "Opposite the Sector 65 metro gate": what a technician navigates by when the pin lands in the middle of a large society. |
| `place_id` | TEXT | yes |  |  | Google's Place ID for the building. Exempt from their caching restriction and storable for good, so it is what we keep rather than their suggestion text; it is also what re-resolves the coordinate if the address is ever rechecked (docs/decisions/0054-address-capture.md, "What may be kept"). |
| `geocode_source` | TEXT | yes |  |  | Where lat/lng came from, because the licence differs by source and a coordinate we observed is worth more than one a provider computed: google_geocoding  the Geocoding API, resolved from the Place ID above device            the client's own phone, through navigator.geolocation checkin           a technician who has stood at the door The last two are not written yet (ADR 0054 ranks them first and cheapest); they are listed now so adding them needs no second migration. |
| `given_to_staff` | TEXT | yes |  |  | The Access e-mail of the member of staff a client gave the address to on the phone, who saved it for them; NULL for an address the client saved. |

Indexes:

- `addresses_by_person`: on (`person_id`, `replaced_at`)

## alerts

One row per alert while it is open, kept once it is resolved; raising it again counts it (ADR 0067).

Made by `0038_alerts.sql`; changed by `0087_alerts_told.sql`, `0088_alerts_retold.sql`, `0172_retention_reaches_every_table.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `key` | TEXT | no |  |  |  |
| `message` | TEXT | no |  |  |  |
| `link` | TEXT | yes |  |  | A path in the ops console, "/clients/<personId>", where ops act on it. |
| `count` | INTEGER | no |  |  |  |
| `first_seen_at` | TEXT | no |  |  |  |
| `last_seen_at` | TEXT | no |  |  |  |
| `resolved_at` | TEXT | yes |  |  |  |
| `told_at` | TEXT | yes |  |  |  |
| `last_told_at` | TEXT | yes |  |  |  |

Indexes:

- `alerts_open_by_key`: unique on (`key`), where `resolved_at IS NULL`
- `alerts_open_told`: on (`told_at`), where `resolved_at IS NULL AND told_at IS NOT NULL`
- `alerts_resolved`: on (`resolved_at`), where `resolved_at IS NOT NULL`

## appointments

Each visit, mirrored from FSM or booked without it: when, with whom, of what type and in what state, and what we have learnt of each since, such as the window asked for and its invoice. `fsm_id` is FSM's ID for a visit FSM holds, otherwise the row's own (ADR 0032, ADR 0110).

Made by `0011_fsm_mirror.sql`; changed by `0012_fsm_reconciliation.sql`, `0029_invoice_checks.sql`, `0030_invoice_issued.sql`, `0034_leave_and_asked_window.sql`, `0037_cron_indexes.sql`, `0041_vendor_correctness.sql`, `0044_hand_offs_and_messages.sql`, `0048_done_visits.sql`, `0050_services.sql`, `0053_balances_and_last_visits.sql`, `0056_task_owners.sql`, `0059_no_show_charges_and_disputes.sql`, `0060_flat_task_reads.sql`, `0061_one_visit.sql`, `0063_discount_codes.sql`, `0066_client_note_in_fsm.sql`, `0070_field_record_ours.sql`, `0076_books_without_fsm.sql`, `0090_board_version.sql`, `0098_checkin_waivers.sql`, `0099_retention.sql`, `0104_fsm_columns_expand.sql`, `0158_visits_left_open.sql`, `0168_upkeep_out_of_triggers.sql`, `0169_visits_whole.sql`, `0173_fsm_columns_read_the_new.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `fsm_id` | TEXT | no |  |  |  |
| `fsm_work_order_id` | TEXT | yes |  |  |  |
| `person_id` | TEXT | yes |  | → `people.id` | NULL while FSM's client has no mobile number the mirror could match. |
| `type` | TEXT | yes |  |  | NULL for an appointment for none of our four services. |
| `window_start` | TEXT | yes |  |  |  |
| `window_end` | TEXT | yes |  |  |  |
| `technician_id` | TEXT | yes |  | → `technicians.id` | The lead technician. |
| `status` | TEXT | no |  |  |  |
| `service_city` | TEXT | yes |  |  |  |
| `service_pincode` | TEXT | yes |  |  |  |
| `fsm_invoice_id` | TEXT | yes |  |  |  |
| `synced_at` | TEXT | no |  |  |  |
| `deleted_at` | TEXT | yes |  |  | Set when FSM no longer has the appointment. |
| `reconciled_at` | TEXT | yes |  |  | When the last full pass saw the appointment in FSM's list. |
| `invoice_checked_at` | TEXT | yes |  |  |  |
| `invoice_issued_at` | TEXT | yes |  |  |  |
| `asked_window` | TEXT | yes |  |  | The window the client asked for, as against the one the visit was given. FSM holds one time on an appointment and its own Preference subform is read-only there, so the asked window is read from the Request the visit's work order names, and matched to the lead we wrote that Request from (ADR 0063). NULL means nothing recorded one, and the board says so in words. |
| `asked_checked_at` | TEXT | yes |  |  | When the pass last looked, so a visit with no Request behind it — everything our own booking creates — is not asked about again on every run. |
| `asked_failed_at` | TEXT | yes |  |  | When FSM last failed to say what a visit's client asked for. The pass asks about it again an hour later, rather than first on every run (src/domain/booking/asked-windows.ts). |
| `client_note` | TEXT | yes |  |  | The client's note on a visit to come, from the app's "Add a note", which the technician reads on the client's card (src/domain/clients/client-notes.ts). The latest replaces any before it. Blanked when the client is erased. |
| `client_note_at` | TEXT | yes |  |  |  |
| `first_seen_at` | TEXT | yes |  |  | When a visit first reached our records, from a booking or from FSM, which the address it still needs waits from on the Tasks board (src/domain/ops/tasks.ts). Written once, on insert. A visit the Worker already deployed writes has none, and waits from when it was last synced instead. |
| `tier` | TEXT | yes |  |  | The service an appointment is, beside its kind (type): from the hold that booked it, or from its FSM item. Null where neither says, as for every appointment mirrored before this; it is then read as the standard tier. |
| `start_before_move` | TEXT | yes |  |  | When the visit started before ops moved it: the time the client last chose, kept through every move ops make after it and cleared by the client's own. A client's change counts its notice from it where it is later than the visit's time, so a move by ops never takes a free change away. NULL while the visit is where its booking, or the client's last move, put it. |
| `one_visit` | TEXT | yes |  |  | Where a visit booked as one stands: booked until the technician closes it, then fitted, the client having chosen a product and been fitted, or declined, the client having decided against it, when the visit is a consultation. NULL for every other visit. The mirror keeps a fitted visit's product and a declined visit's kind, which FSM's item does not say (docs/decisions/0110-field-work-without-fsm.md, which retired the FSM mirror). |
| `nothing_owed_at` | TEXT | yes |  |  | When the close of a consultation and fit in one visit found its discount code left nothing to pay, so no payment link was made: the fit itself then settles the friend's referral, which otherwise waits for the link's payment. |
| `fsm_note_written_at` | TEXT | yes |  |  | When the visit's note last reached FSM, so an erasure knows which appointments' notes to blank there, and blanks them once. Emptied again when the erasure has blanked it. |
| `fsm_status` | TEXT | yes |  |  | A visit booked without FSM has no FSM status and no time FSM changed it, so both may be empty. Many tables point at appointments, so each column is swapped in place rather than the table rebuilt; no index, trigger or view names either. |
| `fsm_modified_at` | TEXT | yes |  |  |  |
| `checkin_waived_at` | TEXT | yes |  |  |  |
| `checkin_waived_by` | TEXT | yes |  |  |  |
| `checkin_waived_reason` | TEXT | yes |  |  |  |
| `books_invoice_id` | TEXT | yes |  |  |  |

Indexes:

- `appointments_asked_unchecked`: on (`window_start`), where `asked_checked_at IS NULL AND fsm_work_order_id IS NOT NULL AND deleted_at IS NULL AND status IN ('scheduled', 'dispatched', 'in_progress')`
- `appointments_by_person`: on (`person_id`, `window_start`)
- `appointments_by_technician`: on (`technician_id`, `window_start`)
- `appointments_by_window_end`: on (`window_end`)
- `appointments_by_window_start`: on (`window_start`)
- `appointments_done_visits`: on (`window_start`), where `status = 'completed' AND type IN ('first_fit', 'service', 'replacement') AND deleted_at IS NULL`
- `appointments_drafts_held`: on (`window_start`), where `status = 'completed' AND invoice_issued_at IS NULL AND books_invoice_id IS NOT NULL AND deleted_at IS NULL`
- `appointments_held_drafts`: on (`window_start`), where `status = 'completed' AND invoice_issued_at IS NULL AND fsm_invoice_id IS NOT NULL AND deleted_at IS NULL`
- `appointments_live_by_person`: on (`person_id`), where `status IN ('scheduled', 'dispatched', 'in_progress') AND deleted_at IS NULL`
- `appointments_live_by_start`: on (`window_start`), where `status IN ('scheduled', 'dispatched', 'in_progress') AND deleted_at IS NULL`
- `appointments_to_bill`: on (`window_start`), where `status = 'completed' AND invoice_issued_at IS NULL AND deleted_at IS NULL AND type IN ('first_fit', 'service', 'replacement') AND one_visit IS NOT 'declined'`
- `appointments_to_invoice`: on (`window_start`), where `status = 'completed' AND invoice_issued_at IS NULL AND fsm_work_order_id IS NOT NULL AND deleted_at IS NULL`
- A `UNIQUE` constraint: unique on (`fsm_id`)

Triggers: `appointments_kept_whole`, `appointments_whole`.

## audit_log

Every ops action that reads or changes a client's data, and who took it. An entry is never changed (ADR 0031).

Made by `0005_audit.sql`; changed by `0172_retention_reaches_every_table.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | INTEGER | no |  | primary key |  |
| `at` | TEXT | no |  |  |  |
| `surface` | TEXT | no |  |  |  |
| `actor_kind` | TEXT | no |  |  | staff: an Access login, by e-mail. service: an Access service token, by client ID. client, technician: by our own opaque ID. system: a scheduled job, by name. |
| `actor` | TEXT | no |  |  |  |
| `action` | TEXT | no |  |  | e.g. ops.call, photo.view. The list is in src/domain/platform/audit.ts, so a new action needs no migration. |
| `subject_kind` | TEXT | yes |  |  |  |
| `subject_id` | TEXT | yes |  |  |  |
| `request_id` | TEXT | yes |  |  |  |
| `detail` | TEXT | yes |  |  | A JSON object of IDs, counts and codes, never personal details. |

Indexes:

- `audit_log_actor`: on (`actor_kind`, `actor`, `at`)
- `audit_log_by_at`: on (`at`)
- `audit_log_subject`: on (`subject_kind`, `subject_id`, `at`)

Triggers: `audit_log_append_only_delete`, `audit_log_append_only_update`.

## board_version

One row: a number that triggers raise whenever a visit, a move, leave, a technician or the day's slot times change, so the open dispatch board reads itself again only then (ADR 0069).

Made by `0090_board_version.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | INTEGER | no |  | primary key |  |
| `version` | INTEGER | no |  |  |  |

## care_leave

Leave for a Care team member, from one date to another; their chats are covered meanwhile (ADR 0134).

Made by `0117_care_days_off.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `email` | TEXT | no |  |  |  |
| `from_date` | TEXT | no |  |  |  |
| `to_date` | TEXT | no |  |  |  |
| `set_by` | TEXT | no |  |  |  |
| `set_at` | TEXT | no |  |  |  |

Indexes:

- `care_leave_by_end`: on (`to_date`)

## care_names

The first name each Care team member is known by to clients, as their Support card shows it (ADR 0136).

Made by `0119_care_names.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `email` | TEXT | no |  | primary key |  |
| `name` | TEXT | no |  |  |  |
| `set_by` | TEXT | no |  |  |  |
| `set_at` | TEXT | no |  |  |  |

## care_owners

Each client's named Care person, given at their first chat and moved by a Customer Care manager (ADR 0131).

Made by `0116_care_owners.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `person_id` | TEXT | no |  | primary key; → `people.id` |  |
| `email` | TEXT | no |  |  | The Care person, by the e-mail the Staff list names them by; one taken off the list keeps their clients until a manager moves them. |
| `since` | TEXT | no |  |  |  |
| `assigned_by` | TEXT | no |  |  | "system" when given at the first chat; else the manager who moved the client. |

Indexes:

- `care_owners_by_email`: on (`email`)

## care_weekly_off

Each Care team member's weekly days off, as a Customer Care manager sets them (ADR 0134).

Made by `0117_care_days_off.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `email` | TEXT | no |  | primary key |  |
| `weekday` | INTEGER | no |  | primary key |  |
| `set_by` | TEXT | no |  |  |  |
| `set_at` | TEXT | no |  |  |  |

## channel_attributions

A person who came through a partner's code, and what the friend and the partner earned once fitted (ADR 0123).

Made by `0109_referral_channels.sql`; changed by `0110_partner_payouts.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `channel_id` | TEXT | no |  | → `referral_channels.id` |  |
| `referred_person_id` | TEXT | no |  | → `people.id` |  |
| `first_touch_at` | TEXT | no |  |  |  |
| `via` | TEXT | no |  |  |  |
| `pincode` | TEXT | yes |  |  |  |
| `first_fit_appointment_id` | TEXT | yes |  | → `appointments.id` |  |
| `grant_state` | TEXT | no | `'pending'` |  | pending: not fitted yet; granted: the friend's visits given and the commission earned; expired: held on a waitlist past the invite's life; clawed_back: the first fit was refunded under the guarantee. |
| `friend_visits` | INTEGER | yes |  |  | The reward in force when the friend was fitted, kept with it. |
| `valid_days` | INTEGER | yes |  |  |  |
| `commission` | INTEGER | yes |  |  |  |
| `granted_at` | TEXT | yes |  |  |  |
| `created_at` | TEXT | no |  |  |  |
| `updated_at` | TEXT | no |  |  |  |
| `clawed_back_at` | TEXT | yes |  |  | When a refund took a friend's commission back, so the taking back falls in that month's statement. |

Indexes:

- `channel_attributions_by_channel`: on (`channel_id`, `grant_state`)
- `channel_attributions_by_clawed_back`: on (`clawed_back_at`), where `clawed_back_at IS NOT NULL`
- `channel_attributions_by_first_fit`: on (`first_fit_appointment_id`), where `first_fit_appointment_id IS NOT NULL`
- `channel_attributions_by_granted`: on (`granted_at`), where `granted_at IS NOT NULL`
- `channel_attributions_pending`: on (`referred_person_id`), where `grant_state = 'pending'`
- A `UNIQUE` constraint: unique on (`referred_person_id`)

## chat_messages

Every message in a Care inbox thread: what the client wrote, our replies, and notes only staff see (ADR 0129).

Made by `0114_conversations.sql`; changed by `0115_chat_replies.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `conversation_id` | TEXT | no |  | → `conversations.id` |  |
| `direction` | TEXT | no |  |  | in: from the client; out: our reply; note: for staff alone, never sent. |
| `author` | TEXT | no |  |  | "client", a member of staff's e-mail, or "system". |
| `text` | TEXT | yes |  |  | Null once the client's record is erased. |
| `provider_message_id` | TEXT | yes |  |  | WhatsApp's ID for it, through the bridge or MSG91: a message filed twice is filed once. |
| `sent_at` | TEXT | no |  |  |  |
| `created_at` | TEXT | no |  |  |  |
| `delivery` | TEXT | yes |  |  | For a reply: sent, or failed with why; null for the client's messages and staff's notes. |
| `failure` | TEXT | yes |  |  |  |

Indexes:

- `chat_messages_by_conversation`: on (`conversation_id`, `sent_at`)
- `chat_messages_by_provider_id`: unique on (`provider_message_id`), where `provider_message_id IS NOT NULL`

## checkins

Each "I have arrived", passed or not, with the distance measured and the radius in force (ADR 0065); an erasure blanks where the phone was (ADR 0094).

Made by `0026_field_operations.sql`; changed by `0035_checkin_times_and_distance.sql`, `0037_cron_indexes.sql`, `0057_consent_sources_and_checkin_coordinates.sql`, `0085_checkin_job_event.sql`, `0098_checkin_waivers.sql`, `0099_retention.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `appointment_id` | TEXT | no |  | → `appointments.id` |  |
| `technician_id` | TEXT | no |  | → `technicians.id` |  |
| `address_id` | TEXT | yes |  | → `addresses.id` | The address measured against (migration 0008 holds its lat and lng). |
| `at` | TEXT | no |  |  |  |
| `accuracy_m` | REAL | yes |  |  | What the phone claimed of its own fix, in metres; NULL where it said nothing. |
| `radius_m` | INTEGER | no |  |  |  |
| `passed` | INTEGER | no |  |  |  |
| `created_at` | TEXT | no |  |  |  |
| `claimed_at` | TEXT | yes |  |  |  |
| `distance_m` | INTEGER | yes |  |  |  |
| `lat` | REAL | yes |  |  | Where the phone said it was. |
| `lng` | REAL | yes |  |  |  |
| `job_event_id` | TEXT | yes |  | → `job_events.id` |  |
| `waived_by` | TEXT | yes |  |  |  |

Indexes:

- `checkins_by_address`: on (`address_id`), where `address_id IS NOT NULL`
- `checkins_by_appointment`: on (`appointment_id`, `at`)
- `checkins_one_per_job_event`: unique on (`job_event_id`), where `job_event_id IS NOT NULL`
- `checkins_with_coordinates`: on (`created_at`), where `lat IS NOT NULL`

## checklist_items

Each kind of visit's checklist as ops set it, an item they took off kept as retired; a kind with no rows takes the committed list (ADR 0087).

Made by `0049_consumables_and_stock.sql`; changed by `0177_checklist_client_words.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `visit_type` | TEXT | no |  | primary key |  |
| `code` | TEXT | no |  | primary key | What the app sends back; made from the label when the item is added. |
| `label` | TEXT | no |  |  |  |
| `position` | INTEGER | no |  |  | The order the technician sees them in. |
| `retired_at` | TEXT | yes |  |  |  |
| `set_by` | TEXT | no |  |  |  |
| `set_at` | TEXT | no |  |  |  |
| `client_label` | TEXT | yes |  |  | A checklist item's words on the client's record, under "What was done", which are not the technician's: "Refitted" where the technician ticks "Hair system refitted". Null for an item only the technician needs, such as checking a new hair system against its label. An item already saved keeps showing the client what it showed before. |

## cities

Our cities, each a row ops edit at Admin › Cities: its state for GST, its zone, whether it is served and offered. A lead, a pincode, a technician and a stock place name one, and a zone groups them for staff access (ADR 0109, ADR 0198).

Made by `0002_lead_path.sql`; changed by `0069_staff_and_access.sql`, `0167_cities_as_data.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `name` | TEXT | no |  | primary key |  |
| `served` | INTEGER | no |  |  |  |
| `active` | INTEGER | no | `1` |  |  |
| `sort` | INTEGER | no |  |  |  |
| `zone` | TEXT | yes |  | → `zones.name` | NULL for a city in no zone yet, which only a national grant or a grant of that city reaches. |
| `state_code` | TEXT | yes |  |  |  |
| `state` | TEXT | yes |  |  |  |

## city_blackouts

Days on which no visit is offered in one city alone (ADR 0119).

Made by `0107_city_blackouts_and_fitters.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `date` | TEXT | no |  | primary key |  |
| `city` | TEXT | no |  | primary key; → `cities.name` |  |
| `reason` | TEXT | no |  |  |  |
| `set_by` | TEXT | yes |  |  |  |
| `set_at` | TEXT | yes |  |  |  |

## city_matters

A matter Customer Care sent from a chat to the client's city, on that city's Tasks until it is closed (ADR 0135).

Made by `0118_city_matters.sql`; changed by `0172_retention_reaches_every_table.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `person_id` | TEXT | no |  | → `people.id` |  |
| `conversation_id` | TEXT | yes |  | → `conversations.id` |  |
| `city` | TEXT | no |  |  | The client's city when it was sent, which decides whose Tasks it waits on. |
| `note` | TEXT | yes |  |  | Care's words to the city team about the client; NULL once the client is erased. |
| `raised_by` | TEXT | no |  |  |  |
| `raised_at` | TEXT | no |  |  |  |

Indexes:

- `city_matters_by_conversation`: on (`conversation_id`), where `conversation_id IS NOT NULL`
- `city_matters_by_person`: on (`person_id`)

## city_prices

A price a city sets apart from the book's, from a day, which comes first there (ADR 0198).

Made by `0167_cities_as_data.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `item` | TEXT | no |  | primary key |  |
| `tier` | TEXT | no | `'standard'` | primary key |  |
| `city` | TEXT | no |  | primary key; → `cities.name` |  |
| `amount_ex_gst` | INTEGER | no |  |  |  |
| `gst_percent` | INTEGER | no |  |  |  |
| `valid_from` | TEXT | no |  | primary key |  |

## city_settings

A rule a city sets apart from the national one: its check-in radius or reminder hour (ADR 0198).

Made by `0167_cities_as_data.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `city` | TEXT | no |  | primary key; → `cities.name` |  |
| `key` | TEXT | no |  | primary key |  |
| `value` | TEXT | no |  |  |  |
| `updated_by` | TEXT | no |  |  |  |
| `updated_at` | TEXT | no |  |  |  |

## consents

What each person agreed to, under which notice's version, and where (ADR 0094). Rows are only ever added (ADR 0042, ADR 0049).

Made by `0002_lead_path.sql`; changed by `0009_consents_v2.sql`, `0057_consent_sources_and_checkin_coordinates.sql`, `0090_board_version.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `person_id` | TEXT | no |  | → `people.id` |  |
| `purpose` | TEXT | no |  |  |  |
| `notice_version` | TEXT | no |  |  |  |
| `granted` | INTEGER | no |  |  |  |
| `created_at` | TEXT | no |  |  |  |
| `ip_hash` | TEXT | yes |  |  |  |
| `source` | TEXT | yes |  |  |  |

Indexes:

- `consents_by_person`: on (`person_id`)
- `consents_by_person_purpose`: on (`person_id`, `purpose`, `created_at`)

Triggers: `consents_no_delete`, `consents_no_update`.

## consultation_requests

A consultation asked for while self-serve booking is off, for ops to fix the hour (ADR 0060).

Made by `0032_consultation_requests.sql`; changed by `0056_task_owners.sql`, `0061_one_visit.sql`, `0063_discount_codes.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `person_id` | TEXT | no |  | → `people.id` |  |
| `pincode` | TEXT | no |  |  |  |
| `requested_date` | TEXT | no |  |  | The day and window they asked for, in the landing's own three windows. |
| `requested_window` | TEXT | no |  |  |  |
| `referral_code` | TEXT | yes |  | → `referral_codes.code` | The invite they arrived with, where there was one. |
| `created_at` | TEXT | no |  |  |  |
| `booked` | INTEGER | no | `0` |  | Whether the client has a consultation booked or done: one not cancelled, terminated or deleted. A request is a task while they have none, so the board reads only the requests with none, however many leads have asked before. |
| `one_visit` | INTEGER | no | `0` |  | A consultation and fit in one visit asked for while self-serve booking is off, which ops book by hand. |
| `discount_code` | TEXT | yes |  |  | The code the site's form was given with a consultation and fit in one visit asked for while self-serve booking is off, as it was typed and found to apply: ops enter it on the visit they book by hand, which the Tasks board says. |

Indexes:

- `consultation_requests_by_created`: on (`created_at`)
- `consultation_requests_waiting`: on (`created_at`), where `booked = 0`
- A `UNIQUE` constraint: unique on (`person_id`, `requested_date`, `requested_window`)

Triggers: `consultation_requests_booked_asked`.

## consumable_usage

What each service, a kind of visit at a tier of the price book, is expected to use of each consumable: where the technician's steppers start (ADR 0087).

Made by `0049_consumables_and_stock.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `visit_type` | TEXT | no |  | primary key |  |
| `tier` | TEXT | no | `'standard'` | primary key |  |
| `consumable_code` | TEXT | no |  | primary key; → `consumables.code` |  |
| `quantity` | INTEGER | no |  |  | How many of its unit, a whole number. |
| `set_by` | TEXT | no |  |  |  |
| `set_at` | TEXT | no |  |  |  |

## consumables

The consumables ops keep: name, unit, what one costs, the reorder levels, the day it is retired from, and FSM's part for it (ADR 0087).

Made by `0049_consumables_and_stock.sql`; changed by `0135_stock_lots.sql`, `0154_cycle_counts.sql`, `0166_store_reorder_levels.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `code` | TEXT | no |  | primary key | What the technician app sends and the ledger keys on. Made from the name when the consumable is added and never changed, so a rename keeps its history and a phone that queued it offline is still understood. |
| `name` | TEXT | no |  |  |  |
| `unit` | TEXT | no |  |  | What one is counted in: strip, ml, sachet. |
| `unit_cost` | INTEGER | no |  |  | In paise, for one unit. |
| `reorder_kit` | INTEGER | yes |  |  | A kit, or the central store, is low at or below its level; NULL for no level. |
| `reorder_central` | INTEGER | yes |  |  |  |
| `retired_date` | TEXT | yes |  |  | The day in India from which it is no longer offered; NULL while it is. |
| `fsm_item_id` | TEXT | yes |  |  | FSM's Part for it, once the hourly check finds one by its name or the push makes one; the name FSM gives that Part; and when the check first found FSM so. All three stay empty until the check has run. |
| `fsm_name` | TEXT | yes |  |  |  |
| `fsm_checked_at` | TEXT | yes |  |  |  |
| `created_at` | TEXT | no |  |  |  |
| `updated_at` | TEXT | no |  |  |  |
| `shelf_life_days` | INTEGER | yes |  |  | Lots and expiry (docs/decisions/0157-lots-and-expiry.md): a delivery brings a lot of a stock code, with the supplier's lot and the day it expires, and each movement is broken down by the lots it moved, soonest to expire first, so each place knows what it holds of each lot. A stock code's shelf life gives a lot its expiry when the supplier names none. The ledger's rows and balances stay as they are; stock moved before lots, or of no known lot, has none. |
| `count_class` | TEXT | yes |  |  | How often an item is counted wherever it is held; NULL for its kind's own: a hair system weekly, the rest quarterly. |
| `reorder_store` | INTEGER | yes |  |  |  |

Indexes:

- `consumables_name`: unique on (`name`)

## consumables_used

The consumables a technician recorded at a job's third step, with what its service expected and what one cost that day (ADR 0038, ADR 0087).

Made by `0026_field_operations.sql`; changed by `0049_consumables_and_stock.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `appointment_id` | TEXT | no |  | → `appointments.id` |  |
| `job_event_id` | TEXT | no |  | → `job_events.id` | The event that carried it, so a replay updates the same rows. |
| `fsm_item_id` | TEXT | yes |  | → `fsm_items.fsm_id` | FSM's part, once the catalogue has it (migration 0011). |
| `name` | TEXT | no |  |  |  |
| `quantity` | INTEGER | no |  |  |  |
| `created_at` | TEXT | no |  |  |  |
| `consumable_code` | TEXT | yes |  | → `consumables.code` | A job's use as the technician recorded it, now that the step names each consumable by its code: which one, what the job's service expected of it, and what one cost that day. An item a phone queued by name before this release keeps its name alone, and all three stay empty. |
| `expected_quantity` | INTEGER | yes |  |  |  |
| `unit_cost` | INTEGER | yes |  |  |  |

Indexes:

- `consumables_used_by_appointment`: on (`appointment_id`)
- `consumables_used_by_event_and_code`: unique on (`job_event_id`, `consumable_code`), where `consumable_code IS NOT NULL`
- A `UNIQUE` constraint: unique on (`job_event_id`, `name`)

## conversations

The Care inbox: one thread for each number that writes to our WhatsApp number, matched to its client where we know the number (ADR 0129).

Made by `0114_conversations.sql`; changed by `0115_chat_replies.sql`, `0124_care_numbers_indexes.sql`, `0179_chat_archives.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `person_id` | TEXT | yes |  | → `people.id` | The client whose number it is; null for a number we do not know. |
| `mobile_e164` | TEXT | no |  |  | The number the thread is with, as E.164; after an erasure, a placeholder that is nobody's. |
| `state` | TEXT | no | `'open'` |  | open: waiting on us; waiting: on the client; closed: settled, until the client writes again. |
| `opened_at` | TEXT | no |  |  |  |
| `last_message_at` | TEXT | no |  |  |  |
| `last_inbound_at` | TEXT | yes |  |  | When the client last wrote, which opens WhatsApp's 24-hour window for a free reply. |
| `closed_at` | TEXT | yes |  |  |  |
| `closed_by` | TEXT | yes |  |  |  |
| `created_at` | TEXT | no |  |  |  |
| `updated_at` | TEXT | no |  |  |  |
| `close_reason` | TEXT | yes |  |  | What the chat was about, as Care closed it. |
| `archive_key` | TEXT | yes |  |  | A client's Care thread, closed and quiet for a year, has its messages moved out of D1 into the backups bucket, one file for the thread (docs/decisions/0207-closed-chats-archived.md). Where that file is, how many messages it holds, and the thread's last message when it was written: a thread written to again since is archived again once it is quiet a year more. |
| `archived_messages` | INTEGER | no | `0` |  |  |
| `archived_through` | TEXT | yes |  |  |  |

Indexes:

- `conversations_by_number`: unique on (`mobile_e164`)
- `conversations_by_opened`: on (`opened_at`)
- `conversations_by_person`: on (`person_id`), where `person_id IS NOT NULL`
- `conversations_by_state`: on (`state`, `last_message_at`)
- `conversations_to_archive`: on (`last_message_at`), where `state = 'closed' AND person_id IS NOT NULL AND (archived_through IS NULL OR archived_through <> last_message_at)`

## count_lines

Each item a count task counted: what the ledger held, which the counter never saw, the count, any recount, and whether the ledger took it (ADR 0185).

Made by `0154_cycle_counts.sql`; changed by `0162_counts_by_label.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `task_id` | TEXT | no |  | primary key; → `count_tasks.id` |  |
| `consumable_code` | TEXT | no |  | primary key; → `consumables.code` |  |
| `held` | INTEGER | no |  |  | What the ledger held when the line was counted, which the counter never sees. |
| `counted` | INTEGER | no |  |  |  |
| `recounted` | INTEGER | yes |  |  |  |
| `state` | TEXT | no |  |  | settled once the ledger takes it; recount or sign_off while it waits. |
| `labels` | TEXT | yes |  |  | JSON arrays: the labels last scanned, those held and not scanned (gone missing), and those not held there. |
| `missing_labels` | TEXT | yes |  |  |  |
| `unknown_labels` | TEXT | yes |  |  |  |

## count_tasks

Each cycle count of one class of items at one place: raised once its period comes round, counted blind, counted again where it differs, signed off where that stands (ADR 0185).

Made by `0154_cycle_counts.sql`; changed by `0162_counts_by_label.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `place_id` | TEXT | no |  |  | No foreign key: a kit is deleted with a technician added by mistake (migration 0133), and reads leave its tasks out. |
| `count_class` | TEXT | no |  |  |  |
| `due_on` | TEXT | no |  |  |  |
| `state` | TEXT | no |  |  | open until counted; recount while a difference waits to be counted again; sign_off while a recount that still differs waits for a manager; done once every line is settled. |
| `raised_at` | TEXT | no |  |  |  |
| `counted_by` | TEXT | yes |  |  |  |
| `counted_at` | TEXT | yes |  |  |  |
| `recounted_by` | TEXT | yes |  |  |  |
| `recounted_at` | TEXT | yes |  |  |  |
| `signed_off_by` | TEXT | yes |  |  |  |
| `signed_off_at` | TEXT | yes |  |  |  |
| `sign_off_note` | TEXT | yes |  |  |  |
| `done_at` | TEXT | yes |  |  |  |
| `consumable_code` | TEXT | yes |  |  | A task of one item, and who started it; both NULL on the morning's tasks of a class. No foreign key, as place_id has none: an item added by mistake is deleted, and a task of it then reads by its code. |
| `started_by` | TEXT | yes |  |  |  |

Indexes:

- `count_tasks_by_place`: on (`place_id`, `count_class`, `due_on`)
- `count_tasks_done`: on (`done_at`), where `state = 'done'`
- `count_tasks_open`: on (`place_id`, `count_class`), where `state <> 'done'`

## counters

Fixed-window counters for the rate limits and the daily ceilings (ADR 0011).

Made by `0002_lead_path.sql`; changed by `0037_cron_indexes.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `scope` | TEXT | no |  | primary key |  |
| `key` | TEXT | no |  | primary key |  |
| `window_start` | TEXT | no |  | primary key |  |
| `count` | INTEGER | no | `0` |  |  |

Indexes:

- `counters_by_window`: on (`window_start`)

## credit_expiry_cursor

One row: how far the pass that closes expired credits has got, so it reads only the grants that expired since.

Made by `0083_credit_expiry_cursor.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | INTEGER | no |  | primary key |  |
| `open_from_at` | TEXT | no |  |  | Every grant that expired before this has its expire entry; the pass reads from here. |
| `updated_at` | TEXT | no |  |  |  |

## credit_ledger

Service-visit credits, entry by entry, each drawing on the grant it spends; a balance is summed, never kept (ADR 0033).

Made by `0021_referrals.sql`; changed by `0037_cron_indexes.sql`, `0132_credit_closed_once.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `person_id` | TEXT | no |  | → `people.id` |  |
| `kind` | TEXT | no |  |  |  |
| `visits` | INTEGER | no |  |  | Signed: a grant or a restore adds, the others take away. |
| `grant_id` | TEXT | yes |  | → `credit_ledger.id` |  |
| `source_kind` | TEXT | no |  |  | Where it came from: a referral attribution, an appointment, ops, or the pre-January import. |
| `source_id` | TEXT | no |  |  |  |
| `expires_at` | TEXT | yes |  |  |  |
| `created_at` | TEXT | no |  |  |  |

Indexes:

- `credit_ledger_by_grant`: on (`grant_id`)
- `credit_ledger_by_person`: on (`person_id`, `created_at`)
- `credit_ledger_by_source`: on (`source_id`, `kind`)
- `credit_ledger_grants_by_expiry`: on (`expires_at`), where `kind = 'grant'`
- `credit_ledger_one_close`: unique on (`grant_id`), where `kind IN ('expire', 'clawback')`
- `credit_ledger_one_grant`: unique on (`person_id`, `source_kind`, `source_id`), where `kind = 'grant'`
- `credit_ledger_one_use`: unique on (`source_id`, `kind`), where `kind IN ('redeem', 'restore')`

Triggers: `credit_ledger_no_delete`, `credit_ledger_no_update`.

## crm_contact_updates

A client's contact change still owed to their CRM lead, which the sweeper sends again until the lead has it (ADR 0203).

Made by `0174_crm_held_off_and_owed_updates.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `person_id` | TEXT | no |  | primary key; → `people.id` |  |
| `owed_at` | TEXT | no |  |  | the instant the oldest change the lead does not have was made |
| `changed_at` | TEXT | no |  |  | the instant of the latest change, which a sent update must cover |
| `invite_attached` | INTEGER | no | `0` |  | 1 once ops attached an invite |
| `attempts` | INTEGER | no | `0` |  | tries that did not reach the lead |
| `tried_at` | TEXT | yes |  |  | the instant of the last of them; empty since the latest change |

Indexes:

- `crm_contact_updates_due`: on (`null`)

## cron_jobs

Each job of the cron, and how many runs in a row it has failed (ADR 0067).

Made by `0038_alerts.sql`; changed by `0165_cron_job_leases.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `job` | TEXT | no |  | primary key |  |
| `failed_runs` | INTEGER | no | `0` |  |  |
| `last_failed_at` | TEXT | yes |  |  |  |
| `last_error` | TEXT | yes |  |  | The error's message, scrubbed of numbers and e-mail addresses. |
| `lease_until` | TEXT | yes |  |  |  |
| `last_success_at` | TEXT | yes |  |  |  |
| `first_seen_at` | TEXT | yes |  |  |  |

Indexes:

- `cron_jobs_failing`: on (`job`), where `failed_runs > 0`

## cron_runs

One row: when the cron's latest run started and its last finished run ended, so a run cut short is told by the next.

Made by `0068_cron_runs.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | INTEGER | no |  | primary key |  |
| `started_at` | TEXT | no |  |  |  |
| `completed_at` | TEXT | yes |  |  | When the last run to finish did so, which a run in progress leaves in place; empty until one has. |
| `failed_jobs` | INTEGER | yes |  |  | How many of that run's jobs failed. |
| `cut_short_at` | TEXT | yes |  |  | When a run last found the one before it cut short; emptied once runs have finished for an hour after. |

## custom_orders

Each hair system made for one client to their exact spec: the spec, supplier and price, its payment link and payment, and the order it was bought on (ADR 0174).

Made by `0147_custom_orders.sql`; changed by `0149_custom_refunds.sql`, `0160_custom_order_money.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `number` | INTEGER | no |  |  |  |
| `person_id` | TEXT | no |  | → `people.id` |  |
| `product` | TEXT | no |  |  | The spec, from the client's hair profile when raised. |
| `base_width_in` | REAL | no |  |  |  |
| `base_length_in` | REAL | no |  |  |  |
| `colour` | TEXT | no |  |  |  |
| `grey_percent` | INTEGER | no |  |  |  |
| `density_percent` | INTEGER | no |  |  |  |
| `wave` | TEXT | yes |  |  |  |
| `note` | TEXT | yes |  |  |  |
| `supplier_id` | TEXT | no |  | → `suppliers.id` |  |
| `supplier_price` | INTEGER | no |  |  | One piece's price from the supplier, in its currency's smallest unit; and what the client pays, in paise. |
| `amount` | INTEGER | no |  |  |  |
| `promised_on` | TEXT | yes |  |  |  |
| `state` | TEXT | no |  |  |  |
| `razorpay_link_id` | TEXT | yes |  |  |  |
| `short_url` | TEXT | yes |  |  |  |
| `link_sent_at` | TEXT | yes |  |  |  |
| `razorpay_payment_id` | TEXT | yes |  |  |  |
| `paid_at` | TEXT | yes |  |  |  |
| `consumable_code` | TEXT | yes |  | → `consumables.code` | The stock code made to its spec, and the purchase order drafted for it, once paid. |
| `po_id` | TEXT | yes |  | → `purchase_orders.id` |  |
| `raised_by` | TEXT | no |  |  |  |
| `raised_at` | TEXT | no |  |  |  |
| `updated_at` | TEXT | no |  |  |  |
| `refund_reason` | TEXT | yes |  |  | A custom order refunded in full (docs/decisions/0176-custom-order-refunds.md): before its purchase order went out, once its supplier was late past the grace ops set, or once its piece failed its check. Never once the client changes their mind after the order has gone. |
| `razorpay_refund_id` | TEXT | yes |  |  |  |
| `refunded_at` | TEXT | yes |  |  |  |
| `refund_asked_at` | TEXT | yes |  |  |  |
| `payment_checked_at` | TEXT | yes |  |  |  |

Indexes:

- `custom_orders_awaiting_payment`: on (`link_sent_at`), where `state = 'awaiting_payment' AND razorpay_link_id IS NOT NULL`
- `custom_orders_by_person`: on (`person_id`)
- `custom_orders_open`: on (`number`), where `state <> 'cancelled'`
- A `UNIQUE` constraint: unique on (`number`)
- A `UNIQUE` constraint: unique on (`razorpay_link_id`)

## deletion_requests

A client's request to be erased, waiting for ops, and what ops decided (ADR 0042, ADR 0078).

Made by `0008_profile.sql`; changed by `0023_dpdp.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `person_id` | TEXT | no |  | → `people.id` |  |
| `created_at` | TEXT | no |  |  |  |
| `state` | TEXT | no |  |  |  |
| `decided_at` | TEXT | yes |  |  |  |
| `decided_by` | TEXT | yes |  |  |  |
| `reason` | TEXT | yes |  |  |  |
| `alerted_at` | TEXT | yes |  |  |  |

Indexes:

- `deletion_requests_by_state`: on (`state`, `created_at`)

## demand_events

The calendar of uplifts ops keep, each an event in a city or every city, which lifts the forecast's baseline (ADR 0179).

Made by `0151_forecast.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `name` | TEXT | no |  |  |  |
| `city` | TEXT | yes |  |  | NULL for every city. |
| `starts_on` | TEXT | no |  |  |  |
| `ends_on` | TEXT | no |  |  |  |
| `uplift_percent` | INTEGER | no |  |  |  |
| `created_by` | TEXT | no |  |  |  |
| `created_at` | TEXT | no |  |  |  |
| `deleted_at` | TEXT | yes |  |  |  |

Indexes:

- `demand_events_by_end`: on (`ends_on`), where `deleted_at IS NULL`

## deployment_identity

Which environment's database this is, so a Worker refuses to serve on another's (ADR 0003).

Made by `0001_deployment_identity.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | INTEGER | no |  | primary key |  |
| `database_name` | TEXT | no |  |  |  |
| `marked_at` | TEXT | no | `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` |  |  |

Triggers: `deployment_identity_no_delete`, `deployment_identity_no_update`.

## discount_code_uses

Each time a discount code was entered on a booking, its hold or its visit: by whom, and what it took off before GST once the price was known. Never deleted: one taken off is marked removed (ADR 0108).

Made by `0063_discount_codes.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `code_id` | TEXT | no |  | → `discount_codes.id` |  |
| `person_id` | TEXT | no |  | → `people.id` |  |
| `hold_id` | TEXT | yes |  | → `slot_holds.id` | The booking: the hold, for a code entered as the client books; the visit, for one entered after. |
| `appointment_id` | TEXT | yes |  | → `appointments.id` |  |
| `amount_off` | INTEGER | yes |  |  | Paise taken off before GST; NULL until the price is known, as a one visit's is only once its product is chosen. |
| `given_by` | TEXT | no |  |  |  |
| `given_by_id` | TEXT | no |  |  | The client's or the technician's ID, or the Access identity of ops. |
| `created_at` | TEXT | no |  |  |  |
| `removed_at` | TEXT | yes |  |  | Taken off the booking before it was invoiced; NULL while it stands. |
| `removed_by` | TEXT | yes |  |  |  |
| `removed_by_id` | TEXT | yes |  |  |  |

Indexes:

- `discount_code_uses_by_code`: on (`code_id`, `person_id`)
- `discount_code_uses_by_hold`: on (`hold_id`), where `hold_id IS NOT NULL`
- `discount_code_uses_by_person`: on (`person_id`)
- `discount_code_uses_by_visit`: on (`appointment_id`), where `appointment_id IS NOT NULL`
- `discount_code_uses_one_per_hold`: unique on (`hold_id`), where `hold_id IS NOT NULL AND removed_at IS NULL`
- `discount_code_uses_one_per_visit`: unique on (`appointment_id`), where `appointment_id IS NOT NULL AND removed_at IS NULL`

Triggers: `discount_code_uses_kept`, `discount_code_uses_written_once`.

## discount_codes

The discount codes ops make: a percentage with an optional cap or an amount, the kinds of visit each covers, its last day and limits, and whether it is switched off (ADR 0108).

Made by `0063_discount_codes.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `code` | TEXT | no |  |  | In capitals, of the letters and digits none reads as another (src/policy/discount-codes.ts); matched whatever case it is entered in. |
| `kind` | TEXT | no |  |  | percent: value is whole per cent, 1 to 100; amount: value is paise taken off before GST. |
| `value` | INTEGER | no |  |  |  |
| `cap` | INTEGER | yes |  |  | The most a percent code takes off, in paise before GST; NULL for no cap, and always NULL for an amount. |
| `covers_first_fit` | INTEGER | no |  |  | The kinds of visit it takes money off, 1 for each: a one visit is a first fit. |
| `covers_service` | INTEGER | no |  |  |  |
| `covers_replacement` | INTEGER | no |  |  |  |
| `expires_on` | TEXT | yes |  |  | The last day in India it may be entered; NULL for no end. |
| `max_uses` | INTEGER | yes |  |  | How many bookings it may be on; NULL for no limit. |
| `once_per_client` | INTEGER | no |  |  |  |
| `batch_id` | TEXT | yes |  |  | The codes generated with it in one press, as a batch of single-use codes is; NULL for a code made alone. |
| `created_by` | TEXT | no |  |  | The Access identity that made it. |
| `created_at` | TEXT | no |  |  |  |
| `switched_off_by` | TEXT | yes |  |  | Switched off: no booking takes it from then on, and its uses stay as they are. NULL while it is on. |
| `switched_off_at` | TEXT | yes |  |  |  |

Indexes:

- `discount_codes_by_batch`: on (`batch_id`), where `batch_id IS NOT NULL`
- A `UNIQUE` constraint: unique on (`code`)

## dispatch_moves

Every move ops make on the dispatch board: from where to where, by whom, why, what FSM said, and whether the client was told (ADR 0069).

Made by `0026_field_operations.sql`; changed by `0040_dispatch_claims.sql`, `0060_flat_task_reads.sql`, `0090_board_version.sql`, `0094_dispatch_move_blackout_reason.sql`, `0104_fsm_columns_expand.sql`, `0172_retention_reaches_every_table.sql`, `0173_fsm_columns_read_the_new.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `appointment_id` | TEXT | no |  | → `appointments.id` |  |
| `was_technician_id` | TEXT | yes |  | → `technicians.id` | A reassignment changes the technician, a reschedule the time; a move may do both. |
| `now_technician_id` | TEXT | yes |  | → `technicians.id` |  |
| `was_start` | TEXT | yes |  |  |  |
| `now_start` | TEXT | yes |  |  |  |
| `reason` | TEXT | no |  |  |  |
| `actor` | TEXT | no |  |  | The Access identity of the ops user who moved it (ADR 0031). |
| `fsm_write_state` | TEXT | no | `'pending'` |  |  |
| `fsm_error` | TEXT | yes |  |  | No personal data: FSM's status and message only. |
| `message_id` | TEXT | yes |  | → `outbound_messages.id` |  |
| `created_at` | TEXT | no |  |  |  |
| `updated_at` | TEXT | no |  |  |  |
| `told_at` | TEXT | yes |  |  | A client who has not agreed to WhatsApp is told of a move by phone. Ops record that they called, which closes the task (src/policy/tasks.ts). |
| `told_by` | TEXT | yes |  |  |  |
| `blackout_reason` | TEXT | yes |  |  |  |
| `write_state` | TEXT | yes |  |  |  |

Indexes:

- `dispatch_moves_by_appointment`: on (`appointment_id`, `created_at`)
- `dispatch_moves_by_message`: on (`message_id`), where `message_id IS NOT NULL`
- `dispatch_moves_not_told`: on (`now_start`), where `write_state = 'written' AND told_at IS NULL`
- `dispatch_moves_one_at_a_time`: unique on (`appointment_id`), where `fsm_write_state = 'pending'`
- `dispatch_moves_one_waiting`: unique on (`appointment_id`), where `write_state = 'pending'`
- `dispatch_moves_untold`: on (`now_start`), where `fsm_write_state = 'written' AND told_at IS NULL`

Triggers: `dispatch_moves_board_added`, `dispatch_moves_board_changed`.

## events

What happened, for analysis, with no personal data in its payload.

Made by `0002_lead_path.sql`; changed by `0037_cron_indexes.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `created_at` | TEXT | no |  |  |  |
| `name` | TEXT | no |  |  |  |
| `subject_id` | TEXT | yes |  |  |  |
| `payload_json` | TEXT | yes |  |  |  |

Indexes:

- `events_by_name`: on (`name`, `created_at`)
- `events_utilisation_by_day`: on (`subject_id`), where `name = 'dispatch_utilisation'`

## first_fit_requests

A first fit asked for on the site's form with the consultation; a person's latest stands (ADR 0086). The form no longer asks for one (ADR 0105), and only the data export, erasure and an old consultation request's line still read it.

Made by `0047_first_fit_requests.sql`; changed by `0056_task_owners.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `person_id` | TEXT | no |  | → `people.id` |  |
| `preferred_window` | TEXT | yes |  |  | The window the fit is wanted in, where one was given. A first fit takes two slots, which do not fit in the evening's (docs/decisions/0035-window-slot-map.md). |
| `created_at` | TEXT | no |  |  |  |
| `fitted_since` | INTEGER | no | `0` |  | Whether the client has had a first fit, service or replacement done since their last consultation, or with none: read from last_visits, which keeps both (migration 0053). A first fit asked for can be a task only while they have not, so the board reads only those requests, however many clients have been fitted since they asked. |

Indexes:

- `first_fit_requests_by_person`: unique on (`person_id`)
- `first_fit_requests_unfitted`: on (`person_id`), where `fitted_since = 0`

Triggers: `first_fit_requests_fitted_asked`.

## forecast_accuracy

How right each forecast run was: its first period's expected use and high case of each stock code in each city beside what the kits used (ADR 0183).

Made by `0153_forecast_accuracy.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `run_id` | TEXT | no |  | primary key |  |
| `consumable_code` | TEXT | no |  | primary key |  |
| `city` | TEXT | no |  | primary key | '' where the use behind it names no city. |
| `period_start` | TEXT | no |  |  |  |
| `period_days` | INTEGER | no |  |  |  |
| `expected` | REAL | no |  |  |  |
| `high` | REAL | no |  |  |  |
| `actual` | REAL | no |  |  |  |
| `measured_at` | TEXT | no |  |  |  |

Indexes:

- `forecast_accuracy_by_city`: on (`city`, `period_start`)

## forecast_lines

Each forecast run's expected use of each stock code in each city and period, with what each of its four layers gave (ADR 0179).

Made by `0151_forecast.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `run_id` | TEXT | no |  | primary key; → `forecast_runs.id` |  |
| `consumable_code` | TEXT | no |  | primary key |  |
| `city` | TEXT | no |  | primary key | '' where the visits behind it name no city. |
| `period` | INTEGER | no |  | primary key |  |
| `booked` | REAL | no |  |  |  |
| `due` | REAL | no |  |  |  |
| `pipeline` | REAL | no |  |  |  |
| `baseline` | REAL | no |  |  |  |
| `expected` | REAL | no |  |  |  |
| `high` | REAL | no |  |  |  |

## forecast_runs

Each demand forecast run, once a planning period: its period, horizon and the rates it learned (ADR 0179).

Made by `0151_forecast.sql`; changed by `0153_forecast_accuracy.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `run_on` | TEXT | no |  |  | India's date the run's first period starts on. |
| `period_days` | INTEGER | no |  |  |  |
| `horizon_periods` | INTEGER | no |  |  |  |
| `due_rate` | REAL | no |  |  | The rates it learned: the share of clients due who book, and of consultations that become a first fit. |
| `fit_rate` | REAL | no |  |  |  |
| `ran_at` | TEXT | no |  |  |  |
| `measured_at` | TEXT | yes |  |  | When a run was measured, so one whose period used nothing it expected is measured once all the same. |

Indexes:

- `forecast_runs_by_day`: on (`run_on`)
- `forecast_runs_unmeasured`: on (`run_on`), where `measured_at IS NULL`

## fsm_items

FSM's catalogue, to read each appointment's visit type from its service item and to compare FSM's prices with the price book (ADR 0032, ADR 0073).

Made by `0011_fsm_mirror.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `fsm_id` | TEXT | no |  | primary key |  |
| `name` | TEXT | no |  |  |  |
| `type` | TEXT | no |  |  |  |
| `updated_at` | TEXT | no |  |  |  |

## grievances

A client's grievance, and the answer ops recorded (ADR 0049, ADR 0078).

Made by `0023_dpdp.sql`; changed by `0037_cron_indexes.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `person_id` | TEXT | no |  | → `people.id` |  |
| `text` | TEXT | no |  |  | The client's own words; blanked if they are erased. |
| `state` | TEXT | no |  |  |  |
| `response` | TEXT | yes |  |  |  |
| `resolved_by` | TEXT | yes |  |  |  |
| `resolved_at` | TEXT | yes |  |  |  |
| `created_at` | TEXT | no |  |  |  |

Indexes:

- `grievances_by_person`: on (`person_id`)
- `grievances_by_state`: on (`state`, `created_at`)

## gst_registrations

A state's own GST registration, which supplies the visits in it, and its Books branch (ADR 0198).

Made by `0167_cities_as_data.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `state_code` | TEXT | no |  | primary key |  |
| `gstin` | TEXT | no |  |  |  |
| `books_branch_id` | TEXT | yes |  |  | The Books branch its invoices are raised under; null for an organisation with no branches. |
| `added_by` | TEXT | no |  |  |  |
| `added_at` | TEXT | no |  |  |  |

Indexes:

- A `UNIQUE` constraint: unique on (`gstin`)

## hair_profiles

Every version of a client's hair profile, the fit spec and the history: the technician's at a visit, once for each of the phone's events, and ops' corrections. Never changed, only blanked (ADR 0106).

Made by `0064_hair_profiles.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `person_id` | TEXT | no |  | → `people.id` |  |
| `appointment_id` | TEXT | yes |  | → `appointments.id` |  |
| `event_id` | TEXT | yes |  |  |  |
| `technician_id` | TEXT | yes |  | → `technicians.id` |  |
| `staff` | TEXT | yes |  |  |  |
| `created_at` | TEXT | no |  |  |  |
| `norwood_stage` | TEXT | yes |  |  | The fit spec. |
| `head_circumference_cm` | REAL | yes |  |  |  |
| `front_to_nape_cm` | REAL | yes |  |  |  |
| `ear_to_ear_cm` | REAL | yes |  |  |  |
| `temple_to_temple_cm` | REAL | yes |  |  |  |
| `base_width_in` | REAL | yes |  |  |  |
| `base_length_in` | REAL | yes |  |  |  |
| `colour` | TEXT | yes |  |  |  |
| `grey_percent` | INTEGER | yes |  |  |  |
| `density_percent` | INTEGER | yes |  |  |  |
| `wave` | TEXT | yes |  |  |  |
| `hairline` | TEXT | yes |  |  |  |
| `product` | TEXT | yes |  |  |  |
| `attachment` | TEXT | yes |  |  |  |
| `remedies` | TEXT | yes |  |  | The history: remedies tried (a JSON array of codes), a transplant's year, skin conditions and allergies. |
| `transplant_year` | INTEGER | yes |  |  |  |
| `skin_and_allergies` | TEXT | yes |  |  |  |

Indexes:

- `hair_profiles_by_event`: unique on (`appointment_id`, `event_id`)
- `hair_profiles_by_person`: on (`person_id`, `created_at`)

Triggers: `hair_profiles_no_delete`, `hair_profiles_only_blanked`.

## hair_systems

Each hair system kept in stock: its product, base size, colour, grey and density, matched exactly to a client's profile; its stock code is a row of `consumables`, counted in pieces (ADR 0156).

Made by `0134_hair_systems.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `code` | TEXT | no |  | primary key; → `consumables.code` |  |
| `product` | TEXT | no |  |  | The tier of the first-fit service it is sold as, as the hair profile names a product. |
| `base_width_in` | REAL | no |  |  | In inches, to one decimal, as the hair profile records the base. |
| `base_length_in` | REAL | no |  |  |  |
| `colour` | TEXT | no |  |  | The suppliers' colour code, #1B written 1B (src/policy/hair-profile.ts). |
| `grey_percent` | INTEGER | no |  |  |  |
| `density_percent` | INTEGER | no |  |  |  |

Indexes:

- A `UNIQUE` constraint: unique on (`product`, `base_width_in`, `base_length_in`, `colour`, `grey_percent`, `density_percent`)

## idempotency

The stored answer to each `Idempotency-Key`, so a request sent again gets its first answer (ADR 0011).

Made by `0002_lead_path.sql`; changed by `0037_cron_indexes.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `key` | TEXT | no |  | primary key |  |
| `route` | TEXT | no |  | primary key |  |
| `request_hash` | TEXT | no |  |  |  |
| `response_json` | TEXT | yes |  |  |  |
| `created_at` | TEXT | no |  |  |  |

Indexes:

- `idempotency_by_created`: on (`created_at`)

## job_events

The technician app's writes, each once by the ID the phone gave it, and whether it has reached FSM (ADR 0038, ADR 0065).

Made by `0026_field_operations.sql`; changed by `0090_board_version.sql`, `0101_job_event_phone_time.sql`, `0104_fsm_columns_expand.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `appointment_id` | TEXT | no |  | → `appointments.id` |  |
| `event_id` | TEXT | no |  |  | The device's own ID for the event: what the replay is made idempotent on. |
| `technician_id` | TEXT | no |  | → `technicians.id` |  |
| `device_id` | TEXT | yes |  | → `technician_devices.id` |  |
| `kind` | TEXT | no |  |  | The in-job steps, in the order they are taken (src/policy/in-job-steps.ts). |
| `body` | TEXT | no |  |  | The event's own fields, as JSON, as the device sent them. |
| `occurred_at` | TEXT | no |  |  | The phone's clock, kept as evidence; ours, which orders the queue. |
| `received_at` | TEXT | no |  |  |  |
| `fsm_write_state` | TEXT | no | `'pending'` |  | FSM is written first, and the mirror only after FSM accepts (ADR 0032). |
| `fsm_error` | TEXT | yes |  |  | No personal data: FSM's status and message only. |
| `superseded` | INTEGER | no | `0` |  | Set when FSM had changed underneath, say ops reassigned the job while the phone was offline. The technician is shown what changed; the write is refused. |
| `updated_at` | TEXT | no |  |  |  |
| `claimed_at` | TEXT | yes |  |  |  |
| `write_state` | TEXT | yes |  |  |  |

Indexes:

- `job_events_by_appointment_kind`: on (`appointment_id`, `kind`)
- `job_events_unwritten`: on (`fsm_write_state`, `received_at`)
- A `UNIQUE` constraint: unique on (`appointment_id`, `event_id`)

## last_visits

Each client's last first fit, service or replacement done, and last consultation done, kept from the view `last_visits_now` by each write that changes their visits (src/domain/visits/visit-upkeep.ts); the Tasks board's At-risk client and First fit to book read it (ADR 0086), the second along `last_visits_unfitted`, the clients not fitted since their consultation.

Made by `0053_balances_and_last_visits.sql`; changed by `0056_task_owners.sql`, `0095_last_visits_unfitted.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `person_id` | TEXT | no |  | primary key |  |
| `visit_id` | TEXT | yes |  |  |  |
| `visit_start` | TEXT | yes |  |  |  |
| `consulted_start` | TEXT | yes |  |  |  |

Indexes:

- `last_visits_by_visit_start`: on (`visit_start`)
- `last_visits_unfitted`: on (`consulted_start`), where `visit_start IS NULL OR visit_start < consulted_start`

Triggers: `last_visits_fitted_added`, `last_visits_fitted_changed`.

## leads

Each booking, waitlist sign-up and try-on claim as the CRM receives it, and whether it has reached the CRM and FSM (ADR 0011, ADR 0012).

Made by `0002_lead_path.sql`; changed by `0015_fsm_leads.sql`, `0031_optional_loss_extent.sql`, `0037_cron_indexes.sql`, `0038_alerts.sql`, `0039_money_path.sql`, `0120_whatsapp_leads.sql`, `0127_found_us.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `person_id` | TEXT | no |  | → `people.id` |  |
| `created_at` | TEXT | no |  |  |  |
| `city` | TEXT | yes |  | → `cities.name` |  |
| `first_choice_window` | TEXT | yes |  |  |  |
| `proposed_visit_date` | TEXT | yes |  |  |  |
| `utm_source` | TEXT | yes |  |  |  |
| `utm_medium` | TEXT | yes |  |  |  |
| `utm_campaign` | TEXT | yes |  |  |  |
| `utm_content` | TEXT | yes |  |  |  |
| `gclid` | TEXT | yes |  |  |  |
| `fbclid` | TEXT | yes |  |  |  |
| `referrer` | TEXT | yes |  |  |  |
| `landing_path` | TEXT | yes |  |  |  |
| `sync_state` | TEXT | no | `'pending'` |  |  |
| `sync_attempts` | INTEGER | no | `0` |  |  |
| `last_sync_error` | TEXT | yes |  |  |  |
| `synced_at` | TEXT | yes |  |  |  |
| `request_id` | TEXT | no |  |  |  |
| `fsm_request_id` | TEXT | yes |  |  |  |
| `loss_extent` | TEXT | yes |  |  |  |
| `fsm_queued_at` | TEXT | yes |  |  | When a booked lead was put on the fsm-sync queue. Empty on a lead whose queueing failed, which the sweeper then queues (src/scheduled/sweeper.ts). |
| `fsm_request_tried_at` | TEXT | yes |  |  | Set before a lead's Request is first asked of FSM, as for a work order above. |
| `source` | TEXT | yes |  |  |  |
| `found_us` | TEXT | yes |  |  | How the client told Care they found us, for a lead Care saved from a chat (docs/decisions/0148-the-channel-rule.md): one of the channel codes in src/policy/channels.ts. NULL for a lead from the site, whose tags tell. |

Indexes:

- `leads_by_fsm_request`: on (`fsm_request_id`), where `fsm_request_id IS NOT NULL`
- `leads_by_person`: on (`person_id`)
- `leads_by_sync_state`: on (`sync_state`, `created_at`)
- `leads_fsm_unqueued`: on (`created_at`), where `fsm_queued_at IS NULL AND fsm_request_id IS NULL AND source = 'form' AND first_choice_window IS NOT NULL`

## lost_reasons

Why a client is not going ahead with a fit after their consultation, as ops set them, one they took off kept as retired; none means the committed list (ADR 0149).

Made by `0128_lost_reasons.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `code` | TEXT | no |  | primary key |  |
| `label` | TEXT | no |  |  |  |
| `position` | INTEGER | no |  |  |  |
| `retired_at` | TEXT | yes |  |  |  |
| `set_by` | TEXT | no |  |  |  |
| `set_at` | TEXT | no |  |  |  |

## maintenance

One row while D1 is being restored: the cron and the queue consumers stand still until it is deleted (runbook, "Restoring D1").

Made by `0071_maintenance.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | INTEGER | no |  | primary key |  |
| `reason` | TEXT | no |  |  |  |
| `started_at` | TEXT | no | `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` |  |  |

## move_proposals

A move to another day ops asked a client to confirm: where the visit would go, until when, and whether it was accepted, taken back or made moot (ADR 0115).

Made by `0105_move_proposals.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `appointment_id` | TEXT | no |  | → `appointments.id` |  |
| `technician_id` | TEXT | no |  | → `technicians.id` | Where the visit would go. |
| `date` | TEXT | no |  |  |  |
| `window_label` | TEXT | no |  |  |  |
| `reason` | TEXT | no |  |  |  |
| `proposed_by` | TEXT | no |  |  | The Access identity that asked, which the move names once accepted. |
| `expected_technician_id` | TEXT | yes |  |  | The visit as the board showed it when ops asked: a move since makes the proposal moot. |
| `expected_start` | TEXT | no |  |  |  |
| `created_at` | TEXT | no |  |  |  |
| `expires_at` | TEXT | no |  |  | The last moment it may be accepted: two days on, or the visit's own start if that is sooner. |
| `answered_at` | TEXT | yes |  |  |  |
| `answer` | TEXT | yes |  |  |  |
| `move_id` | TEXT | yes |  | → `dispatch_moves.id` |  |
| `message_id` | TEXT | yes |  |  |  |

Indexes:

- `move_proposals_open`: unique on (`appointment_id`), where `answered_at IS NULL`

## no_show_cases

The evidence a no-show is ruled on, the ruling, and what a charge cost the client (ADR 0065, ADR 0072, ADR 0096).

Made by `0026_field_operations.sql`; changed by `0042_no_show_reasons.sql`, `0044_hand_offs_and_messages.sql`, `0054_policies_in_the_console.sql`, `0059_no_show_charges_and_disputes.sql`, `0065_dispute_window.sql`, `0172_retention_reaches_every_table.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `checkin_id` | TEXT | no |  | → `checkins.id` | The check-in the wait ran from; one case per check-in. |
| `appointment_id` | TEXT | no |  | → `appointments.id` |  |
| `wait_started_at` | TEXT | no |  |  |  |
| `wait_ends_at` | TEXT | no |  |  | When "Close as no-show" becomes possible, and when the technician used it. |
| `closed_at` | TEXT | yes |  |  |  |
| `message_id` | TEXT | yes |  | → `outbound_messages.id` | The third fact: the WhatsApp ops read the receipt of, and what the BSP reported. |
| `message_delivered_at` | TEXT | yes |  |  |  |
| `decision` | TEXT | no | `'undecided'` |  | Charged under the 24-hour policy (src/policy/moving-a-visit.ts), or waived. |
| `decided_by` | TEXT | yes |  |  | The Access identity of the ops user who ruled (ADR 0031). |
| `decided_at` | TEXT | yes |  |  |  |
| `created_at` | TEXT | no |  |  |  |
| `decision_reason` | TEXT | yes |  |  |  |
| `waiver_payment` | TEXT | yes |  |  | What a waiver gave back, kept on the ruling: whether the visit's payment was refunded or kept, and its credit returned or spent. Ops set what a waiver gives in the console now, so the client's message and the money follow what was ruled, whatever is set after. Null for a charge, and for a waiver ruled before, which gave both back (WAIVER_GIVES_BACK, src/policy/no-show.ts). |
| `waiver_credit` | TEXT | yes |  |  |  |
| `charge` | TEXT | yes |  |  | What a charged no-show cost the client, as the booking was sold under it (ADR 0088): the charge, what it kept of the visit's payment, and what it gave back, in paise. NULL on a waiver, and on a case charged before this, which kept whatever the visit took and recorded no amount. |
| `kept_amount` | INTEGER | yes |  |  |  |
| `refund_amount` | INTEGER | yes |  |  |  |
| `ruling_id` | TEXT | yes |  |  | The ID of the request that ruled, written with the ruling. What goes in the ruling's batch beside it (its audit entry, the client's message, a credit given back) is written only where the case carries that ID, so a ruling that loses a race to another member of staff's writes nothing. NULL while undecided, and on a case ruled before. |
| `dispute_until` | TEXT | yes |  |  |  |

Indexes:

- `no_show_cases_by_appointment`: on (`appointment_id`, `created_at`)
- `no_show_cases_by_decision`: on (`decision`, `created_at`)
- `no_show_cases_by_message`: on (`message_id`), where `message_id IS NOT NULL`
- A `UNIQUE` constraint: unique on (`checkin_id`)

## no_show_disputes

A client's dispute of a no-show's charge, one a charge, and ops' ruling on it, refunded or upheld, with their reason (ADR 0096).

Made by `0059_no_show_charges_and_disputes.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `case_id` | TEXT | no |  | → `no_show_cases.id` |  |
| `person_id` | TEXT | no |  | → `people.id` |  |
| `reason` | TEXT | yes |  |  | The client's own words; NULL once they are erased. |
| `created_at` | TEXT | no |  |  |  |
| `ruling` | TEXT | yes |  |  |  |
| `ruled_by` | TEXT | yes |  |  |  |
| `ruled_at` | TEXT | yes |  |  |  |
| `ruling_id` | TEXT | yes |  |  | The ID of the request that ruled, which guards what its batch writes beside the ruling, as on no_show_cases. |
| `ruling_reason` | TEXT | yes |  |  | Ops' own words about the client, which reach no message; NULL once the client is erased. |

Indexes:

- `no_show_disputes_by_person`: on (`person_id`)
- `no_show_disputes_open`: on (`created_at`), where `ruling IS NULL`
- A `UNIQUE` constraint: unique on (`case_id`)

## no_show_refunds

What a no-show's ruling gives back of the visit's payment, kept as owed with the ruling until it is refunded or left to ops (ADR 0096).

Made by `0161_no_show_refunds_owed.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `appointment_id` | TEXT | no |  | → `appointments.id` |  |
| `why` | TEXT | no |  |  | What gives it back: a waiver, what a charge does not keep, or a dispute refunded. A ruling is made once, so each is owed once a visit. |
| `amount` | INTEGER | no |  |  | In paise, as ruled; what is refunded is at most what is left of the visit's payment then. |
| `created_at` | TEXT | no |  |  |  |
| `asked_at` | TEXT | yes |  |  | When Razorpay was first asked, written before it is, so a second ask is made as one that may have been made. |
| `settled_at` | TEXT | yes |  |  | When it was done with: refunded, or left to ops with an alert, or nothing left to give back. |
| `razorpay_refund_id` | TEXT | yes |  |  |  |

Indexes:

- `no_show_refunds_owed`: on (`created_at`), where `settled_at IS NULL`
- A `UNIQUE` constraint: unique on (`appointment_id`, `why`)

## number_change_requests

A client's change of mobile number: the codes proven on both numbers, and what ops decided (ADR 0042, ADR 0078).

Made by `0008_profile.sql`; changed by `0041_vendor_correctness.sql`, `0102_number_change_session.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `person_id` | TEXT | no |  | → `people.id` |  |
| `created_at` | TEXT | no |  |  |  |
| `new_mobile_e164` | TEXT | no |  |  |  |
| `old_verified_at` | TEXT | yes |  |  |  |
| `new_verified_at` | TEXT | yes |  |  |  |
| `state` | TEXT | no |  |  |  |
| `decided_at` | TEXT | yes |  |  |  |
| `decided_by` | TEXT | yes |  |  | The member of staff who decided, by their Access e-mail. |
| `reason` | TEXT | yes |  |  |  |
| `replaced_mobile_e164` | TEXT | yes |  |  | The number a confirmed change replaced, so the referral fraud rule can compare every number a person has held (src/domain/referrals/referral-grants.ts). Null on changes confirmed before this migration, and on any not confirmed. |
| `session_id` | TEXT | yes |  |  |  |

Indexes:

- `number_change_requests_by_person`: on (`person_id`, `created_at`)
- `number_change_requests_by_state`: on (`state`, `created_at`)

## number_codes

Each WhatsApp code sent to prove a number typed into the site, with the number and the code only as hashes (ADR 0081, ADR 0104).

Made by `0074_number_codes.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `created_at` | TEXT | no |  |  |  |
| `mobile_hash` | TEXT | no |  |  | The number, only as the rate limits key it: HMAC-SHA256 of "mobile:<E.164>" under IP_HASH_SALT. |
| `code_hash` | TEXT | no |  |  | HMAC-SHA256 of the row's ID and its code, under OTP_PEPPER. |
| `attempts` | INTEGER | no | `0` |  |  |
| `expires_at` | TEXT | no |  |  |  |
| `verified_at` | TEXT | yes |  |  |  |
| `voided_at` | TEXT | yes |  |  |  |

Indexes:

- `number_codes_by_expiry`: on (`expires_at`)

## ops_settings

The business inputs ops set in the console, a row each; a row that is not there means the committed default (ADR 0061).

Made by `0033_ops_settings.sql`; changed by `0054_policies_in_the_console.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `name` | TEXT | no |  | primary key | One of OPS_SETTINGS' names. Not a CHECK constraint, so adding an input needs no table rebuild, exactly as audit_log's actions do not. |
| `value` | TEXT | no |  |  | JSON: a number, or an object of numbers keyed by the input's own keys. The register says which, and the bounds, and refuses anything else before it reaches here. |
| `set_by` | TEXT | no |  |  | The Access identity that set it, as every ops action records (ADR 0031). |
| `set_at` | TEXT | no |  |  |  |

Triggers: `ops_settings_snapshot_on_delete`, `ops_settings_snapshot_on_insert`, `ops_settings_snapshot_on_update`.

## ops_settings_snapshot

One row holding every `ops_settings` value, kept by that table's triggers: the one row a request reads (ADR 0088).

Made by `0054_policies_in_the_console.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | INTEGER | no |  | primary key | There is only ever the one row. |
| `inputs` | TEXT | no |  |  | A JSON object: each ops_settings name, with its value as that row holds it. The register decides at read time whether each still stands, exactly as it does for the rows themselves. |

## otp_challenges

Each one-time code sent, as a hash, with its sends and attempts (ADR 0030, ADR 0052).

Made by `0007_login.sql`; changed by `0008_profile.sql`, `0027_pieces_and_zones.sql`, `0037_cron_indexes.sql`, `0079_challenge_number.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `created_at` | TEXT | no |  |  |  |
| `person_id` | TEXT | yes |  | → `people.id` | NULL for a number with no booking. Such a challenge answers exactly as a real one does, but nothing is sent and no code matches it, so the login screen never says whether a number has a booking. |
| `purpose` | TEXT | no |  |  |  |
| `channel` | TEXT | no |  |  | The channel the current code went by. |
| `code_hash` | TEXT | yes |  |  | HMAC-SHA256 of the challenge's ID and its code, under OTP_PEPPER. NULL for a challenge that sends nothing. |
| `last_sent_at` | TEXT | no |  |  |  |
| `sends` | INTEGER | no | `1` |  |  |
| `attempts` | INTEGER | no | `0` |  |  |
| `expires_at` | TEXT | no |  |  |  |
| `verified_at` | TEXT | yes |  |  |  |
| `voided_at` | TEXT | yes |  |  |  |
| `number_change_id` | TEXT | yes |  | → `number_change_requests.id` | Which number change a code belongs to, for its two challenges. |
| `technician_login` | INTEGER | no | `0` |  | A technician's login code. The challenge is otherwise the client's (migration 0007): same table, same lifetime, same five wrong attempts. Two columns, not one. technician_login says whose login the row belongs to, and each login reads only its own rows; technician_id says which technician, and is NULL for a number FSM does not list, exactly as person_id is NULL for a number with no booking. Without the first column a challenge for an unrecognised number could not be told from a client's, and the answer for a number FSM lists would differ from the answer for one it does not. |
| `technician_id` | TEXT | yes |  | → `technicians.id` |  |
| `mobile_hash` | TEXT | yes |  |  | The number, only as the rate limits key it: HMAC-SHA256 of "mobile:<E.164>" under IP_HASH_SALT. |

Indexes:

- `otp_challenges_by_expiry`: on (`expires_at`)
- `otp_challenges_by_number_change`: on (`number_change_id`), where `number_change_id IS NOT NULL`
- `otp_challenges_by_person`: on (`person_id`, `created_at`)

## outbound_messages

Each WhatsApp message, from queued to sent, delivered and read (ADR 0041).

Made by `0003_tryon.sql`; changed by `0006_outbound_messages_v2.sql`, `0044_hand_offs_and_messages.sql`, `0093_outbound_message_due_at.sql`, `0172_retention_reaches_every_table.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `created_at` | TEXT | no |  |  |  |
| `person_id` | TEXT | no |  | → `people.id` |  |
| `kind` | TEXT | no |  |  |  |
| `subject_kind` | TEXT | no | `'tryon_job'` |  | What the message is about, and its ID in that table. |
| `subject_id` | TEXT | no |  |  | The try-on job whose result this message carries. |
| `state` | TEXT | no |  |  |  |
| `queued_at` | TEXT | yes |  |  |  |
| `sending_at` | TEXT | yes |  |  | Claimed before each send, so two overlapping consumer runs cannot both send it. |
| `provider_message_id` | TEXT | yes |  |  |  |
| `attempts` | INTEGER | no | `0` |  |  |
| `last_error` | TEXT | yes |  |  | No personal data: a provider status and code only. |
| `sent_at` | TEXT | yes |  |  |  |
| `delivered_at` | TEXT | yes |  |  | When WhatsApp reported the message delivered to the phone, and read. The first report wins. |
| `read_at` | TEXT | yes |  |  |  |
| `due_at` | TEXT | yes |  |  |  |

Indexes:

- `outbound_messages_by_created`: on (`created_at`)
- `outbound_messages_by_provider_id`: on (`provider_message_id`)
- `outbound_messages_by_state`: on (`state`, `queued_at`)
- `outbound_messages_by_subject`: on (`subject_id`)
- `outbound_messages_one_arrival`: unique on (`subject_id`), where `kind = 'arrival_notice'`

## partial_reasons

The reasons a job may be left partly done, as ops set them, one they took off kept as retired; none means the committed list (ADR 0087).

Made by `0049_consumables_and_stock.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `code` | TEXT | no |  | primary key |  |
| `label` | TEXT | no |  |  |  |
| `position` | INTEGER | no |  |  |  |
| `retired_at` | TEXT | yes |  |  |  |
| `set_by` | TEXT | no |  |  |  |
| `set_at` | TEXT | no |  |  |  |

## partner_payouts

Each month's payment to a partner, as Finance made it from the payout tool, with its reference (ADR 0124).

Made by `0110_partner_payouts.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `channel_id` | TEXT | no |  | → `referral_channels.id` |  |
| `month` | TEXT | no |  |  | The month paid for, "YYYY-MM", in India. |
| `amount` | INTEGER | no |  |  | Paise, as paid: what the month came to, or less where tax was deducted. |
| `paid_on` | TEXT | no |  |  |  |
| `reference` | TEXT | no |  |  | The payout tool's reference for the transfer: a UTR, or a payout's ID. |
| `recorded_by` | TEXT | no |  |  |  |
| `recorded_at` | TEXT | no |  |  |  |

Indexes:

- A `UNIQUE` constraint: unique on (`channel_id`, `month`)

## pay_grades

The seniority grades Finance names for technicians' pay per visit (ADR 0122).

Made by `0108_technician_pay.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `name` | TEXT | no |  |  |  |
| `created_by` | TEXT | no |  |  |  |
| `created_at` | TEXT | no |  |  |  |

Indexes:

- A `UNIQUE` constraint: unique on (`name`)

## payment_links

The Razorpay payment link a consultation and fit in one visit is paid by once the client is fitted: one a visit, the product and its price, when Razorpay made and texted it, and the payment that paid it (ADR 0105).

Made by `0061_one_visit.sql`; changed by `0080_payment_link_references.sql`, `0091_razorpay_catch_up.sql`, `0157_payment_link_closes.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `appointment_id` | TEXT | no |  | → `appointments.id` |  |
| `tier` | TEXT | no |  |  | The first fit's service the client chose, by its tier. |
| `amount` | INTEGER | no |  |  | In paise: the price with GST, and its parts, as the price book gave them. |
| `amount_ex_gst` | INTEGER | no |  |  |  |
| `gst_percent` | INTEGER | no |  |  |  |
| `razorpay_link_id` | TEXT | yes |  |  | Razorpay's link and its address, once Razorpay has made it and sent it to the client; NULL until then. |
| `short_url` | TEXT | yes |  |  |  |
| `sent_at` | TEXT | yes |  |  |  |
| `refused_at` | TEXT | yes |  |  | When Razorpay refused to make it, which ops are told of; NULL while it may still be asked for. |
| `razorpay_payment_id` | TEXT | yes |  |  | The payment that paid it, once Razorpay's webhook says so. |
| `paid_at` | TEXT | yes |  |  |  |
| `created_at` | TEXT | no |  |  |  |
| `updated_at` | TEXT | no |  |  |  |
| `reference` | TEXT | yes |  |  |  |
| `reference_year` | INTEGER | yes |  |  |  |
| `reference_number` | INTEGER | yes |  |  |  |
| `payment_checked_at` | TEXT | yes |  |  |  |
| `closes_at` | TEXT | yes |  |  |  |

Indexes:

- `payment_links_reference`: unique on (`reference`)
- `payment_links_reference_number`: unique on (`reference_year`, `reference_number`)
- `payment_links_unpaid`: on (`created_at`), where `paid_at IS NULL`
- `payment_links_unsent`: on (`created_at`), where `sent_at IS NULL AND refused_at IS NULL`
- A `UNIQUE` constraint: unique on (`appointment_id`)
- A `UNIQUE` constraint: unique on (`razorpay_link_id`)

## payments

The mirror of Razorpay's payments, and where each stands in Books (ADR 0044).

Made by `0014_payments.sql`; changed by `0019_books_payments.sql`, `0020_visit_changes.sql`, `0037_cron_indexes.sql`, `0039_money_path.sql`, `0096_payments_to_refund.sql`, `0099_retention.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `reference` | TEXT | yes |  |  | Ours, for the client and ops: "MM-2026-0841", numbered by year once the payment is captured. |
| `reference_year` | INTEGER | yes |  |  |  |
| `reference_number` | INTEGER | yes |  |  |  |
| `person_id` | TEXT | yes |  | → `people.id` | From the order's notes when we made the order; else the payment's mobile number matched to a person. |
| `appointment_id` | TEXT | yes |  | → `appointments.id` |  |
| `razorpay_order_id` | TEXT | yes |  |  |  |
| `razorpay_payment_id` | TEXT | no |  |  |  |
| `amount` | INTEGER | no |  |  | In paise. |
| `currency` | TEXT | no |  |  |  |
| `method` | TEXT | yes |  |  | upi, card, netbanking, wallet and so on, as Razorpay names them. |
| `vpa_hash` | TEXT | yes |  |  | HMAC of the lower-cased UPI handle under IP_HASH_SALT: compared, never shown. |
| `card_network` | TEXT | yes |  |  |  |
| `status` | TEXT | no |  |  |  |
| `refunded_amount` | INTEGER | no | `0` |  | In paise; refunds that Razorpay has processed. |
| `captured_at` | TEXT | yes |  |  |  |
| `created_at` | TEXT | no |  |  |  |
| `updated_at` | TEXT | no |  |  |  |
| `books_payment_id` | TEXT | yes |  |  |  |
| `books_checked_at` | TEXT | yes |  |  |  |
| `books_applied_at` | TEXT | yes |  |  |  |
| `kind` | TEXT | no | `'visit'` |  | What a payment paid for: the visit, or a late fee for moving it. |
| `amount_ex_gst` | INTEGER | yes |  |  | What a payment was before GST, and at what rate, as the hold priced it. Null for a payment no hold priced, which the Payments tab splits at GST_PERCENT. |
| `gst_percent` | INTEGER | yes |  |  |  |

Indexes:

- `payments_books_unapplied`: on (`captured_at`), where `books_payment_id IS NOT NULL AND books_applied_at IS NULL`
- `payments_books_unrecorded`: on (`captured_at`), where `books_payment_id IS NULL AND captured_at IS NOT NULL`
- `payments_by_appointment`: on (`appointment_id`)
- `payments_by_order`: on (`razorpay_order_id`)
- `payments_by_person`: on (`person_id`, `created_at`)
- `payments_refunded_visits`: on (`appointment_id`), where `status = 'refunded' AND kind = 'visit'`
- `payments_unbooked`: on (`razorpay_order_id`), where `status = 'captured' AND appointment_id IS NULL`
- A `UNIQUE` constraint: unique on (`reference`)
- A `UNIQUE` constraint: unique on (`razorpay_payment_id`)
- A `UNIQUE` constraint: unique on (`reference_year`, `reference_number`)

Triggers: `people_client_by_payment`, `people_client_by_payment_given`.

## people

One row per person, keyed by mobile number. D1 owns the identity; the CRM's and Books' IDs are only references (ADR 0011, ADR 0110).

Made by `0002_lead_path.sql`; changed by `0004_erasure.sql`, `0011_fsm_mirror.sql`, `0023_dpdp.sql`, `0036_erased_files.sql`, `0037_cron_indexes.sql`, `0070_field_record_ours.sql`, `0076_books_without_fsm.sql`, `0077_books_customer_upkeep.sql`, `0099_retention.sql`, `0100_test_record_flag.sql`, `0103_crm_contact_erasure.sql`, `0163_threads_found_their_client.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `created_at` | TEXT | no |  |  |  |
| `mobile_e164` | TEXT | no |  |  |  |
| `name` | TEXT | no |  |  |  |
| `email` | TEXT | yes |  |  |  |
| `zoho_lead_id` | TEXT | yes |  |  |  |
| `contactable` | INTEGER | no | `0` |  | 1 only once a `contact` consent exists: ops may call and message. |
| `erased_at` | TEXT | yes |  |  |  |
| `crm_erased_at` | TEXT | yes |  |  |  |
| `crm_erasure_attempts` | INTEGER | no | `0` |  |  |
| `crm_erasure_error` | TEXT | yes |  |  | A provider status and code only, never the person's details. |
| `fsm_contact_id` | TEXT | yes |  |  | The FSM contact a person is, once the mirror has matched them by mobile number. |
| `fsm_erased_at` | TEXT | yes |  |  |  |
| `fsm_erasure_attempts` | INTEGER | no | `0` |  |  |
| `files_erased_at` | TEXT | yes |  |  |  |
| `books_customer_id` | TEXT | yes |  |  | The person's customer in Zoho Books, once the Books pass has made it. |
| `books_checked_at` | TEXT | yes |  |  | When the Books pass last tried to make the person's customer: one it could not make waits an hour before it is tried again. |
| `books_erased_at` | TEXT | yes |  |  | The Books erasure pass (src/domain/books/books-erasure.ts), with the tries it took, as the CRM's and FSM's erasures keep theirs. |
| `books_erasure_attempts` | INTEGER | no | `0` |  |  |
| `books_details_changed_at` | TEXT | yes |  |  | When the client's number or address last changed, until the Books pass has written it to their customer. |
| `client_since` | TEXT | yes |  |  |  |
| `test_record` | INTEGER | no | `0` |  |  |
| `crm_contact_id` | TEXT | yes |  |  |  |
| `crm_contact_erased_at` | TEXT | yes |  |  |  |
| `crm_contact_erasure_attempts` | INTEGER | no | `0` |  |  |

Indexes:

- `people_books_erasure_due`: on (`erased_at`), where `erased_at IS NOT NULL AND books_customer_id IS NOT NULL AND books_erased_at IS NULL`
- `people_books_update_due`: on (`books_details_changed_at`), where `books_details_changed_at IS NOT NULL AND books_customer_id IS NOT NULL AND erased_at IS NULL`
- `people_by_books_customer`: unique on (`books_customer_id`), where `books_customer_id IS NOT NULL`
- `people_by_fsm_contact`: unique on (`fsm_contact_id`), where `fsm_contact_id IS NOT NULL`
- `people_crm_contact_erasure_due`: on (`erased_at`), where `crm_contact_id IS NOT NULL AND crm_contact_erased_at IS NULL`
- `people_crm_erasure_due`: on (`erased_at`), where `erased_at IS NOT NULL AND crm_erased_at IS NULL`
- `people_files_to_erase`: on (`erased_at`), where `erased_at IS NOT NULL AND files_erased_at IS NULL`
- `people_fsm_erasure_due`: on (`erased_at`), where `erased_at IS NOT NULL AND fsm_contact_id IS NOT NULL AND fsm_erased_at IS NULL`
- `people_never_clients`: on (`created_at`), where `erased_at IS NULL AND client_since IS NULL`
- A `UNIQUE` constraint: unique on (`mobile_e164`)

Triggers: `conversations_linked_to_new_number`, `conversations_linked_to_new_person`.

## photo_sets

A visit's set of photographs, before or after (ADR 0028).

Made by `0013_client_photos.sql`; changed by `0045_kept_try_ons.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `appointment_id` | TEXT | no |  | → `appointments.id` |  |
| `phase` | TEXT | no |  |  |  |
| `created_at` | TEXT | no |  |  |  |

Indexes:

- `photo_sets_by_created`: on (`created_at`)
- A `UNIQUE` constraint: unique on (`appointment_id`, `phase`)

## photos

One photograph of a set, by its angle, and where it and its thumbnail are kept in R2 (ADR 0028, ADR 0093).

Made by `0013_client_photos.sql`; changed by `0055_storage_meter.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `photo_set_id` | TEXT | no |  | → `photo_sets.id` |  |
| `angle` | TEXT | no |  |  |  |
| `r2_key` | TEXT | no |  |  |  |
| `content_type` | TEXT | no |  |  |  |
| `bytes` | INTEGER | no |  |  |  |
| `width` | INTEGER | yes |  |  | NULL when the image's header does not say. |
| `height` | INTEGER | yes |  |  |  |
| `taken_at` | TEXT | no |  |  |  |
| `fsm_attachment_id` | TEXT | yes |  |  | The FSM attachment it came from, while photographs are taken in FSM's own app. |
| `created_at` | TEXT | no |  |  |  |
| `thumbnail_key` | TEXT | yes |  |  | The small copy the technician's phone makes of each photograph for the client app's rows, in the client-photos bucket beside it (visits/<appointment>/<phase>-<angle>-<take>-small.jpg). Empty for a photograph copied from FSM, or taken before the phone made one: the app shows the photograph itself. |

Indexes:

- A `UNIQUE` constraint: unique on (`r2_key`)
- A `UNIQUE` constraint: unique on (`fsm_attachment_id`)
- A `UNIQUE` constraint: unique on (`photo_set_id`, `angle`)

## piece_returns

Each piece that came off a client at a replacement, held in the technician's kit as returned until handed in (ADR 0163).

Made by `0139_piece_returns.sql`; changed by `0144_supplier_claims.sql`, `0145_stock_photos.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `piece_code` | TEXT | no |  |  |  |
| `appointment_id` | TEXT | no |  |  | The visit it came off at, and the technician whose kit holds it. |
| `technician_id` | TEXT | no |  |  |  |
| `reason` | TEXT | yes |  |  | Why it came off, as the technician said; never the client's name. |
| `returned_at` | TEXT | no |  |  |  |
| `handed_in_at` | TEXT | yes |  |  | Where and when it was handed in; null while the kit still holds it. |
| `handed_in_to` | TEXT | yes |  |  |  |
| `settled_at` | TEXT | yes |  |  | A returned piece handed in is settled once: claimed on its supplier, or written off with why. |
| `settled_by` | TEXT | yes |  |  |  |
| `claim_id` | TEXT | yes |  | → `supplier_claims.id` |  |
| `write_off_reason` | TEXT | yes |  |  |  |
| `settlement_id` | TEXT | yes |  |  | The request that settled it, which what follows from the settlement is written under. |
| `photo_id` | TEXT | yes |  |  | Photographs of stock (docs/decisions/0170-stock-photos.md), each kept in the client-photos bucket under stock/ and counted by the storage meter: a returned piece's when it is written off, which it must have, and a claim's when it is sent, which it may. |

Indexes:

- `piece_returns_held`: on (`technician_id`, `returned_at`), where `handed_in_at IS NULL`
- `piece_returns_to_settle`: on (`handed_in_at`), where `handed_in_at IS NOT NULL AND settled_at IS NULL`
- A `UNIQUE` constraint: unique on (`appointment_id`, `piece_code`)

## pieces

Each piece fitted, its base and lot, the day it was fitted and the day it falls due, and a failure with its reason. `fsm_id` is FSM's ID for a piece mirrored from FSM, otherwise the row's own (ADR 0032, ADR 0110).

Made by `0027_pieces_and_zones.sql`; changed by `0060_flat_task_reads.sql`, `0151_forecast.sql`, `0156_pieces_replaced.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `fsm_id` | TEXT | no |  |  |  |
| `person_id` | TEXT | yes |  | → `people.id` |  |
| `piece_code` | TEXT | no |  |  | FSM's Asset_Number: the label on the piece, e.g. MM-STD-4417-B. The format is a placeholder until the owner sets it (docs/open-points.md, item 25). |
| `base` | TEXT | yes |  |  | The base the piece is built on, from the part item FSM's asset names. |
| `supplier_lot` | TEXT | yes |  |  |  |
| `fitted_at` | TEXT | yes |  |  |  |
| `replacement_due_at` | TEXT | yes |  |  | fitted_at plus the base's cycle (src/config/pieces.ts); NULL until it is fitted. |
| `appointment_id` | TEXT | yes |  | → `appointments.id` | The visit it was fitted on, where we wrote it ourselves. |
| `failed_at` | TEXT | yes |  |  |  |
| `failure_reason` | TEXT | yes |  |  | From the job sheet once its template exists (docs/open-points.md, item 13). |
| `synced_at` | TEXT | no |  |  |  |
| `deleted_at` | TEXT | yes |  |  | Set when FSM no longer has the asset. |
| `replacement_booked` | INTEGER | no | `0` |  | Whether a replacement is booked for the piece: a replacement visit of its client's, not cancelled, on or after the day the piece fell due. |
| `replaced_at` | TEXT | yes |  |  | A piece taken off at a replacement is marked replaced, apart from one that failed, so it no longer reads as worn; a worn piece with a later one fitted for the same client is marked replaced as that one was recorded (docs/decisions/0191-a-replaced-piece-comes-off.md). A piece's recalls are found by the piece, for what a client is owed free (docs/decisions/0192-free-remakes.md). |

Indexes:

- `pieces_by_code`: on (`piece_code`)
- `pieces_by_due`: on (`null`)
- `pieces_by_person`: on (`person_id`, `fitted_at`)
- `pieces_to_replace`: on (`replacement_due_at`), where `replacement_booked = 0 AND deleted_at IS NULL AND failed_at IS NULL AND replacement_due_at IS NOT NULL`
- A `UNIQUE` constraint: unique on (`fsm_id`)

Triggers: `pieces_replacement_booked_added`, `pieces_replacement_booked_changed`.

## plan_lines

Each move the supply plan proposes from a forecast run, a transfer or an order, with the figures behind it and what ops decided (ADR 0180).

Made by `0152_supply_plan.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `run_id` | TEXT | no |  |  | The forecast run it was drafted from (forecast_runs), let go with it. |
| `kind` | TEXT | no |  |  |  |
| `consumable_code` | TEXT | no |  | → `consumables.code` |  |
| `city` | TEXT | yes |  |  | The city it is for; NULL for an order, which the warehouse receives for every city. |
| `from_place` | TEXT | yes |  | → `stock_places.id` |  |
| `to_place` | TEXT | yes |  | → `stock_places.id` |  |
| `supplier_id` | TEXT | yes |  | → `suppliers.id` |  |
| `proposed` | INTEGER | no |  |  |  |
| `quantity` | INTEGER | yes |  |  | As approved, where ops changed it. |
| `usable` | INTEGER | no |  |  | Why: what the city could use, and what it needs over the lead time and a period, and its safety stock. |
| `need` | REAL | no |  |  |  |
| `safety` | REAL | no |  |  |  |
| `state` | TEXT | no |  |  |  |
| `reject_reason` | TEXT | yes |  |  |  |
| `decided_by` | TEXT | yes |  |  |  |
| `decided_at` | TEXT | yes |  |  |  |
| `po_id` | TEXT | yes |  | → `purchase_orders.id` | The purchase order an approved order drafted. |
| `drafted_at` | TEXT | no |  |  |  |

Indexes:

- `plan_lines_by_run`: on (`run_id`)
- `plan_lines_open`: on (`drafted_at`), where `state = 'proposed'`

## po_letterhead

One row, once ops set it: the legal name, GSTIN and delivery address a printed purchase order carries (ADR 0166).

Made by `0176_po_letterhead.sql`; changed by `0180_letterhead_office.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | INTEGER | no |  | primary key |  |
| `legal_name` | TEXT | no |  |  |  |
| `gstin` | TEXT | yes |  |  |  |
| `deliver_to` | TEXT | no |  |  |  |
| `set_by` | TEXT | no |  |  |  |
| `set_at` | TEXT | no |  |  |  |
| `registered_office` | TEXT | yes |  |  | A company's registered office and its CIN, which a printed purchase order carries beside its legal name, as the Companies Act 2013 asks of a company's business letters (s.12(3)(c); docs/decisions/0166-purchase-orders.md). Null until ops set them. |
| `cin` | TEXT | yes |  |  |  |

## po_lines

Each line of a purchase order: the stock code, how many, the price it was ordered at, and how many have arrived (ADR 0166).

Made by `0141_purchase_orders.sql`; changed by `0147_custom_orders.sql`, `0159_receipts_held_to_the_order.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `po_id` | TEXT | no |  | → `purchase_orders.id` |  |
| `consumable_code` | TEXT | no |  | → `consumables.code` |  |
| `quantity` | INTEGER | no |  |  |  |
| `unit_price` | INTEGER | no |  |  | One unit's price in the order's currency, in its smallest unit, as the supplier listed it when drafted. |
| `received_quantity` | INTEGER | no | `0` |  |  |
| `custom_order_id` | TEXT | yes |  | → `custom_orders.id` |  |

Indexes:

- `po_lines_by_order`: on (`po_id`)

Triggers: `po_lines_not_over_received`.

## price_book

Every price from its date, and the only source of prices; an old row stays for what was sold under it (ADR 0045, ADR 0061).

Made by `0016_booking.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `item` | TEXT | no |  | primary key | consultation, first_fit, service, replacement, late_fee_first_fit or late_fee_replacement. |
| `tier` | TEXT | no | `'standard'` | primary key |  |
| `amount_ex_gst` | INTEGER | no |  |  | In paise, before GST. |
| `gst_percent` | INTEGER | no |  |  |  |
| `valid_from` | TEXT | no |  | primary key | India's calendar date it applies from. |

## purchase_orders

Each purchase order to a supplier: its state from drafted to closed or cancelled, who approved, sent or cancelled it, and when (ADR 0166).

Made by `0141_purchase_orders.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `number` | INTEGER | no |  |  | Shown as PO-0001, one after another. |
| `supplier_id` | TEXT | no |  | → `suppliers.id` |  |
| `currency` | TEXT | no |  |  | The supplier's currency when it was drafted, which its lines' prices are in. |
| `state` | TEXT | no |  |  |  |
| `expected_on` | TEXT | yes |  |  | India's date the supplier promised it for. |
| `note` | TEXT | yes |  |  | Ops' own words. Never a client's name. |
| `drafted_by` | TEXT | no |  |  |  |
| `drafted_at` | TEXT | no |  |  |  |
| `approved_by` | TEXT | yes |  |  |  |
| `approved_at` | TEXT | yes |  |  |  |
| `second_approved_by` | TEXT | yes |  |  |  |
| `second_approved_at` | TEXT | yes |  |  |  |
| `sent_by` | TEXT | yes |  |  |  |
| `sent_at` | TEXT | yes |  |  |  |
| `cancelled_by` | TEXT | yes |  |  |  |
| `cancelled_at` | TEXT | yes |  |  |  |
| `cancel_reason` | TEXT | yes |  |  |  |
| `updated_at` | TEXT | no |  |  |  |
| `change_id` | TEXT | yes |  |  | The last change's own token, which its audit entry is written only where it stands. |

Indexes:

- `purchase_orders_open`: on (`expected_on`), where `state IN ('approved', 'sent', 'part_received')`
- A `UNIQUE` constraint: unique on (`number`)

## quick_replies

Saved answers Customer Care pick in a chat, kept by a Customer Care manager (ADR 0141).

Made by `0122_quick_replies.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `title` | TEXT | no |  |  |  |
| `text` | TEXT | no |  |  |  |
| `created_by` | TEXT | no |  |  |  |
| `created_at` | TEXT | no |  |  |  |
| `retired_at` | TEXT | yes |  |  | Taken off the list; kept, as the record of what was offered. |

## razorpay_events

Each Razorpay webhook event, once, by its event ID (ADR 0044).

Made by `0014_payments.sql`; changed by `0172_retention_reaches_every_table.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `event_id` | TEXT | no |  | primary key |  |
| `event` | TEXT | no |  |  |  |
| `received_at` | TEXT | no |  |  |  |

Indexes:

- `razorpay_events_by_received`: on (`received_at`)

## recall_pieces

Each fitted piece a recall made due for replacement, and the day it was due before (ADR 0187).

Made by `0155_recalls.sql`; changed by `0156_pieces_replaced.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `recall_id` | TEXT | no |  | primary key; → `recalls.id` |  |
| `piece_id` | TEXT | no |  | primary key | No foreign key: a client's pieces go with them when they are erased, and reads leave such a row out. |
| `due_before` | TEXT | yes |  |  |  |

Indexes:

- `recall_pieces_by_piece`: on (`piece_id`)

## recalls

Each lot recalled: why, who raised it and when, and when it was closed once dealt with (ADR 0187).

Made by `0155_recalls.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `number` | INTEGER | no |  |  |  |
| `lot_id` | TEXT | no |  | → `stock_lots.id` |  |
| `reason` | TEXT | no |  |  |  |
| `raised_by` | TEXT | no |  |  |  |
| `raised_at` | TEXT | no |  |  |  |
| `closed_by` | TEXT | yes |  |  |  |
| `closed_at` | TEXT | yes |  |  |  |

Indexes:

- `recalls_one_open`: unique on (`lot_id`), where `closed_at IS NULL`
- A `UNIQUE` constraint: unique on (`number`)

## receipt_lines

What a receipt brought of each order line: accepted, damaged, failed its check, its lot, and what one cost landed (ADR 0167).

Made by `0142_receipts.sql`; changed by `0144_supplier_claims.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `receipt_id` | TEXT | no |  | → `receipts.id` |  |
| `po_line_id` | TEXT | no |  | → `po_lines.id` |  |
| `received` | INTEGER | no |  |  | Accepted into stock; the damaged and those that failed their check never enter it. |
| `damaged` | INTEGER | no |  |  |  |
| `qc_failed` | INTEGER | no |  |  |  |
| `lot_code` | TEXT | yes |  |  |  |
| `expires_on` | TEXT | yes |  |  |  |
| `landed_unit_paise` | INTEGER | no |  |  |  |
| `movement_id` | TEXT | yes |  | → `stock_movements.id` | The delivery into the warehouse; null where nothing of the line was accepted. |

Indexes:

- `receipt_lines_by_movement`: on (`movement_id`), where `movement_id IS NOT NULL`
- `receipt_lines_by_receipt`: on (`receipt_id`)

## receipts

Each receipt against a purchase order at the warehouse: who received it, the supplier's invoice, the rupee rate and the freight, duty and clearing (ADR 0167).

Made by `0142_receipts.sql`; changed by `0143_books_bills.sql`, `0178_receipt_rate_micro.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `po_id` | TEXT | no |  | → `purchase_orders.id` |  |
| `received_by` | TEXT | no |  |  |  |
| `received_at` | TEXT | no |  |  |  |
| `supplier_invoice` | TEXT | yes |  |  | The supplier's own invoice number, as printed. |
| `rupee_rate` | INTEGER | no |  |  | Paise per one unit of the order's currency: 100 for rupees, 8325 for a dollar at Rs. 83.25. |
| `freight_paise` | INTEGER | no |  |  |  |
| `duty_paise` | INTEGER | no |  |  |  |
| `clearing_paise` | INTEGER | no |  |  |  |
| `note` | TEXT | yes |  |  | Ops' own words. Never a client's name. |
| `books_bill_id` | TEXT | yes |  |  |  |
| `books_checked_at` | TEXT | yes |  |  |  |
| `rate_micro` | INTEGER | yes |  |  | A receipt's exchange rate in micro-rupees to one whole unit of the order's currency, beside rupee_rate's whole paise: a paisa to the yen, or to the dong, was too coarse a step, and its price in the currency's smallest unit was assumed to be hundredths (src/config/currencies.ts). The code reads rate_micro where it is set, and rupee_rate's paise until then. |

Indexes:

- `receipts_by_order`: on (`po_id`)
- `receipts_to_bill`: on (`received_at`), where `books_bill_id IS NULL`

## referral_attributions

A person who came through an invite, to the first invite they used, what became of its grant, and who attached it and why where ops did (ADR 0048, ADR 0089).

Made by `0021_referrals.sql`; changed by `0037_cron_indexes.sql`, `0044_hand_offs_and_messages.sql`, `0051_invites_ops_attach.sql`, `0060_flat_task_reads.sql`, `0062_referral_reward_kept.sql`, `0073_invite_told_notice.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `code` | TEXT | no |  | → `referral_codes.code` |  |
| `referred_person_id` | TEXT | no |  | → `people.id` |  |
| `first_touch_at` | TEXT | no |  |  |  |
| `via` | TEXT | no |  |  | How they came: a consultation booked, or a place on the waitlist. |
| `pincode` | TEXT | yes |  |  |  |
| `consultation_appointment_id` | TEXT | yes |  | → `appointments.id` |  |
| `first_fit_appointment_id` | TEXT | yes |  | → `appointments.id` |  |
| `grant_state` | TEXT | no | `'pending'` |  | pending: not fitted yet; held: waiting for ops' review; approved and granted; rejected; expired: the invite lapsed, so a consultation but no credits; clawed_back: the first fit was refunded under the guarantee. |
| `fraud_signals` | TEXT | yes |  |  | Why a grant was held: a JSON list of the fraud rules it met. |
| `review_reason` | TEXT | yes |  |  |  |
| `reviewed_by` | TEXT | yes |  |  |  |
| `reviewed_at` | TEXT | yes |  |  |  |
| `created_at` | TEXT | no |  |  |  |
| `updated_at` | TEXT | no |  |  |  |
| `friend_first_name` | TEXT | yes |  |  | The friend's first name, kept with the referral when it is granted, so the referrer's tracker reads it without the friend's record, and an erasure, which blanks it, shows "A friend" rather than "Erased" (src/routes/client/refer.ts). Filled here for the grants already made to a friend not erased. |
| `attached_by` | TEXT | yes |  |  |  |
| `attach_reason` | TEXT | yes |  |  |  |
| `referrer_visits` | INTEGER | yes |  |  |  |
| `friend_visits` | INTEGER | yes |  |  |  |
| `credit_valid_days` | INTEGER | yes |  |  |  |
| `told_notice` | TEXT | yes |  |  |  |

Indexes:

- `referral_attributions_by_code`: on (`code`, `created_at`)
- `referral_attributions_by_first_fit`: on (`first_fit_appointment_id`), where `first_fit_appointment_id IS NOT NULL`
- `referral_attributions_held`: on (`code`), where `grant_state = 'held'`
- `referral_attributions_pending`: on (`referred_person_id`), where `grant_state = 'pending'`
- A `UNIQUE` constraint: unique on (`referred_person_id`)

## referral_channels

Partners who send us clients on their own code: the friend's reward and the partner's commission (ADR 0123).

Made by `0109_referral_channels.sql`; changed by `0111_partner_discount.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `name` | TEXT | no |  |  | As the invite page names it: "Recommended by Looks Salon". |
| `code` | TEXT | no |  |  | In capitals, of the letters and digits none reads as another, as a client's code is; never one a client has. |
| `friend_visits` | INTEGER | no |  |  | What the friend gets once fitted: service visits, and how many days they last. |
| `valid_days` | INTEGER | no |  |  |  |
| `commission` | INTEGER | no |  |  | What the partner earns for each friend fitted, in paise; 0 for none. |
| `paused_at` | TEXT | yes |  |  | Paused: nobody new comes through it, and its code reads as one we do not have. |
| `opens` | INTEGER | no | `0` |  | The invite page opened, once a day for each address, as a client's code counts its opens. |
| `created_by` | TEXT | no |  |  |  |
| `created_at` | TEXT | no |  |  |  |
| `changed_by` | TEXT | yes |  |  |  |
| `changed_at` | TEXT | yes |  |  |  |
| `discount_code_id` | TEXT | yes |  | → `discount_codes.id` | A partner's discount code for the friends it sends (docs/decisions/0125-partner-discount-codes.md): one of Finance's codes, which comes off the friend's first paid visit by itself, beside or instead of the partner's free visits. |

Indexes:

- `referral_channels_by_discount_code`: on (`discount_code_id`)
- A `UNIQUE` constraint: unique on (`name`)
- A `UNIQUE` constraint: unique on (`code`)

## referral_codes

A client's invite code, the version of their card, and how often the invite was opened (ADR 0048).

Made by `0021_referrals.sql`; changed by `0024_referral_opens.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `code` | TEXT | no |  | primary key |  |
| `person_id` | TEXT | no |  | → `people.id` |  |
| `card_state` | TEXT | no | `'house'` |  |  |
| `card_version` | INTEGER | no | `1` |  |  |
| `card_key` | TEXT | yes |  |  |  |
| `created_at` | TEXT | no |  |  |  |
| `updated_at` | TEXT | no |  |  |  |
| `opens` | INTEGER | no | `0` |  |  |

Indexes:

- A `UNIQUE` constraint: unique on (`person_id`)

## refunds

The mirror of Razorpay's refunds, and where each stands in Books (ADR 0044).

Made by `0014_payments.sql`; changed by `0019_books_payments.sql`, `0037_cron_indexes.sql`, `0096_payments_to_refund.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `payment_id` | TEXT | no |  | → `payments.id` |  |
| `razorpay_refund_id` | TEXT | no |  |  |  |
| `amount` | INTEGER | no |  |  |  |
| `status` | TEXT | no |  |  |  |
| `speed` | TEXT | yes |  |  | normal or optimum, as asked; Razorpay reports the speed it used. |
| `created_at` | TEXT | no |  |  |  |
| `processed_at` | TEXT | yes |  |  |  |
| `updated_at` | TEXT | no |  |  |  |
| `books_refund_id` | TEXT | yes |  |  |  |
| `books_checked_at` | TEXT | yes |  |  |  |

Indexes:

- `refunds_books_unrecorded`: on (`created_at`), where `status = 'processed' AND books_refund_id IS NULL`
- `refunds_by_payment`: on (`payment_id`)
- `refunds_failed`: on (`payment_id`), where `status = 'failed'`
- A `UNIQUE` constraint: unique on (`razorpay_refund_id`)

## remedies

Free service visits Customer Care gave a client, with why: given within the limit, or awaiting a manager (ADR 0143).

Made by `0123_remedies.sql`; changed by `0124_care_numbers_indexes.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `person_id` | TEXT | no |  | → `people.id` |  |
| `visits` | INTEGER | no |  |  |  |
| `reason` | TEXT | no |  |  |  |
| `note` | TEXT | yes |  |  | Care's words about it; NULL once the client is erased. |
| `given_by` | TEXT | no |  |  |  |
| `given_at` | TEXT | no |  |  |  |
| `state` | TEXT | no |  |  |  |
| `decided_by` | TEXT | yes |  |  |  |
| `decided_at` | TEXT | yes |  |  |  |

Indexes:

- `remedies_awaiting`: on (`given_at`), where `state = 'awaiting'`
- `remedies_by_given`: on (`given_at`)
- `remedies_by_person`: on (`person_id`, `given_at`)

## serviceable_pincodes

Every NCR pincode, its area and city, and whether and since when we serve it (ADR 0048, ADR 0061).

Made by `0021_referrals.sql`; changed by `0043_area_names.sql`, `0167_cities_as_data.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `pincode` | TEXT | no |  | primary key |  |
| `area` | TEXT | no |  |  | The area a client would recognise ("Saket"), and the city. |
| `city` | TEXT | no |  |  |  |
| `served` | INTEGER | no | `0` |  |  |
| `launched_at` | TEXT | yes |  |  | When a technician started coming, or will start. |
| `area_named_by` | TEXT | yes |  |  |  |

Triggers: `serviceable_pincodes_in_a_city`, `serviceable_pincodes_moved_to_a_city`.

## services

What clients may book: each kind of visit's services, their names, the line clients read under each, lengths and order, when each is retired, and its item in FSM's catalogue and in Books; the price book prices each by its kind and tier (ADR 0085, ADR 0110).

Made by `0050_services.sql`; changed by `0070_field_record_ours.sql`, `0092_service_description.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `kind` | TEXT | no |  | primary key | The kind of visit, which decides the technician's steps, the booking rules and the fees. |
| `tier` | TEXT | no |  | primary key | The code the price book prices it under: small letters, digits and _, a letter first (PRICE_TIER, src/policy/ops-settings.ts). Made from its first name, and never changed after, so its prices stay its own. |
| `name` | TEXT | no |  |  | What clients, ops and FSM's catalogue call it. One name, one service, so FSM's item can be found by it. |
| `minutes` | INTEGER | no |  |  | How long FSM books it for, which is the time the scheduler reserves (src/policy/visit-length.ts). |
| `sort` | INTEGER | no | `0` |  | Its place among its kind's services, as the console and the app list them. |
| `retired_date` | TEXT | yes |  |  | India's date from which clients no longer see it or book it; null while it is offered. |
| `fsm_item_id` | TEXT | yes |  |  | Its service item in FSM's catalogue, once found or made; until then it is looked for by name. |
| `updated_by` | TEXT | no |  |  | The Access identity that last changed it, and when; the audit log holds each change. |
| `updated_at` | TEXT | no |  |  |  |
| `books_item_id` | TEXT | yes |  |  | The service's item in Zoho Books, once found by name or made. |
| `description` | TEXT | yes |  |  |  |

Indexes:

- A `UNIQUE` constraint: unique on (`name`)

## sessions

The client app's and the technician app's sessions: whose, from which device, and when each ends or was revoked (ADR 0029, ADR 0052).

Made by `0007_login.sql`; changed by `0037_cron_indexes.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key | SHA-256 of the cookie's token. The token itself is never stored. |
| `subject_kind` | TEXT | no |  |  | A client (people.id) now; a technician from P2-M4. |
| `subject_id` | TEXT | no |  |  |  |
| `created_at` | TEXT | no |  |  |  |
| `last_seen_at` | TEXT | no |  |  |  |
| `expires_at` | TEXT | no |  |  |  |
| `device_label` | TEXT | yes |  |  | What the browser said it was at login, e.g. "Chrome on Android", for the profile's list of devices. |
| `revoked_at` | TEXT | yes |  |  |  |

Indexes:

- `sessions_by_expiry`: on (`expires_at`)
- `sessions_by_revoked`: on (`revoked_at`), where `revoked_at IS NOT NULL`
- `sessions_by_subject`: on (`subject_kind`, `subject_id`)

## site_word_publishes

Each publish of the site's words from the Words page: the changed lines as they stood, which each build of the site lays over its copy (ADR 0127).

Made by `0113_site_word_publishes.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `words` | TEXT | no |  |  | JSON: each changed line's key, as src/config/words.json names it, and its words. |
| `lines` | INTEGER | no |  |  |  |
| `published_by` | TEXT | no |  |  |  |
| `published_at` | TEXT | no |  |  |  |

Indexes:

- `site_word_publishes_by_time`: on (`published_at`)

## slot_claims

What a hold or a visit takes of a technician's day, a row per half-slot and window, so no time is taken twice (ADR 0034, ADR 0069).

Made by `0016_booking.sql`; changed by `0040_dispatch_claims.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `technician_id` | TEXT | no |  | primary key; → `technicians.id` |  |
| `date` | TEXT | no |  | primary key |  |
| `claim` | TEXT | no |  | primary key |  |
| `hold_id` | TEXT | yes |  | → `slot_holds.id` |  |
| `move_id` | TEXT | yes |  | → `dispatch_moves.id` |  |

Indexes:

- `slot_claims_by_hold`: on (`hold_id`)
- `slot_claims_by_move`: on (`move_id`), where `move_id IS NOT NULL`

## slot_holds

A slot held while a client pays, at Checkout or by a payment link ops sent, and what became of it (ADR 0045, ADR 0068).

Made by `0016_booking.sql`; changed by `0017_hold_refunds.sql`, `0020_visit_changes.sql`, `0022_credit_bookings.sql`, `0037_cron_indexes.sql`, `0039_money_path.sql`, `0050_services.sql`, `0053_balances_and_last_visits.sql`, `0054_policies_in_the_console.sql`, `0058_held_bookings.sql`, `0061_one_visit.sql`, `0075_pay_by_link.sql`, `0078_consents_shown.sql`, `0080_payment_link_references.sql`, `0086_automatic_refunds.sql`, `0091_razorpay_catch_up.sql`, `0181_pay_at_visit.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `person_id` | TEXT | no |  | → `people.id` |  |
| `type` | TEXT | no |  |  |  |
| `date` | TEXT | no |  |  | India's calendar date, and the window booked on it. |
| `window_label` | TEXT | no |  |  |  |
| `technician_id` | TEXT | no |  | → `technicians.id` |  |
| `start_unit` | INTEGER | no |  |  | The half-slot the visit starts in (src/config/scheduling.ts). |
| `amount` | INTEGER | no |  |  | The price when it was held, in paise: what the client pays, and its GST. |
| `amount_ex_gst` | INTEGER | no |  |  |  |
| `gst_percent` | INTEGER | no |  |  |  |
| `state` | TEXT | no |  |  | held: waiting to be paid; booked: paid (or free) and written to FSM; released: let go or expired unpaid. |
| `razorpay_order_id` | TEXT | yes |  |  |  |
| `appointment_id` | TEXT | yes |  | → `appointments.id` |  |
| `expires_at` | TEXT | no |  |  |  |
| `created_at` | TEXT | no |  |  |  |
| `updated_at` | TEXT | no |  |  |  |
| `refunded_at` | TEXT | yes |  |  |  |
| `moves_appointment_id` | TEXT | yes |  | → `appointments.id` | A hold made to move a visit: which visit, and whether it moves in place ('move': free, or once its late fee is paid) or is replaced by a new visit ('replace': a service visit moved inside 24 hours, the old one charged). |
| `move_kind` | TEXT | yes |  |  |  |
| `use_credit` | INTEGER | no | `0` |  |  |
| `confirmed_at` | TEXT | yes |  |  | When the client's side of a hold was done: Razorpay's own time for its payment, or when a free visit was booked. From then the hold keeps its time until it is booked or refunded, however long FSM takes, and nothing else lets it go. |
| `queued_at` | TEXT | yes |  |  | When the booking was put on the fsm-sync queue, or was due to be. The cron puts back one still neither booked nor refunded 30 minutes later. |
| `booking_until` | TEXT | yes |  |  | The lease one consumer holds while it writes the hold to FSM, so two never write it at once. |
| `fsm_tried_at` | TEXT | yes |  |  | Set before the work order is first asked for, so a later try knows FSM may have made one whose answer never reached us, and looks for it first. |
| `fsm_work_order_id` | TEXT | yes |  |  | FSM's IDs, each kept the moment FSM answers with it, so a retry reuses them. |
| `fsm_appointment_id` | TEXT | yes |  |  |  |
| `pincode` | TEXT | yes |  |  | Where the visit is: the pincode it was booked at, for the visit and FSM. |
| `late_fee_ex_gst` | INTEGER | yes |  |  | A first fit's or a replacement's late fee when it was held, in paise before GST, and its rate: what moving or cancelling it late costs, whatever the price book says later. |
| `late_fee_gst_percent` | INTEGER | yes |  |  |  |
| `tier` | TEXT | no | `'standard'` |  | The service a hold is for, beside its kind (type): its price, late fee and length are copied onto it as it is made, so what the client was sold stays sold whatever ops change after. |
| `minutes` | INTEGER | yes |  |  | How long the hold's visit was held for, in minutes: the service's length when it was made. Null for a hold made before services had lengths of their own, which took its kind's (VISIT_BLOCKS). |
| `grace_seconds` | INTEGER | yes |  |  | The grace a hold was made with, in seconds: how long after its countdown a payment Razorpay made still counts as in time, and how long an unpaid hold keeps its time (docs/decisions/0068-a-paid-hold-is-kept.md). Ops set it in the console now; a hold keeps the one it was made with. Null for a hold made before, which had the committed two minutes (PAYMENT_GRACE_SECONDS, src/config/scheduling.ts). |
| `change_notice_hours` | INTEGER | yes |  |  | The terms a hold was sold under, so a change in the console never moves a promise already made: how many hours before its window moving or cancelling it stops being free, and what its kind costs inside that notice, and what it costs if the client is not home. Each charge is one of src/policy/moving-a-visit.ts's Charge ('nothing', 'late_fee', 'visit'); there is no CHECK, since slot_holds is referenced by other tables and could not be rebuilt to change one. Null for a hold made before, which was sold under the committed terms (FREE_CHANGE_NOTICE_HOURS, LATE_CHANGE_CHARGES, NO_SHOW_CHARGES). |
| `late_change_charge` | TEXT | yes |  |  |  |
| `no_show_charge` | TEXT | yes |  |  |  |
| `fsm_held_at` | TEXT | yes |  |  | When FSM's fifth refusal running held the booking for ops, rather than giving it up. The hourly tries count their 24 hours from it, and the Tasks board lists the booking from it until it is booked or refunded. Kept once the booking is booked or refunded, as the record that it waited. |
| `fsm_refusal` | TEXT | yes |  |  | FSM's latest refusal, as the log gives it (failureReason, src/log.ts), for ops to read beside the booking. |
| `one_visit` | INTEGER | no | `0` |  | A hold the site's form made for a consultation and fit in one visit: a first fit, sold with nothing paid. |
| `pay_by_link` | INTEGER | no | `0` |  | A hold ops made that the client pays for by a payment link, rather than at the app's Checkout. |
| `payment_link_id` | TEXT | yes |  |  | The link Razorpay made for it, and the address Razorpay texted the client. |
| `payment_link_url` | TEXT | yes |  |  |  |
| `consents_shown` | TEXT | yes |  |  | The purposes shown, comma-separated, as "photos_own_record,photos_referral_cards". |
| `consents_ip_hash` | TEXT | yes |  |  | The tapping client's hashed address, which the consent rows carry. |
| `reference` | TEXT | yes |  |  |  |
| `reference_year` | INTEGER | yes |  |  |  |
| `reference_number` | INTEGER | yes |  |  |  |
| `auto_refund_reason` | TEXT | yes |  |  |  |
| `payment_checked_at` | TEXT | yes |  |  |  |
| `pay_at_visit` | INTEGER | no | `0` |  | A paid visit ops booked while online payment is off: nothing is taken at booking, the client pays by UPI at the visit, and ops record the payment once it reaches the account (docs/decisions/0208-paid-at-the-visit-by-upi.md). |

Indexes:

- `slot_holds_by_appointment`: on (`appointment_id`), where `appointment_id IS NOT NULL`
- `slot_holds_by_payment_link`: unique on (`payment_link_id`), where `payment_link_id IS NOT NULL`
- `slot_holds_by_person`: on (`person_id`, `created_at`)
- `slot_holds_confirmed`: on (`queued_at`), where `state = 'held' AND confirmed_at IS NOT NULL`
- `slot_holds_confirmed_by_person`: on (`person_id`), where `state = 'held' AND confirmed_at IS NOT NULL`
- `slot_holds_held`: on (`expires_at`), where `state = 'held'`
- `slot_holds_reference`: unique on (`reference`)
- `slot_holds_reference_number`: unique on (`reference_year`, `reference_number`)
- `slot_holds_unconfirmed`: on (`expires_at`), where `confirmed_at IS NULL`
- A `UNIQUE` constraint: unique on (`razorpay_order_id`)

## slot_times

Each change of the day's half-slot times ops set, from the day it applies; never changed (ADR 0102).

Made by `0067_slot_times.sql`; changed by `0090_board_version.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `applies_from` | TEXT | no |  |  |  |
| `unit_starts` | TEXT | no |  |  | A JSON array of eight "HH:MM", in order. |
| `day_end` | TEXT | no |  |  |  |
| `set_by` | TEXT | no |  |  | The member of staff's Access e-mail, and when they set it. |
| `set_at` | TEXT | no |  |  |  |

Indexes:

- A `UNIQUE` constraint: unique on (`applies_from`)

Triggers: `slot_times_board_added`, `slot_times_no_delete`, `slot_times_no_update`.

## spend_entries

A month's offline spend to win clients, for a city or national, by channel, as typed on the console's Spend page; one taken off kept, with who and when (ADR 0150).

Made by `0129_spend_entries.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `month` | TEXT | no |  |  |  |
| `city` | TEXT | yes |  | → `cities.name` |  |
| `channel` | TEXT | no |  |  |  |
| `campaign` | TEXT | yes |  |  |  |
| `amount` | INTEGER | no |  |  |  |
| `note` | TEXT | yes |  |  |  |
| `entered_by` | TEXT | no |  |  |  |
| `entered_at` | TEXT | no |  |  |  |
| `removed_by` | TEXT | yes |  |  |  |
| `removed_at` | TEXT | yes |  |  |  |

Indexes:

- `spend_entries_by_month`: on (`month`), where `removed_at IS NULL`

## staff

Each member of staff on the console's Staff list, by their Access e-mail, and whether they are let in (ADR 0109).

Made by `0069_staff_and_access.sql`; changed by `0121_care_shifts.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `email` | TEXT | no |  | primary key | In lower case, as the Worker reads it from the Access token. |
| `active` | INTEGER | no |  |  | 0: kept on the list, with their grants, but let in nowhere. |
| `added_by` | TEXT | no |  |  |  |
| `added_at` | TEXT | no |  |  |  |
| `changed_by` | TEXT | yes |  |  |  |
| `changed_at` | TEXT | yes |  |  |  |
| `on_shift_since` | TEXT | yes |  |  | When each of the Care team went on shift, as they mark it themselves on the Messages page (docs/decisions/0139-care-shifts.md); NULL while off shift. A Care person off shift has their chats covered. |

## staff_access_mode

One row: whether the console enforces the Staff list yet, and who last switched it (ADR 0109).

Made by `0069_staff_and_access.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | INTEGER | no |  | primary key |  |
| `enforced` | INTEGER | no |  |  | 0: nothing is refused, and what would have been is logged. 1: the Staff list decides. |
| `set_by` | TEXT | yes |  |  |  |
| `set_at` | TEXT | yes |  |  |  |

## staff_grants

What each member of staff may do: a department, at a level, over a place, national, a zone or a city (ADR 0109).

Made by `0069_staff_and_access.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | INTEGER | no |  | primary key |  |
| `email` | TEXT | no |  | → `staff.email` |  |
| `department` | TEXT | no |  |  |  |
| `level` | TEXT | no |  |  | view < act < manage: each level can do what the ones before it can. |
| `geography` | TEXT | no |  |  |  |
| `place` | TEXT | yes |  |  | The zone's or the city's name; NULL for national, which names no place. |
| `granted_by` | TEXT | no |  |  |  |
| `granted_at` | TEXT | no |  |  |  |

Indexes:

- `staff_grants_by_email`: on (`email`)

## staff_service_tokens

The Access service tokens let in as every caller was before the Staff list, such as CI's (ADR 0109).

Made by `0069_staff_and_access.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `client_id` | TEXT | no |  | primary key | What Access sends as the token's common name. |
| `label` | TEXT | no |  |  |  |
| `added_by` | TEXT | no |  |  |  |
| `added_at` | TEXT | no |  |  |  |

## standard_costs

What each first fit and replacement product costs us, from its date, for the margin figures until stock lots carry what was paid; an old row stays for the visits under it (ADR 0152).

Made by `0130_standard_costs.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `item` | TEXT | no |  | primary key |  |
| `tier` | TEXT | no |  | primary key |  |
| `cost` | INTEGER | no |  |  |  |
| `valid_from` | TEXT | no |  | primary key |  |
| `set_by` | TEXT | no |  |  |  |
| `set_at` | TEXT | no |  |  |  |

## stock_balances

What each place holds of each consumable, and when it last counted it: the sum of its rows in `stock_movements`, kept by triggers as each is written (ADR 0087).

Made by `0053_balances_and_last_visits.sql`; changed by `0154_cycle_counts.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `consumable_code` | TEXT | no |  | primary key; → `consumables.code` |  |
| `place` | TEXT | no |  | primary key | 'central' for the central store; for a technician's kit, their ID. |
| `quantity` | INTEGER | no |  |  |  |
| `counted_at` | TEXT | yes |  |  | When the place last counted it; NULL if never. |

Indexes:

- `stock_balances_by_place`: on (`place`, `consumable_code`), where `quantity > 0`

## stock_lot_balances

What each place holds of each lot: the sum of its rows in `stock_lot_moves`, kept by triggers as each is written (ADR 0157).

Made by `0135_stock_lots.sql`; changed by `0137_held_lots.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `lot_id` | TEXT | no |  | primary key; → `stock_lots.id` |  |
| `place` | TEXT | no |  | primary key |  |
| `quantity` | INTEGER | no |  |  |  |

Indexes:

- `stock_lot_balances_by_place`: on (`place`, `lot_id`)
- `stock_lot_balances_held`: on (`lot_id`, `place`), where `quantity > 0`

## stock_lot_moves

What each movement moved of each lot, soonest to expire first, at the movement's place (ADR 0157).

Made by `0135_stock_lots.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `movement_id` | TEXT | no |  | primary key; → `stock_movements.id` |  |
| `lot_id` | TEXT | no |  | primary key; → `stock_lots.id` |  |
| `place` | TEXT | no |  |  |  |
| `quantity` | INTEGER | no |  |  |  |

Triggers: `stock_lot_moves_balance`, `stock_lot_moves_taken_out`.

## stock_lots

Each lot of a stock code a delivery brought: the supplier's lot, or the day it was received, and the day it expires (ADR 0157).

Made by `0135_stock_lots.sql`; changed by `0138_stock_units.sql`, `0142_receipts.sql`, `0155_recalls.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `consumable_code` | TEXT | no |  | → `consumables.code` |  |
| `lot_code` | TEXT | no |  |  | The supplier's lot, as printed, or the day it was received where it carries none. |
| `expires_on` | TEXT | yes |  |  | India's date it expires on; null for one that does not. |
| `received_at` | TEXT | no |  |  |  |
| `label` | TEXT | yes |  |  | A lot's label, for its boxes: e.g. MM-LT-0000042-Q. |
| `label_serial` | INTEGER | yes |  |  |  |
| `landed_cost_paise` | INTEGER | yes |  |  |  |
| `recalled_at` | TEXT | yes |  |  | When a lot was recalled; it stays blocked after its recall is closed. |

Indexes:

- A `UNIQUE` constraint: unique on (`consumable_code`, `lot_code`)
- `stock_lots_by_label`: unique on (`label`)
- `stock_lots_by_label_serial`: unique on (`label_serial`)

## stock_movements

Every movement of a consumable into or out of the central store or a technician's kit, never changed; what a place holds is the sum of its rows (ADR 0087).

Made by `0049_consumables_and_stock.sql`; changed by `0053_balances_and_last_visits.sql`, `0133_stock_places.sql`, `0151_forecast.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `consumable_code` | TEXT | no |  | → `consumables.code` |  |
| `location` | TEXT | no |  |  |  |
| `technician_id` | TEXT | yes |  | → `technicians.id` | Whose kit; NULL for the central store. |
| `quantity` | INTEGER | no |  |  | Into the place, positive; out of it, negative. Only a count that matched is nought. |
| `reason` | TEXT | no |  |  |  |
| `transfer_id` | TEXT | yes |  |  | The two rows of one transfer share it. |
| `appointment_id` | TEXT | yes |  | → `appointments.id` | A job's use: the visit, and the technician's event that recorded it. |
| `job_event_id` | TEXT | yes |  | → `job_events.id` |  |
| `actor_kind` | TEXT | no |  |  | Who: a member of staff by their Access identity, or the technician by our ID. |
| `actor` | TEXT | no |  |  |  |
| `note` | TEXT | yes |  |  | Ops' own words: the supplier's note, what was lost. Never a client's name. |
| `created_at` | TEXT | no |  |  |  |
| `place_id` | TEXT | yes |  | → `stock_places.id` | A hub's or a stockroom's row names it; the warehouse's and a kit's leave it null, as every row before. |

Indexes:

- `stock_movements_by_job`: on (`appointment_id`), where `reason = 'used'`
- `stock_movements_held`: on (`technician_id`, `consumable_code`)
- `stock_movements_latest`: on (`created_at`)
- `stock_movements_used`: unique on (`job_event_id`, `consumable_code`), where `reason = 'used'`
- `stock_movements_used_by_day`: on (`created_at`), where `reason = 'used'`

Triggers: `stock_movements_balance`, `stock_movements_no_update`, `stock_movements_taken_out`.

## stock_places

Where stock is kept, as a tree: the national warehouse, zone hubs, city stockrooms and a kit for each technician, which a trigger adds with them (ADR 0155).

Made by `0133_stock_places.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `kind` | TEXT | no |  |  |  |
| `name` | TEXT | yes |  |  | A kit is named by its technician. |
| `parent_id` | TEXT | yes |  | → `stock_places.id` |  |
| `zone` | TEXT | yes |  | → `zones.name` | A hub's zone; a stockroom's city. A kit is in its technician's city. |
| `city` | TEXT | yes |  | → `cities.name` |  |
| `technician_id` | TEXT | yes |  |  | A kit's technician, whose ID it shares. No foreign key: the code before this release deletes a technician added by mistake without knowing of kits, so a kit can outlive its technician, and reads leave such a kit out. |
| `active` | INTEGER | no | `1` |  |  |
| `created_by` | TEXT | no |  |  |  |
| `created_at` | TEXT | no |  |  |  |

Indexes:

- `stock_places_by_parent`: on (`parent_id`)

## stock_risks

Each fit booked ahead found with no hair system in its city, or no profile to match one by, and when it was no longer at risk (ADR 0178).

Made by `0150_stock_risks.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `appointment_id` | TEXT | no |  | primary key; → `appointments.id` |  |
| `consumable_code` | TEXT | yes |  |  | The stock code it needs; NULL where the client has no profile to match one by. |
| `city` | TEXT | yes |  |  |  |
| `found_at` | TEXT | no |  |  |  |
| `cleared_at` | TEXT | yes |  |  |  |

Indexes:

- `stock_risks_open`: on (`found_at`), where `cleared_at IS NULL`

## stock_transfers

Each transfer sent to a warehouse, a hub or a stockroom: what left, from where, to where, and whether it arrived, in full or short, or was sent back (ADR 0158).

Made by `0136_stock_transfers.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `consumable_code` | TEXT | no |  | → `consumables.code` |  |
| `quantity` | INTEGER | no |  |  |  |
| `from_place` | TEXT | no |  | → `stock_places.id` |  |
| `to_place` | TEXT | no |  | → `stock_places.id` |  |
| `state` | TEXT | no |  |  |  |
| `received_quantity` | INTEGER | yes |  |  | What arrived; short of the quantity sent where some was lost on the way. |
| `note` | TEXT | yes |  |  | Ops' own words on what arrived. Never a client's name. |
| `sent_by` | TEXT | no |  |  |  |
| `sent_at` | TEXT | no |  |  |  |
| `settled_by` | TEXT | yes |  |  |  |
| `settled_at` | TEXT | yes |  |  |  |
| `settlement_id` | TEXT | yes |  |  | The settling request's own token, which the rows written with the settlement test for. |

Indexes:

- `stock_transfers_in_transit`: on (`sent_at`), where `state = 'in_transit'`

## stock_unit_events

Each unit's history, only ever added to: the state it moved into, where, and by which movement (ADR 0161).

Made by `0138_stock_units.sql`; changed by `0148_custom_reservations.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `unit_id` | TEXT | no |  | → `stock_units.id` |  |
| `at` | TEXT | no |  |  |  |
| `state` | TEXT | no |  |  |  |
| `place` | TEXT | yes |  |  |  |
| `movement_id` | TEXT | yes |  |  |  |
| `transfer_id` | TEXT | yes |  |  |  |
| `appointment_id` | TEXT | yes |  |  |  |
| `actor` | TEXT | no |  |  |  |

Indexes:

- `stock_unit_events_by_movement`: on (`movement_id`), where `movement_id IS NOT NULL`
- `stock_unit_events_by_unit`: on (`unit_id`, `at`)

## stock_units

Each hair system piece labelled: its label, stock code and lot, and where it is now, held at a place, in transit, fitted or gone (ADR 0161).

Made by `0138_stock_units.sql`; changed by `0148_custom_reservations.sql`, `0155_recalls.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `code` | TEXT | no |  |  | The label on the piece and in its QR code, e.g. MM-STA-0000123-K; a piece fitted keeps it as its piece code. |
| `serial` | INTEGER | no |  |  |  |
| `consumable_code` | TEXT | no |  | → `consumables.code` |  |
| `lot_id` | TEXT | yes |  | → `stock_lots.id` |  |
| `state` | TEXT | no |  |  |  |
| `place` | TEXT | yes |  |  | The place holding it, or one in transit is going to; null once it has left the stock. |
| `transfer_id` | TEXT | yes |  | → `stock_transfers.id` |  |
| `appointment_id` | TEXT | yes |  |  | The visit it was fitted on, or came off at. |
| `labelled_at` | TEXT | no |  |  |  |
| `moved_at` | TEXT | no |  |  |  |
| `custom_order_id` | TEXT | yes |  | → `custom_orders.id` | A custom order's piece reserved to its client (docs/decisions/0175-custom-pieces-reserved.md): the unit a receipt of its order's line labels names the custom order, and never joins free stock. |

Indexes:

- A `UNIQUE` constraint: unique on (`code`)
- A `UNIQUE` constraint: unique on (`serial`)
- `stock_units_by_lot`: on (`lot_id`), where `lot_id IS NOT NULL`
- `stock_units_by_transfer`: on (`transfer_id`), where `transfer_id IS NOT NULL`
- `stock_units_by_visit`: on (`appointment_id`), where `appointment_id IS NOT NULL`
- `stock_units_held`: on (`place`, `consumable_code`), where `state = 'held'`
- `stock_units_reserved`: on (`custom_order_id`), where `custom_order_id IS NOT NULL`

## storage_meter

What the apps' two buckets, client-photos and referral-cards, hold together: one row, the sum of `stored_objects` kept beside it, and the last mark of the share ops were told of (ADR 0093); and the last mark of the database's own size they were told of.

Made by `0055_storage_meter.sql`; changed by `0072_database_size_told.sql`, `0164_storage_growth_by_day.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | INTEGER | no |  | primary key |  |
| `bytes` | INTEGER | no |  |  |  |
| `told_percent` | INTEGER | no | `0` |  |  |
| `database_told_percent` | INTEGER | no | `0` |  |  |
| `growth_date` | TEXT | yes |  |  |  |
| `growth_from_bytes` | INTEGER | yes |  |  |  |

## stored_objects

Each object client-photos and referral-cards hold, and its size, written as it is stored and deleted as it is, so the storage meter never counts one twice (ADR 0093).

Made by `0055_storage_meter.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `key` | TEXT | no |  | primary key |  |
| `bytes` | INTEGER | no |  |  |  |

## supplier_claims

Each claim on a supplier: what arrived damaged or failed its check, or a returned piece in warranty, and whether it was sent, credited, replaced, rejected or withdrawn (ADR 0169).

Made by `0144_supplier_claims.sql`; changed by `0145_stock_photos.sql`, `0146_vendor_credits.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `number` | INTEGER | no |  |  |  |
| `supplier_id` | TEXT | no |  | → `suppliers.id` |  |
| `consumable_code` | TEXT | no |  | → `consumables.code` |  |
| `quantity` | INTEGER | no |  |  |  |
| `reason` | TEXT | no |  |  |  |
| `receipt_line_id` | TEXT | no |  | → `receipt_lines.id` |  |
| `unit_id` | TEXT | yes |  | → `stock_units.id` | The returned piece a warranty claim is for. |
| `unit_price` | INTEGER | no |  |  | One unit's price on the order, in the order's currency's smallest unit. |
| `currency` | TEXT | no |  |  |  |
| `state` | TEXT | no |  |  |  |
| `outcome` | TEXT | yes |  |  |  |
| `credit_amount` | INTEGER | yes |  |  |  |
| `note` | TEXT | yes |  |  |  |
| `drafted_by` | TEXT | no |  |  |  |
| `drafted_at` | TEXT | no |  |  |  |
| `sent_by` | TEXT | yes |  |  |  |
| `sent_at` | TEXT | yes |  |  |  |
| `decided_by` | TEXT | yes |  |  |  |
| `decided_at` | TEXT | yes |  |  |  |
| `change_id` | TEXT | yes |  |  |  |
| `photo_id` | TEXT | yes |  |  |  |
| `books_credit_id` | TEXT | yes |  |  | Vendor credits in Zoho Books (docs/decisions/0171-vendor-credits.md): each claim settled as a credit made a vendor credit on its supplier's vendor, once, tried again an hour after a failure. |
| `books_checked_at` | TEXT | yes |  |  |  |

Indexes:

- A `UNIQUE` constraint: unique on (`number`)
- `supplier_claims_by_receipt_line`: unique on (`receipt_line_id`, `reason`), where `unit_id IS NULL`
- `supplier_claims_by_supplier`: on (`supplier_id`)
- `supplier_claims_by_unit`: unique on (`unit_id`), where `unit_id IS NOT NULL`
- `supplier_claims_open`: on (`number`), where `state IN ('drafted', 'sent')`
- `supplier_claims_to_credit`: on (`decided_at`), where `outcome = 'credit' AND books_credit_id IS NULL`

## supplier_items

What each supplier supplies of a stock code: their code, price in their currency, pack, minimum order and lead time (ADR 0165).

Made by `0140_suppliers.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `supplier_id` | TEXT | no |  | primary key; → `suppliers.id` |  |
| `consumable_code` | TEXT | no |  | primary key; → `consumables.code` |  |
| `their_code` | TEXT | yes |  |  |  |
| `unit_price` | INTEGER | no |  |  | One unit's price in the supplier's currency, in its smallest unit: paise for rupees, cents for dollars. |
| `pack_size` | INTEGER | no |  |  |  |
| `minimum_order` | INTEGER | no |  |  |  |
| `lead_time_days` | INTEGER | no |  |  |  |
| `updated_at` | TEXT | no |  |  |  |

Indexes:

- `supplier_items_by_code`: on (`consumable_code`)

## suppliers

Each supplier we buy stock from: its terms, currency and warranty, retired rather than deleted (ADR 0165).

Made by `0140_suppliers.sql`; changed by `0143_books_bills.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `name` | TEXT | no |  |  |  |
| `gstin` | TEXT | yes |  |  | India's GST number; null for a supplier abroad, or one not registered. |
| `country` | TEXT | no |  |  | ISO 3166 alpha-2, and the ISO 4217 currency its invoices are in, which its prices are kept in. |
| `currency` | TEXT | no |  |  |  |
| `contact_name` | TEXT | yes |  |  |  |
| `contact_phone` | TEXT | yes |  |  |  |
| `contact_email` | TEXT | yes |  |  |  |
| `payment_terms_days` | INTEGER | no |  |  |  |
| `warranty_days` | INTEGER | no |  |  | How long after a piece is fitted the supplier takes it back if it fails; nought for none. |
| `retired_at` | TEXT | yes |  |  |  |
| `created_at` | TEXT | no |  |  |  |
| `updated_at` | TEXT | no |  |  |  |
| `books_vendor_id` | TEXT | yes |  |  | Bills in Zoho Books (docs/decisions/0168-bills-in-books.md): each supplier with a receipt to bill made a Books vendor, and each receipt a bill, once, each tried again an hour after a failure. |
| `books_checked_at` | TEXT | yes |  |  |  |

Indexes:

- `suppliers_by_name`: unique on (`name`)

## targets

Each month's target for a city, by measure, as set on the console's Targets page; set again, it is replaced (ADR 0154).

Made by `0131_targets.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `month` | TEXT | no |  | primary key |  |
| `city` | TEXT | no |  | primary key; → `cities.name` |  |
| `measure` | TEXT | no |  | primary key |  |
| `target` | INTEGER | no |  |  |  |
| `set_by` | TEXT | no |  |  |  |
| `set_at` | TEXT | no |  |  |  |

## task_closures

A task on the Tasks board ops closed without doing its thing, a visit left partly done alone, with why, who and when, by the task's group and its row's id (ADR 0092).

Made by `0056_task_owners.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `task_group` | TEXT | no |  |  |  |
| `subject_id` | TEXT | no |  |  |  |
| `reason` | TEXT | yes |  |  | Ops' own words about the client's visit; NULL once the client is erased. |
| `closed_by` | TEXT | no |  |  |  |
| `closed_at` | TEXT | no |  |  |  |

Indexes:

- A `UNIQUE` constraint: unique on (`task_group`, `subject_id`)

## task_owners

The member of staff a task on the Tasks board is theirs, by Access e-mail, by the task's group, its row's id and, where that row can be a new task again, its episode; a task with no row for it is nobody's (ADR 0092).

Made by `0056_task_owners.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `task_group` | TEXT | no |  | primary key |  |
| `subject_id` | TEXT | no |  | primary key |  |
| `episode` | TEXT | no |  |  |  |
| `owner` | TEXT | no |  |  |  |
| `assigned_by` | TEXT | no |  |  |  |
| `assigned_at` | TEXT | no |  |  |  |

## task_spans

Each task the Tasks board has held, by its group, row and episode: the client's city, when it opened and the night it was first found gone, from which the reporting copy counts Care cases (ADR 0147).

Made by `0126_task_spans.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `task_group` | TEXT | no |  |  |  |
| `subject_id` | TEXT | no |  |  | The task's row and episode, as the board names it; with the group, which task it is. |
| `episode` | TEXT | no |  |  |  |
| `city` | TEXT | yes |  |  | The client's city when it opened; NULL where none is known. |
| `opened_at` | TEXT | no |  |  |  |
| `closed_at` | TEXT | yes |  |  |  |

Indexes:

- `task_spans_by_close`: on (`closed_at`)
- `task_spans_open`: unique on (`task_group`, `subject_id`, `episode`), where `closed_at IS NULL`

## technician_devices

The phones technicians work from, each bound to a session and revocable by ops (ADR 0052).

Made by `0026_field_operations.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `technician_id` | TEXT | no |  | → `technicians.id` |  |
| `device_id` | TEXT | no |  |  | The app's own ID for the phone, kept in its storage. Never a hardware serial. |
| `session_id` | TEXT | yes |  | → `sessions.id` | The session it logged in with (migration 0007); NULL once that session ended. |
| `label` | TEXT | yes |  |  | What the browser said it was at login, e.g. "Chrome on Android". |
| `created_at` | TEXT | no |  |  |  |
| `last_seen_at` | TEXT | no |  |  |  |
| `revoked_at` | TEXT | yes |  |  |  |
| `revoked_by` | TEXT | yes |  |  | The Access identity of the ops user who revoked it (ADR 0031). |
| `wiped_at` | TEXT | yes |  |  | When the device confirmed it had dropped its cached jobs. |

Indexes:

- A `UNIQUE` constraint: unique on (`technician_id`, `device_id`)
- `technician_devices_by_session`: on (`session_id`)

## technician_leave

A technician's leave in whole days, which the clash check reads beside `slot_claims` (ADR 0062).

Made by `0034_leave_and_asked_window.sql`; changed by `0090_board_version.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `technician_id` | TEXT | no |  | → `technicians.id` |  |
| `from_date` | TEXT | no |  |  | Inclusive, both of them: a single day's leave has the same date twice. |
| `to_date` | TEXT | no |  |  |  |
| `note` | TEXT | yes |  |  | Why, in ops' own words, for whoever reads the board later. Never a medical detail. |
| `actor` | TEXT | no |  |  | The Access identity of the ops user who recorded it, and of whoever took it back (ADR 0031). |
| `created_at` | TEXT | no |  |  |  |
| `cancelled_at` | TEXT | yes |  |  |  |
| `cancelled_by` | TEXT | yes |  |  |  |

Indexes:

- `technician_leave_by_technician`: on (`technician_id`, `from_date`)

Triggers: `technician_leave_board_added`, `technician_leave_board_changed`.

## technician_updates

A technician's word to the client from the job card: on the way, at the gate, or running late, sent from our number (ADR 0145).

Made by `0125_technician_updates.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `appointment_id` | TEXT | no |  | → `appointments.id` |  |
| `technician_id` | TEXT | no |  |  |  |
| `preset` | TEXT | no |  |  |  |
| `minutes` | INTEGER | yes |  |  | How many minutes away, or late; NULL at the gate. |
| `written_at` | TEXT | no |  |  | When the phone queued it, from its event ID. |
| `created_at` | TEXT | no |  |  |  |

Indexes:

- `technician_updates_by_visit`: on (`appointment_id`, `written_at`)

## technicians

Each technician: name, initials, mobile number, zone and city, as ops keep them on the Technicians page. `fsm_id` is the ID FSM gave a technician it once held, otherwise one of ours. `city` places them for staff access (ADR 0032, ADR 0052, ADR 0109, ADR 0110).

Made by `0011_fsm_mirror.sql`; changed by `0027_pieces_and_zones.sql`, `0046_hand_written_technicians.sql`, `0081_technician_city.sql`, `0090_board_version.sql`, `0097_technician_sign_in_stopped.sql`, `0106_technician_test_record.sql`, `0107_city_blackouts_and_fitters.sql`, `0108_technician_pay.sql`, `0133_stock_places.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `fsm_id` | TEXT | no |  |  |  |
| `name` | TEXT | no |  |  |  |
| `initials` | TEXT | no |  |  |  |
| `active` | INTEGER | no |  |  |  |
| `updated_at` | TEXT | no |  |  |  |
| `zone` | TEXT | yes |  |  | The zone migration 0026 left for the code that reads it: the dispatch board groups technicians by it, and FSM calls it a territory. NULL until each technician has one there (docs/open-points.md, item 12). |
| `mobile_e164` | TEXT | yes |  |  | The technician's own number, as ops keep it on the Technicians page, which they sign in with by a one-time code, the same flow as clients' but a separate role (src/routes/tech/auth.ts). NULL for a technician with no number, who then cannot sign in. |
| `hand_written` | INTEGER | no | `0` |  |  |
| `city` | TEXT | yes |  | → `cities.name` |  |
| `sign_in_stopped_at` | TEXT | yes |  |  |  |
| `test_record` | INTEGER | no | `0` |  |  |
| `fits_trained` | INTEGER | no | `0` |  |  |
| `pay_grade_id` | TEXT | yes |  | → `pay_grades.id` |  |

Indexes:

- A `UNIQUE` constraint: unique on (`fsm_id`)
- `technicians_by_mobile`: on (`mobile_e164`)

Triggers: `technicians_board_added`, `technicians_board_changed`, `technicians_kit`.

## tryon_jobs

One try-on render: the photograph, the look, the provider's job and the result (ADR 0014, ADR 0015).

Made by `0003_tryon.sql`; changed by `0037_cron_indexes.sql`, `0045_kept_try_ons.sql`, `0074_number_codes.sql`, `0171_tryon_on_youcam.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `created_at` | TEXT | no |  |  |  |
| `upload_key` | TEXT | no |  |  | The photo in the UPLOADS bucket. A second look reuses its first look's key. |
| `uploaded_at` | TEXT | yes |  |  |  |
| `upload_deleted_at` | TEXT | yes |  |  |  |
| `parent_job_id` | TEXT | yes |  | → `tryon_jobs.id` | The first look of this photo, for a second or later look; NULL otherwise. |
| `stage` | TEXT | yes |  |  | Chosen at generate. |
| `preset` | TEXT | yes |  |  |  |
| `hair_color` | TEXT | yes |  |  |  |
| `endpoint` | TEXT | yes |  |  |  |
| `provider_color` | TEXT | yes |  |  | The colour sent to the provider, and why: 'as_detected', or the UNKNOWN_COLOR_ROUTE taken. |
| `color_route` | TEXT | yes |  |  |  |
| `state` | TEXT | no |  |  |  |
| `submit_started_at` | TEXT | yes |  |  | The render. submit_started_at is claimed before submitting, so a job is never submitted (and billed) twice. |
| `submit_attempts` | INTEGER | no | `0` |  |  |
| `submitted_at` | TEXT | yes |  |  |  |
| `provider_task_id` | TEXT | yes |  |  |  |
| `provider_result_url` | TEXT | yes |  |  | Kept before downloading: the image is billed on generation, and this URL is the only way back to it for 24 hours. |
| `provider_result_expires_at` | TEXT | yes |  |  |  |
| `download_attempts` | INTEGER | no | `0` |  |  |
| `download_attempted_at` | TEXT | yes |  |  |  |
| `result_key` | TEXT | yes |  |  |  |
| `failure_code` | TEXT | yes |  |  |  |
| `provider_error_detail` | TEXT | yes |  |  | The provider's error, with the API key scrubbed out. Never shown to the customer. |
| `latency_ms` | INTEGER | yes |  |  |  |
| `person_id` | TEXT | yes |  | → `people.id` | Who, once the gate is passed (or the session that asked for a second look). |
| `lead_id` | TEXT | yes |  | → `leads.id` |  |
| `session_id` | TEXT | yes |  |  |  |
| `claimed_at` | TEXT | yes |  |  |  |
| `expires_at` | TEXT | yes |  |  | When the result is deleted: 30 days after it is ready. |
| `photo_consent_version` | TEXT | no |  |  | The photo consent, given before the upload. Copied into consents at claim. |
| `photo_consent_at` | TEXT | no |  |  |  |
| `ip_hash` | TEXT | no |  |  |  |
| `request_id` | TEXT | no |  |  |  |
| `copy_key` | TEXT | yes |  |  | The photograph's small copy in the client-photos bucket (tryons/<job>/before.jpg), from its upload until the sweeper deletes it: with the photograph, with the look, or never once the try-on is kept. Blank once deleted. |
| `kept_at` | TEXT | yes |  |  | When the sweeper kept the try-on, on its look's last day: its person had booked a visit by then. |
| `kept_look_key` | TEXT | yes |  |  | The kept look, moved to the client-photos bucket (tryons/<job>/look.<ext>), where no lifecycle rule can take it, until the client's first fit is photographed. Blank once deleted. |
| `number_proved_at` | TEXT | yes |  |  | When the try-on's claim came with its number proved by a code. The app shows and keeps a client's try-on only when it did. |
| `failure_reason` | TEXT | yes |  |  |  |
| `render_key` | TEXT | yes |  |  | A sha256 over the photograph's own bytes, the look and the references' version. |
| `renders` | INTEGER | no | `0` |  | The renders YouCam took for the job: one more is made when its model fails or runs out of time. |

Indexes:

- `tryon_jobs_by_person`: on (`person_id`), where `person_id IS NOT NULL`
- `tryon_jobs_by_render`: on (`render_key`), where `state = 'ready' AND result_key IS NOT NULL`
- `tryon_jobs_by_session`: on (`session_id`)
- `tryon_jobs_by_state`: on (`state`, `created_at`)
- `tryon_jobs_by_upload`: on (`upload_key`)
- `tryon_jobs_one_kept`: unique on (`person_id`), where `kept_at IS NOT NULL`
- `tryon_jobs_photos_held`: on (`upload_key`, `created_at`, `state`), where `upload_deleted_at IS NULL AND uploaded_at IS NOT NULL`

## tryon_sessions

The try-on gate's session, which showed a visitor their result (ADR 0014); written no more since the look goes to WhatsApp only (ADR 0104).

Made by `0003_tryon.sql`; changed by `0037_cron_indexes.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `person_id` | TEXT | no |  | → `people.id` |  |
| `created_at` | TEXT | no |  |  |  |
| `expires_at` | TEXT | no |  |  |  |

Indexes:

- `tryon_sessions_by_expiry`: on (`expires_at`)
- `tryon_sessions_by_person`: on (`person_id`)

## vendor_breakers

Each vendor's failures in a row, and until when its work waits while it is held off (ADR 0203).

Made by `0174_crm_held_off_and_owed_updates.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `vendor` | TEXT | no |  | primary key | "crm" |
| `failures` | INTEGER | no | `0` |  | the vendor's own failures in a row, its refusals of a record not among them |
| `reopens_at` | TEXT | yes |  |  | the instant its work may be tried again; empty while it is not held |
| `opened_at` | TEXT | yes |  |  | the instant the hold that is open, or the run of them, began |

## visit_blackouts

Days on which no visit is offered.

Made by `0002_lead_path.sql`; changed by `0054_policies_in_the_console.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `date` | TEXT | no |  | primary key |  |
| `reason` | TEXT | no |  |  |  |
| `set_by` | TEXT | yes |  |  | Blackout days are set in the console now, where the runbook's SQL set them: who set each and when, as every ops change records it (ADR 0031). Null for a day the runbook's SQL wrote before. |
| `set_at` | TEXT | yes |  |  |  |

## visit_changes

Each move or cancel a client made, and each cancel ops made, with its notice and what it cost (ADR 0046).

Made by `0020_visit_changes.sql`; changed by `0037_cron_indexes.sql`, `0082_ops_cancel_and_close.sql`, `0084_cancel_refund_settled.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `appointment_id` | TEXT | no |  | → `appointments.id` |  |
| `person_id` | TEXT | no |  | → `people.id` |  |
| `kind` | TEXT | no |  |  | moved: the same visit at a new time; replaced: cancelled for a new visit; cancelled. |
| `notice` | TEXT | no |  |  |  |
| `was_start` | TEXT | no |  |  | When the visit was to start, and, for a move, when it starts now. |
| `now_start` | TEXT | yes |  |  |  |
| `refund_amount` | INTEGER | no | `0` |  | In paise: what goes back to the client, and what is kept as a charge. |
| `kept_amount` | INTEGER | no | `0` |  |  |
| `payment_id` | TEXT | yes |  | → `payments.id` | The payment refunded or kept, and Razorpay's refund once asked for. |
| `razorpay_refund_id` | TEXT | yes |  |  |  |
| `hold_id` | TEXT | yes |  | → `slot_holds.id` |  |
| `created_at` | TEXT | no |  |  |  |
| `cancelled_by` | TEXT | yes |  |  | A cancel ops made: the Access e-mail of who made it, their reason as they typed it, and the terms it was made on: free to the client, or the client's own late terms. |
| `cancel_reason` | TEXT | yes |  |  |  |
| `ops_terms` | TEXT | yes |  |  |  |
| `refund_settled_at` | TEXT | yes |  |  |  |

Indexes:

- `visit_changes_by_appointment`: on (`appointment_id`, `created_at`)
- `visit_changes_by_payment`: on (`payment_id`)
- `visit_changes_one_end`: unique on (`appointment_id`), where `kind IN ('replaced', 'cancelled')`
- `visit_changes_refund_owed`: on (`created_at`), where `kind = 'cancelled' AND refund_settled_at IS NULL`

## visit_outcomes

What an appointment became once it closed, or ops closed it by hand: the outcome, its reason and its times (ADR 0032, ADR 0074).

Made by `0169_visits_whole.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `appointment_id` | TEXT | no |  | → `appointments.id` |  |
| `started_at` | TEXT | yes |  |  |  |
| `ended_at` | TEXT | yes |  |  |  |
| `duration_minutes` | INTEGER | yes |  |  |  |
| `outcome` | TEXT | no |  |  |  |
| `partial_reason` | TEXT | yes |  |  | From the technician's outcome, for a partial visit only (src/config/job-sheet.ts). |
| `updated_at` | TEXT | no |  |  |  |
| `followed_up` | INTEGER | no | `0` |  | Whether a visit left partly done has been followed: any visit of its client's, not cancelled, booked after it. |
| `closed_by` | TEXT | yes |  |  | A visit ops closed by hand: who closed it, and why, as they typed it. |
| `close_reason` | TEXT | yes |  |  |  |
| `lost_reason` | TEXT | yes |  |  |  |

Indexes:

- A `UNIQUE` constraint: unique on (`appointment_id`)
- `visits_partial`: on (`appointment_id`), where `outcome = 'partial'`
- `visits_partial_open`: on (`appointment_id`), where `outcome = 'partial' AND followed_up = 0`

Triggers: `visits_followed_up_added`, `visits_followed_up_changed`.

## visit_pay_rates

What a visit pays a technician, beside their salary: per grade and kind of visit, for every city or one, from a date (ADR 0122).

Made by `0108_technician_pay.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `grade_id` | TEXT | no |  | → `pay_grades.id` |  |
| `city` | TEXT | yes |  | → `cities.name` | One city's rate, which stands in for every city's there; NULL for every city. |
| `visit_kind` | TEXT | no |  |  |  |
| `amount` | INTEGER | yes |  |  | Paise. NULL from this date: no rate of its own, so a city's falls back to every city's, and every city's to none. |
| `effective_from` | TEXT | no |  |  | India's date it applies from. |
| `set_by` | TEXT | no |  |  |  |
| `set_at` | TEXT | no |  |  |  |

Indexes:

- `visit_pay_rates_one_a_day`: unique on (`grade_id`, `null`, `visit_kind`, `effective_from`)

## waitlist_entries

Someone waiting for us to reach their pincode, and whether they were told it launched (ADR 0048).

Made by `0021_referrals.sql`; changed by `0037_cron_indexes.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `pincode` | TEXT | no |  |  |  |
| `person_id` | TEXT | no |  | → `people.id` |  |
| `referral_code` | TEXT | yes |  | → `referral_codes.code` |  |
| `contact_consent_at` | TEXT | no |  |  |  |
| `launch_alert` | INTEGER | no | `0` |  | Whether they asked to be told when we launch there, and when we told them. |
| `alerted_at` | TEXT | yes |  |  |  |
| `created_at` | TEXT | no |  |  |  |

Indexes:

- A `UNIQUE` constraint: unique on (`pincode`, `person_id`)
- `waitlist_entries_by_person`: on (`person_id`)
- `waitlist_entries_by_pincode`: on (`pincode`, `created_at`)

## word_versions

Every wording a line of the site or a WhatsApp message has had on the Words page; the newest is in force (ADR 0126).

Made by `0112_words.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |  |
| `key` | TEXT | no |  |  |  |
| `text` | TEXT | yes |  |  |  |
| `set_by` | TEXT | no |  |  |  |
| `set_at` | TEXT | no |  |  |  |

Indexes:

- `word_versions_by_key`: on (`key`, `set_at`)

## zoho_access_tokens

Each Zoho client's access token, the CRM's, FSM's and Books', and the lease one caller holds while it asks for a new one (ADR 0070, ADR 0110).

Made by `0041_vendor_correctness.sql`; changed by `0070_field_record_ours.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `client` | TEXT | no |  | primary key |  |
| `access_token` | TEXT | yes |  |  |  |
| `expires_at` | TEXT | yes |  |  |  |
| `refreshing_until` | TEXT | yes |  |  |  |
| `cool_down_until` | TEXT | yes |  |  |  |

## zones

A region made of cities, as NCR is, which a grant of staff access may name (ADR 0109).

Made by `0069_staff_and_access.sql`.

| Column | Type | May be empty | Default | Key | What it holds |
| --- | --- | --- | --- | --- | --- |
| `name` | TEXT | no |  | primary key |  |
| `sort` | INTEGER | no |  |  |  |
