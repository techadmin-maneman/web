# The database schema

What each table in D1 holds, as the migrations leave it. This file is written by `npm run schema`, which applies `migrations/` in order to an empty database and reads every table back; `test/node/schema-doc.test.ts` fails until it is run after a migration changes a table. How to write a migration is `docs/migrations.md`.

## Times and dates

A column ending `_at` holds an instant, as ISO 8601 in UTC (`2026-09-27T06:30:00.000Z`). One ending `_date` holds a calendar day in India, `YYYY-MM-DD`, and a day is never cut from an instant's UTC string: it is read as India's date (`src/lib/india-time.ts`). Two `_at` columns hold a day, from before the rule was written (`docs/migrations.md`, rule 7):

- `pieces.fitted_at`: The day FSM's asset says the piece was installed (`Installation_Date`), or the day the technician's app fitted it (`src/domain/pieces.ts`).
- `pieces.replacement_due_at`: The fitted day plus the base's cycle; the Tasks board reads it as midnight in India on that day (`instantOf`, `src/domain/tasks.ts`).

## Tables

- [addresses](#addresses): Each address a client has given, in the app or to ops on the phone, who then saved it for them (`given_to_staff`). The current one has `replaced_at` empty; earlier ones stay for the visits booked to them (ADR 0042, ADR 0054, ADR 0092).
- [alerts](#alerts): One row per alert while it is open, kept once it is resolved; raising it again counts it (ADR 0067).
- [appointments](#appointments): The mirror of FSM's appointments: when, with whom, of what type and in what state, and what we have learnt of each since, such as the window asked for and its invoice (ADR 0032).
- [audit_log](#audit_log): Every ops action that reads or changes a client's data, and who took it. An entry is never changed (ADR 0031).
- [checkins](#checkins): Each "I have arrived", passed or not, with the distance measured and the radius in force (ADR 0065); an erasure blanks where the phone was (ADR 0094).
- [checklist_items](#checklist_items): Each kind of visit's checklist as ops set it, an item they took off kept as retired; a kind with no rows takes the committed list (ADR 0087).
- [cities](#cities): The cities Phase 1's booking form offered. The leads it left name one, a booking's lead names its pincode's, and the dispatch board filters by them.
- [consents](#consents): What each person agreed to, under which notice's version, and where (ADR 0094). Rows are only ever added (ADR 0042, ADR 0049).
- [consultation_requests](#consultation_requests): A consultation asked for while self-serve booking is off, for ops to fix the hour (ADR 0060).
- [consumable_usage](#consumable_usage): What each service, a kind of visit at a tier of the price book, is expected to use of each consumable: where the technician's steppers start (ADR 0087).
- [consumables](#consumables): The consumables ops keep: name, unit, what one costs, the reorder levels, the day it is retired from, and FSM's part for it (ADR 0087).
- [consumables_used](#consumables_used): The consumables a technician recorded at a job's third step, with what its service expected and what one cost that day (ADR 0038, ADR 0087).
- [counters](#counters): Fixed-window counters for the rate limits and the daily ceilings (ADR 0011).
- [credit_ledger](#credit_ledger): Service-visit credits, entry by entry, each drawing on the grant it spends; a balance is summed, never kept (ADR 0033).
- [cron_jobs](#cron_jobs): Each job of the five-minute cron, and how many runs in a row it has failed (ADR 0067).
- [deletion_requests](#deletion_requests): A client's request to be erased, waiting for ops, and what ops decided (ADR 0042, ADR 0078).
- [deployment_identity](#deployment_identity): Which environment's database this is, so a Worker refuses to serve on another's (ADR 0003).
- [dispatch_moves](#dispatch_moves): Every move ops make on the dispatch board: from where to where, by whom, why, what FSM said, and whether the client was told (ADR 0069).
- [events](#events): What happened, for analysis, with no personal data in its payload.
- [first_fit_requests](#first_fit_requests): A first fit asked for on the site's form with the consultation, for the app to offer once the consultation is done; a person's latest stands (ADR 0086). The form asks for none since 1 October 2026 (ADR 0105).
- [fsm_items](#fsm_items): FSM's catalogue, to read each appointment's visit type from its service item and to compare FSM's prices with the price book (ADR 0032, ADR 0073).
- [grievances](#grievances): A client's grievance, and the answer ops recorded (ADR 0049, ADR 0078).
- [hair_profiles](#hair_profiles): Every version of a client's hair profile, the fit spec and the history taken with its own consent: the technician's at a visit, once for each of the phone's events, and ops' corrections. Never changed, only blanked (ADR 0106).
- [idempotency](#idempotency): The stored answer to each `Idempotency-Key`, so a request sent again gets its first answer (ADR 0011).
- [job_events](#job_events): The technician app's writes, each once by the ID the phone gave it, and whether it has reached FSM (ADR 0038, ADR 0065).
- [last_visits](#last_visits): Each client's last first fit, service or replacement done, and last consultation done, kept by triggers from the view `last_visits_now` as their visits change; the Tasks board's At-risk client and First fit to book read it (ADR 0086).
- [leads](#leads): Each booking, waitlist sign-up and try-on claim as the CRM receives it, and whether it has reached the CRM and FSM (ADR 0011, ADR 0012).
- [no_show_cases](#no_show_cases): The evidence a no-show is ruled on, the ruling, and what a charge cost the client (ADR 0065, ADR 0072, ADR 0096).
- [no_show_disputes](#no_show_disputes): A client's dispute of a no-show's charge, one a charge, and ops' ruling on it, refunded or upheld, with their reason (ADR 0096).
- [number_change_requests](#number_change_requests): A client's change of mobile number: the codes proven on both numbers, and what ops decided (ADR 0042, ADR 0078).
- [ops_settings](#ops_settings): The business inputs ops set in the console, a row each; a row that is not there means the committed default (ADR 0061).
- [ops_settings_snapshot](#ops_settings_snapshot): One row holding every `ops_settings` value, kept by that table's triggers: the one row a request reads (ADR 0088).
- [otp_challenges](#otp_challenges): Each one-time code sent, as a hash, with its sends and attempts (ADR 0030, ADR 0052).
- [outbound_messages](#outbound_messages): Each WhatsApp message, from queued to sent, delivered and read (ADR 0041).
- [partial_reasons](#partial_reasons): The reasons a job may be left partly done, as ops set them, one they took off kept as retired; none means the committed list (ADR 0087).
- [payment_links](#payment_links): The Razorpay payment link a consultation and fit in one visit is paid by once the client is fitted: one a visit, the product and its price, when Razorpay made and texted it, and the payment that paid it (ADR 0105).
- [payments](#payments): The mirror of Razorpay's payments, and where each stands in Books (ADR 0044).
- [people](#people): One row per person, keyed by mobile number. D1 owns the identity; the CRM's ID is only a reference (ADR 0011).
- [photo_sets](#photo_sets): A visit's set of photographs, before or after (ADR 0028).
- [photos](#photos): One photograph of a set, by its angle, and where it and its thumbnail are kept in R2 (ADR 0028, ADR 0093).
- [pieces](#pieces): The mirror of FSM's assets: each piece fitted, its base and lot, the day it was fitted and the day it falls due, and a failure with its reason (ADR 0032).
- [price_book](#price_book): Every price from its date, and the only source of prices; an old row stays for what was sold under it (ADR 0045, ADR 0061).
- [razorpay_events](#razorpay_events): Each Razorpay webhook event, once, by its event ID (ADR 0044).
- [referral_attributions](#referral_attributions): A person who came through an invite, to the first invite they used, what became of its grant, and who attached it and why where ops did (ADR 0048, ADR 0089).
- [referral_codes](#referral_codes): A client's invite code, the version of their card, and how often the invite was opened (ADR 0048).
- [refunds](#refunds): The mirror of Razorpay's refunds, and where each stands in Books (ADR 0044).
- [serviceable_pincodes](#serviceable_pincodes): Every NCR pincode, its area and city, and whether and since when we serve it (ADR 0048, ADR 0061).
- [services](#services): What clients may book: each kind of visit's services, their names, lengths and order, when each is retired, and its item in FSM's catalogue; the price book prices each by its kind and tier (ADR 0085).
- [sessions](#sessions): The client app's and the technician app's sessions: whose, from which device, and when each ends or was revoked (ADR 0029, ADR 0052).
- [slot_claims](#slot_claims): What a hold or a visit takes of a technician's day, a row per half-slot and window, so no time is taken twice (ADR 0034, ADR 0069).
- [slot_holds](#slot_holds): A slot held while a client pays, and what became of it (ADR 0045, ADR 0068).
- [stock_balances](#stock_balances): What each place holds of each consumable, and when it last counted it: the sum of its rows in `stock_movements`, kept by triggers as each is written (ADR 0087).
- [stock_movements](#stock_movements): Every movement of a consumable into or out of the central store or a technician's kit, never changed; what a place holds is the sum of its rows (ADR 0087).
- [storage_meter](#storage_meter): What Phase 2's two buckets, client-photos and referral-cards, hold together: one row, the sum of `stored_objects` kept beside it, and the last mark of the share ops were told of (ADR 0093).
- [stored_objects](#stored_objects): Each object client-photos and referral-cards hold, and its size, written as it is stored and deleted as it is, so the storage meter never counts one twice (ADR 0093).
- [sync_cursors](#sync_cursors): Where each pass of the reconciliation with FSM has reached (ADR 0032).
- [task_closures](#task_closures): A task on the Tasks board ops closed without doing its thing, a visit left partly done alone, with why, who and when, by the task's group and its row's id (ADR 0092).
- [task_owners](#task_owners): The member of staff a task on the Tasks board is theirs, by Access e-mail, by the task's group, its row's id and, where that row can be a new task again, its episode; a task with no row for it is nobody's (ADR 0092).
- [technician_devices](#technician_devices): The phones technicians work from, each bound to a session and revocable by ops (ADR 0052).
- [technician_leave](#technician_leave): A technician's leave in whole days, which the clash check reads beside `slot_claims` (ADR 0062).
- [technicians](#technicians): The mirror of FSM's technicians: name, initials, mobile number and zone; and on staging the few written by hand for a test, which the sync leaves alone (ADR 0032, ADR 0052).
- [tryon_jobs](#tryon_jobs): One try-on render: the photograph, the look, the provider's job and the result (ADR 0014, ADR 0015).
- [tryon_sessions](#tryon_sessions): The try-on gate's session, which showed a visitor their result (ADR 0014); written no more since the look goes to WhatsApp only (ADR 0104).
- [visit_blackouts](#visit_blackouts): Days on which no visit is offered.
- [visit_changes](#visit_changes): Each move or cancel a client made, with its notice and what it cost (ADR 0046).
- [visits](#visits): What an appointment became once FSM closed it: the outcome, its reason and its times (ADR 0032, ADR 0074).
- [waitlist_entries](#waitlist_entries): Someone waiting for us to reach their pincode, and whether they were told it launched (ADR 0048).
- [webhook_inbox](#webhook_inbox): FSM's webhook deliveries, each kept once (ADR 0032).
- [zoho_access_tokens](#zoho_access_tokens): Each Zoho client's access token, and the lease one caller holds while it asks for a new one (ADR 0070).
- [zoho_token](#zoho_token): The CRM's access token before migration 0041; unread since, and dropped later (open point 90).
- [zoho_tokens](#zoho_tokens): FSM's and Books' access token before migration 0041; unread since, and dropped later (open point 90).

## addresses

Each address a client has given, in the app or to ops on the phone, who then saved it for them (`given_to_staff`). The current one has `replaced_at` empty; earlier ones stay for the visits booked to them (ADR 0042, ADR 0054, ADR 0092).

Made by `0008_profile.sql`; changed by `0028_address_pin.sql`, `0056_task_owners.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `person_id` | TEXT | no |  | → `people.id` |
| `created_at` | TEXT | no |  |  |
| `line1` | TEXT | no |  |  |
| `line2` | TEXT | yes |  |  |
| `locality` | TEXT | no |  |  |
| `city` | TEXT | no |  |  |
| `pincode` | TEXT | no |  |  |
| `access_notes` | TEXT | yes |  |  |
| `lat` | REAL | yes |  |  |
| `lng` | REAL | yes |  |  |
| `geocoded_at` | TEXT | yes |  |  |
| `replaced_at` | TEXT | yes |  |  |
| `building` | TEXT | yes |  |  |
| `flat` | TEXT | yes |  |  |
| `floor` | TEXT | yes |  |  |
| `tower` | TEXT | yes |  |  |
| `landmark` | TEXT | yes |  |  |
| `place_id` | TEXT | yes |  |  |
| `geocode_source` | TEXT | yes |  |  |
| `given_to_staff` | TEXT | yes |  |  |

Indexes:

- `addresses_by_person`: on (`person_id`, `replaced_at`)

## alerts

One row per alert while it is open, kept once it is resolved; raising it again counts it (ADR 0067).

Made by `0038_alerts.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `key` | TEXT | no |  |  |
| `message` | TEXT | no |  |  |
| `link` | TEXT | yes |  |  |
| `count` | INTEGER | no |  |  |
| `first_seen_at` | TEXT | no |  |  |
| `last_seen_at` | TEXT | no |  |  |
| `resolved_at` | TEXT | yes |  |  |

Indexes:

- `alerts_open_by_key`: unique on (`key`), where `resolved_at IS NULL`

## appointments

The mirror of FSM's appointments: when, with whom, of what type and in what state, and what we have learnt of each since, such as the window asked for and its invoice (ADR 0032).

Made by `0011_fsm_mirror.sql`; changed by `0012_fsm_reconciliation.sql`, `0029_invoice_checks.sql`, `0030_invoice_issued.sql`, `0034_leave_and_asked_window.sql`, `0037_cron_indexes.sql`, `0041_vendor_correctness.sql`, `0044_hand_offs_and_messages.sql`, `0048_done_visits.sql`, `0050_services.sql`, `0053_balances_and_last_visits.sql`, `0056_task_owners.sql`, `0059_no_show_charges_and_disputes.sql`, `0060_flat_task_reads.sql`, `0061_one_visit.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `fsm_id` | TEXT | no |  |  |
| `fsm_work_order_id` | TEXT | yes |  |  |
| `person_id` | TEXT | yes |  | → `people.id` |
| `type` | TEXT | yes |  |  |
| `window_start` | TEXT | yes |  |  |
| `window_end` | TEXT | yes |  |  |
| `technician_id` | TEXT | yes |  | → `technicians.id` |
| `status` | TEXT | no |  |  |
| `fsm_status` | TEXT | no |  |  |
| `service_city` | TEXT | yes |  |  |
| `service_pincode` | TEXT | yes |  |  |
| `fsm_invoice_id` | TEXT | yes |  |  |
| `fsm_modified_at` | TEXT | no |  |  |
| `synced_at` | TEXT | no |  |  |
| `deleted_at` | TEXT | yes |  |  |
| `reconciled_at` | TEXT | yes |  |  |
| `invoice_checked_at` | TEXT | yes |  |  |
| `invoice_issued_at` | TEXT | yes |  |  |
| `asked_window` | TEXT | yes |  |  |
| `asked_checked_at` | TEXT | yes |  |  |
| `asked_failed_at` | TEXT | yes |  |  |
| `client_note` | TEXT | yes |  |  |
| `client_note_at` | TEXT | yes |  |  |
| `first_seen_at` | TEXT | yes |  |  |
| `tier` | TEXT | yes |  |  |
| `start_before_move` | TEXT | yes |  |  |
| `one_visit` | TEXT | yes |  |  |

Indexes:

- `appointments_asked_unchecked`: on (`window_start`), where `asked_checked_at IS NULL AND fsm_work_order_id IS NOT NULL AND deleted_at IS NULL AND status IN ('scheduled', 'dispatched', 'in_progress')`
- `appointments_by_person`: on (`person_id`, `window_start`)
- `appointments_by_technician`: on (`technician_id`, `window_start`)
- `appointments_by_window_end`: on (`window_end`)
- `appointments_by_window_start`: on (`window_start`)
- `appointments_done_visits`: on (`window_start`), where `status = 'completed' AND type IN ('first_fit', 'service', 'replacement') AND deleted_at IS NULL`
- `appointments_live_by_person`: on (`person_id`), where `status IN ('scheduled', 'dispatched', 'in_progress') AND deleted_at IS NULL`
- `appointments_to_invoice`: on (`window_start`), where `status = 'completed' AND invoice_issued_at IS NULL AND fsm_work_order_id IS NOT NULL AND deleted_at IS NULL`
- A `UNIQUE` constraint: unique on (`fsm_id`)

Triggers: `appointments_consultation_booked_added`, `appointments_consultation_booked_changed`, `appointments_consultation_booked_taken_out`, `appointments_first_fit_books_one_visit_added`, `appointments_first_fit_books_one_visit_changed`, `appointments_followed_up_added`, `appointments_followed_up_changed`, `appointments_followed_up_taken_out`, `appointments_last_visits_added`, `appointments_last_visits_changed`, `appointments_last_visits_taken_out`, `appointments_replacement_booked_added`, `appointments_replacement_booked_changed`, `appointments_replacement_booked_taken_out`.

## audit_log

Every ops action that reads or changes a client's data, and who took it. An entry is never changed (ADR 0031).

Made by `0005_audit.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | INTEGER | no |  | primary key |
| `at` | TEXT | no |  |  |
| `surface` | TEXT | no |  |  |
| `actor_kind` | TEXT | no |  |  |
| `actor` | TEXT | no |  |  |
| `action` | TEXT | no |  |  |
| `subject_kind` | TEXT | yes |  |  |
| `subject_id` | TEXT | yes |  |  |
| `request_id` | TEXT | yes |  |  |
| `detail` | TEXT | yes |  |  |

Indexes:

- `audit_log_actor`: on (`actor_kind`, `actor`, `at`)
- `audit_log_subject`: on (`subject_kind`, `subject_id`, `at`)

Triggers: `audit_log_append_only_delete`, `audit_log_append_only_update`.

## checkins

Each "I have arrived", passed or not, with the distance measured and the radius in force (ADR 0065); an erasure blanks where the phone was (ADR 0094).

Made by `0026_field_operations.sql`; changed by `0035_checkin_times_and_distance.sql`, `0037_cron_indexes.sql`, `0057_consent_sources_and_checkin_coordinates.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `appointment_id` | TEXT | no |  | → `appointments.id` |
| `technician_id` | TEXT | no |  | → `technicians.id` |
| `address_id` | TEXT | yes |  | → `addresses.id` |
| `at` | TEXT | no |  |  |
| `accuracy_m` | REAL | yes |  |  |
| `radius_m` | INTEGER | no |  |  |
| `passed` | INTEGER | no |  |  |
| `created_at` | TEXT | no |  |  |
| `claimed_at` | TEXT | yes |  |  |
| `distance_m` | INTEGER | yes |  |  |
| `lat` | REAL | yes |  |  |
| `lng` | REAL | yes |  |  |

Indexes:

- `checkins_by_address`: on (`address_id`), where `address_id IS NOT NULL`
- `checkins_by_appointment`: on (`appointment_id`, `at`)

## checklist_items

Each kind of visit's checklist as ops set it, an item they took off kept as retired; a kind with no rows takes the committed list (ADR 0087).

Made by `0049_consumables_and_stock.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `visit_type` | TEXT | no |  | primary key |
| `code` | TEXT | no |  | primary key |
| `label` | TEXT | no |  |  |
| `position` | INTEGER | no |  |  |
| `retired_at` | TEXT | yes |  |  |
| `set_by` | TEXT | no |  |  |
| `set_at` | TEXT | no |  |  |

## cities

The cities Phase 1's booking form offered. The leads it left name one, a booking's lead names its pincode's, and the dispatch board filters by them.

Made by `0002_lead_path.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `name` | TEXT | no |  | primary key |
| `served` | INTEGER | no |  |  |
| `active` | INTEGER | no | `1` |  |
| `sort` | INTEGER | no |  |  |

## consents

What each person agreed to, under which notice's version, and where (ADR 0094). Rows are only ever added (ADR 0042, ADR 0049).

Made by `0002_lead_path.sql`; changed by `0009_consents_v2.sql`, `0057_consent_sources_and_checkin_coordinates.sql`, `0063_hair_profiles.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `person_id` | TEXT | no |  | → `people.id` |
| `purpose` | TEXT | no |  |  |
| `notice_version` | TEXT | no |  |  |
| `granted` | INTEGER | no |  |  |
| `created_at` | TEXT | no |  |  |
| `ip_hash` | TEXT | yes |  |  |
| `source` | TEXT | yes |  |  |

Indexes:

- `consents_by_person`: on (`person_id`)

Triggers: `consents_no_delete`, `consents_no_update`.

## consultation_requests

A consultation asked for while self-serve booking is off, for ops to fix the hour (ADR 0060).

Made by `0032_consultation_requests.sql`; changed by `0056_task_owners.sql`, `0061_one_visit.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `person_id` | TEXT | no |  | → `people.id` |
| `pincode` | TEXT | no |  |  |
| `requested_date` | TEXT | no |  |  |
| `requested_window` | TEXT | no |  |  |
| `referral_code` | TEXT | yes |  | → `referral_codes.code` |
| `created_at` | TEXT | no |  |  |
| `booked` | INTEGER | no | `0` |  |
| `one_visit` | INTEGER | no | `0` |  |

Indexes:

- `consultation_requests_by_created`: on (`created_at`)
- `consultation_requests_waiting`: on (`created_at`), where `booked = 0`
- A `UNIQUE` constraint: unique on (`person_id`, `requested_date`, `requested_window`)

Triggers: `consultation_requests_booked_asked`.

## consumable_usage

What each service, a kind of visit at a tier of the price book, is expected to use of each consumable: where the technician's steppers start (ADR 0087).

Made by `0049_consumables_and_stock.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `visit_type` | TEXT | no |  | primary key |
| `tier` | TEXT | no | `'standard'` | primary key |
| `consumable_code` | TEXT | no |  | primary key; → `consumables.code` |
| `quantity` | INTEGER | no |  |  |
| `set_by` | TEXT | no |  |  |
| `set_at` | TEXT | no |  |  |

## consumables

The consumables ops keep: name, unit, what one costs, the reorder levels, the day it is retired from, and FSM's part for it (ADR 0087).

Made by `0049_consumables_and_stock.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `code` | TEXT | no |  | primary key |
| `name` | TEXT | no |  |  |
| `unit` | TEXT | no |  |  |
| `unit_cost` | INTEGER | no |  |  |
| `reorder_kit` | INTEGER | yes |  |  |
| `reorder_central` | INTEGER | yes |  |  |
| `retired_date` | TEXT | yes |  |  |
| `fsm_item_id` | TEXT | yes |  |  |
| `fsm_name` | TEXT | yes |  |  |
| `fsm_checked_at` | TEXT | yes |  |  |
| `created_at` | TEXT | no |  |  |
| `updated_at` | TEXT | no |  |  |

Indexes:

- `consumables_name`: unique on (`name`)

## consumables_used

The consumables a technician recorded at a job's third step, with what its service expected and what one cost that day (ADR 0038, ADR 0087).

Made by `0026_field_operations.sql`; changed by `0049_consumables_and_stock.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `appointment_id` | TEXT | no |  | → `appointments.id` |
| `job_event_id` | TEXT | no |  | → `job_events.id` |
| `fsm_item_id` | TEXT | yes |  | → `fsm_items.fsm_id` |
| `name` | TEXT | no |  |  |
| `quantity` | INTEGER | no |  |  |
| `created_at` | TEXT | no |  |  |
| `consumable_code` | TEXT | yes |  | → `consumables.code` |
| `expected_quantity` | INTEGER | yes |  |  |
| `unit_cost` | INTEGER | yes |  |  |

Indexes:

- `consumables_used_by_appointment`: on (`appointment_id`)
- `consumables_used_by_event_and_code`: unique on (`job_event_id`, `consumable_code`), where `consumable_code IS NOT NULL`
- A `UNIQUE` constraint: unique on (`job_event_id`, `name`)

## counters

Fixed-window counters for the rate limits and the daily ceilings (ADR 0011).

Made by `0002_lead_path.sql`; changed by `0037_cron_indexes.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `scope` | TEXT | no |  | primary key |
| `key` | TEXT | no |  | primary key |
| `window_start` | TEXT | no |  | primary key |
| `count` | INTEGER | no | `0` |  |

Indexes:

- `counters_by_window`: on (`window_start`)

## credit_ledger

Service-visit credits, entry by entry, each drawing on the grant it spends; a balance is summed, never kept (ADR 0033).

Made by `0021_referrals.sql`; changed by `0037_cron_indexes.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `person_id` | TEXT | no |  | → `people.id` |
| `kind` | TEXT | no |  |  |
| `visits` | INTEGER | no |  |  |
| `grant_id` | TEXT | yes |  | → `credit_ledger.id` |
| `source_kind` | TEXT | no |  |  |
| `source_id` | TEXT | no |  |  |
| `expires_at` | TEXT | yes |  |  |
| `created_at` | TEXT | no |  |  |

Indexes:

- `credit_ledger_by_grant`: on (`grant_id`)
- `credit_ledger_by_person`: on (`person_id`, `created_at`)
- `credit_ledger_by_source`: on (`source_id`, `kind`)
- `credit_ledger_grants_by_expiry`: on (`expires_at`), where `kind = 'grant'`
- `credit_ledger_one_grant`: unique on (`person_id`, `source_kind`, `source_id`), where `kind = 'grant'`
- `credit_ledger_one_use`: unique on (`source_id`, `kind`), where `kind IN ('redeem', 'restore')`

Triggers: `credit_ledger_no_delete`, `credit_ledger_no_update`.

## cron_jobs

Each job of the five-minute cron, and how many runs in a row it has failed (ADR 0067).

Made by `0038_alerts.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `job` | TEXT | no |  | primary key |
| `failed_runs` | INTEGER | no | `0` |  |
| `last_failed_at` | TEXT | yes |  |  |
| `last_error` | TEXT | yes |  |  |

## deletion_requests

A client's request to be erased, waiting for ops, and what ops decided (ADR 0042, ADR 0078).

Made by `0008_profile.sql`; changed by `0023_dpdp.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `person_id` | TEXT | no |  | → `people.id` |
| `created_at` | TEXT | no |  |  |
| `state` | TEXT | no |  |  |
| `decided_at` | TEXT | yes |  |  |
| `decided_by` | TEXT | yes |  |  |
| `reason` | TEXT | yes |  |  |
| `alerted_at` | TEXT | yes |  |  |

Indexes:

- `deletion_requests_by_state`: on (`state`, `created_at`)

## deployment_identity

Which environment's database this is, so a Worker refuses to serve on another's (ADR 0003).

Made by `0001_deployment_identity.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | INTEGER | no |  | primary key |
| `database_name` | TEXT | no |  |  |
| `marked_at` | TEXT | no | `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` |  |

Triggers: `deployment_identity_no_delete`, `deployment_identity_no_update`.

## dispatch_moves

Every move ops make on the dispatch board: from where to where, by whom, why, what FSM said, and whether the client was told (ADR 0069).

Made by `0026_field_operations.sql`; changed by `0040_dispatch_claims.sql`, `0060_flat_task_reads.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `appointment_id` | TEXT | no |  | → `appointments.id` |
| `was_technician_id` | TEXT | yes |  | → `technicians.id` |
| `now_technician_id` | TEXT | yes |  | → `technicians.id` |
| `was_start` | TEXT | yes |  |  |
| `now_start` | TEXT | yes |  |  |
| `reason` | TEXT | no |  |  |
| `actor` | TEXT | no |  |  |
| `fsm_write_state` | TEXT | no | `'pending'` |  |
| `fsm_error` | TEXT | yes |  |  |
| `message_id` | TEXT | yes |  | → `outbound_messages.id` |
| `created_at` | TEXT | no |  |  |
| `updated_at` | TEXT | no |  |  |
| `told_at` | TEXT | yes |  |  |
| `told_by` | TEXT | yes |  |  |

Indexes:

- `dispatch_moves_by_appointment`: on (`appointment_id`, `created_at`)
- `dispatch_moves_one_at_a_time`: unique on (`appointment_id`), where `fsm_write_state = 'pending'`
- `dispatch_moves_untold`: on (`now_start`), where `fsm_write_state = 'written' AND told_at IS NULL`

## events

What happened, for analysis, with no personal data in its payload.

Made by `0002_lead_path.sql`; changed by `0037_cron_indexes.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `created_at` | TEXT | no |  |  |
| `name` | TEXT | no |  |  |
| `subject_id` | TEXT | yes |  |  |
| `payload_json` | TEXT | yes |  |  |

Indexes:

- `events_by_name`: on (`name`, `created_at`)
- `events_utilisation_by_day`: on (`subject_id`), where `name = 'dispatch_utilisation'`

## first_fit_requests

A first fit asked for on the site's form with the consultation, for the app to offer once the consultation is done; a person's latest stands (ADR 0086). The form asks for none since 1 October 2026 (ADR 0105).

Made by `0047_first_fit_requests.sql`; changed by `0056_task_owners.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `person_id` | TEXT | no |  | → `people.id` |
| `preferred_window` | TEXT | yes |  |  |
| `created_at` | TEXT | no |  |  |
| `fitted_since` | INTEGER | no | `0` |  |

Indexes:

- `first_fit_requests_by_person`: unique on (`person_id`)
- `first_fit_requests_unfitted`: on (`person_id`), where `fitted_since = 0`

Triggers: `first_fit_requests_fitted_asked`.

## fsm_items

FSM's catalogue, to read each appointment's visit type from its service item and to compare FSM's prices with the price book (ADR 0032, ADR 0073).

Made by `0011_fsm_mirror.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `fsm_id` | TEXT | no |  | primary key |
| `name` | TEXT | no |  |  |
| `type` | TEXT | no |  |  |
| `updated_at` | TEXT | no |  |  |

## grievances

A client's grievance, and the answer ops recorded (ADR 0049, ADR 0078).

Made by `0023_dpdp.sql`; changed by `0037_cron_indexes.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `person_id` | TEXT | no |  | → `people.id` |
| `text` | TEXT | no |  |  |
| `state` | TEXT | no |  |  |
| `response` | TEXT | yes |  |  |
| `resolved_by` | TEXT | yes |  |  |
| `resolved_at` | TEXT | yes |  |  |
| `created_at` | TEXT | no |  |  |

Indexes:

- `grievances_by_person`: on (`person_id`)
- `grievances_by_state`: on (`state`, `created_at`)

## hair_profiles

Every version of a client's hair profile, the fit spec and the history taken with its own consent: the technician's at a visit, once for each of the phone's events, and ops' corrections. Never changed, only blanked (ADR 0106).

Made by `0063_hair_profiles.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `person_id` | TEXT | no |  | → `people.id` |
| `appointment_id` | TEXT | yes |  | → `appointments.id` |
| `event_id` | TEXT | yes |  |  |
| `technician_id` | TEXT | yes |  | → `technicians.id` |
| `staff` | TEXT | yes |  |  |
| `created_at` | TEXT | no |  |  |
| `norwood_stage` | TEXT | yes |  |  |
| `head_circumference_cm` | REAL | yes |  |  |
| `front_to_nape_cm` | REAL | yes |  |  |
| `ear_to_ear_cm` | REAL | yes |  |  |
| `temple_to_temple_cm` | REAL | yes |  |  |
| `base_width_in` | REAL | yes |  |  |
| `base_length_in` | REAL | yes |  |  |
| `colour` | TEXT | yes |  |  |
| `grey_percent` | INTEGER | yes |  |  |
| `density_percent` | INTEGER | yes |  |  |
| `wave` | TEXT | yes |  |  |
| `hairline` | TEXT | yes |  |  |
| `product` | TEXT | yes |  |  |
| `attachment` | TEXT | yes |  |  |
| `remedies` | TEXT | yes |  |  |
| `transplant_year` | INTEGER | yes |  |  |
| `skin_and_allergies` | TEXT | yes |  |  |

Indexes:

- `hair_profiles_by_event`: unique on (`appointment_id`, `event_id`)
- `hair_profiles_by_person`: on (`person_id`, `created_at`)

Triggers: `hair_profiles_no_delete`, `hair_profiles_only_blanked`.

## idempotency

The stored answer to each `Idempotency-Key`, so a request sent again gets its first answer (ADR 0011).

Made by `0002_lead_path.sql`; changed by `0037_cron_indexes.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `key` | TEXT | no |  | primary key |
| `route` | TEXT | no |  | primary key |
| `request_hash` | TEXT | no |  |  |
| `response_json` | TEXT | yes |  |  |
| `created_at` | TEXT | no |  |  |

Indexes:

- `idempotency_by_created`: on (`created_at`)

## job_events

The technician app's writes, each once by the ID the phone gave it, and whether it has reached FSM (ADR 0038, ADR 0065).

Made by `0026_field_operations.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `appointment_id` | TEXT | no |  | → `appointments.id` |
| `event_id` | TEXT | no |  |  |
| `technician_id` | TEXT | no |  | → `technicians.id` |
| `device_id` | TEXT | yes |  | → `technician_devices.id` |
| `kind` | TEXT | no |  |  |
| `body` | TEXT | no |  |  |
| `occurred_at` | TEXT | no |  |  |
| `received_at` | TEXT | no |  |  |
| `fsm_write_state` | TEXT | no | `'pending'` |  |
| `fsm_error` | TEXT | yes |  |  |
| `superseded` | INTEGER | no | `0` |  |
| `updated_at` | TEXT | no |  |  |

Indexes:

- `job_events_unwritten`: on (`fsm_write_state`, `received_at`)
- A `UNIQUE` constraint: unique on (`appointment_id`, `event_id`)

## last_visits

Each client's last first fit, service or replacement done, and last consultation done, kept by triggers from the view `last_visits_now` as their visits change; the Tasks board's At-risk client and First fit to book read it (ADR 0086).

Made by `0053_balances_and_last_visits.sql`; changed by `0056_task_owners.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `person_id` | TEXT | no |  | primary key |
| `visit_id` | TEXT | yes |  |  |
| `visit_start` | TEXT | yes |  |  |
| `consulted_start` | TEXT | yes |  |  |

Indexes:

- `last_visits_by_visit_start`: on (`visit_start`)

Triggers: `last_visits_fitted_added`, `last_visits_fitted_changed`.

## leads

Each booking, waitlist sign-up and try-on claim as the CRM receives it, and whether it has reached the CRM and FSM (ADR 0011, ADR 0012).

Made by `0002_lead_path.sql`; changed by `0015_fsm_leads.sql`, `0031_optional_loss_extent.sql`, `0037_cron_indexes.sql`, `0038_alerts.sql`, `0039_money_path.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `person_id` | TEXT | no |  | → `people.id` |
| `created_at` | TEXT | no |  |  |
| `source` | TEXT | no |  |  |
| `city` | TEXT | yes |  | → `cities.name` |
| `first_choice_window` | TEXT | yes |  |  |
| `proposed_visit_date` | TEXT | yes |  |  |
| `utm_source` | TEXT | yes |  |  |
| `utm_medium` | TEXT | yes |  |  |
| `utm_campaign` | TEXT | yes |  |  |
| `utm_content` | TEXT | yes |  |  |
| `gclid` | TEXT | yes |  |  |
| `fbclid` | TEXT | yes |  |  |
| `referrer` | TEXT | yes |  |  |
| `landing_path` | TEXT | yes |  |  |
| `sync_state` | TEXT | no | `'pending'` |  |
| `sync_attempts` | INTEGER | no | `0` |  |
| `last_sync_error` | TEXT | yes |  |  |
| `synced_at` | TEXT | yes |  |  |
| `request_id` | TEXT | no |  |  |
| `fsm_request_id` | TEXT | yes |  |  |
| `loss_extent` | TEXT | yes |  |  |
| `fsm_queued_at` | TEXT | yes |  |  |
| `fsm_request_tried_at` | TEXT | yes |  |  |

Indexes:

- `leads_by_fsm_request`: on (`fsm_request_id`), where `fsm_request_id IS NOT NULL`
- `leads_by_person`: on (`person_id`)
- `leads_by_sync_state`: on (`sync_state`, `created_at`)
- `leads_fsm_unqueued`: on (`created_at`), where `fsm_queued_at IS NULL AND fsm_request_id IS NULL AND source = 'form' AND first_choice_window IS NOT NULL`

## no_show_cases

The evidence a no-show is ruled on, the ruling, and what a charge cost the client (ADR 0065, ADR 0072, ADR 0096).

Made by `0026_field_operations.sql`; changed by `0042_no_show_reasons.sql`, `0044_hand_offs_and_messages.sql`, `0054_policies_in_the_console.sql`, `0059_no_show_charges_and_disputes.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `checkin_id` | TEXT | no |  | → `checkins.id` |
| `appointment_id` | TEXT | no |  | → `appointments.id` |
| `wait_started_at` | TEXT | no |  |  |
| `wait_ends_at` | TEXT | no |  |  |
| `closed_at` | TEXT | yes |  |  |
| `message_id` | TEXT | yes |  | → `outbound_messages.id` |
| `message_delivered_at` | TEXT | yes |  |  |
| `decision` | TEXT | no | `'undecided'` |  |
| `decided_by` | TEXT | yes |  |  |
| `decided_at` | TEXT | yes |  |  |
| `created_at` | TEXT | no |  |  |
| `decision_reason` | TEXT | yes |  |  |
| `waiver_payment` | TEXT | yes |  |  |
| `waiver_credit` | TEXT | yes |  |  |
| `charge` | TEXT | yes |  |  |
| `kept_amount` | INTEGER | yes |  |  |
| `refund_amount` | INTEGER | yes |  |  |
| `ruling_id` | TEXT | yes |  |  |

Indexes:

- `no_show_cases_by_appointment`: on (`appointment_id`, `created_at`)
- `no_show_cases_by_decision`: on (`decision`, `created_at`)
- A `UNIQUE` constraint: unique on (`checkin_id`)

## no_show_disputes

A client's dispute of a no-show's charge, one a charge, and ops' ruling on it, refunded or upheld, with their reason (ADR 0096).

Made by `0059_no_show_charges_and_disputes.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `case_id` | TEXT | no |  | → `no_show_cases.id` |
| `person_id` | TEXT | no |  | → `people.id` |
| `reason` | TEXT | yes |  |  |
| `created_at` | TEXT | no |  |  |
| `ruling` | TEXT | yes |  |  |
| `ruled_by` | TEXT | yes |  |  |
| `ruled_at` | TEXT | yes |  |  |
| `ruling_id` | TEXT | yes |  |  |
| `ruling_reason` | TEXT | yes |  |  |

Indexes:

- `no_show_disputes_by_person`: on (`person_id`)
- `no_show_disputes_open`: on (`created_at`), where `ruling IS NULL`
- A `UNIQUE` constraint: unique on (`case_id`)

## number_change_requests

A client's change of mobile number: the codes proven on both numbers, and what ops decided (ADR 0042, ADR 0078).

Made by `0008_profile.sql`; changed by `0041_vendor_correctness.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `person_id` | TEXT | no |  | → `people.id` |
| `created_at` | TEXT | no |  |  |
| `new_mobile_e164` | TEXT | no |  |  |
| `old_verified_at` | TEXT | yes |  |  |
| `new_verified_at` | TEXT | yes |  |  |
| `state` | TEXT | no |  |  |
| `decided_at` | TEXT | yes |  |  |
| `decided_by` | TEXT | yes |  |  |
| `reason` | TEXT | yes |  |  |
| `replaced_mobile_e164` | TEXT | yes |  |  |

Indexes:

- `number_change_requests_by_person`: on (`person_id`, `created_at`)
- `number_change_requests_by_state`: on (`state`, `created_at`)

## ops_settings

The business inputs ops set in the console, a row each; a row that is not there means the committed default (ADR 0061).

Made by `0033_ops_settings.sql`; changed by `0054_policies_in_the_console.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `name` | TEXT | no |  | primary key |
| `value` | TEXT | no |  |  |
| `set_by` | TEXT | no |  |  |
| `set_at` | TEXT | no |  |  |

Triggers: `ops_settings_snapshot_on_delete`, `ops_settings_snapshot_on_insert`, `ops_settings_snapshot_on_update`.

## ops_settings_snapshot

One row holding every `ops_settings` value, kept by that table's triggers: the one row a request reads (ADR 0088).

Made by `0054_policies_in_the_console.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | INTEGER | no |  | primary key |
| `inputs` | TEXT | no |  |  |

## otp_challenges

Each one-time code sent, as a hash, with its sends and attempts (ADR 0030, ADR 0052).

Made by `0007_login.sql`; changed by `0008_profile.sql`, `0027_pieces_and_zones.sql`, `0037_cron_indexes.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `created_at` | TEXT | no |  |  |
| `person_id` | TEXT | yes |  | → `people.id` |
| `purpose` | TEXT | no |  |  |
| `channel` | TEXT | no |  |  |
| `code_hash` | TEXT | yes |  |  |
| `last_sent_at` | TEXT | no |  |  |
| `sends` | INTEGER | no | `1` |  |
| `attempts` | INTEGER | no | `0` |  |
| `expires_at` | TEXT | no |  |  |
| `verified_at` | TEXT | yes |  |  |
| `voided_at` | TEXT | yes |  |  |
| `number_change_id` | TEXT | yes |  | → `number_change_requests.id` |
| `technician_login` | INTEGER | no | `0` |  |
| `technician_id` | TEXT | yes |  | → `technicians.id` |

Indexes:

- `otp_challenges_by_expiry`: on (`expires_at`)
- `otp_challenges_by_number_change`: on (`number_change_id`), where `number_change_id IS NOT NULL`
- `otp_challenges_by_person`: on (`person_id`, `created_at`)

## outbound_messages

Each WhatsApp message, from queued to sent, delivered and read (ADR 0041).

Made by `0003_tryon.sql`; changed by `0006_outbound_messages_v2.sql`, `0044_hand_offs_and_messages.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `created_at` | TEXT | no |  |  |
| `person_id` | TEXT | no |  | → `people.id` |
| `kind` | TEXT | no |  |  |
| `subject_kind` | TEXT | no | `'tryon_job'` |  |
| `subject_id` | TEXT | no |  |  |
| `state` | TEXT | no |  |  |
| `queued_at` | TEXT | yes |  |  |
| `sending_at` | TEXT | yes |  |  |
| `provider_message_id` | TEXT | yes |  |  |
| `attempts` | INTEGER | no | `0` |  |
| `last_error` | TEXT | yes |  |  |
| `sent_at` | TEXT | yes |  |  |
| `delivered_at` | TEXT | yes |  |  |
| `read_at` | TEXT | yes |  |  |

Indexes:

- `outbound_messages_by_provider_id`: on (`provider_message_id`)
- `outbound_messages_by_state`: on (`state`, `queued_at`)
- `outbound_messages_by_subject`: on (`subject_id`)
- `outbound_messages_one_arrival`: unique on (`subject_id`), where `kind = 'arrival_notice'`

## partial_reasons

The reasons a job may be left partly done, as ops set them, one they took off kept as retired; none means the committed list (ADR 0087).

Made by `0049_consumables_and_stock.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `code` | TEXT | no |  | primary key |
| `label` | TEXT | no |  |  |
| `position` | INTEGER | no |  |  |
| `retired_at` | TEXT | yes |  |  |
| `set_by` | TEXT | no |  |  |
| `set_at` | TEXT | no |  |  |

## payment_links

The Razorpay payment link a consultation and fit in one visit is paid by once the client is fitted: one a visit, the product and its price, when Razorpay made and texted it, and the payment that paid it (ADR 0105).

Made by `0061_one_visit.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `appointment_id` | TEXT | no |  | → `appointments.id` |
| `tier` | TEXT | no |  |  |
| `amount` | INTEGER | no |  |  |
| `amount_ex_gst` | INTEGER | no |  |  |
| `gst_percent` | INTEGER | no |  |  |
| `razorpay_link_id` | TEXT | yes |  |  |
| `short_url` | TEXT | yes |  |  |
| `sent_at` | TEXT | yes |  |  |
| `refused_at` | TEXT | yes |  |  |
| `razorpay_payment_id` | TEXT | yes |  |  |
| `paid_at` | TEXT | yes |  |  |
| `created_at` | TEXT | no |  |  |
| `updated_at` | TEXT | no |  |  |

Indexes:

- `payment_links_unpaid`: on (`created_at`), where `paid_at IS NULL`
- `payment_links_unsent`: on (`created_at`), where `sent_at IS NULL AND refused_at IS NULL`
- A `UNIQUE` constraint: unique on (`appointment_id`)
- A `UNIQUE` constraint: unique on (`razorpay_link_id`)

## payments

The mirror of Razorpay's payments, and where each stands in Books (ADR 0044).

Made by `0014_payments.sql`; changed by `0019_books_payments.sql`, `0020_visit_changes.sql`, `0037_cron_indexes.sql`, `0039_money_path.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `reference` | TEXT | yes |  |  |
| `reference_year` | INTEGER | yes |  |  |
| `reference_number` | INTEGER | yes |  |  |
| `person_id` | TEXT | yes |  | → `people.id` |
| `appointment_id` | TEXT | yes |  | → `appointments.id` |
| `razorpay_order_id` | TEXT | yes |  |  |
| `razorpay_payment_id` | TEXT | no |  |  |
| `amount` | INTEGER | no |  |  |
| `currency` | TEXT | no |  |  |
| `method` | TEXT | yes |  |  |
| `vpa_hash` | TEXT | yes |  |  |
| `card_network` | TEXT | yes |  |  |
| `status` | TEXT | no |  |  |
| `refunded_amount` | INTEGER | no | `0` |  |
| `captured_at` | TEXT | yes |  |  |
| `created_at` | TEXT | no |  |  |
| `updated_at` | TEXT | no |  |  |
| `books_payment_id` | TEXT | yes |  |  |
| `books_checked_at` | TEXT | yes |  |  |
| `books_applied_at` | TEXT | yes |  |  |
| `kind` | TEXT | no | `'visit'` |  |
| `amount_ex_gst` | INTEGER | yes |  |  |
| `gst_percent` | INTEGER | yes |  |  |

Indexes:

- `payments_books_unapplied`: on (`captured_at`), where `books_payment_id IS NOT NULL AND books_applied_at IS NULL`
- `payments_books_unrecorded`: on (`captured_at`), where `books_payment_id IS NULL AND captured_at IS NOT NULL`
- `payments_by_appointment`: on (`appointment_id`)
- `payments_by_order`: on (`razorpay_order_id`)
- `payments_by_person`: on (`person_id`, `created_at`)
- `payments_refunded_visits`: on (`appointment_id`), where `status = 'refunded' AND kind = 'visit'`
- A `UNIQUE` constraint: unique on (`reference`)
- A `UNIQUE` constraint: unique on (`razorpay_payment_id`)
- A `UNIQUE` constraint: unique on (`reference_year`, `reference_number`)

## people

One row per person, keyed by mobile number. D1 owns the identity; the CRM's ID is only a reference (ADR 0011).

Made by `0002_lead_path.sql`; changed by `0004_erasure.sql`, `0011_fsm_mirror.sql`, `0023_dpdp.sql`, `0036_erased_files.sql`, `0037_cron_indexes.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `created_at` | TEXT | no |  |  |
| `mobile_e164` | TEXT | no |  |  |
| `name` | TEXT | no |  |  |
| `email` | TEXT | yes |  |  |
| `zoho_lead_id` | TEXT | yes |  |  |
| `contactable` | INTEGER | no | `0` |  |
| `erased_at` | TEXT | yes |  |  |
| `crm_erased_at` | TEXT | yes |  |  |
| `crm_erasure_attempts` | INTEGER | no | `0` |  |
| `crm_erasure_error` | TEXT | yes |  |  |
| `fsm_contact_id` | TEXT | yes |  |  |
| `fsm_erased_at` | TEXT | yes |  |  |
| `fsm_erasure_attempts` | INTEGER | no | `0` |  |
| `files_erased_at` | TEXT | yes |  |  |

Indexes:

- `people_by_fsm_contact`: unique on (`fsm_contact_id`), where `fsm_contact_id IS NOT NULL`
- `people_crm_erasure_due`: on (`erased_at`), where `erased_at IS NOT NULL AND crm_erased_at IS NULL`
- `people_files_to_erase`: on (`erased_at`), where `erased_at IS NOT NULL AND files_erased_at IS NULL`
- `people_fsm_erasure_due`: on (`erased_at`), where `erased_at IS NOT NULL AND fsm_contact_id IS NOT NULL AND fsm_erased_at IS NULL`
- A `UNIQUE` constraint: unique on (`mobile_e164`)

## photo_sets

A visit's set of photographs, before or after (ADR 0028).

Made by `0013_client_photos.sql`; changed by `0045_kept_try_ons.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `appointment_id` | TEXT | no |  | → `appointments.id` |
| `phase` | TEXT | no |  |  |
| `created_at` | TEXT | no |  |  |

Indexes:

- `photo_sets_by_created`: on (`created_at`)
- A `UNIQUE` constraint: unique on (`appointment_id`, `phase`)

## photos

One photograph of a set, by its angle, and where it and its thumbnail are kept in R2 (ADR 0028, ADR 0093).

Made by `0013_client_photos.sql`; changed by `0055_storage_meter.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `photo_set_id` | TEXT | no |  | → `photo_sets.id` |
| `angle` | TEXT | no |  |  |
| `r2_key` | TEXT | no |  |  |
| `content_type` | TEXT | no |  |  |
| `bytes` | INTEGER | no |  |  |
| `width` | INTEGER | yes |  |  |
| `height` | INTEGER | yes |  |  |
| `taken_at` | TEXT | no |  |  |
| `fsm_attachment_id` | TEXT | yes |  |  |
| `created_at` | TEXT | no |  |  |
| `thumbnail_key` | TEXT | yes |  |  |

Indexes:

- A `UNIQUE` constraint: unique on (`r2_key`)
- A `UNIQUE` constraint: unique on (`fsm_attachment_id`)
- A `UNIQUE` constraint: unique on (`photo_set_id`, `angle`)

## pieces

The mirror of FSM's assets: each piece fitted, its base and lot, the day it was fitted and the day it falls due, and a failure with its reason (ADR 0032).

Made by `0027_pieces_and_zones.sql`; changed by `0060_flat_task_reads.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `fsm_id` | TEXT | no |  |  |
| `person_id` | TEXT | yes |  | → `people.id` |
| `piece_code` | TEXT | no |  |  |
| `base` | TEXT | yes |  |  |
| `supplier_lot` | TEXT | yes |  |  |
| `fitted_at` | TEXT | yes |  |  |
| `replacement_due_at` | TEXT | yes |  |  |
| `appointment_id` | TEXT | yes |  | → `appointments.id` |
| `failed_at` | TEXT | yes |  |  |
| `failure_reason` | TEXT | yes |  |  |
| `synced_at` | TEXT | no |  |  |
| `deleted_at` | TEXT | yes |  |  |
| `replacement_booked` | INTEGER | no | `0` |  |

Indexes:

- `pieces_by_code`: on (`piece_code`)
- `pieces_by_person`: on (`person_id`, `fitted_at`)
- `pieces_to_replace`: on (`replacement_due_at`), where `replacement_booked = 0 AND deleted_at IS NULL AND failed_at IS NULL AND replacement_due_at IS NOT NULL`
- A `UNIQUE` constraint: unique on (`fsm_id`)

Triggers: `pieces_replacement_booked_added`, `pieces_replacement_booked_changed`.

## price_book

Every price from its date, and the only source of prices; an old row stays for what was sold under it (ADR 0045, ADR 0061).

Made by `0016_booking.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `item` | TEXT | no |  | primary key |
| `tier` | TEXT | no | `'standard'` | primary key |
| `amount_ex_gst` | INTEGER | no |  |  |
| `gst_percent` | INTEGER | no |  |  |
| `valid_from` | TEXT | no |  | primary key |

## razorpay_events

Each Razorpay webhook event, once, by its event ID (ADR 0044).

Made by `0014_payments.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `event_id` | TEXT | no |  | primary key |
| `event` | TEXT | no |  |  |
| `received_at` | TEXT | no |  |  |

## referral_attributions

A person who came through an invite, to the first invite they used, what became of its grant, and who attached it and why where ops did (ADR 0048, ADR 0089).

Made by `0021_referrals.sql`; changed by `0037_cron_indexes.sql`, `0044_hand_offs_and_messages.sql`, `0051_invites_ops_attach.sql`, `0060_flat_task_reads.sql`, `0062_referral_reward_kept.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `code` | TEXT | no |  | → `referral_codes.code` |
| `referred_person_id` | TEXT | no |  | → `people.id` |
| `first_touch_at` | TEXT | no |  |  |
| `via` | TEXT | no |  |  |
| `pincode` | TEXT | yes |  |  |
| `consultation_appointment_id` | TEXT | yes |  | → `appointments.id` |
| `first_fit_appointment_id` | TEXT | yes |  | → `appointments.id` |
| `grant_state` | TEXT | no | `'pending'` |  |
| `fraud_signals` | TEXT | yes |  |  |
| `review_reason` | TEXT | yes |  |  |
| `reviewed_by` | TEXT | yes |  |  |
| `reviewed_at` | TEXT | yes |  |  |
| `created_at` | TEXT | no |  |  |
| `updated_at` | TEXT | no |  |  |
| `friend_first_name` | TEXT | yes |  |  |
| `attached_by` | TEXT | yes |  |  |
| `attach_reason` | TEXT | yes |  |  |
| `referrer_visits` | INTEGER | yes |  |  |
| `friend_visits` | INTEGER | yes |  |  |
| `credit_valid_days` | INTEGER | yes |  |  |

Indexes:

- `referral_attributions_by_code`: on (`code`, `created_at`)
- `referral_attributions_by_first_fit`: on (`first_fit_appointment_id`), where `first_fit_appointment_id IS NOT NULL`
- `referral_attributions_held`: on (`code`), where `grant_state = 'held'`
- `referral_attributions_pending`: on (`referred_person_id`), where `grant_state = 'pending'`
- A `UNIQUE` constraint: unique on (`referred_person_id`)

## referral_codes

A client's invite code, the version of their card, and how often the invite was opened (ADR 0048).

Made by `0021_referrals.sql`; changed by `0024_referral_opens.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `code` | TEXT | no |  | primary key |
| `person_id` | TEXT | no |  | → `people.id` |
| `card_state` | TEXT | no | `'house'` |  |
| `card_version` | INTEGER | no | `1` |  |
| `card_key` | TEXT | yes |  |  |
| `created_at` | TEXT | no |  |  |
| `updated_at` | TEXT | no |  |  |
| `opens` | INTEGER | no | `0` |  |

Indexes:

- A `UNIQUE` constraint: unique on (`person_id`)

## refunds

The mirror of Razorpay's refunds, and where each stands in Books (ADR 0044).

Made by `0014_payments.sql`; changed by `0019_books_payments.sql`, `0037_cron_indexes.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `payment_id` | TEXT | no |  | → `payments.id` |
| `razorpay_refund_id` | TEXT | no |  |  |
| `amount` | INTEGER | no |  |  |
| `status` | TEXT | no |  |  |
| `speed` | TEXT | yes |  |  |
| `created_at` | TEXT | no |  |  |
| `processed_at` | TEXT | yes |  |  |
| `updated_at` | TEXT | no |  |  |
| `books_refund_id` | TEXT | yes |  |  |
| `books_checked_at` | TEXT | yes |  |  |

Indexes:

- `refunds_books_unrecorded`: on (`created_at`), where `status = 'processed' AND books_refund_id IS NULL`
- `refunds_by_payment`: on (`payment_id`)
- A `UNIQUE` constraint: unique on (`razorpay_refund_id`)

## serviceable_pincodes

Every NCR pincode, its area and city, and whether and since when we serve it (ADR 0048, ADR 0061).

Made by `0021_referrals.sql`; changed by `0043_area_names.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `pincode` | TEXT | no |  | primary key |
| `area` | TEXT | no |  |  |
| `city` | TEXT | no |  |  |
| `served` | INTEGER | no | `0` |  |
| `launched_at` | TEXT | yes |  |  |
| `area_named_by` | TEXT | yes |  |  |

## services

What clients may book: each kind of visit's services, their names, lengths and order, when each is retired, and its item in FSM's catalogue; the price book prices each by its kind and tier (ADR 0085).

Made by `0050_services.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `kind` | TEXT | no |  | primary key |
| `tier` | TEXT | no |  | primary key |
| `name` | TEXT | no |  |  |
| `minutes` | INTEGER | no |  |  |
| `sort` | INTEGER | no | `0` |  |
| `retired_date` | TEXT | yes |  |  |
| `fsm_item_id` | TEXT | yes |  |  |
| `updated_by` | TEXT | no |  |  |
| `updated_at` | TEXT | no |  |  |

Indexes:

- A `UNIQUE` constraint: unique on (`name`)

## sessions

The client app's and the technician app's sessions: whose, from which device, and when each ends or was revoked (ADR 0029, ADR 0052).

Made by `0007_login.sql`; changed by `0037_cron_indexes.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `subject_kind` | TEXT | no |  |  |
| `subject_id` | TEXT | no |  |  |
| `created_at` | TEXT | no |  |  |
| `last_seen_at` | TEXT | no |  |  |
| `expires_at` | TEXT | no |  |  |
| `device_label` | TEXT | yes |  |  |
| `revoked_at` | TEXT | yes |  |  |

Indexes:

- `sessions_by_expiry`: on (`expires_at`)
- `sessions_by_revoked`: on (`revoked_at`), where `revoked_at IS NOT NULL`
- `sessions_by_subject`: on (`subject_kind`, `subject_id`)

## slot_claims

What a hold or a visit takes of a technician's day, a row per half-slot and window, so no time is taken twice (ADR 0034, ADR 0069).

Made by `0016_booking.sql`; changed by `0040_dispatch_claims.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `technician_id` | TEXT | no |  | primary key; → `technicians.id` |
| `date` | TEXT | no |  | primary key |
| `claim` | TEXT | no |  | primary key |
| `hold_id` | TEXT | yes |  | → `slot_holds.id` |
| `move_id` | TEXT | yes |  | → `dispatch_moves.id` |

Indexes:

- `slot_claims_by_hold`: on (`hold_id`)
- `slot_claims_by_move`: on (`move_id`), where `move_id IS NOT NULL`

## slot_holds

A slot held while a client pays, and what became of it (ADR 0045, ADR 0068).

Made by `0016_booking.sql`; changed by `0017_hold_refunds.sql`, `0020_visit_changes.sql`, `0022_credit_bookings.sql`, `0037_cron_indexes.sql`, `0039_money_path.sql`, `0050_services.sql`, `0053_balances_and_last_visits.sql`, `0054_policies_in_the_console.sql`, `0058_held_bookings.sql`, `0061_one_visit.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `person_id` | TEXT | no |  | → `people.id` |
| `type` | TEXT | no |  |  |
| `date` | TEXT | no |  |  |
| `window_label` | TEXT | no |  |  |
| `technician_id` | TEXT | no |  | → `technicians.id` |
| `start_unit` | INTEGER | no |  |  |
| `amount` | INTEGER | no |  |  |
| `amount_ex_gst` | INTEGER | no |  |  |
| `gst_percent` | INTEGER | no |  |  |
| `state` | TEXT | no |  |  |
| `razorpay_order_id` | TEXT | yes |  |  |
| `appointment_id` | TEXT | yes |  | → `appointments.id` |
| `expires_at` | TEXT | no |  |  |
| `created_at` | TEXT | no |  |  |
| `updated_at` | TEXT | no |  |  |
| `refunded_at` | TEXT | yes |  |  |
| `moves_appointment_id` | TEXT | yes |  | → `appointments.id` |
| `move_kind` | TEXT | yes |  |  |
| `use_credit` | INTEGER | no | `0` |  |
| `confirmed_at` | TEXT | yes |  |  |
| `queued_at` | TEXT | yes |  |  |
| `booking_until` | TEXT | yes |  |  |
| `fsm_tried_at` | TEXT | yes |  |  |
| `fsm_work_order_id` | TEXT | yes |  |  |
| `fsm_appointment_id` | TEXT | yes |  |  |
| `pincode` | TEXT | yes |  |  |
| `late_fee_ex_gst` | INTEGER | yes |  |  |
| `late_fee_gst_percent` | INTEGER | yes |  |  |
| `tier` | TEXT | no | `'standard'` |  |
| `minutes` | INTEGER | yes |  |  |
| `grace_seconds` | INTEGER | yes |  |  |
| `change_notice_hours` | INTEGER | yes |  |  |
| `late_change_charge` | TEXT | yes |  |  |
| `no_show_charge` | TEXT | yes |  |  |
| `fsm_held_at` | TEXT | yes |  |  |
| `fsm_refusal` | TEXT | yes |  |  |
| `one_visit` | INTEGER | no | `0` |  |

Indexes:

- `slot_holds_by_appointment`: on (`appointment_id`), where `appointment_id IS NOT NULL`
- `slot_holds_by_person`: on (`person_id`, `created_at`)
- `slot_holds_confirmed`: on (`queued_at`), where `state = 'held' AND confirmed_at IS NOT NULL`
- `slot_holds_confirmed_by_person`: on (`person_id`), where `state = 'held' AND confirmed_at IS NOT NULL`
- `slot_holds_held`: on (`expires_at`), where `state = 'held'`
- A `UNIQUE` constraint: unique on (`razorpay_order_id`)

## stock_balances

What each place holds of each consumable, and when it last counted it: the sum of its rows in `stock_movements`, kept by triggers as each is written (ADR 0087).

Made by `0053_balances_and_last_visits.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `consumable_code` | TEXT | no |  | primary key; → `consumables.code` |
| `place` | TEXT | no |  | primary key |
| `quantity` | INTEGER | no |  |  |
| `counted_at` | TEXT | yes |  |  |

## stock_movements

Every movement of a consumable into or out of the central store or a technician's kit, never changed; what a place holds is the sum of its rows (ADR 0087).

Made by `0049_consumables_and_stock.sql`; changed by `0053_balances_and_last_visits.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `consumable_code` | TEXT | no |  | → `consumables.code` |
| `location` | TEXT | no |  |  |
| `technician_id` | TEXT | yes |  | → `technicians.id` |
| `quantity` | INTEGER | no |  |  |
| `reason` | TEXT | no |  |  |
| `transfer_id` | TEXT | yes |  |  |
| `appointment_id` | TEXT | yes |  | → `appointments.id` |
| `job_event_id` | TEXT | yes |  | → `job_events.id` |
| `actor_kind` | TEXT | no |  |  |
| `actor` | TEXT | no |  |  |
| `note` | TEXT | yes |  |  |
| `created_at` | TEXT | no |  |  |

Indexes:

- `stock_movements_by_job`: on (`appointment_id`), where `reason = 'used'`
- `stock_movements_held`: on (`technician_id`, `consumable_code`)
- `stock_movements_latest`: on (`created_at`)
- `stock_movements_used`: unique on (`job_event_id`, `consumable_code`), where `reason = 'used'`

Triggers: `stock_movements_balance`, `stock_movements_no_update`, `stock_movements_taken_out`.

## storage_meter

What Phase 2's two buckets, client-photos and referral-cards, hold together: one row, the sum of `stored_objects` kept beside it, and the last mark of the share ops were told of (ADR 0093).

Made by `0055_storage_meter.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | INTEGER | no |  | primary key |
| `bytes` | INTEGER | no |  |  |
| `told_percent` | INTEGER | no | `0` |  |

## stored_objects

Each object client-photos and referral-cards hold, and its size, written as it is stored and deleted as it is, so the storage meter never counts one twice (ADR 0093).

Made by `0055_storage_meter.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `key` | TEXT | no |  | primary key |
| `bytes` | INTEGER | no |  |  |

## sync_cursors

Where each pass of the reconciliation with FSM has reached (ADR 0032).

Made by `0012_fsm_reconciliation.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `name` | TEXT | no |  | primary key |
| `pass_date` | TEXT | yes |  |  |
| `next_page` | INTEGER | no | `1` |  |
| `pass_started_at` | TEXT | yes |  |  |
| `repaired` | INTEGER | no | `0` |  |
| `updated_at` | TEXT | no |  |  |

## task_closures

A task on the Tasks board ops closed without doing its thing, a visit left partly done alone, with why, who and when, by the task's group and its row's id (ADR 0092).

Made by `0056_task_owners.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `task_group` | TEXT | no |  |  |
| `subject_id` | TEXT | no |  |  |
| `reason` | TEXT | yes |  |  |
| `closed_by` | TEXT | no |  |  |
| `closed_at` | TEXT | no |  |  |

Indexes:

- A `UNIQUE` constraint: unique on (`task_group`, `subject_id`)

## task_owners

The member of staff a task on the Tasks board is theirs, by Access e-mail, by the task's group, its row's id and, where that row can be a new task again, its episode; a task with no row for it is nobody's (ADR 0092).

Made by `0056_task_owners.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `task_group` | TEXT | no |  | primary key |
| `subject_id` | TEXT | no |  | primary key |
| `episode` | TEXT | no |  |  |
| `owner` | TEXT | no |  |  |
| `assigned_by` | TEXT | no |  |  |
| `assigned_at` | TEXT | no |  |  |

## technician_devices

The phones technicians work from, each bound to a session and revocable by ops (ADR 0052).

Made by `0026_field_operations.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `technician_id` | TEXT | no |  | → `technicians.id` |
| `device_id` | TEXT | no |  |  |
| `session_id` | TEXT | yes |  | → `sessions.id` |
| `label` | TEXT | yes |  |  |
| `created_at` | TEXT | no |  |  |
| `last_seen_at` | TEXT | no |  |  |
| `revoked_at` | TEXT | yes |  |  |
| `revoked_by` | TEXT | yes |  |  |
| `wiped_at` | TEXT | yes |  |  |

Indexes:

- A `UNIQUE` constraint: unique on (`technician_id`, `device_id`)
- `technician_devices_by_session`: on (`session_id`)

## technician_leave

A technician's leave in whole days, which the clash check reads beside `slot_claims` (ADR 0062).

Made by `0034_leave_and_asked_window.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `technician_id` | TEXT | no |  | → `technicians.id` |
| `from_date` | TEXT | no |  |  |
| `to_date` | TEXT | no |  |  |
| `note` | TEXT | yes |  |  |
| `actor` | TEXT | no |  |  |
| `created_at` | TEXT | no |  |  |
| `cancelled_at` | TEXT | yes |  |  |
| `cancelled_by` | TEXT | yes |  |  |

Indexes:

- `technician_leave_by_technician`: on (`technician_id`, `from_date`)

## technicians

The mirror of FSM's technicians: name, initials, mobile number and zone; and on staging the few written by hand for a test, which the sync leaves alone (ADR 0032, ADR 0052).

Made by `0011_fsm_mirror.sql`; changed by `0027_pieces_and_zones.sql`, `0046_hand_written_technicians.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `fsm_id` | TEXT | no |  |  |
| `name` | TEXT | no |  |  |
| `initials` | TEXT | no |  |  |
| `active` | INTEGER | no |  |  |
| `updated_at` | TEXT | no |  |  |
| `zone` | TEXT | yes |  |  |
| `mobile_e164` | TEXT | yes |  |  |
| `hand_written` | INTEGER | no | `0` |  |

Indexes:

- A `UNIQUE` constraint: unique on (`fsm_id`)
- `technicians_by_mobile`: on (`mobile_e164`)

## tryon_jobs

One try-on render: the photograph, the look, the provider's job and the result (ADR 0014, ADR 0015).

Made by `0003_tryon.sql`; changed by `0037_cron_indexes.sql`, `0045_kept_try_ons.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `created_at` | TEXT | no |  |  |
| `upload_key` | TEXT | no |  |  |
| `uploaded_at` | TEXT | yes |  |  |
| `upload_deleted_at` | TEXT | yes |  |  |
| `parent_job_id` | TEXT | yes |  | → `tryon_jobs.id` |
| `stage` | TEXT | yes |  |  |
| `preset` | TEXT | yes |  |  |
| `hair_color` | TEXT | yes |  |  |
| `endpoint` | TEXT | yes |  |  |
| `provider_color` | TEXT | yes |  |  |
| `color_route` | TEXT | yes |  |  |
| `state` | TEXT | no |  |  |
| `submit_started_at` | TEXT | yes |  |  |
| `submit_attempts` | INTEGER | no | `0` |  |
| `submitted_at` | TEXT | yes |  |  |
| `provider_task_id` | TEXT | yes |  |  |
| `provider_result_url` | TEXT | yes |  |  |
| `provider_result_expires_at` | TEXT | yes |  |  |
| `download_attempts` | INTEGER | no | `0` |  |
| `download_attempted_at` | TEXT | yes |  |  |
| `result_key` | TEXT | yes |  |  |
| `failure_code` | TEXT | yes |  |  |
| `provider_error_detail` | TEXT | yes |  |  |
| `latency_ms` | INTEGER | yes |  |  |
| `person_id` | TEXT | yes |  | → `people.id` |
| `lead_id` | TEXT | yes |  | → `leads.id` |
| `session_id` | TEXT | yes |  |  |
| `claimed_at` | TEXT | yes |  |  |
| `expires_at` | TEXT | yes |  |  |
| `photo_consent_version` | TEXT | no |  |  |
| `photo_consent_at` | TEXT | no |  |  |
| `ip_hash` | TEXT | no |  |  |
| `request_id` | TEXT | no |  |  |
| `copy_key` | TEXT | yes |  |  |
| `kept_at` | TEXT | yes |  |  |
| `kept_look_key` | TEXT | yes |  |  |

Indexes:

- `tryon_jobs_by_person`: on (`person_id`), where `person_id IS NOT NULL`
- `tryon_jobs_by_session`: on (`session_id`)
- `tryon_jobs_by_state`: on (`state`, `created_at`)
- `tryon_jobs_by_upload`: on (`upload_key`)
- `tryon_jobs_one_kept`: unique on (`person_id`), where `kept_at IS NOT NULL`
- `tryon_jobs_photos_held`: on (`upload_key`, `created_at`, `state`), where `upload_deleted_at IS NULL AND uploaded_at IS NOT NULL`

## tryon_sessions

The try-on gate's session, which showed a visitor their result (ADR 0014); written no more since the look goes to WhatsApp only (ADR 0104).

Made by `0003_tryon.sql`; changed by `0037_cron_indexes.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `person_id` | TEXT | no |  | → `people.id` |
| `created_at` | TEXT | no |  |  |
| `expires_at` | TEXT | no |  |  |

Indexes:

- `tryon_sessions_by_expiry`: on (`expires_at`)
- `tryon_sessions_by_person`: on (`person_id`)

## visit_blackouts

Days on which no visit is offered.

Made by `0002_lead_path.sql`; changed by `0054_policies_in_the_console.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `date` | TEXT | no |  | primary key |
| `reason` | TEXT | no |  |  |
| `set_by` | TEXT | yes |  |  |
| `set_at` | TEXT | yes |  |  |

## visit_changes

Each move or cancel a client made, with its notice and what it cost (ADR 0046).

Made by `0020_visit_changes.sql`; changed by `0037_cron_indexes.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `appointment_id` | TEXT | no |  | → `appointments.id` |
| `person_id` | TEXT | no |  | → `people.id` |
| `kind` | TEXT | no |  |  |
| `notice` | TEXT | no |  |  |
| `was_start` | TEXT | no |  |  |
| `now_start` | TEXT | yes |  |  |
| `refund_amount` | INTEGER | no | `0` |  |
| `kept_amount` | INTEGER | no | `0` |  |
| `payment_id` | TEXT | yes |  | → `payments.id` |
| `razorpay_refund_id` | TEXT | yes |  |  |
| `hold_id` | TEXT | yes |  | → `slot_holds.id` |
| `created_at` | TEXT | no |  |  |

Indexes:

- `visit_changes_by_appointment`: on (`appointment_id`, `created_at`)
- `visit_changes_by_payment`: on (`payment_id`)
- `visit_changes_one_end`: unique on (`appointment_id`), where `kind IN ('replaced', 'cancelled')`

## visits

What an appointment became once FSM closed it: the outcome, its reason and its times (ADR 0032, ADR 0074).

Made by `0011_fsm_mirror.sql`; changed by `0044_hand_offs_and_messages.sql`, `0060_flat_task_reads.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `appointment_id` | TEXT | no |  | → `appointments.id` |
| `started_at` | TEXT | yes |  |  |
| `ended_at` | TEXT | yes |  |  |
| `duration_minutes` | INTEGER | yes |  |  |
| `outcome` | TEXT | no |  |  |
| `partial_reason` | TEXT | yes |  |  |
| `updated_at` | TEXT | no |  |  |
| `followed_up` | INTEGER | no | `0` |  |

Indexes:

- A `UNIQUE` constraint: unique on (`appointment_id`)
- `visits_partial`: on (`appointment_id`), where `outcome = 'partial'`
- `visits_partial_open`: on (`appointment_id`), where `outcome = 'partial' AND followed_up = 0`

Triggers: `visits_followed_up_added`, `visits_followed_up_changed`.

## waitlist_entries

Someone waiting for us to reach their pincode, and whether they were told it launched (ADR 0048).

Made by `0021_referrals.sql`; changed by `0037_cron_indexes.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `pincode` | TEXT | no |  |  |
| `person_id` | TEXT | no |  | → `people.id` |
| `referral_code` | TEXT | yes |  | → `referral_codes.code` |
| `contact_consent_at` | TEXT | no |  |  |
| `launch_alert` | INTEGER | no | `0` |  |
| `alerted_at` | TEXT | yes |  |  |
| `created_at` | TEXT | no |  |  |

Indexes:

- A `UNIQUE` constraint: unique on (`pincode`, `person_id`)
- `waitlist_entries_by_person`: on (`person_id`)
- `waitlist_entries_by_pincode`: on (`pincode`, `created_at`)

## webhook_inbox

FSM's webhook deliveries, each kept once (ADR 0032).

Made by `0011_fsm_mirror.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | TEXT | no |  | primary key |
| `source` | TEXT | no |  |  |
| `dedupe_key` | TEXT | no |  |  |
| `module` | TEXT | no |  |  |
| `record_id` | TEXT | no |  |  |
| `received_at` | TEXT | no |  |  |
| `processed_at` | TEXT | yes |  |  |
| `attempts` | INTEGER | no | `0` |  |
| `last_error` | TEXT | yes |  |  |

Indexes:

- A `UNIQUE` constraint: unique on (`dedupe_key`)
- `webhook_inbox_unprocessed`: on (`processed_at`, `received_at`)

## zoho_access_tokens

Each Zoho client's access token, and the lease one caller holds while it asks for a new one (ADR 0070).

Made by `0041_vendor_correctness.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `client` | TEXT | no |  | primary key |
| `access_token` | TEXT | yes |  |  |
| `expires_at` | TEXT | yes |  |  |
| `refreshing_until` | TEXT | yes |  |  |
| `cool_down_until` | TEXT | yes |  |  |

## zoho_token

The CRM's access token before migration 0041; unread since, and dropped later (open point 90).

Made by `0002_lead_path.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `id` | INTEGER | no |  | primary key |
| `access_token` | TEXT | no |  |  |
| `expires_at` | TEXT | no |  |  |

## zoho_tokens

FSM's and Books' access token before migration 0041; unread since, and dropped later (open point 90).

Made by `0010_zoho_tokens.sql`.

| Column | Type | May be empty | Default | Key |
| --- | --- | --- | --- | --- |
| `client` | TEXT | no |  | primary key |
| `access_token` | TEXT | no |  |  |
| `expires_at` | TEXT | no |  |  |
