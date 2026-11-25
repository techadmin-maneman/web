# Architecture decision records

Every decision this repository was built on, oldest first. A record says what was decided and why, and is not rewritten to say something else: a later record changes it, and says so in its own header (ADR 0001). **Changed by** gathers those later records, from either side, so an old record's reader knows to read on. How each part of the business works today, with the few records that still govern it, is on its page in [how it works](../how-it-works/README.md).

This file is written by `npm run adr-index` from the records' own headers, and `test/node/tooling/adr-index.test.ts` fails until it is run after a record is added or its status changes. A record names its topic in its header, `- Topic:` and one of the headings below, and the test fails on one that does not. The next free number is 0320. 0090 and 0091 and 0318 were taken for records never written, and stay unused.

## By topic

### Platform

- [0001](0001-record-architecture-decisions.md) Record architecture decisions
- [0002](0002-repository-layout-and-tooling.md) Repository layout and tooling
- [0003](0003-environment-identity-guard.md) Environment identity guard
- [0004](0004-routing-and-hostnames.md) Routing and hostnames
- [0005](0005-environment-isolation-in-wrangler-config.md) Environment isolation in the wrangler config
- [0006](0006-deployment-pipeline.md) Deployment pipeline (superseded)
- [0007](0007-platform-constraints.md) Platform facts that block M1's definition of done
- [0008](0008-owner-decisions-on-platform-constraints.md) Owner decisions on the platform constraints
- [0009](0009-stay-inside-cloudflare-free-tier.md) Stay inside Cloudflare's free tier
- [0010](0010-applying-triggers.md) Applying triggers
- [0023](0023-launch-hardening.md) Launch hardening: headers, analytics, budgets
- [0025](0025-phase-2-conflicts-register.md) Phase 2: the conflicts register
- [0026](0026-hosts-and-surfaces.md) Hosts and surfaces
- [0037](0037-shared-packages.md) Shared packages: the brand first
- [0039](0039-phase-2-budget.md) The Phase 2 budget on the free plan
- [0043](0043-client-app.md) The client app: build, Worker and policy
- [0067](0067-alerts-and-silent-failures.md) A failure that needs a person reaches one, once, with the IDs to act on
- [0075](0075-tests-held-to-the-contract-and-the-local-stack.md) Tests held to the API's contract, and the whole system on a laptop
- [0076](0076-one-ui-layer-and-one-api-client.md) One component layer and one API client for the front ends
- [0077](0077-a-token-scale-written-once.md) A token scale written once, and names for what a value is for
- [0093](0093-the-storage-meter.md) The storage meter, the photograph upload limit, and thumbnails made on the phone
- [0097](0097-staging-logins-open-reminders-fenced.md) Staging logins open, reminders fenced
- [0112](0112-workers-paid.md) Workers Paid
- [0121](0121-the-site-and-the-app-book-with-the-same-parts.md) The site and the app book with the same parts
- [0146](0146-the-nightly-analytics-copy.md) The nightly analytics copy
- [0148](0148-the-channel-rule.md) The channel rule
- [0151](0151-retention-figures.md) Retention figures
- [0153](0153-supply-and-credits-in-the-copy.md) Supply and credits in the copy
- [0194](0194-the-build-on-workers-paid.md) The build on Workers Paid
- [0195](0195-the-cron-a-job-at-a-time.md) The cron a job at a time
- [0196](0196-long-work-in-workflows.md) Long work in Workflows
- [0198](0198-cities-as-data.md) Cities as data
- [0199](0199-derived-state-in-the-domain.md) Derived state in the domain
- [0200](0200-staging-tenants-of-its-own.md) Staging's tenants of its own
- [0205](0205-the-pipeline-as-it-runs.md) The pipeline as it runs
- [0207](0207-closed-chats-archived.md) Closed Care threads are archived out of D1
- [0275](0275-the-apps-phase-2-pairs-retired.md) The apps' Phase 2 fidelity pairs retired
- [0277](0277-alerts-that-come-sooner.md) Alerts that come sooner
- [0281](0281-the-consoles-first-load-counts-today.md) The console's first load counts Today, and Today holds its room
- [0284](0284-the-first-screen-and-the-precache.md) A phone app's budget counts its first screen, and its precache has a ceiling of its own
- [0286](0286-the-icons-are-the-mark.md) The browser's and the home screen's icons are the mark
- [0288](0288-attribution-and-conversions.md) Attribution and conversions
- [0295](0295-the-consoles-first-load.md) The console's first load is held to 175 KB
- [0312](0312-the-consoles-favicon-everywhere.md) The console's favicon, everywhere

### Booking and visits

- [0034](0034-clash-check.md) The clash check
- [0035](0035-window-slot-map.md) The window-to-slot map
- [0040](0040-phase-1-alignment.md) Phase 1 aligned with Phase 2: the evening window, and "consultation"
- [0045](0045-self-serve-booking.md) Self-serve booking and prepayment
- [0046](0046-moving-and-cancelling.md) Moving and cancelling a visit
- [0051](0051-booking-from-the-site.md) Booking from the site is the landing's booking
- [0057](0057-one-payment-per-tap.md) One payment per tap
- [0058](0058-one-tap-per-intent.md) One tap per intent
- [0063](0063-the-asked-window.md) The asked window and the offered one
- [0068](0068-a-paid-hold-is-kept.md) A paid hold is kept
- [0079](0079-an-address-before-a-slot.md) An address before any slot
- [0081](0081-the-site-takes-the-address.md) The site takes the address before it books
- [0085](0085-services-ops-can-edit.md) Services ops can edit
- [0086](0086-the-next-visit-is-offered.md) The next visit is offered, and the client books it
- [0102](0102-window-times.md) The window times in the console
- [0105](0105-a-consultation-and-fit-in-one-visit.md) A consultation and fit in one visit
- [0111](0111-a-technician-never-takes-two-visits-in-a-row.md) A technician never takes two visits in a row
- [0115](0115-a-move-to-another-day-waits-for-the-client.md) A move to another day waits for the client
- [0116](0116-book-asks-for-the-name-and-number-first.md) /book asks for the name and number first
- [0117](0117-a-technician-takes-visits-in-their-own-city.md) A technician takes visits in their own city
- [0118](0118-booking-never-dead-ends.md) Booking never dead-ends
- [0119](0119-blackouts-by-city-and-trained-fitters.md) Blackouts by city, and trained fitters
- [0210](0210-booking-by-start-time.md) Booking by start time
- [0211](0211-packages.md) Packages
- [0223](0223-reach-from-home.md) Reach from home, drawn on the city's map and checked at the address
- [0252](0252-client-app-redesign.md) The client app redrawn: four tabs, the profile, and the client's look
- [0253](0253-replacement-when-due-and-change-of-hair-system.md) Changing hair system at the replacement booking, and when a replacement is booked
- [0256](0256-fit-guarantee-setting.md) The fit guarantee's days as a setting, and a claim as a Tasks row
- [0278](0278-a-technician-in-training-takes-no-visits.md) A technician in training takes no visits
- [0287](0287-a-start-googles-drive-refused-is-not-offered.md) A start Google's drive leaves no room for is not offered again
- [0289](0289-who-takes-a-visit.md) Who takes a visit: a radius in km, an overflow ring, and the least cost
- [0290](0290-allotted-the-evening-before.md) A visit's technician is fixed the evening before
- [0292](0292-room-made-at-booking.md) Booking moves a draft to make room
- [0293](0293-steering-booking-times.md) Clients are steered to the times that drive least
- [0294](0294-learned-drive-times.md) Drive times are learned from our own drives
- [0297](0297-drafts-off-a-day-that-no-longer-fits.md) A draft its day no longer fits is moved, and two cities are checked a run
- [0299](0299-fit-today.md) Fit today: a consultation becomes the fit at the door

### Field work

- [0028](0028-photographs-from-the-app.md) Photographs from the technician app
- [0032](0032-fsm-mirror.md) The FSM mirror, and Books documents (superseded)
- [0036](0036-geocoding.md) Geocoding, for the check-in's geofence
- [0038](0038-offline-writes.md) The technician app's offline writes, and what they write to FSM
- [0052](0052-technician-sessions.md) Technician sessions, devices and the day-before unlock
- [0053](0053-the-technician-app-offline.md) The technician app offline: the outbox, the device and the camera
- [0054](0054-address-capture.md) Capturing an address: the fields, the pin, and the way to the door
- [0062](0062-leave-on-the-dispatch-board.md) Leave on the dispatch board
- [0064](0064-converting-a-request.md) Converting a Request by API (superseded)
- [0065](0065-a-technicians-writes-reach-fsm.md) A technician's writes reach FSM, in order, on a clock we can hold him to
- [0069](0069-dispatch-under-concurrency.md) Dispatch under concurrency
- [0087](0087-consumables-and-stock.md) Consumables and their stock, and the job sheet, set in the console
- [0095](0095-a-booking-fsm-refuses-is-held.md) A booking FSM refuses is held, not refunded (superseded)
- [0098](0098-the-door-in-fsms-address.md) The door in FSM's service address (superseded)
- [0099](0099-the-clients-note-in-fsm.md) The client's note in FSM (superseded)
- [0101](0101-phase-1s-path-into-fsm-removed.md) Phase 1's path into FSM is removed, and no booking carries a Request (superseded)
- [0106](0106-a-clients-hair-profile.md) A client's hair profile: the fit spec and their history
- [0110](0110-field-work-without-fsm.md) Field work without Zoho FSM
- [0113](0113-fsms-columns-go.md) FSM's columns go
- [0122](0122-technician-pay-per-visit.md) Technician pay per visit
- [0149](0149-lost-reasons.md) Lost reasons
- [0155](0155-the-stock-place-tree.md) The stock place tree
- [0156](0156-hair-systems-in-stock.md) Hair systems in stock
- [0157](0157-lots-and-expiry.md) Lots and expiry
- [0158](0158-transfers-in-transit.md) Transfers in transit
- [0159](0159-stock-views-and-expiry.md) Stock views and expiry
- [0160](0160-demand-and-opening-counts.md) Demand ahead and opening counts
- [0161](0161-pieces-as-units.md) Pieces as units
- [0162](0162-scanning-labels.md) Scanning labels
- [0163](0163-pieces-scanned-from-the-kit.md) Pieces scanned from the kit
- [0164](0164-the-kit-screen.md) The kit screen
- [0165](0165-suppliers.md) Suppliers
- [0166](0166-purchase-orders.md) Purchase orders
- [0167](0167-receipts-and-landed-cost.md) Receipts and landed cost
- [0169](0169-supplier-claims.md) Supplier claims
- [0170](0170-stock-photos.md) Photographs of stock
- [0172](0172-supplier-scorecard.md) Supplier scorecard
- [0173](0173-matching-a-client-to-stock.md) Matching a client to stock
- [0174](0174-custom-orders.md) Custom orders
- [0175](0175-custom-pieces-reserved.md) Custom pieces reserved
- [0177](0177-custom-orders-in-the-app.md) Custom orders in the app
- [0178](0178-stock-at-risk.md) Stock at risk
- [0179](0179-demand-forecast.md) Demand forecast
- [0180](0180-supply-plan.md) Supply plan
- [0181](0181-tomorrows-kits.md) Tomorrow's kits
- [0182](0182-the-events-calendar.md) The events calendar and the forecast on the Supply plan
- [0183](0183-forecast-accuracy.md) Forecast accuracy
- [0184](0184-the-one-visit-range.md) The one-visit range
- [0185](0185-cycle-counts.md) Cycle counts
- [0186](0186-usage-and-shrinkage.md) Usage against expected, and shrinkage
- [0187](0187-recalls.md) Recalls
- [0188](0188-failure-rates-and-value-at-risk.md) Failure rates and value at risk
- [0190](0190-foreign-orders-judged-at-a-rate.md) Foreign orders judged at a rate
- [0191](0191-a-replaced-piece-comes-off.md) A replaced piece comes off
- [0222](0222-consumables-short-of-expected.md) Consumables short of what a visit expects are said why, and checked
- [0239](0239-technician-light-look.md) The technician app's new look: white, navy and Plex, screen by screen
- [0240](0240-consultation-rules-and-inches.md) A consultation uses nothing from the kit, a first fit takes the profile, and the head is measured in inches
- [0241](0241-tab-shell-today-and-me.md) The technician app's tab bar, Today redrawn, and Me with sign out
- [0242](0242-client-record.md) A client's record for the technicians: alerts, the handoff note, and their history
- [0243](0243-job-and-the-door.md) The job and the door in the new look
- [0244](0244-the-visit-engine.md) The visit engine, its plan, and the photographs
- [0245](0245-the-steps.md) The visit's steps in the new look
- [0246](0246-closed-and-sent-back.md) Closed, and a step sent back
- [0247](0247-the-steps-left.md) The steps left from PR 7
- [0248](0248-safety.md) A technician's safety on a visit
- [0249](0249-schedule-kit-and-me.md) Schedule, Kit and Me
- [0250](0250-guides-and-alerts.md) Guides and alerts
- [0251](0251-hindi-and-the-sign-in.md) Hindi on every screen, and the sign-in redrawn
- [0254](0254-client-signs-off-the-fit.md) The client signs off the fit
- [0258](0258-the-technician-design-pass.md) The technician app's design pass
- [0267](0267-the-technician-design-check.md) The technician app's design check
- [0268](0268-the-visits-design-check.md) The visit's design check
- [0270](0270-the-design-checks-api-side.md) The design check's API side
- [0271](0271-the-technician-follow-ups.md) The technician follow-ups
- [0273](0273-why-a-hair-system-failed.md) Why a hair system failed
- [0280](0280-the-technician-apps-hindi-corrected.md) The technician app's Hindi corrected, and the job card's arrival named
- [0291](0291-pieces-without-labels.md) A piece without a label never stops the fit
- [0296](0296-no-empty-reference-photograph.md) A guided task draws no reference photograph until it has one
- [0298](0298-past-weeks-on-schedule.md) Schedule goes back to past weeks, and never past this one
- [0311](0311-dated-technician-grades.md) Dated technician grades

### Money and Books

- [0033](0033-credit-ledger.md) The credit ledger
- [0044](0044-payments-mirror.md) The payments mirror
- [0055](0055-invoices.md) The invoice for a finished job
- [0056](0056-issuing-the-invoice.md) The invoice is issued, and shown beside the visit
- [0073](0073-prices-from-the-price-book.md) Prices from the price book, on the site and in FSM's catalogue
- [0096](0096-a-no-shows-charge-and-its-dispute.md) A no-show's charge and its dispute, and the free change a visit ops moved keeps
- [0100](0100-a-refund-is-made-once.md) A refund is made once, however often it is asked for
- [0108](0108-discount-codes.md) Discount codes
- [0152](0152-standard-costs.md) Standard costs
- [0168](0168-bills-in-books.md) Bills in Books
- [0171](0171-vendor-credits.md) Vendor credits
- [0176](0176-custom-order-refunds.md) Custom order refunds
- [0192](0192-free-remakes.md) Free remakes
- [0202](0202-razorpay-events-queued.md) Razorpay's events are queued, and every queue has its dead letters
- [0209](0209-paid-at-the-visit-by-upi.md) Paid at the visit by UPI, while online payment is off
- [0257](0257-razorpay-only.md) Razorpay is the only way to pay
- [0261](0261-razorpay-money-in-books.md) Razorpay's money in Books, from payment to the bank
- [0274](0274-gst-on.md) GST on: prices with their GST, and every invoice line and fee carrying its tax
- [0279](0279-one-rule-for-paying-and-the-tagline-as-written.md) One rule for paying, and the tagline as written
- [0300](0300-payment-links-on-whatsapp.md) Payment links on WhatsApp, through our own address

### Privacy and accounts

- [0019](0019-erasure.md) Erasure
- [0029](0029-sessions.md) Sessions for the client app
- [0030](0030-one-time-codes.md) One-time codes for the client app's login
- [0042](0042-client-profile.md) The client's profile: address, consents, number change, deletion
- [0049](0049-dpdp.md) DPDP readiness
- [0066](0066-erasure-all-or-nothing.md) Erasure is all or nothing
- [0080](0080-consents-given-by-booking.md) The photograph consents, given by booking
- [0094](0094-where-a-consent-was-given.md) Where a consent was given, and an erasure blanks a check-in's coordinates
- [0219](0219-one-line-consents.md) One-line consents, with the full notice a link away

### Messages and the CRM

- [0011](0011-lead-api.md) The lead API
- [0012](0012-zoho-sync.md) The Zoho sync
- [0016](0016-whatsapp-through-evolution.md) WhatsApp through Evolution API, for now
- [0020](0020-production-on-the-zoho-test-org.md) Production uses the Zoho test org, for now (superseded)
- [0041](0041-outbound-messages-for-phase-2.md) Outbound messages for Phase 2, and delivery receipts
- [0047](0047-visit-messages.md) Messages about a client's visits
- [0050](0050-crm-in-the-real-org.md) The CRM moves to the real Zoho org
- [0059](0059-a-clients-history.md) A client's history, and where a customer lives in the CRM
- [0060](0060-an-invited-friend-reaches-ops-and-the-crm.md) An invited friend reaches ops and the CRM
- [0070](0070-vendor-correctness.md) What we write to Zoho is right, written once, and asked for sparingly
- [0074](0074-hand-offs-and-messages.md) What each person learns when something changes for them
- [0114](0114-whatsapp-business-platform-through-msg91.md) The WhatsApp Business Platform through MSG91
- [0128](0128-messages-with-the-words-set.md) Messages in the words set
- [0129](0129-the-care-inbox.md) The Care inbox
- [0130](0130-replies-from-the-care-inbox.md) Replies from the Care inbox
- [0131](0131-care-people.md) Each client's Care person
- [0132](0132-the-reply-clock.md) The reply clock
- [0133](0133-the-after-hours-reply.md) The after-hours reply
- [0134](0134-care-cover.md) Days off and cover for the Care team
- [0135](0135-city-matters.md) City matters
- [0136](0136-care-names.md) The name a client knows their Care person by
- [0137](0137-last-contact-in-the-crm.md) A client's last contact in the CRM
- [0138](0138-strangers-in-the-inbox.md) Chats from numbers we don't know
- [0139](0139-care-shifts.md) Care on shift
- [0140](0140-the-client-panel.md) The client beside their chat
- [0141](0141-quick-replies.md) Quick replies
- [0142](0142-moving-every-client.md) Moving every client, and technicians in the inbox
- [0143](0143-remedies.md) Remedies
- [0144](0144-care-numbers.md) The Care numbers
- [0145](0145-technician-presets.md) A technician's word from the job card
- [0197](0197-one-inbound-port.md) One inbound port
- [0203](0203-a-vendor-down-is-held-off.md) A vendor that is down is held off, and a contact change waits in D1
- [0255](0255-client-alerts-and-push.md) Client alerts and push, and the live visit
- [0259](0259-the-issue-log.md) The issue log
- [0260](0260-ratings.md) Ratings
- [0276](0276-a-message-whatsapp-refuses.md) A message WhatsApp refuses
- [0315](0315-a-remedy-past-the-limit-given-by-one-who-may-approve-it.md) A remedy past the limit, given by one who may approve it

### Referrals

- [0027](0027-referral-landing.md) The referral landing: a Worker beside the site's assets
- [0048](0048-referrals.md) Referrals and the waitlist
- [0083](0083-anyone-signed-in-can-refer.md) Anyone signed in can refer
- [0089](0089-an-invite-is-not-lost.md) An invite is not lost when the friend books away from its page
- [0107](0107-referral-rewards-in-the-console.md) What a referral earns, set in the console, each side apart
- [0123](0123-partner-referral-channels.md) Partner referral channels
- [0124](0124-partner-statements.md) Partners' monthly statements
- [0125](0125-partner-discount-codes.md) A partner's discount code
- [0218](0218-refer-opens-at-the-first-consultation.md) Refer opens at the first consultation

### The try-on

- [0013](0013-departures-from-the-ailabtools-harness.md) Departures from the AILabTools harness
- [0014](0014-try-on-api.md) The try-on API
- [0015](0015-render-pipeline.md) The render pipeline and its budget
- [0017](0017-no-paid-face-precheck.md) No paid face pre-check
- [0018](0018-one-look-pro-only-lead-notices.md) One look per visitor, Pro only, and new-lead notices
- [0024](0024-the-browsers-own-look.md) The browser's own look: an optional gate, and a look shown again
- [0082](0082-try-ons-in-the-app.md) A client's try-on in the app
- [0084](0084-a-clients-try-on-is-kept.md) A client's try-on is kept
- [0104](0104-the-try-ons-look-on-whatsapp-only.md) The try-on's look on WhatsApp only
- [0201](0201-the-try-on-on-youcam.md) The try-on on YouCam

### The site

- [0021](0021-public-site.md) The public site: Astro in site/, on staging first
- [0022](0022-site-departures-from-v2.md) Where the site departs from v2 or the front-end prompt
- [0103](0103-the-home-pages-first-copy-round.md) The home page's first copy round
- [0204](0204-the-sites-price-pipeline-removed.md) The site's price pipeline is removed
- [0206](0206-trusted-types-and-a-nonce-per-page.md) Trusted Types enforced, and a nonce on every page
- [0213](0213-the-sites-second-copy-round.md) The site's second copy round
- [0214](0214-from-the-site-into-the-app.md) From the site into the app, and the look on the page
- [0215](0215-the-range-as-a-table.md) The range as a table
- [0216](0216-the-sites-polish-pass.md) The site's polish pass
- [0217](0217-the-try-ons-photo-taken-and-looked-at.md) The try-on's photo, taken and looked at; no question of where the hair loss is
- [0262](0262-the-sites-typeface-and-palette.md) The site's typeface and palette
- [0263](0263-the-home-pages-order-and-bands.md) The home page's order and bands
- [0264](0264-the-hero-restyled.md) The hero, restyled
- [0265](0265-book-and-try-on-the-client-apps-look.md) `/book` and `/try` on the client app's look
- [0266](0266-the-sites-header-book-and-focus-ring.md) The site's header Book and focus ring
- [0269](0269-the-one-visits-note-on-book.md) The one visit's note on `/book`
- [0272](0272-the-one-visit-is-paid-through-razorpay-only.md) The one visit is paid through Razorpay only
- [0285](0285-every-site-booking-is-a-sign-in.md) Every booking on the site asks the WhatsApp code, and signs the client in

### The ops console

- [0031](0031-access-and-audit.md) Access on the ops surface, and the audit log
- [0061](0061-ops-editable-inputs.md) The business inputs ops change without a developer
- [0071](0071-what-ops-see-before-a-setting-changes.md) What ops see before a setting changes, and who the console says they are (superseded)
- [0072](0072-ops-clients-and-queues.md) The ops console's clients and queues
- [0078](0078-the-queues-no-board-draws.md) The console's queues that no board draws
- [0088](0088-every-policy-in-the-console.md) Every policy in the console
- [0092](0092-task-owners.md) Whose each task is, a visit ops close without a follow-up, and an address given to ops
- [0109](0109-console-departments-and-access.md) The console by departments, and who may do what in it
- [0120](0120-the-board-sees-the-road.md) The board sees the road
- [0126](0126-the-words-page.md) The Words page
- [0127](0127-publishing-the-words.md) Publishing the site's words
- [0147](0147-task-spans.md) Task spans
- [0150](0150-spend.md) Spend
- [0154](0154-targets-and-reporting-access.md) Targets and reporting access
- [0189](0189-the-staff-list-on-by-default.md) The Staff list on by default
- [0193](0193-the-rest-of-the-rules-in-the-console.md) The rest of the rules in the console
- [0208](0208-the-console-redesigned.md) The console redesigned: work first, Settings in one place, and two themes
- [0212](0212-editing-in-place.md) Editing in place
- [0220](0220-opening-a-city-from-india-posts-pincodes.md) Opening a city from India Post's pincodes
- [0221](0221-launches-scheduled-paused-and-checked.md) Launches scheduled, paused and checked first
- [0224](0224-demand-and-the-next-to-open.md) Demand, and the next pincodes to open
- [0225](0225-the-console-on-a-desk-and-a-phone.md) The console on a desk and a phone, to the November redesign
- [0226](0226-the-console-frame-redesigned.md) The console's frame, to the November redesign
- [0227](0227-today-by-home-and-tasks-as-one-table.md) Today by home, and Tasks as one table
- [0228](0228-the-header-city-within-a-persons-reach.md) The header's city, within a person's reach
- [0229](0229-dispatch-and-booking-redesigned.md) Dispatch and booking, to the November redesign
- [0230](0230-clients-redesigned.md) Clients and a client's page, to the November redesign
- [0231](0231-messages-redesigned.md) Messages, to the November redesign
- [0232](0232-technicians-stock-and-money-redesigned.md) A technician's page, Stock and Money, to the November redesign
- [0233](0233-settings-redesigned.md) Settings, to the November redesign
- [0234](0234-every-settings-page-aligned.md) Every Settings page in the redesign's look
- [0235](0235-full-size-check-fixes.md) The redesign checked at full size, and what it changed
- [0236](0236-second-design-pass.md) The second design pass: heads, folded lists, items, and each thing where it is used
- [0237](0237-every-list-sorts.md) Every list sorts, a long one narrows, and its heads stand over their figures
- [0238](0238-third-design-pass.md) Third design pass: one home, the chat's column, a record's facts beside its head, Inventory's one row of tabs
- [0282](0282-tasks-chosen-together.md) Tasks chosen together, and the keys a desk moves by
- [0283](0283-changed-and-deleted-while-unused.md) What ops configure is changed, and deleted while nothing uses it
- [0301](0301-the-console-look-to-the-22-november-redesign.md) The console's look, to the 22 November redesign
- [0302](0302-tasks-written-by-hand.md) Tasks written by hand
- [0303](0303-snoozing-a-task.md) Snoozing a task
- [0304](0304-the-work-screens-to-the-22-november-redesign.md) The Work screens, to the 22 November redesign
- [0305](0305-a-technicians-start-date.md) A technician's start date
- [0306](0306-the-people-screens-to-the-22-november-redesign.md) The People screens, to the 22 November redesign
- [0307](0307-the-people-rulings.md) The People rulings
- [0308](0308-the-inventory-screens-to-the-22-november-redesign.md) The Inventory screens, to the 22 November redesign
- [0309](0309-the-requests-and-money-screens-to-the-22-november-redesign.md) The Requests and Money screens, to the 22 November redesign
- [0310](0310-the-growth-and-reports-screens-to-the-22-november-redesign.md) The Growth and Reports screens, to the 22 November redesign
- [0313](0313-the-settings-screens-to-the-22-november-redesign.md) The Settings screens, to the 22 November redesign
- [0314](0314-change-everywhere-and-forms-in-a-grid.md) Change everywhere, and forms in a grid
- [0316](0316-every-console-action-an-icon.md) Every console action an icon
- [0317](0317-targets-progress.md) Targets progress
- [0319](0319-rules-that-hold-together.md) Rules that hold together

## Every decision, oldest first

| ADR | Decision | Date | Status | Changed by |
| --- | --- | --- | --- | --- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | 2026-09-21 | accepted |  |
| [0002](0002-repository-layout-and-tooling.md) | Repository layout and tooling | 2026-09-21 | accepted |  |
| [0003](0003-environment-identity-guard.md) | Environment identity guard | 2026-09-21 | accepted |  |
| [0004](0004-routing-and-hostnames.md) | Routing and hostnames | 2026-09-21 | accepted |  |
| [0005](0005-environment-isolation-in-wrangler-config.md) | Environment isolation in the wrangler config | 2026-09-21 | accepted |  |
| [0006](0006-deployment-pipeline.md) | Deployment pipeline | 2026-09-21 | superseded by 0205 on 15 October 2026, which says how the pipeline runs now | [0010](0010-applying-triggers.md), [0075](0075-tests-held-to-the-contract-and-the-local-stack.md), [0205](0205-the-pipeline-as-it-runs.md) |
| [0007](0007-platform-constraints.md) | Platform facts that block M1's definition of done | 2026-09-21 | resolved by 0008 | [0008](0008-owner-decisions-on-platform-constraints.md) |
| [0008](0008-owner-decisions-on-platform-constraints.md) | Owner decisions on the platform constraints | 2026-09-21 | accepted |  |
| [0009](0009-stay-inside-cloudflare-free-tier.md) | Stay inside Cloudflare's free tier | 2026-09-21 | accepted | [0112](0112-workers-paid.md), [0194](0194-the-build-on-workers-paid.md) |
| [0010](0010-applying-triggers.md) | Applying triggers | 2026-09-21 | accepted |  |
| [0011](0011-lead-api.md) | The lead API | 2026-09-21 | accepted | [0067](0067-alerts-and-silent-failures.md) |
| [0012](0012-zoho-sync.md) | The Zoho sync | 2026-09-21 | accepted | [0070](0070-vendor-correctness.md), [0203](0203-a-vendor-down-is-held-off.md) |
| [0013](0013-departures-from-the-ailabtools-harness.md) | Departures from the AILabTools harness | 2026-09-21 | accepted |  |
| [0014](0014-try-on-api.md) | The try-on API | 2026-09-21 | accepted | [0018](0018-one-look-pro-only-lead-notices.md), [0039](0039-phase-2-budget.md), [0084](0084-a-clients-try-on-is-kept.md), [0104](0104-the-try-ons-look-on-whatsapp-only.md), [0201](0201-the-try-on-on-youcam.md) |
| [0015](0015-render-pipeline.md) | The render pipeline and its budget | 2026-09-21 | accepted | [0070](0070-vendor-correctness.md), [0201](0201-the-try-on-on-youcam.md) |
| [0016](0016-whatsapp-through-evolution.md) | WhatsApp through Evolution API, for now | 2026-09-21 | accepted | [0114](0114-whatsapp-business-platform-through-msg91.md) |
| [0017](0017-no-paid-face-precheck.md) | No paid face pre-check | 2026-09-21 | accepted |  |
| [0018](0018-one-look-pro-only-lead-notices.md) | One look per visitor, Pro only, and new-lead notices | 2026-09-21 | accepted | [0104](0104-the-try-ons-look-on-whatsapp-only.md), [0201](0201-the-try-on-on-youcam.md) |
| [0019](0019-erasure.md) | Erasure | 2026-09-21 | accepted | [0066](0066-erasure-all-or-nothing.md), [0094](0094-where-a-consent-was-given.md) |
| [0020](0020-production-on-the-zoho-test-org.md) | Production uses the Zoho test org, for now | 2026-09-21 | superseded by 0050 on 22 September 2026 | [0050](0050-crm-in-the-real-org.md) |
| [0021](0021-public-site.md) | The public site: Astro in site/, on staging first | 2026-09-22 | accepted |  |
| [0022](0022-site-departures-from-v2.md) | Where the site departs from v2 or the front-end prompt | 2026-09-22 | accepted | [0073](0073-prices-from-the-price-book.md), [0103](0103-the-home-pages-first-copy-round.md), [0104](0104-the-try-ons-look-on-whatsapp-only.md) |
| [0023](0023-launch-hardening.md) | Launch hardening: headers, analytics, budgets | 2026-09-22 | accepted | [0206](0206-trusted-types-and-a-nonce-per-page.md), [0281](0281-the-consoles-first-load-counts-today.md), [0284](0284-the-first-screen-and-the-precache.md), [0286](0286-the-icons-are-the-mark.md) |
| [0024](0024-the-browsers-own-look.md) | The browser's own look: an optional gate, and a look shown again | 2026-09-22 | accepted, on the owner's review of 22 September 2026 | [0104](0104-the-try-ons-look-on-whatsapp-only.md) |
| [0025](0025-phase-2-conflicts-register.md) | Phase 2: the conflicts register | 2026-09-22 | accepted, and kept up to date | [0200](0200-staging-tenants-of-its-own.md) |
| [0026](0026-hosts-and-surfaces.md) | Hosts and surfaces | 2026-09-22 | accepted |  |
| [0027](0027-referral-landing.md) | The referral landing: a Worker beside the site's assets | 2026-09-22 | accepted | [0073](0073-prices-from-the-price-book.md) |
| [0028](0028-photographs-from-the-app.md) | Photographs from the technician app | 2026-09-23 | accepted | [0093](0093-the-storage-meter.md), [0246](0246-closed-and-sent-back.md) |
| [0029](0029-sessions.md) | Sessions for the client app | 2026-09-22 | accepted |  |
| [0030](0030-one-time-codes.md) | One-time codes for the client app's login | 2026-09-22 | accepted | [0070](0070-vendor-correctness.md), [0097](0097-staging-logins-open-reminders-fenced.md) |
| [0031](0031-access-and-audit.md) | Access on the ops surface, and the audit log | 2026-09-22 | accepted | [0072](0072-ops-clients-and-queues.md) |
| [0032](0032-fsm-mirror.md) | The FSM mirror, and Books documents | 2026-09-22 | superseded by 0110 on 4 October 2026: FSM's mirror is gone with FSM | [0070](0070-vendor-correctness.md), [0075](0075-tests-held-to-the-contract-and-the-local-stack.md), [0101](0101-phase-1s-path-into-fsm-removed.md), [0110](0110-field-work-without-fsm.md) |
| [0033](0033-credit-ledger.md) | The credit ledger | 2026-09-22 | accepted | [0068](0068-a-paid-hold-is-kept.md), [0107](0107-referral-rewards-in-the-console.md) |
| [0034](0034-clash-check.md) | The clash check | 2026-09-22 | accepted | [0069](0069-dispatch-under-concurrency.md), [0117](0117-a-technician-takes-visits-in-their-own-city.md), [0210](0210-booking-by-start-time.md) |
| [0035](0035-window-slot-map.md) | The window-to-slot map | 2026-09-22 | accepted, with placeholder times | [0102](0102-window-times.md), [0210](0210-booking-by-start-time.md) |
| [0036](0036-geocoding.md) | Geocoding, for the check-in's geofence | 2026-09-23 | accepted | [0054](0054-address-capture.md) |
| [0037](0037-shared-packages.md) | Shared packages: the brand first | 2026-09-22 | accepted | [0076](0076-one-ui-layer-and-one-api-client.md), [0077](0077-a-token-scale-written-once.md) |
| [0038](0038-offline-writes.md) | The technician app's offline writes, and what they write to FSM | 2026-09-23 | accepted |  |
| [0039](0039-phase-2-budget.md) | The Phase 2 budget on the free plan | 2026-09-22 | accepted | [0073](0073-prices-from-the-price-book.md), [0084](0084-a-clients-try-on-is-kept.md), [0093](0093-the-storage-meter.md) |
| [0040](0040-phase-1-alignment.md) | Phase 1 aligned with Phase 2: the evening window, and "consultation" | 2026-09-22 | accepted |  |
| [0041](0041-outbound-messages-for-phase-2.md) | Outbound messages for Phase 2, and delivery receipts | 2026-09-22 | accepted |  |
| [0042](0042-client-profile.md) | The client's profile: address, consents, number change, deletion | 2026-09-22 | accepted | [0080](0080-consents-given-by-booking.md) |
| [0043](0043-client-app.md) | The client app: build, Worker and policy | 2026-09-22 | accepted | [0275](0275-the-apps-phase-2-pairs-retired.md), [0286](0286-the-icons-are-the-mark.md) |
| [0044](0044-payments-mirror.md) | The payments mirror | 2026-09-22 | accepted | [0067](0067-alerts-and-silent-failures.md), [0068](0068-a-paid-hold-is-kept.md), [0202](0202-razorpay-events-queued.md) |
| [0045](0045-self-serve-booking.md) | Self-serve booking and prepayment | 2026-09-22 | accepted | [0068](0068-a-paid-hold-is-kept.md), [0079](0079-an-address-before-a-slot.md), [0086](0086-the-next-visit-is-offered.md), [0100](0100-a-refund-is-made-once.md), [0209](0209-paid-at-the-visit-by-upi.md) |
| [0046](0046-moving-and-cancelling.md) | Moving and cancelling a visit | 2026-09-22 | accepted | [0068](0068-a-paid-hold-is-kept.md), [0096](0096-a-no-shows-charge-and-its-dispute.md) |
| [0047](0047-visit-messages.md) | Messages about a client's visits | 2026-09-22 | accepted | [0074](0074-hand-offs-and-messages.md), [0115](0115-a-move-to-another-day-waits-for-the-client.md) |
| [0048](0048-referrals.md) | Referrals and the waitlist | 2026-09-22 | accepted | [0060](0060-an-invited-friend-reaches-ops-and-the-crm.md), [0071](0071-what-ops-see-before-a-setting-changes.md), [0074](0074-hand-offs-and-messages.md), [0080](0080-consents-given-by-booking.md), [0089](0089-an-invite-is-not-lost.md), [0107](0107-referral-rewards-in-the-console.md), [0218](0218-refer-opens-at-the-first-consultation.md) |
| [0049](0049-dpdp.md) | DPDP readiness | 2026-09-22 | accepted | [0066](0066-erasure-all-or-nothing.md), [0074](0074-hand-offs-and-messages.md), [0094](0094-where-a-consent-was-given.md), [0219](0219-one-line-consents.md) |
| [0050](0050-crm-in-the-real-org.md) | The CRM moves to the real Zoho org | 2026-09-22 | accepted | [0059](0059-a-clients-history.md), [0070](0070-vendor-correctness.md) |
| [0051](0051-booking-from-the-site.md) | Booking from the site is the landing's booking | 2026-09-23 | accepted | [0060](0060-an-invited-friend-reaches-ops-and-the-crm.md), [0081](0081-the-site-takes-the-address.md), [0086](0086-the-next-visit-is-offered.md), [0089](0089-an-invite-is-not-lost.md), [0116](0116-book-asks-for-the-name-and-number-first.md) |
| [0052](0052-technician-sessions.md) | Technician sessions, devices and the day-before unlock | 2026-09-23 | accepted |  |
| [0053](0053-the-technician-app-offline.md) | The technician app offline: the outbox, the device and the camera | 2026-09-23 | accepted | [0251](0251-hindi-and-the-sign-in.md), [0270](0270-the-design-checks-api-side.md), [0271](0271-the-technician-follow-ups.md) |
| [0054](0054-address-capture.md) | Capturing an address: the fields, the pin, and the way to the door | 2026-09-23 | accepted | [0070](0070-vendor-correctness.md), [0098](0098-the-door-in-fsms-address.md) |
| [0055](0055-invoices.md) | The invoice for a finished job | 2026-09-23 | accepted | [0056](0056-issuing-the-invoice.md) |
| [0056](0056-issuing-the-invoice.md) | The invoice is issued, and shown beside the visit | 2026-09-23 | accepted | [0070](0070-vendor-correctness.md) |
| [0057](0057-one-payment-per-tap.md) | One payment per tap | 2026-09-23 | accepted |  |
| [0058](0058-one-tap-per-intent.md) | One tap per intent | 2026-09-24 | accepted |  |
| [0059](0059-a-clients-history.md) | A client's history, and where a customer lives in the CRM | 2026-09-24 | accepted for the derivation, the ops console and the client app |  |
| [0060](0060-an-invited-friend-reaches-ops-and-the-crm.md) | An invited friend reaches ops and the CRM | 2026-09-24 | accepted |  |
| [0061](0061-ops-editable-inputs.md) | The business inputs ops change without a developer | 2026-09-24 | accepted | [0071](0071-what-ops-see-before-a-setting-changes.md), [0072](0072-ops-clients-and-queues.md), [0085](0085-services-ops-can-edit.md), [0086](0086-the-next-visit-is-offered.md), [0087](0087-consumables-and-stock.md), [0088](0088-every-policy-in-the-console.md), [0220](0220-opening-a-city-from-india-posts-pincodes.md) |
| [0062](0062-leave-on-the-dispatch-board.md) | Leave on the dispatch board | 2026-09-24 | accepted | [0074](0074-hand-offs-and-messages.md), [0210](0210-booking-by-start-time.md) |
| [0063](0063-the-asked-window.md) | The asked window and the offered one | 2026-09-24 | accepted | [0069](0069-dispatch-under-concurrency.md), [0070](0070-vendor-correctness.md), [0074](0074-hand-offs-and-messages.md), [0101](0101-phase-1s-path-into-fsm-removed.md) |
| [0064](0064-converting-a-request.md) | Converting a Request by API | 2026-09-24 | superseded by 0110 on 4 October 2026: no booking becomes an FSM work order | [0101](0101-phase-1s-path-into-fsm-removed.md), [0110](0110-field-work-without-fsm.md) |
| [0065](0065-a-technicians-writes-reach-fsm.md) | A technician's writes reach FSM, in order, on a clock we can hold him to | 2026-09-25 | accepted | [0087](0087-consumables-and-stock.md) |
| [0066](0066-erasure-all-or-nothing.md) | Erasure is all or nothing | 2026-09-25 | accepted | [0094](0094-where-a-consent-was-given.md) |
| [0067](0067-alerts-and-silent-failures.md) | A failure that needs a person reaches one, once, with the IDs to act on | 2026-09-25 | accepted | [0195](0195-the-cron-a-job-at-a-time.md), [0277](0277-alerts-that-come-sooner.md) |
| [0068](0068-a-paid-hold-is-kept.md) | A paid hold is kept | 2026-09-25 | accepted | [0095](0095-a-booking-fsm-refuses-is-held.md), [0285](0285-every-site-booking-is-a-sign-in.md) |
| [0069](0069-dispatch-under-concurrency.md) | Dispatch under concurrency | 2026-09-25 | accepted |  |
| [0070](0070-vendor-correctness.md) | What we write to Zoho is right, written once, and asked for sparingly | 2026-09-25 | accepted | [0104](0104-the-try-ons-look-on-whatsapp-only.md) |
| [0071](0071-what-ops-see-before-a-setting-changes.md) | What ops see before a setting changes, and who the console says they are | 2026-09-26 | superseded in part by 0212 on 18 October 2026: a setting or a record now changes where it reads | [0086](0086-the-next-visit-is-offered.md), [0212](0212-editing-in-place.md), [0221](0221-launches-scheduled-paused-and-checked.md) |
| [0072](0072-ops-clients-and-queues.md) | The ops console's clients and queues | 2026-09-26 | accepted | [0092](0092-task-owners.md) |
| [0073](0073-prices-from-the-price-book.md) | Prices from the price book, on the site and in FSM's catalogue | 2026-09-26 | accepted | [0085](0085-services-ops-can-edit.md), [0087](0087-consumables-and-stock.md), [0103](0103-the-home-pages-first-copy-round.md), [0204](0204-the-sites-price-pipeline-removed.md), [0274](0274-gst-on.md) |
| [0074](0074-hand-offs-and-messages.md) | What each person learns when something changes for them | 2026-09-26 | accepted | [0092](0092-task-owners.md), [0096](0096-a-no-shows-charge-and-its-dispute.md), [0099](0099-the-clients-note-in-fsm.md) |
| [0075](0075-tests-held-to-the-contract-and-the-local-stack.md) | Tests held to the API's contract, and the whole system on a laptop | 2026-09-27 | accepted |  |
| [0076](0076-one-ui-layer-and-one-api-client.md) | One component layer and one API client for the front ends | 2026-09-27 | accepted | [0121](0121-the-site-and-the-app-book-with-the-same-parts.md) |
| [0077](0077-a-token-scale-written-once.md) | A token scale written once, and names for what a value is for | 2026-09-27 | accepted | [0262](0262-the-sites-typeface-and-palette.md) |
| [0078](0078-the-queues-no-board-draws.md) | The console's queues that no board draws | 2026-09-27 | accepted |  |
| [0079](0079-an-address-before-a-slot.md) | An address before any slot | 2026-09-27 | accepted |  |
| [0080](0080-consents-given-by-booking.md) | The photograph consents, given by booking | 2026-09-27 | accepted, for counsel to confirm before production | [0094](0094-where-a-consent-was-given.md) |
| [0081](0081-the-site-takes-the-address.md) | The site takes the address before it books | 2026-09-27 | accepted | [0098](0098-the-door-in-fsms-address.md), [0285](0285-every-site-booking-is-a-sign-in.md) |
| [0082](0082-try-ons-in-the-app.md) | A client's try-on in the app | 2026-09-27 | accepted, on the owner's ruling of 27 September 2026 | [0084](0084-a-clients-try-on-is-kept.md) |
| [0083](0083-anyone-signed-in-can-refer.md) | Anyone signed in can refer | 2026-09-27 | withdrawn by the owner on 27 September 2026, the day it was made |  |
| [0084](0084-a-clients-try-on-is-kept.md) | A client's try-on is kept | 2026-09-27 | accepted, on the owner's ruling of 27 September 2026 | [0093](0093-the-storage-meter.md), [0104](0104-the-try-ons-look-on-whatsapp-only.md) |
| [0085](0085-services-ops-can-edit.md) | Services ops can edit | 2026-09-27 | accepted, on the owner's rulings of 27 September 2026 | [0211](0211-packages.md) |
| [0086](0086-the-next-visit-is-offered.md) | The next visit is offered, and the client books it | 2026-09-27 | accepted | [0085](0085-services-ops-can-edit.md), [0105](0105-a-consultation-and-fit-in-one-visit.md), [0211](0211-packages.md), [0253](0253-replacement-when-due-and-change-of-hair-system.md) |
| [0087](0087-consumables-and-stock.md) | Consumables and their stock, and the job sheet, set in the console | 2026-09-27 | accepted, on the owner's rulings of 27 September 2026 | [0085](0085-services-ops-can-edit.md), [0222](0222-consumables-short-of-expected.md) |
| [0088](0088-every-policy-in-the-console.md) | Every policy in the console | 2026-09-28 | accepted, on the owner's standing rule of 27 September 2026 | [0095](0095-a-booking-fsm-refuses-is-held.md), [0096](0096-a-no-shows-charge-and-its-dispute.md), [0119](0119-blackouts-by-city-and-trained-fitters.md) |
| [0089](0089-an-invite-is-not-lost.md) | An invite is not lost when the friend books away from its page | 2026-09-28 | accepted |  |
| [0092](0092-task-owners.md) | Whose each task is, a visit ops close without a follow-up, and an address given to ops | 2026-09-28 | accepted | [0282](0282-tasks-chosen-together.md) |
| [0093](0093-the-storage-meter.md) | The storage meter, the photograph upload limit, and thumbnails made on the phone | 2026-09-28 | accepted, on the owner's rulings of 27 September 2026 | [0194](0194-the-build-on-workers-paid.md) |
| [0094](0094-where-a-consent-was-given.md) | Where a consent was given, and an erasure blanks a check-in's coordinates | 2026-09-28 | accepted, on the owner's rulings of 27 September 2026 |  |
| [0095](0095-a-booking-fsm-refuses-is-held.md) | A booking FSM refuses is held, not refunded | 2026-09-29 | superseded by 0110 on 4 October 2026: no booking waits on FSM, so none is held for ops | [0100](0100-a-refund-is-made-once.md), [0110](0110-field-work-without-fsm.md) |
| [0096](0096-a-no-shows-charge-and-its-dispute.md) | A no-show's charge and its dispute, and the free change a visit ops moved keeps | 2026-09-29 | accepted, on the owner's rulings of 27 September 2026 | [0100](0100-a-refund-is-made-once.md) |
| [0097](0097-staging-logins-open-reminders-fenced.md) | Staging logins open, reminders fenced | 2026-09-30 | accepted |  |
| [0098](0098-the-door-in-fsms-address.md) | The door in FSM's service address | 2026-10-01 | superseded by 0110 on 4 October 2026: the door is kept on our own address record | [0110](0110-field-work-without-fsm.md) |
| [0099](0099-the-clients-note-in-fsm.md) | The client's note in FSM | 2026-10-01 | superseded by 0110 on 4 October 2026: the client's note is kept on the visit in our own database | [0110](0110-field-work-without-fsm.md) |
| [0100](0100-a-refund-is-made-once.md) | A refund is made once, however often it is asked for | 2026-10-01 | accepted |  |
| [0101](0101-phase-1s-path-into-fsm-removed.md) | Phase 1's path into FSM is removed, and no booking carries a Request | 2026-10-01 | superseded by 0110 on 4 October 2026: with FSM gone there is no path into it to remove | [0110](0110-field-work-without-fsm.md) |
| [0102](0102-window-times.md) | The window times in the console | 2026-10-01 | accepted, on the owner's rulings of 30 September and 1 October 2026 | [0210](0210-booking-by-start-time.md) |
| [0103](0103-the-home-pages-first-copy-round.md) | The home page's first copy round | 2026-10-01 | accepted | [0213](0213-the-sites-second-copy-round.md), [0215](0215-the-range-as-a-table.md) |
| [0104](0104-the-try-ons-look-on-whatsapp-only.md) | The try-on's look on WhatsApp only | 2026-10-01 | accepted, on the owner's ruling D3 of 1 October 2026 | [0214](0214-from-the-site-into-the-app.md), [0217](0217-the-try-ons-photo-taken-and-looked-at.md), [0219](0219-one-line-consents.md), [0276](0276-a-message-whatsapp-refuses.md) |
| [0105](0105-a-consultation-and-fit-in-one-visit.md) | A consultation and fit in one visit | 2026-10-01 | accepted, on the owner's ruling D2 of 1 October 2026 and the rulings of the same day on the piece, the payment and the length | [0299](0299-fit-today.md) |
| [0106](0106-a-clients-hair-profile.md) | A client's hair profile: the fit spec and their history | 2026-10-01 | accepted, on the owner's rulings of 1 October 2026 | [0240](0240-consultation-rules-and-inches.md), [0270](0270-the-design-checks-api-side.md) |
| [0107](0107-referral-rewards-in-the-console.md) | What a referral earns, set in the console, each side apart | 2026-10-01 | accepted, on the owner's ruling of 1 October 2026 |  |
| [0108](0108-discount-codes.md) | Discount codes | 2026-10-01 | accepted, on the owner's rulings of 1 October 2026 | [0283](0283-changed-and-deleted-while-unused.md) |
| [0109](0109-console-departments-and-access.md) | The console by departments, and who may do what in it | 2026-10-02 | accepted, on the owner's ruling of 2 October 2026 | [0198](0198-cities-as-data.md), [0208](0208-the-console-redesigned.md), [0283](0283-changed-and-deleted-while-unused.md) |
| [0110](0110-field-work-without-fsm.md) | Field work without Zoho FSM | 2026-10-02 | accepted, on the owner's ruling of 2 October 2026 |  |
| [0111](0111-a-technician-never-takes-two-visits-in-a-row.md) | A technician never takes two visits in a row | 2026-10-05 | accepted, on the owner's ruling of 5 October 2026 | [0118](0118-booking-never-dead-ends.md) |
| [0112](0112-workers-paid.md) | Workers Paid | 2026-10-06 | accepted, on the owner's purchase of 6 October 2026 |  |
| [0113](0113-fsms-columns-go.md) | FSM's columns go | 2026-10-06 | accepted | [0199](0199-derived-state-in-the-domain.md) |
| [0114](0114-whatsapp-business-platform-through-msg91.md) | The WhatsApp Business Platform through MSG91 | 2026-10-11 | accepted | [0197](0197-one-inbound-port.md) |
| [0115](0115-a-move-to-another-day-waits-for-the-client.md) | A move to another day waits for the client | 2026-10-11 | accepted |  |
| [0116](0116-book-asks-for-the-name-and-number-first.md) | /book asks for the name and number first | 2026-10-11 | accepted | [0214](0214-from-the-site-into-the-app.md) |
| [0117](0117-a-technician-takes-visits-in-their-own-city.md) | A technician takes visits in their own city | 2026-10-11 | accepted | [0118](0118-booking-never-dead-ends.md), [0223](0223-reach-from-home.md) |
| [0118](0118-booking-never-dead-ends.md) | Booking never dead-ends | 2026-10-11 | accepted |  |
| [0119](0119-blackouts-by-city-and-trained-fitters.md) | Blackouts by city, and trained fitters | 2026-10-11 | accepted | [0278](0278-a-technician-in-training-takes-no-visits.md) |
| [0120](0120-the-board-sees-the-road.md) | The board sees the road | 2026-10-11 | accepted |  |
| [0121](0121-the-site-and-the-app-book-with-the-same-parts.md) | The site and the app book with the same parts | 2026-10-11 | accepted |  |
| [0122](0122-technician-pay-per-visit.md) | Technician pay per visit | 2026-10-11 | accepted | [0311](0311-dated-technician-grades.md) |
| [0123](0123-partner-referral-channels.md) | Partner referral channels | 2026-10-11 | accepted |  |
| [0124](0124-partner-statements.md) | Partners' monthly statements | 2026-10-11 | accepted |  |
| [0125](0125-partner-discount-codes.md) | A partner's discount code | 2026-10-11 | accepted |  |
| [0126](0126-the-words-page.md) | The Words page | 2026-10-11 | accepted |  |
| [0127](0127-publishing-the-words.md) | Publishing the site's words | 2026-10-11 | accepted |  |
| [0128](0128-messages-with-the-words-set.md) | Messages in the words set | 2026-10-11 | accepted |  |
| [0129](0129-the-care-inbox.md) | The Care inbox | 2026-10-12 | accepted | [0207](0207-closed-chats-archived.md) |
| [0130](0130-replies-from-the-care-inbox.md) | Replies from the Care inbox | 2026-10-12 | accepted |  |
| [0131](0131-care-people.md) | Each client's Care person | 2026-10-12 | accepted |  |
| [0132](0132-the-reply-clock.md) | The reply clock | 2026-10-12 | accepted |  |
| [0133](0133-the-after-hours-reply.md) | The after-hours reply | 2026-10-12 | accepted |  |
| [0134](0134-care-cover.md) | Days off and cover for the Care team | 2026-10-12 | accepted |  |
| [0135](0135-city-matters.md) | City matters | 2026-10-12 | accepted |  |
| [0136](0136-care-names.md) | The name a client knows their Care person by | 2026-10-12 | accepted |  |
| [0137](0137-last-contact-in-the-crm.md) | A client's last contact in the CRM | 2026-10-12 | accepted |  |
| [0138](0138-strangers-in-the-inbox.md) | Chats from numbers we don't know | 2026-10-12 | accepted |  |
| [0139](0139-care-shifts.md) | Care on shift | 2026-10-12 | accepted |  |
| [0140](0140-the-client-panel.md) | The client beside their chat | 2026-10-12 | accepted |  |
| [0141](0141-quick-replies.md) | Quick replies | 2026-10-12 | accepted | [0283](0283-changed-and-deleted-while-unused.md) |
| [0142](0142-moving-every-client.md) | Moving every client, and technicians in the inbox | 2026-10-12 | accepted |  |
| [0143](0143-remedies.md) | Remedies | 2026-10-12 | accepted | [0315](0315-a-remedy-past-the-limit-given-by-one-who-may-approve-it.md) |
| [0144](0144-care-numbers.md) | The Care numbers | 2026-10-12 | accepted |  |
| [0145](0145-technician-presets.md) | A technician's word from the job card | 2026-10-12 | accepted |  |
| [0146](0146-the-nightly-analytics-copy.md) | The nightly analytics copy | 2026-10-12 | accepted | [0196](0196-long-work-in-workflows.md) |
| [0147](0147-task-spans.md) | Task spans | 2026-10-12 | accepted |  |
| [0148](0148-the-channel-rule.md) | The channel rule | 2026-10-12 | accepted | [0288](0288-attribution-and-conversions.md) |
| [0149](0149-lost-reasons.md) | Lost reasons | 2026-10-12 | accepted | [0268](0268-the-visits-design-check.md) |
| [0150](0150-spend.md) | Spend | 2026-10-12 | accepted | [0288](0288-attribution-and-conversions.md) |
| [0151](0151-retention-figures.md) | Retention figures | 2026-10-12 | accepted |  |
| [0152](0152-standard-costs.md) | Standard costs | 2026-10-12 | accepted |  |
| [0153](0153-supply-and-credits-in-the-copy.md) | Supply and credits in the copy | 2026-10-12 | accepted |  |
| [0154](0154-targets-and-reporting-access.md) | Targets and reporting access | 2026-10-12 | accepted |  |
| [0155](0155-the-stock-place-tree.md) | The stock place tree | 2026-10-12 | accepted |  |
| [0156](0156-hair-systems-in-stock.md) | Hair systems in stock | 2026-10-12 | accepted | [0211](0211-packages.md) |
| [0157](0157-lots-and-expiry.md) | Lots and expiry | 2026-10-12 | accepted |  |
| [0158](0158-transfers-in-transit.md) | Transfers in transit | 2026-10-12 | accepted |  |
| [0159](0159-stock-views-and-expiry.md) | Stock views and expiry | 2026-10-12 | accepted |  |
| [0160](0160-demand-and-opening-counts.md) | Demand ahead and opening counts | 2026-10-12 | accepted |  |
| [0161](0161-pieces-as-units.md) | Pieces as units | 2026-10-12 | accepted | [0291](0291-pieces-without-labels.md) |
| [0162](0162-scanning-labels.md) | Scanning labels | 2026-10-12 | accepted | [0271](0271-the-technician-follow-ups.md) |
| [0163](0163-pieces-scanned-from-the-kit.md) | Pieces scanned from the kit | 2026-10-12 | accepted | [0291](0291-pieces-without-labels.md) |
| [0164](0164-the-kit-screen.md) | The kit screen | 2026-10-12 | accepted |  |
| [0165](0165-suppliers.md) | Suppliers | 2026-10-12 | accepted |  |
| [0166](0166-purchase-orders.md) | Purchase orders | 2026-10-12 | accepted |  |
| [0167](0167-receipts-and-landed-cost.md) | Receipts and landed cost | 2026-10-12 | accepted |  |
| [0168](0168-bills-in-books.md) | Bills in Books | 2026-10-12 | accepted |  |
| [0169](0169-supplier-claims.md) | Supplier claims | 2026-10-12 | accepted | [0270](0270-the-design-checks-api-side.md), [0273](0273-why-a-hair-system-failed.md), [0283](0283-changed-and-deleted-while-unused.md) |
| [0170](0170-stock-photos.md) | Photographs of stock | 2026-10-12 | accepted |  |
| [0171](0171-vendor-credits.md) | Vendor credits | 2026-10-12 | accepted |  |
| [0172](0172-supplier-scorecard.md) | Supplier scorecard | 2026-10-12 | accepted |  |
| [0173](0173-matching-a-client-to-stock.md) | Matching a client to stock | 2026-10-12 | accepted |  |
| [0174](0174-custom-orders.md) | Custom orders | 2026-10-12 | accepted |  |
| [0175](0175-custom-pieces-reserved.md) | Custom pieces reserved | 2026-10-12 | accepted |  |
| [0176](0176-custom-order-refunds.md) | Custom order refunds | 2026-10-12 | accepted |  |
| [0177](0177-custom-orders-in-the-app.md) | Custom orders in the app | 2026-10-12 | accepted |  |
| [0178](0178-stock-at-risk.md) | Stock at risk | 2026-10-12 | accepted |  |
| [0179](0179-demand-forecast.md) | Demand forecast | 2026-10-12 | accepted |  |
| [0180](0180-supply-plan.md) | Supply plan | 2026-10-12 | accepted |  |
| [0181](0181-tomorrows-kits.md) | Tomorrow's kits | 2026-10-12 | accepted |  |
| [0182](0182-the-events-calendar.md) | The events calendar and the forecast on the Supply plan | 2026-10-12 | accepted |  |
| [0183](0183-forecast-accuracy.md) | Forecast accuracy | 2026-10-12 | accepted |  |
| [0184](0184-the-one-visit-range.md) | The one-visit range | 2026-10-12 | accepted |  |
| [0185](0185-cycle-counts.md) | Cycle counts | 2026-10-12 | accepted |  |
| [0186](0186-usage-and-shrinkage.md) | Usage against expected, and shrinkage | 2026-10-12 | accepted |  |
| [0187](0187-recalls.md) | Recalls | 2026-10-12 | accepted |  |
| [0188](0188-failure-rates-and-value-at-risk.md) | Failure rates and value at risk | 2026-10-12 | accepted | [0270](0270-the-design-checks-api-side.md), [0273](0273-why-a-hair-system-failed.md) |
| [0189](0189-the-staff-list-on-by-default.md) | The Staff list on by default | 2026-10-13 | accepted |  |
| [0190](0190-foreign-orders-judged-at-a-rate.md) | Foreign orders judged at a rate | 2026-10-13 | accepted |  |
| [0191](0191-a-replaced-piece-comes-off.md) | A replaced piece comes off | 2026-10-13 | accepted |  |
| [0192](0192-free-remakes.md) | Free remakes | 2026-10-13 | accepted |  |
| [0193](0193-the-rest-of-the-rules-in-the-console.md) | The rest of the rules in the console | 2026-10-13 | accepted |  |
| [0194](0194-the-build-on-workers-paid.md) | The build on Workers Paid | 2026-10-13 | accepted |  |
| [0195](0195-the-cron-a-job-at-a-time.md) | The cron a job at a time | 2026-10-13 | accepted |  |
| [0196](0196-long-work-in-workflows.md) | Long work in Workflows | 2026-10-13 | accepted, on the owner's ruling of 13 October 2026 |  |
| [0197](0197-one-inbound-port.md) | One inbound port | 2026-10-13 | accepted, on the owner's ruling of 13 October 2026 | [0276](0276-a-message-whatsapp-refuses.md) |
| [0198](0198-cities-as-data.md) | Cities as data | 2026-10-14 | accepted | [0283](0283-changed-and-deleted-while-unused.md) |
| [0199](0199-derived-state-in-the-domain.md) | Derived state in the domain | 2026-10-14 | accepted |  |
| [0200](0200-staging-tenants-of-its-own.md) | Staging's tenants of its own | 2026-10-14 | accepted | [0261](0261-razorpay-money-in-books.md) |
| [0201](0201-the-try-on-on-youcam.md) | The try-on on YouCam | 2026-10-14 | accepted |  |
| [0202](0202-razorpay-events-queued.md) | Razorpay's events are queued, and every queue has its dead letters | 2026-10-14 | accepted |  |
| [0203](0203-a-vendor-down-is-held-off.md) | A vendor that is down is held off, and a contact change waits in D1 | 2026-10-14 | accepted |  |
| [0204](0204-the-sites-price-pipeline-removed.md) | The site's price pipeline is removed | 2026-10-15 | accepted | [0213](0213-the-sites-second-copy-round.md) |
| [0205](0205-the-pipeline-as-it-runs.md) | The pipeline as it runs | 2026-10-15 | accepted |  |
| [0206](0206-trusted-types-and-a-nonce-per-page.md) | Trusted Types enforced, and a nonce on every page | 2026-10-15 | accepted |  |
| [0207](0207-closed-chats-archived.md) | Closed Care threads are archived out of D1 | 2026-10-15 | accepted |  |
| [0208](0208-the-console-redesigned.md) | The console redesigned: work first, Settings in one place, and two themes | 2026-10-15 | accepted | [0225](0225-the-console-on-a-desk-and-a-phone.md), [0301](0301-the-console-look-to-the-22-november-redesign.md) |
| [0209](0209-paid-at-the-visit-by-upi.md) | Paid at the visit by UPI, while online payment is off | 2026-10-15 | accepted | [0257](0257-razorpay-only.md) |
| [0210](0210-booking-by-start-time.md) | Booking by start time | 2026-10-18 | accepted | [0223](0223-reach-from-home.md), [0287](0287-a-start-googles-drive-refused-is-not-offered.md), [0289](0289-who-takes-a-visit.md), [0290](0290-allotted-the-evening-before.md) |
| [0211](0211-packages.md) | Packages | 2026-10-18 | accepted |  |
| [0212](0212-editing-in-place.md) | Editing in place | 2026-10-18 | accepted | [0313](0313-the-settings-screens-to-the-22-november-redesign.md), [0314](0314-change-everywhere-and-forms-in-a-grid.md) |
| [0213](0213-the-sites-second-copy-round.md) | The site's second copy round | 2026-10-19 | accepted | [0263](0263-the-home-pages-order-and-bands.md), [0279](0279-one-rule-for-paying-and-the-tagline-as-written.md) |
| [0214](0214-from-the-site-into-the-app.md) | From the site into the app, and the look on the page | 2026-10-19 | accepted | [0217](0217-the-try-ons-photo-taken-and-looked-at.md), [0285](0285-every-site-booking-is-a-sign-in.md) |
| [0215](0215-the-range-as-a-table.md) | The range as a table | 2026-10-19 | accepted |  |
| [0216](0216-the-sites-polish-pass.md) | The site's polish pass | 2026-10-19 | accepted | [0262](0262-the-sites-typeface-and-palette.md), [0263](0263-the-home-pages-order-and-bands.md) |
| [0217](0217-the-try-ons-photo-taken-and-looked-at.md) | The try-on's photo, taken and looked at; no question of where the hair loss is | 2026-10-19 | accepted | [0219](0219-one-line-consents.md) |
| [0218](0218-refer-opens-at-the-first-consultation.md) | Refer opens at the first consultation | 2026-10-19 | accepted |  |
| [0219](0219-one-line-consents.md) | One-line consents, with the full notice a link away | 2026-10-19 | accepted |  |
| [0220](0220-opening-a-city-from-india-posts-pincodes.md) | Opening a city from India Post's pincodes | 2026-10-25 | accepted | [0221](0221-launches-scheduled-paused-and-checked.md) |
| [0221](0221-launches-scheduled-paused-and-checked.md) | Launches scheduled, paused and checked first | 2026-10-25 | accepted | [0224](0224-demand-and-the-next-to-open.md) |
| [0222](0222-consumables-short-of-expected.md) | Consumables short of what a visit expects are said why, and checked | 2026-10-25 | accepted |  |
| [0223](0223-reach-from-home.md) | Reach from home, drawn on the city's map and checked at the address | 2026-10-26 | accepted | [0289](0289-who-takes-a-visit.md) |
| [0224](0224-demand-and-the-next-to-open.md) | Demand, and the next pincodes to open | 2026-10-26 | accepted |  |
| [0225](0225-the-console-on-a-desk-and-a-phone.md) | The console on a desk and a phone, to the November redesign | 2026-11-02 | accepted | [0226](0226-the-console-frame-redesigned.md), [0227](0227-today-by-home-and-tasks-as-one-table.md), [0229](0229-dispatch-and-booking-redesigned.md), [0230](0230-clients-redesigned.md), [0231](0231-messages-redesigned.md), [0232](0232-technicians-stock-and-money-redesigned.md), [0233](0233-settings-redesigned.md), [0235](0235-full-size-check-fixes.md), [0236](0236-second-design-pass.md) |
| [0226](0226-the-console-frame-redesigned.md) | The console's frame, to the November redesign | 2026-11-02 | accepted | [0228](0228-the-header-city-within-a-persons-reach.md) |
| [0227](0227-today-by-home-and-tasks-as-one-table.md) | Today by home, and Tasks as one table | 2026-11-02 | accepted | [0228](0228-the-header-city-within-a-persons-reach.md), [0238](0238-third-design-pass.md), [0282](0282-tasks-chosen-together.md) |
| [0228](0228-the-header-city-within-a-persons-reach.md) | The header's city, within a person's reach | 2026-11-02 | accepted |  |
| [0229](0229-dispatch-and-booking-redesigned.md) | Dispatch and booking, to the November redesign | 2026-11-02 | accepted |  |
| [0230](0230-clients-redesigned.md) | Clients and a client's page, to the November redesign | 2026-11-02 | accepted |  |
| [0231](0231-messages-redesigned.md) | Messages, to the November redesign | 2026-11-02 | accepted | [0238](0238-third-design-pass.md) |
| [0232](0232-technicians-stock-and-money-redesigned.md) | A technician's page, Stock and Money, to the November redesign | 2026-11-02 | accepted | [0238](0238-third-design-pass.md) |
| [0233](0233-settings-redesigned.md) | Settings, to the November redesign | 2026-11-02 | accepted | [0234](0234-every-settings-page-aligned.md) |
| [0234](0234-every-settings-page-aligned.md) | Every Settings page in the redesign's look | 2026-11-02 | accepted |  |
| [0235](0235-full-size-check-fixes.md) | The redesign checked at full size, and what it changed | 2026-11-02 | accepted |  |
| [0236](0236-second-design-pass.md) | The second design pass: heads, folded lists, items, and each thing where it is used | 2026-11-02 | accepted | [0237](0237-every-list-sorts.md), [0238](0238-third-design-pass.md) |
| [0237](0237-every-list-sorts.md) | Every list sorts, a long one narrows, and its heads stand over their figures | 2026-11-02 | accepted |  |
| [0238](0238-third-design-pass.md) | Third design pass: one home, the chat's column, a record's facts beside its head, Inventory's one row of tabs | 2026-11-02 | accepted |  |
| [0239](0239-technician-light-look.md) | The technician app's new look: white, navy and Plex, screen by screen | 2026-11-10 | accepted |  |
| [0240](0240-consultation-rules-and-inches.md) | A consultation uses nothing from the kit, a first fit takes the profile, and the head is measured in inches | 2026-11-10 | accepted |  |
| [0241](0241-tab-shell-today-and-me.md) | The technician app's tab bar, Today redrawn, and Me with sign out | 2026-11-10 | accepted |  |
| [0242](0242-client-record.md) | A client's record for the technicians: alerts, the handoff note, and their history | 2026-11-11 | accepted |  |
| [0243](0243-job-and-the-door.md) | The job and the door in the new look | 2026-11-11 | accepted |  |
| [0244](0244-the-visit-engine.md) | The visit engine, its plan, and the photographs | 2026-11-11 | accepted | [0245](0245-the-steps.md) |
| [0245](0245-the-steps.md) | The visit's steps in the new look | 2026-11-12 | accepted | [0246](0246-closed-and-sent-back.md), [0258](0258-the-technician-design-pass.md), [0296](0296-no-empty-reference-photograph.md) |
| [0246](0246-closed-and-sent-back.md) | Closed, and a step sent back | 2026-11-11 | accepted |  |
| [0247](0247-the-steps-left.md) | The steps left from PR 7 | 2026-11-11 | accepted |  |
| [0248](0248-safety.md) | A technician's safety on a visit | 2026-11-11 | accepted |  |
| [0249](0249-schedule-kit-and-me.md) | Schedule, Kit and Me | 2026-11-11 | accepted | [0258](0258-the-technician-design-pass.md), [0298](0298-past-weeks-on-schedule.md) |
| [0250](0250-guides-and-alerts.md) | Guides and alerts | 2026-11-11 | accepted |  |
| [0251](0251-hindi-and-the-sign-in.md) | Hindi on every screen, and the sign-in redrawn | 2026-11-11 | accepted | [0280](0280-the-technician-apps-hindi-corrected.md) |
| [0252](0252-client-app-redesign.md) | The client app redrawn: four tabs, the profile, and the client's look | 2026-11-12 | accepted | [0295](0295-the-consoles-first-load.md) |
| [0253](0253-replacement-when-due-and-change-of-hair-system.md) | Changing hair system at the replacement booking, and when a replacement is booked | 2026-11-12 | accepted |  |
| [0254](0254-client-signs-off-the-fit.md) | The client signs off the fit | 2026-11-12 | accepted |  |
| [0255](0255-client-alerts-and-push.md) | Client alerts and push, and the live visit | 2026-11-12 | accepted |  |
| [0256](0256-fit-guarantee-setting.md) | The fit guarantee's days as a setting, and a claim as a Tasks row | 2026-11-12 | accepted |  |
| [0257](0257-razorpay-only.md) | Razorpay is the only way to pay | 2026-11-12 | accepted | [0279](0279-one-rule-for-paying-and-the-tagline-as-written.md) |
| [0258](0258-the-technician-design-pass.md) | The technician app's design pass | 2026-11-12 | accepted | [0268](0268-the-visits-design-check.md) |
| [0259](0259-the-issue-log.md) | The issue log | 2026-11-16 | accepted |  |
| [0260](0260-ratings.md) | Ratings | 2026-11-16 | accepted |  |
| [0261](0261-razorpay-money-in-books.md) | Razorpay's money in Books, from payment to the bank | 2026-11-17 | accepted | [0274](0274-gst-on.md) |
| [0262](0262-the-sites-typeface-and-palette.md) | The site's typeface and palette | 2026-11-17 | accepted | [0266](0266-the-sites-header-book-and-focus-ring.md) |
| [0263](0263-the-home-pages-order-and-bands.md) | The home page's order and bands | 2026-11-17 | accepted |  |
| [0264](0264-the-hero-restyled.md) | The hero, restyled | 2026-11-17 | accepted |  |
| [0265](0265-book-and-try-on-the-client-apps-look.md) | `/book` and `/try` on the client app's look | 2026-11-17 | accepted | [0269](0269-the-one-visits-note-on-book.md) |
| [0266](0266-the-sites-header-book-and-focus-ring.md) | The site's header Book and focus ring | 2026-11-17 | accepted |  |
| [0267](0267-the-technician-design-check.md) | The technician app's design check | 2026-11-17 | accepted | [0268](0268-the-visits-design-check.md), [0270](0270-the-design-checks-api-side.md) |
| [0268](0268-the-visits-design-check.md) | The visit's design check | 2026-11-17 | accepted |  |
| [0269](0269-the-one-visits-note-on-book.md) | The one visit's note on `/book` | 2026-11-17 | accepted | [0272](0272-the-one-visit-is-paid-through-razorpay-only.md) |
| [0270](0270-the-design-checks-api-side.md) | The design check's API side | 2026-11-17 | accepted | [0271](0271-the-technician-follow-ups.md), [0273](0273-why-a-hair-system-failed.md) |
| [0271](0271-the-technician-follow-ups.md) | The technician follow-ups | 2026-11-17 | accepted |  |
| [0272](0272-the-one-visit-is-paid-through-razorpay-only.md) | The one visit is paid through Razorpay only | 2026-11-17 | accepted |  |
| [0273](0273-why-a-hair-system-failed.md) | Why a hair system failed | 2026-11-18 | accepted |  |
| [0274](0274-gst-on.md) | GST on: prices with their GST, and every invoice line and fee carrying its tax | 2026-11-18 | accepted |  |
| [0275](0275-the-apps-phase-2-pairs-retired.md) | The apps' Phase 2 fidelity pairs retired | 2026-11-18 | accepted |  |
| [0276](0276-a-message-whatsapp-refuses.md) | A message WhatsApp refuses | 2026-11-18 | accepted, on the owner's rulings of 18 November 2026 |  |
| [0277](0277-alerts-that-come-sooner.md) | Alerts that come sooner | 2026-11-18 | accepted, on the owner's approval of the QA run's fix plan, 18 November 2026 |  |
| [0278](0278-a-technician-in-training-takes-no-visits.md) | A technician in training takes no visits | 2026-11-18 | accepted, on the owner's ruling of 18 November 2026 |  |
| [0279](0279-one-rule-for-paying-and-the-tagline-as-written.md) | One rule for paying, and the tagline as written | 2026-11-19 | accepted |  |
| [0280](0280-the-technician-apps-hindi-corrected.md) | The technician app's Hindi corrected, and the job card's arrival named | 2026-11-19 | accepted |  |
| [0281](0281-the-consoles-first-load-counts-today.md) | The console's first load counts Today, and Today holds its room | 2026-11-19 | accepted | [0284](0284-the-first-screen-and-the-precache.md) |
| [0282](0282-tasks-chosen-together.md) | Tasks chosen together, and the keys a desk moves by | 2026-11-19 | accepted |  |
| [0283](0283-changed-and-deleted-while-unused.md) | What ops configure is changed, and deleted while nothing uses it | 2026-11-19 | accepted |  |
| [0284](0284-the-first-screen-and-the-precache.md) | A phone app's budget counts its first screen, and its precache has a ceiling of its own | 2026-11-19 | accepted |  |
| [0285](0285-every-site-booking-is-a-sign-in.md) | Every booking on the site asks the WhatsApp code, and signs the client in | 2026-11-19 | accepted, on the owner's rulings of 19 November 2026 |  |
| [0286](0286-the-icons-are-the-mark.md) | The browser's and the home screen's icons are the mark | 2026-11-19 | accepted, on the owner's ruling of 19 November 2026 | [0312](0312-the-consoles-favicon-everywhere.md) |
| [0287](0287-a-start-googles-drive-refused-is-not-offered.md) | A start Google's drive leaves no room for is not offered again | 2026-11-19 | accepted, on the owner's go-ahead of 19 November 2026 | [0294](0294-learned-drive-times.md) |
| [0288](0288-attribution-and-conversions.md) | Attribution and conversions | 2026-11-20 | accepted, on the owner's brief and rulings of 20 November 2026 |  |
| [0289](0289-who-takes-a-visit.md) | Who takes a visit: a radius in km, an overflow ring, and the least cost | 2026-11-22 | accepted | [0290](0290-allotted-the-evening-before.md), [0293](0293-steering-booking-times.md) |
| [0290](0290-allotted-the-evening-before.md) | A visit's technician is fixed the evening before | 2026-11-22 | accepted | [0292](0292-room-made-at-booking.md), [0297](0297-drafts-off-a-day-that-no-longer-fits.md) |
| [0291](0291-pieces-without-labels.md) | A piece without a label never stops the fit | 2026-11-22 | accepted |  |
| [0292](0292-room-made-at-booking.md) | Booking moves a draft to make room | 2026-11-22 | accepted |  |
| [0293](0293-steering-booking-times.md) | Clients are steered to the times that drive least | 2026-11-22 | accepted |  |
| [0294](0294-learned-drive-times.md) | Drive times are learned from our own drives | 2026-11-22 | accepted |  |
| [0295](0295-the-consoles-first-load.md) | The console's first load is held to 175 KB | 2026-11-23 | accepted |  |
| [0296](0296-no-empty-reference-photograph.md) | A guided task draws no reference photograph until it has one | 2026-11-23 | accepted |  |
| [0297](0297-drafts-off-a-day-that-no-longer-fits.md) | A draft its day no longer fits is moved, and two cities are checked a run | 2026-11-23 | accepted |  |
| [0298](0298-past-weeks-on-schedule.md) | Schedule goes back to past weeks, and never past this one | 2026-11-23 | accepted |  |
| [0299](0299-fit-today.md) | Fit today: a consultation becomes the fit at the door | 2026-11-23 | accepted |  |
| [0300](0300-payment-links-on-whatsapp.md) | Payment links on WhatsApp, through our own address | 2026-11-23 | accepted |  |
| [0301](0301-the-console-look-to-the-22-november-redesign.md) | The console's look, to the 22 November redesign | 2026-11-23 | accepted | [0304](0304-the-work-screens-to-the-22-november-redesign.md) |
| [0302](0302-tasks-written-by-hand.md) | Tasks written by hand | 2026-11-23 | accepted |  |
| [0303](0303-snoozing-a-task.md) | Snoozing a task | 2026-11-23 | accepted | [0307](0307-the-people-rulings.md) |
| [0304](0304-the-work-screens-to-the-22-november-redesign.md) | The Work screens, to the 22 November redesign | 2026-11-23 | accepted | [0306](0306-the-people-screens-to-the-22-november-redesign.md) |
| [0305](0305-a-technicians-start-date.md) | A technician's start date | 2026-11-24 | accepted |  |
| [0306](0306-the-people-screens-to-the-22-november-redesign.md) | The People screens, to the 22 November redesign | 2026-11-24 | accepted | [0307](0307-the-people-rulings.md) |
| [0307](0307-the-people-rulings.md) | The People rulings | 2026-11-24 | accepted |  |
| [0308](0308-the-inventory-screens-to-the-22-november-redesign.md) | The Inventory screens, to the 22 November redesign | 2026-11-24 | accepted |  |
| [0309](0309-the-requests-and-money-screens-to-the-22-november-redesign.md) | The Requests and Money screens, to the 22 November redesign | 2026-11-24 | accepted |  |
| [0310](0310-the-growth-and-reports-screens-to-the-22-november-redesign.md) | The Growth and Reports screens, to the 22 November redesign | 2026-11-24 | accepted |  |
| [0311](0311-dated-technician-grades.md) | Dated technician grades | 2026-11-24 | accepted |  |
| [0312](0312-the-consoles-favicon-everywhere.md) | The console's favicon, everywhere | 2026-11-24 | accepted, on the owner's ruling of 24 November 2026 |  |
| [0313](0313-the-settings-screens-to-the-22-november-redesign.md) | The Settings screens, to the 22 November redesign | 2026-11-24 | accepted |  |
| [0314](0314-change-everywhere-and-forms-in-a-grid.md) | Change everywhere, and forms in a grid | 2026-11-24 | accepted | [0316](0316-every-console-action-an-icon.md) |
| [0315](0315-a-remedy-past-the-limit-given-by-one-who-may-approve-it.md) | A remedy past the limit, given by one who may approve it | 2026-11-24 | accepted |  |
| [0316](0316-every-console-action-an-icon.md) | Every console action an icon | 2026-11-25 | accepted, on the owner's ruling of 24 November 2026 |  |
| [0317](0317-targets-progress.md) | Targets progress | 2026-11-25 | accepted |  |
| [0319](0319-rules-that-hold-together.md) | Rules that hold together | 2026-11-25 | accepted |  |
