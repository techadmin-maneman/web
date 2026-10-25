// What each table is for, in a line, as docs/schema.md lists it (./schema-doc.ts writes the document).

/** What each table holds, in a line. */
export const PURPOSES: Readonly<Record<string, string>> = {
  addresses:
    "Each address a client has given, in the app or to ops on the phone, who then saved it for them (`given_to_staff`). The current one has `replaced_at` empty; earlier ones stay for the visits booked to them (ADR 0042, ADR 0054, ADR 0092).",
  alerts: "One row per alert while it is open, kept once it is resolved; raising it again counts it (ADR 0067).",
  appointments:
    "Each visit, mirrored from FSM or booked without it: when, with whom, of what type and in what state, and what we have learnt of each since, such as the window asked for and its invoice. `fsm_id` is FSM's ID for a visit FSM holds, otherwise the row's own (ADR 0032, ADR 0110).",
  audit_log:
    "Every ops action that reads or changes a client's data, and who took it. An entry is never changed (ADR 0031).",
  board_version:
    "One row: a number that triggers raise whenever a visit, a move, leave, a technician or the day's slot times change, so the open dispatch board reads itself again only then (ADR 0069).",
  checkins:
    'Each "I have arrived", passed or not, with the distance measured and the radius in force (ADR 0065); an erasure blanks where the phone was (ADR 0094).',
  checklist_items:
    "Each kind of visit's checklist as ops set it, an item they took off kept as retired; a kind with no rows takes the committed list (ADR 0087).",
  cities:
    "Our cities, each a row ops edit at Admin › Cities: its state for GST, its zone, whether it is served and offered. A lead, a pincode, a technician and a stock place name one, and a zone groups them for staff access (ADR 0109, ADR 0198).",
  consents:
    "What each person agreed to, under which notice's version, and where (ADR 0094). Rows are only ever added (ADR 0042, ADR 0049).",
  consultation_requests:
    "A consultation asked for while self-serve booking is off, for ops to fix the hour (ADR 0060).",
  consumable_usage:
    "What each service, a kind of visit at a tier of the price book, is expected to use of each consumable: where the technician's steppers start (ADR 0087).",
  purchase_orders:
    "Each purchase order to a supplier: its state from drafted to closed or cancelled, who approved, sent or cancelled it, and when (ADR 0166).",
  po_lines:
    "Each line of a purchase order: the stock code, how many, the price it was ordered at, and how many have arrived (ADR 0166).",
  receipts:
    "Each receipt against a purchase order at the warehouse: who received it, the supplier's invoice, the rupee rate and the freight, duty and clearing (ADR 0167).",
  receipt_lines:
    "What a receipt brought of each order line: accepted, damaged, failed its check, its lot, and what one cost landed (ADR 0167).",
  custom_orders:
    "Each hair system made for one client to their exact spec: the spec, supplier and price, its payment link and payment, and the order it was bought on (ADR 0174).",
  count_lines:
    "Each item a count task counted: what the ledger held, which the counter never saw, the count, any recount, and whether the ledger took it (ADR 0185).",
  count_tasks:
    "Each cycle count of one class of items at one place: raised once its period comes round, counted blind, counted again where it differs, signed off where that stands (ADR 0185).",
  demand_events:
    "The calendar of uplifts ops keep, each an event in a city or every city, which lifts the forecast's baseline (ADR 0179).",
  forecast_accuracy:
    "How right each forecast run was: its first period's expected use and high case of each stock code in each city beside what the kits used (ADR 0183).",
  forecast_lines:
    "Each forecast run's expected use of each stock code in each city and period, with what each of its four layers gave (ADR 0179).",
  forecast_runs:
    "Each demand forecast run, once a planning period: its period, horizon and the rates it learned (ADR 0179).",
  plan_lines:
    "Each move the supply plan proposes from a forecast run, a transfer or an order, with the figures behind it and what ops decided (ADR 0180).",
  recall_pieces: "Each fitted piece a recall made due for replacement, and the day it was due before (ADR 0187).",
  recalls: "Each lot recalled: why, who raised it and when, and when it was closed once dealt with (ADR 0187).",
  stock_risks:
    "Each fit booked ahead found with no hair system in its city, or no profile to match one by, and when it was no longer at risk (ADR 0178).",
  supplier_claims:
    "Each claim on a supplier: what arrived damaged or failed its check, or a returned piece in warranty, and whether it was sent, credited, replaced, rejected or withdrawn (ADR 0169).",
  suppliers:
    "Each supplier we buy stock from: its terms, currency and warranty, retired rather than deleted (ADR 0165).",
  supplier_items:
    "What each supplier supplies of a stock code: their code, price in their currency, pack, minimum order and lead time (ADR 0165).",
  consumables:
    "The consumables ops keep: name, unit, what one costs, the reorder levels, the day it is retired from, and FSM's part for it (ADR 0087).",
  hair_systems:
    "Each hair system kept in stock: its product, base size, colour, grey and density, matched exactly to a client's profile; its stock code is a row of `consumables`, counted in pieces (ADR 0156).",
  consumables_used:
    "The consumables a technician recorded at a job's third step, with what its service expected and what one cost that day (ADR 0038, ADR 0087).",
  counters: "Fixed-window counters for the rate limits and the daily ceilings (ADR 0011).",
  conversations:
    "The Care inbox: one thread for each number that writes to our WhatsApp number, matched to its client where we know the number (ADR 0129).",
  chat_messages:
    "Every message in a Care inbox thread: what the client wrote, our replies, and notes only staff see (ADR 0129).",
  care_weekly_off: "Each Care team member's weekly days off, as a Customer Care manager sets them (ADR 0134).",
  care_leave: "Leave for a Care team member, from one date to another; their chats are covered meanwhile (ADR 0134).",
  care_names: "The first name each Care team member is known by to clients, as their Support card shows it (ADR 0136).",
  technician_updates:
    "A technician's word to the client from the job card: on the way, at the gate, or running late, sent from our number (ADR 0145).",
  remedies:
    "Free service visits Customer Care gave a client, with why: given within the limit, or awaiting a manager (ADR 0143).",
  quick_replies: "Saved answers Customer Care pick in a chat, kept by a Customer Care manager (ADR 0141).",
  city_matters:
    "A matter Customer Care sent from a chat to the client's city, on that city's Tasks until it is closed (ADR 0135).",
  care_owners:
    "Each client's named Care person, given at their first chat and moved by a Customer Care manager (ADR 0131).",
  crm_contact_updates:
    "A client's contact change still owed to their CRM lead, which the sweeper sends again until the lead has it (ADR 0203).",
  terms_acceptances:
    "Each time a person agreed to the terms and the privacy policy as they booked: the versions, where and when. Rows are only ever added.",
  vendor_breakers: "Each vendor's failures in a row, and until when its work waits while it is held off (ADR 0203).",
  credit_ledger:
    "Service-visit credits, entry by entry, each drawing on the grant it spends; a balance is summed, never kept (ADR 0033).",
  credit_expiry_cursor:
    "One row: how far the pass that closes expired credits has got, so it reads only the grants that expired since.",
  cron_jobs: "Each job of the cron, and how many runs in a row it has failed (ADR 0067).",
  cron_runs:
    "One row: when the cron's latest run started and its last finished run ended, so a run cut short is told by the next.",
  deletion_requests: "A client's request to be erased, waiting for ops, and what ops decided (ADR 0042, ADR 0078).",
  discount_code_uses:
    "Each time a discount code was entered on a booking, its hold or its visit: by whom, and what it took off before GST once the price was known. Never deleted: one taken off is marked removed (ADR 0108).",
  discount_codes:
    "The discount codes ops make: a percentage with an optional cap or an amount, the kinds of visit each covers, its last day and limits, and whether it is switched off (ADR 0108).",
  deployment_identity: "Which environment's database this is, so a Worker refuses to serve on another's (ADR 0003).",
  dispatch_moves:
    "Every move ops make on the dispatch board: from where to where, by whom, why, what FSM said, and whether the client was told (ADR 0069).",
  events: "What happened, for analysis, with no personal data in its payload.",
  first_fit_requests:
    "A first fit asked for on the site's form with the consultation; a person's latest stands (ADR 0086). The form no longer asks for one (ADR 0105), and only the data export, erasure and an old consultation request's line still read it.",
  fsm_items:
    "FSM's catalogue, to read each appointment's visit type from its service item and to compare FSM's prices with the price book (ADR 0032, ADR 0073).",
  grievances: "A client's grievance, and the answer ops recorded (ADR 0049, ADR 0078).",
  hair_profiles:
    "Every version of a client's hair profile, the fit spec and the history: the technician's at a visit, once for each of the phone's events, and ops' corrections. Never changed, only blanked (ADR 0106).",
  idempotency: "The stored answer to each `Idempotency-Key`, so a request sent again gets its first answer (ADR 0011).",
  job_events:
    "The technician app's writes, each once by the ID the phone gave it, and whether it has reached FSM (ADR 0038, ADR 0065).",
  last_visits:
    "Each client's last first fit, service or replacement done, and last consultation done, kept from the view `last_visits_now` by each write that changes their visits (src/domain/visits/visit-upkeep.ts); the Tasks board's At-risk client and First fit to book read it (ADR 0086), the second along `last_visits_unfitted`, the clients not fitted since their consultation.",
  leads:
    "Each booking, waitlist sign-up and try-on claim as the CRM receives it, and whether it has reached the CRM and FSM (ADR 0011, ADR 0012).",
  maintenance:
    'One row while D1 is being restored: the cron and the queue consumers stand still until it is deleted (runbook, "Restoring D1").',
  move_proposals:
    "A move to another day ops asked a client to confirm: where the visit would go, until when, and whether it was accepted, taken back or made moot (ADR 0115).",
  no_show_cases:
    "The evidence a no-show is ruled on, the ruling, and what a charge cost the client (ADR 0065, ADR 0072, ADR 0096).",
  no_show_disputes:
    "A client's dispute of a no-show's charge, one a charge, and ops' ruling on it, refunded or upheld, with their reason (ADR 0096).",
  no_show_refunds:
    "What a no-show's ruling gives back of the visit's payment, kept as owed with the ruling until it is refunded or left to ops (ADR 0096).",
  number_change_requests:
    "A client's change of mobile number: the codes proven on both numbers, and what ops decided (ADR 0042, ADR 0078).",
  ops_settings:
    "The business inputs ops set in the console, a row each; a row that is not there means the committed default (ADR 0061).",
  ops_settings_snapshot:
    "One row holding every `ops_settings` value, kept by that table's triggers: the one row a request reads (ADR 0088).",
  number_codes:
    "Each WhatsApp code sent to prove a number typed into the site, with the number and the code only as hashes (ADR 0081, ADR 0104).",
  lost_reasons:
    "Why a client is not going ahead with a fit after their consultation, as ops set them, one they took off kept as retired; none means the committed list (ADR 0149).",
  otp_challenges: "Each one-time code sent, as a hash, with its sends and attempts (ADR 0030, ADR 0052).",
  partial_reasons:
    "The reasons a job may be left partly done, as ops set them, one they took off kept as retired; none means the committed list (ADR 0087).",
  outbound_messages: "Each WhatsApp message, from queued to sent, delivered and read (ADR 0041).",
  payment_links:
    "The Razorpay payment link a consultation and fit in one visit is paid by once the client is fitted: one a visit, the product and its price, when Razorpay made and texted it, and the payment that paid it (ADR 0105).",
  payments: "The mirror of Razorpay's payments, and where each stands in Books (ADR 0044).",
  people:
    "One row per person, keyed by mobile number. D1 owns the identity; the CRM's and Books' IDs are only references (ADR 0011, ADR 0110).",
  photo_sets: "A visit's set of photographs, before or after (ADR 0028).",
  photos: "One photograph of a set, by its angle, and where it and its thumbnail are kept in R2 (ADR 0028, ADR 0093).",
  pieces:
    "Each piece fitted, its base and lot, the day it was fitted and the day it falls due, and a failure with its reason. `fsm_id` is FSM's ID for a piece mirrored from FSM, otherwise the row's own (ADR 0032, ADR 0110).",
  po_letterhead:
    "One row, once ops set it: the legal name, GSTIN and delivery address a printed purchase order carries (ADR 0166).",
  price_book:
    "Every price from its date, and the only source of prices; an old row stays for what was sold under it (ADR 0045, ADR 0061).",
  razorpay_events: "Each Razorpay webhook event, once, by its event ID (ADR 0044).",
  referral_attributions:
    "A person who came through an invite, to the first invite they used, what became of its grant, and who attached it and why where ops did (ADR 0048, ADR 0089).",
  referral_codes: "A client's invite code, the version of their card, and how often the invite was opened (ADR 0048).",
  refunds: "The mirror of Razorpay's refunds, and where each stands in Books (ADR 0044).",
  serviceable_pincodes:
    "Every NCR pincode, its area and city, and whether and since when we serve it (ADR 0048, ADR 0061).",
  services:
    "What clients may book: each kind of visit's services, their names, the line clients read under each, lengths and order, when each is retired, and its item in FSM's catalogue and in Books; the price book prices each by its kind and tier (ADR 0085, ADR 0110).",
  packages:
    "Each package a client chooses and stays on: how often its service visit falls due and how many months its hair system is worn; its first fit, service visit and replacement are rows of `services` under its code, which its hair systems name as their product (ADR 0211).",
  sessions:
    "The client app's and the technician app's sessions: whose, from which device, and when each ends or was revoked (ADR 0029, ADR 0052).",
  slot_claims:
    "What a hold or a visit takes of a technician's day, a row per half-slot and window, so no time is taken twice (ADR 0034, ADR 0069).",
  slot_holds:
    "A slot held while a client pays, at Checkout or by a payment link ops sent, and what became of it (ADR 0045, ADR 0068).",
  slot_times: "Each change of the day's half-slot times ops set, from the day it applies; never changed (ADR 0102).",
  spend_entries:
    "A month's offline spend to win clients, for a city or national, by channel, as typed on the console's Spend page; one taken off kept, with who and when (ADR 0150).",
  standard_costs:
    "What each first fit and replacement product costs us, from its date, for the margin figures until stock lots carry what was paid; an old row stays for the visits under it (ADR 0152).",
  staff:
    "Each member of staff on the console's Staff list, by their Access e-mail, and whether they are let in (ADR 0109).",
  staff_access_mode: "One row: whether the console enforces the Staff list yet, and who last switched it (ADR 0109).",
  staff_grants:
    "What each member of staff may do: a department, at a level, over a place, national, a zone or a city (ADR 0109).",
  staff_notes:
    "Staff's short notes on a client, at the top of their page: a change writes a new note in the place of the one before, and one taken off is marked so, never deleted, until an erasure.",
  staff_service_tokens:
    "The Access service tokens let in as every caller was before the Staff list, such as CI's (ADR 0109).",
  stock_balances:
    "What each place holds of each consumable, and when it last counted it: the sum of its rows in `stock_movements`, kept by triggers as each is written (ADR 0087).",
  stock_places:
    "Where stock is kept, as a tree: the national warehouse, zone hubs, city stockrooms and a kit for each technician, which a trigger adds with them (ADR 0155).",
  stock_lots:
    "Each lot of a stock code a delivery brought: the supplier's lot, or the day it was received, and the day it expires (ADR 0157).",
  stock_lot_moves: "What each movement moved of each lot, soonest to expire first, at the movement's place (ADR 0157).",
  stock_lot_balances:
    "What each place holds of each lot: the sum of its rows in `stock_lot_moves`, kept by triggers as each is written (ADR 0157).",
  stock_transfers:
    "Each transfer sent to a warehouse, a hub or a stockroom: what left, from where, to where, and whether it arrived, in full or short, or was sent back (ADR 0158).",
  piece_returns:
    "Each piece that came off a client at a replacement, held in the technician's kit as returned until handed in (ADR 0163).",
  stock_units:
    "Each hair system piece labelled: its label, stock code and lot, and where it is now, held at a place, in transit, fitted or gone (ADR 0161).",
  stock_unit_events:
    "Each unit's history, only ever added to: the state it moved into, where, and by which movement (ADR 0161).",
  stock_movements:
    "Every movement of a consumable into or out of the central store or a technician's kit, never changed; what a place holds is the sum of its rows (ADR 0087).",
  stored_objects:
    "Each object client-photos and referral-cards hold, and its size, written as it is stored and deleted as it is, so the storage meter never counts one twice (ADR 0093).",
  storage_meter:
    "What the apps' two buckets, client-photos and referral-cards, hold together: one row, the sum of `stored_objects` kept beside it, and the last mark of the share ops were told of (ADR 0093); and the last mark of the database's own size they were told of.",
  targets:
    "Each month's target for a city, by measure, as set on the console's Targets page; set again, it is replaced (ADR 0154).",
  task_closures:
    "A task on the Tasks board ops closed without doing its thing, a visit left partly done alone, with why, who and when, by the task's group and its row's id (ADR 0092).",
  task_owners:
    "The member of staff a task on the Tasks board is theirs, by Access e-mail, by the task's group, its row's id and, where that row can be a new task again, its episode; a task with no row for it is nobody's (ADR 0092).",
  task_spans:
    "Each task the Tasks board has held, by its group, row and episode: the client's city, when it opened and the night it was first found gone, from which the reporting copy counts Care cases (ADR 0147).",
  technician_devices: "The phones technicians work from, each bound to a session and revocable by ops (ADR 0052).",
  technician_hours:
    "A technician's own week: a row for each day they work, with its hours. One with no rows works their city's hours every day (ADR 0210).",
  technician_leave:
    "A technician's leave, in whole days or between two times of one day, which the clash check reads beside `slot_claims` (ADR 0062, ADR 0210).",
  technicians:
    "Each technician: name, initials, mobile number, zone and city, as ops keep them on the Technicians page. `fsm_id` is the ID FSM gave a technician it once held, otherwise one of ours. `city` places them for staff access (ADR 0032, ADR 0052, ADR 0109, ADR 0110).",
  tryon_jobs: "One try-on render: the photograph, the look, the provider's job and the result (ADR 0014, ADR 0015).",
  tryon_sessions:
    "The try-on gate's session, which showed a visitor their result (ADR 0014); written no more since the look goes to WhatsApp only (ADR 0104).",
  visit_blackouts: "Days on which no visit is offered.",
  site_word_publishes:
    "Each publish of the site's words from the Words page: the changed lines as they stood, which each build of the site lays over its copy (ADR 0127).",
  word_versions:
    "Every wording a line of the site or a WhatsApp message has had on the Words page; the newest is in force (ADR 0126).",
  referral_channels:
    "Partners who send us clients on their own code: the friend's reward and the partner's commission (ADR 0123).",
  channel_attributions:
    "A person who came through a partner's code, and what the friend and the partner earned once fitted (ADR 0123).",
  partner_payouts:
    "Each month's payment to a partner, as Finance made it from the payout tool, with its reference (ADR 0124).",
  pay_grades: "The seniority grades Finance names for technicians' pay per visit (ADR 0122).",
  visit_pay_rates:
    "What a visit pays a technician, beside their salary: per grade and kind of visit, for every city or one, from a date (ADR 0122).",
  city_blackouts: "Days on which no visit is offered in one city alone (ADR 0119).",
  city_prices: "A price a city sets apart from the book's, from a day, which comes first there (ADR 0198).",
  city_settings: "A rule a city sets apart from the national one: its check-in radius or reminder hour (ADR 0198).",
  gst_registrations:
    "A state's own GST registration, which supplies the visits in it, and its Books branch (ADR 0198).",
  visit_changes:
    "Each move or cancel a client made, and each cancel ops made, with its notice and what it cost (ADR 0046).",
  visit_outcomes:
    "What an appointment became once it closed, or ops closed it by hand: the outcome, its reason and its times " +
    "(ADR 0032, ADR 0074).",
  waitlist_entries: "Someone waiting for us to reach their pincode, and whether they were told it launched (ADR 0048).",
  zones: "A region made of cities, as NCR is, which a grant of staff access may name (ADR 0109).",
  zoho_access_tokens:
    "Each Zoho client's access token, the CRM's, FSM's and Books', and the lease one caller holds while it asks for a new one (ADR 0070, ADR 0110).",
};

/**
 * Where a migration's note on a column named a module that has since moved: the migrations are never edited, so the
 * document says where it is now. Each under src/, written without it, since the old paths are gone.
 */
export const PATHS_MOVED: Readonly<Record<string, string>> = Object.fromEntries(
  [
    ["domain/asked-windows.ts", "src/domain/booking/asked-windows.ts"],
    ["domain/client-notes.ts", "src/domain/clients/client-notes.ts"],
    ["domain/tasks.ts", "src/domain/ops/tasks.ts"],
    ["domain/audit.ts", "src/domain/platform/audit.ts"],
    ["domain/referral-grants.ts", "src/domain/referrals/referral-grants.ts"],
    ["domain/books-erasure.ts", "src/domain/books/books-erasure.ts"],
    ["routes/client-refer.ts", "src/routes/client/refer.ts"],
    ["config/ops-settings.ts", "src/policy/ops-settings.ts"],
    ["domain/fsm-mirror.ts", "docs/decisions/0110-field-work-without-fsm.md, which retired the FSM mirror"],
  ].map(([from = "", to = ""]) => [`src/${from}`, to]),
);

/** A column whose migration's note no longer says what it is today, in today's words. */
export const NOTES_NOW: Readonly<Record<string, string>> = {
  "stock_balances.place": "'central' for the central store; for a technician's kit, their ID.",
  "technicians.mobile_e164":
    "The technician's own number, as ops keep it on the Technicians page, which they sign in with by a one-time code, " +
    "the same flow as clients' but a separate role (src/routes/tech/auth.ts). NULL for a technician with no number, " +
    "who then cannot sign in.",
};
