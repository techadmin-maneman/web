# Architecture decision records

Every decision this repository was built on, oldest first. A record says what was decided and why, and is not rewritten to say something else: a later record changes it, and says so in its own header (ADR 0001). **Changed by** gathers those later records, from either side, so an old record's reader knows to read on.

This file is written by `npm run adr-index` from the records' own headers, and `test/node/adr-index.test.ts` fails until it is run after a record is added or its status changes. The next free number is 0109.

| ADR | Decision | Date | Status | Changed by |
| --- | --- | --- | --- | --- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | 2026-09-21 | accepted |  |
| [0002](0002-repository-layout-and-tooling.md) | Repository layout and tooling | 2026-09-21 | accepted |  |
| [0003](0003-environment-identity-guard.md) | Environment identity guard | 2026-09-21 | accepted |  |
| [0004](0004-routing-and-hostnames.md) | Routing and hostnames | 2026-09-21 | accepted |  |
| [0005](0005-environment-isolation-in-wrangler-config.md) | Environment isolation in the wrangler config | 2026-09-21 | accepted |  |
| [0006](0006-deployment-pipeline.md) | Deployment pipeline | 2026-09-21 | accepted | [0010](0010-applying-triggers.md), [0075](0075-tests-held-to-the-contract-and-the-local-stack.md) |
| [0007](0007-platform-constraints.md) | Platform facts that block M1's definition of done | 2026-09-21 | resolved by 0008 | [0008](0008-owner-decisions-on-platform-constraints.md) |
| [0008](0008-owner-decisions-on-platform-constraints.md) | Owner decisions on the platform constraints | 2026-09-21 | accepted |  |
| [0009](0009-stay-inside-cloudflare-free-tier.md) | Stay inside Cloudflare's free tier | 2026-09-21 | accepted |  |
| [0010](0010-applying-triggers.md) | Applying triggers | 2026-09-21 | accepted |  |
| [0011](0011-lead-api.md) | The lead API | 2026-09-21 | accepted | [0067](0067-alerts-and-silent-failures.md) |
| [0012](0012-zoho-sync.md) | The Zoho sync | 2026-09-21 | accepted | [0070](0070-vendor-correctness.md) |
| [0013](0013-departures-from-the-ailabtools-harness.md) | Departures from the AILabTools harness | 2026-09-21 | accepted |  |
| [0014](0014-try-on-api.md) | The try-on API | 2026-09-21 | accepted | [0018](0018-one-look-pro-only-lead-notices.md), [0039](0039-phase-2-budget.md), [0084](0084-a-clients-try-on-is-kept.md), [0104](0104-the-try-ons-look-on-whatsapp-only.md) |
| [0015](0015-render-pipeline.md) | The render pipeline and its budget | 2026-09-21 | accepted | [0070](0070-vendor-correctness.md) |
| [0016](0016-whatsapp-through-evolution.md) | WhatsApp through Evolution API, for now | 2026-09-21 | accepted |  |
| [0017](0017-no-paid-face-precheck.md) | No paid face pre-check | 2026-09-21 | accepted |  |
| [0018](0018-one-look-pro-only-lead-notices.md) | One look per visitor, Pro only, and new-lead notices | 2026-09-21 | accepted | [0104](0104-the-try-ons-look-on-whatsapp-only.md) |
| [0019](0019-erasure.md) | Erasure | 2026-09-21 | accepted | [0066](0066-erasure-all-or-nothing.md), [0094](0094-where-a-consent-was-given.md) |
| [0020](0020-production-on-the-zoho-test-org.md) | Production uses the Zoho test org, for now | 2026-09-21 | superseded by 0050 on 22 September 2026 | [0050](0050-crm-in-the-real-org.md) |
| [0021](0021-public-site.md) | The public site: Astro in site/, on staging first | 2026-09-22 | accepted |  |
| [0022](0022-site-departures-from-v2.md) | Where the site departs from v2 or the front-end prompt | 2026-09-22 | accepted | [0073](0073-prices-from-the-price-book.md), [0103](0103-the-home-pages-first-copy-round.md), [0104](0104-the-try-ons-look-on-whatsapp-only.md) |
| [0023](0023-launch-hardening.md) | Launch hardening: headers, analytics, budgets | 2026-09-22 | accepted |  |
| [0024](0024-the-browsers-own-look.md) | The browser's own look: an optional gate, and a look shown again | 2026-09-22 | accepted, on the owner's review of 22 September 2026 | [0104](0104-the-try-ons-look-on-whatsapp-only.md) |
| [0025](0025-phase-2-conflicts-register.md) | Phase 2: the conflicts register | 2026-09-22 | accepted, and kept up to date |  |
| [0026](0026-hosts-and-surfaces.md) | Hosts and surfaces | 2026-09-22 | accepted |  |
| [0027](0027-referral-landing.md) | The referral landing: a Worker beside the site's assets | 2026-09-22 | accepted | [0073](0073-prices-from-the-price-book.md) |
| [0028](0028-photographs-from-the-app.md) | Photographs from the technician app | 2026-09-23 | accepted | [0093](0093-the-storage-meter.md) |
| [0029](0029-sessions.md) | Sessions for the client app | 2026-09-22 | accepted |  |
| [0030](0030-one-time-codes.md) | One-time codes for the client app's login | 2026-09-22 | accepted | [0070](0070-vendor-correctness.md), [0097](0097-staging-logins-open-reminders-fenced.md) |
| [0031](0031-access-and-audit.md) | Access on the ops surface, and the audit log | 2026-09-22 | accepted | [0072](0072-ops-clients-and-queues.md) |
| [0032](0032-fsm-mirror.md) | The FSM mirror, and Books documents | 2026-09-22 | accepted | [0070](0070-vendor-correctness.md), [0075](0075-tests-held-to-the-contract-and-the-local-stack.md), [0101](0101-phase-1s-path-into-fsm-removed.md) |
| [0033](0033-credit-ledger.md) | The credit ledger | 2026-09-22 | accepted | [0068](0068-a-paid-hold-is-kept.md), [0107](0107-referral-rewards-in-the-console.md) |
| [0034](0034-clash-check.md) | The clash check | 2026-09-22 | accepted | [0069](0069-dispatch-under-concurrency.md) |
| [0035](0035-window-slot-map.md) | The window-to-slot map | 2026-09-22 | accepted, with placeholder times | [0102](0102-window-times.md) |
| [0036](0036-geocoding.md) | Geocoding, for the check-in's geofence | 2026-09-23 | accepted | [0054](0054-address-capture.md) |
| [0037](0037-shared-packages.md) | Shared packages: the brand first | 2026-09-22 | accepted | [0076](0076-one-ui-layer-and-one-api-client.md), [0077](0077-a-token-scale-written-once.md) |
| [0038](0038-offline-writes.md) | The technician app's offline writes, and what they write to FSM | 2026-09-23 | accepted |  |
| [0039](0039-phase-2-budget.md) | The Phase 2 budget on the free plan | 2026-09-22 | accepted | [0073](0073-prices-from-the-price-book.md), [0084](0084-a-clients-try-on-is-kept.md), [0093](0093-the-storage-meter.md) |
| [0040](0040-phase-1-alignment.md) | Phase 1 aligned with Phase 2: the evening window, and "consultation" | 2026-09-22 | accepted |  |
| [0041](0041-outbound-messages-for-phase-2.md) | Outbound messages for Phase 2, and delivery receipts | 2026-09-22 | accepted |  |
| [0042](0042-client-profile.md) | The client's profile: address, consents, number change, deletion | 2026-09-22 | accepted | [0080](0080-consents-given-by-booking.md) |
| [0043](0043-client-app.md) | The client app: build, Worker and policy | 2026-09-22 | accepted |  |
| [0044](0044-payments-mirror.md) | The payments mirror | 2026-09-22 | accepted | [0067](0067-alerts-and-silent-failures.md), [0068](0068-a-paid-hold-is-kept.md) |
| [0045](0045-self-serve-booking.md) | Self-serve booking and prepayment | 2026-09-22 | accepted | [0068](0068-a-paid-hold-is-kept.md), [0079](0079-an-address-before-a-slot.md), [0086](0086-the-next-visit-is-offered.md), [0100](0100-a-refund-is-made-once.md) |
| [0046](0046-moving-and-cancelling.md) | Moving and cancelling a visit | 2026-09-22 | accepted | [0068](0068-a-paid-hold-is-kept.md), [0096](0096-a-no-shows-charge-and-its-dispute.md) |
| [0047](0047-visit-messages.md) | Messages about a client's visits | 2026-09-22 | accepted | [0074](0074-hand-offs-and-messages.md) |
| [0048](0048-referrals.md) | Referrals and the waitlist | 2026-09-22 | accepted | [0060](0060-an-invited-friend-reaches-ops-and-the-crm.md), [0071](0071-what-ops-see-before-a-setting-changes.md), [0074](0074-hand-offs-and-messages.md), [0080](0080-consents-given-by-booking.md), [0089](0089-an-invite-is-not-lost.md), [0107](0107-referral-rewards-in-the-console.md) |
| [0049](0049-dpdp.md) | DPDP readiness | 2026-09-22 | accepted | [0066](0066-erasure-all-or-nothing.md), [0074](0074-hand-offs-and-messages.md), [0094](0094-where-a-consent-was-given.md) |
| [0050](0050-crm-in-the-real-org.md) | The CRM moves to the real Zoho org | 2026-09-22 | accepted | [0059](0059-a-clients-history.md), [0070](0070-vendor-correctness.md) |
| [0051](0051-booking-from-the-site.md) | Booking from the site is the landing's booking | 2026-09-23 | accepted | [0060](0060-an-invited-friend-reaches-ops-and-the-crm.md), [0081](0081-the-site-takes-the-address.md), [0086](0086-the-next-visit-is-offered.md), [0089](0089-an-invite-is-not-lost.md) |
| [0052](0052-technician-sessions.md) | Technician sessions, devices and the day-before unlock | 2026-09-23 | accepted |  |
| [0053](0053-the-technician-app-offline.md) | The technician app offline: the outbox, the device and the camera | 2026-09-23 | accepted |  |
| [0054](0054-address-capture.md) | Capturing an address: the fields, the pin, and the way to the door | 2026-09-23 | accepted | [0070](0070-vendor-correctness.md), [0098](0098-the-door-in-fsms-address.md) |
| [0055](0055-invoices.md) | The invoice for a finished job | 2026-09-23 | accepted | [0056](0056-issuing-the-invoice.md) |
| [0056](0056-issuing-the-invoice.md) | The invoice is issued, and shown beside the visit | 2026-09-23 | accepted | [0070](0070-vendor-correctness.md) |
| [0057](0057-one-payment-per-tap.md) | One payment per tap | 2026-09-23 | accepted |  |
| [0058](0058-one-tap-per-intent.md) | One tap per intent | 2026-09-24 | accepted |  |
| [0059](0059-a-clients-history.md) | A client's history, and where a customer lives in the CRM | 2026-09-24 | accepted for the derivation, the ops console and the client app |  |
| [0060](0060-an-invited-friend-reaches-ops-and-the-crm.md) | An invited friend reaches ops and the CRM | 2026-09-24 | accepted |  |
| [0061](0061-ops-editable-inputs.md) | The business inputs ops change without a developer | 2026-09-24 | accepted | [0071](0071-what-ops-see-before-a-setting-changes.md), [0072](0072-ops-clients-and-queues.md), [0085](0085-services-ops-can-edit.md), [0086](0086-the-next-visit-is-offered.md), [0087](0087-consumables-and-stock.md), [0088](0088-every-policy-in-the-console.md) |
| [0062](0062-leave-on-the-dispatch-board.md) | Leave on the dispatch board | 2026-09-24 | accepted | [0074](0074-hand-offs-and-messages.md) |
| [0063](0063-the-asked-window.md) | The asked window and the offered one | 2026-09-24 | accepted | [0069](0069-dispatch-under-concurrency.md), [0070](0070-vendor-correctness.md), [0074](0074-hand-offs-and-messages.md), [0101](0101-phase-1s-path-into-fsm-removed.md) |
| [0064](0064-converting-a-request.md) | Converting a Request by API | 2026-09-24 | accepted | [0101](0101-phase-1s-path-into-fsm-removed.md) |
| [0065](0065-a-technicians-writes-reach-fsm.md) | A technician's writes reach FSM, in order, on a clock we can hold him to | 2026-09-25 | accepted | [0087](0087-consumables-and-stock.md) |
| [0066](0066-erasure-all-or-nothing.md) | Erasure is all or nothing | 2026-09-25 | accepted | [0094](0094-where-a-consent-was-given.md) |
| [0067](0067-alerts-and-silent-failures.md) | A failure that needs a person reaches one, once, with the IDs to act on | 2026-09-25 | accepted |  |
| [0068](0068-a-paid-hold-is-kept.md) | A paid hold is kept | 2026-09-25 | accepted | [0095](0095-a-booking-fsm-refuses-is-held.md) |
| [0069](0069-dispatch-under-concurrency.md) | Dispatch under concurrency | 2026-09-25 | accepted |  |
| [0070](0070-vendor-correctness.md) | What we write to Zoho is right, written once, and asked for sparingly | 2026-09-25 | accepted | [0104](0104-the-try-ons-look-on-whatsapp-only.md) |
| [0071](0071-what-ops-see-before-a-setting-changes.md) | What ops see before a setting changes, and who the console says they are | 2026-09-26 | accepted | [0086](0086-the-next-visit-is-offered.md) |
| [0072](0072-ops-clients-and-queues.md) | The ops console's clients and queues | 2026-09-26 | accepted | [0092](0092-task-owners.md) |
| [0073](0073-prices-from-the-price-book.md) | Prices from the price book, on the site and in FSM's catalogue | 2026-09-26 | accepted | [0085](0085-services-ops-can-edit.md), [0087](0087-consumables-and-stock.md), [0103](0103-the-home-pages-first-copy-round.md) |
| [0074](0074-hand-offs-and-messages.md) | What each person learns when something changes for them | 2026-09-26 | accepted | [0092](0092-task-owners.md), [0096](0096-a-no-shows-charge-and-its-dispute.md), [0099](0099-the-clients-note-in-fsm.md) |
| [0075](0075-tests-held-to-the-contract-and-the-local-stack.md) | Tests held to the API's contract, and the whole system on a laptop | 2026-09-27 | accepted |  |
| [0076](0076-one-ui-layer-and-one-api-client.md) | One component layer and one API client for the front ends | 2026-09-27 | accepted |  |
| [0077](0077-a-token-scale-written-once.md) | A token scale written once, and names for what a value is for | 2026-09-27 | accepted |  |
| [0078](0078-the-queues-no-board-draws.md) | The console's queues that no board draws | 2026-09-27 | accepted |  |
| [0079](0079-an-address-before-a-slot.md) | An address before any slot | 2026-09-27 | accepted |  |
| [0080](0080-consents-given-by-booking.md) | The photograph consents, given by booking | 2026-09-27 | accepted, for counsel to confirm before production | [0094](0094-where-a-consent-was-given.md) |
| [0081](0081-the-site-takes-the-address.md) | The site takes the address before it books | 2026-09-27 | accepted | [0098](0098-the-door-in-fsms-address.md) |
| [0082](0082-try-ons-in-the-app.md) | A client's try-on in the app | 2026-09-27 | accepted, on the owner's ruling of 27 September 2026 | [0084](0084-a-clients-try-on-is-kept.md) |
| [0083](0083-anyone-signed-in-can-refer.md) | Anyone signed in can refer | 2026-09-27 | withdrawn by the owner on 27 September 2026, the day it was made |  |
| [0084](0084-a-clients-try-on-is-kept.md) | A client's try-on is kept | 2026-09-27 | accepted, on the owner's ruling of 27 September 2026 | [0093](0093-the-storage-meter.md), [0104](0104-the-try-ons-look-on-whatsapp-only.md) |
| [0085](0085-services-ops-can-edit.md) | Services ops can edit | 2026-09-27 | accepted, on the owner's rulings of 27 September 2026 |  |
| [0086](0086-the-next-visit-is-offered.md) | The next visit is offered, and the client books it | 2026-09-27 | accepted | [0085](0085-services-ops-can-edit.md), [0105](0105-a-consultation-and-fit-in-one-visit.md) |
| [0087](0087-consumables-and-stock.md) | Consumables and their stock, and the job sheet, set in the console | 2026-09-27 | accepted, on the owner's rulings of 27 September 2026 | [0085](0085-services-ops-can-edit.md) |
| [0088](0088-every-policy-in-the-console.md) | Every policy in the console | 2026-09-28 | accepted, on the owner's standing rule of 27 September 2026 | [0095](0095-a-booking-fsm-refuses-is-held.md), [0096](0096-a-no-shows-charge-and-its-dispute.md) |
| [0089](0089-an-invite-is-not-lost.md) | An invite is not lost when the friend books away from its page | 2026-09-28 | accepted |  |
| [0092](0092-task-owners.md) | Whose each task is, a visit ops close without a follow-up, and an address given to ops | 2026-09-28 | accepted |  |
| [0093](0093-the-storage-meter.md) | The storage meter, the photograph upload limit, and thumbnails made on the phone | 2026-09-28 | accepted, on the owner's rulings of 27 September 2026 |  |
| [0094](0094-where-a-consent-was-given.md) | Where a consent was given, and an erasure blanks a check-in's coordinates | 2026-09-28 | accepted, on the owner's rulings of 27 September 2026 |  |
| [0095](0095-a-booking-fsm-refuses-is-held.md) | A booking FSM refuses is held, not refunded | 2026-09-29 | accepted, on the owner's ruling of 27 September 2026 | [0100](0100-a-refund-is-made-once.md) |
| [0096](0096-a-no-shows-charge-and-its-dispute.md) | A no-show's charge and its dispute, and the free change a visit ops moved keeps | 2026-09-29 | accepted, on the owner's rulings of 27 September 2026 | [0100](0100-a-refund-is-made-once.md) |
| [0097](0097-staging-logins-open-reminders-fenced.md) | Staging logins open, reminders fenced | 2026-09-30 | accepted |  |
| [0098](0098-the-door-in-fsms-address.md) | The door in FSM's service address | 2026-10-01 | accepted, on the owner's rulings of 27 September 2026 and 1 October 2026 |  |
| [0099](0099-the-clients-note-in-fsm.md) | The client's note in FSM | 2026-10-01 | accepted, on the owner's ruling of 27 September 2026 |  |
| [0100](0100-a-refund-is-made-once.md) | A refund is made once, however often it is asked for | 2026-10-01 | accepted |  |
| [0101](0101-phase-1s-path-into-fsm-removed.md) | Phase 1's path into FSM is removed, and no booking carries a Request | 2026-10-01 | accepted, on the owner's ruling of 1 October 2026 |  |
| [0102](0102-window-times.md) | The window times in the console | 2026-10-01 | accepted, on the owner's rulings of 30 September and 1 October 2026 |  |
| [0103](0103-the-home-pages-first-copy-round.md) | The home page's first copy round | 2026-10-01 | accepted |  |
| [0104](0104-the-try-ons-look-on-whatsapp-only.md) | The try-on's look on WhatsApp only | 2026-10-01 | accepted, on the owner's ruling D3 of 1 October 2026 |  |
| [0105](0105-a-consultation-and-fit-in-one-visit.md) | A consultation and fit in one visit | 2026-10-01 | accepted, on the owner's ruling D2 of 1 October 2026 and the rulings of the same day on the piece, the payment and the length |  |
| [0106](0106-a-clients-hair-profile.md) | A client's hair profile: the fit spec and their history | 2026-10-01 | accepted, on the owner's rulings of 1 October 2026 |  |
| [0107](0107-referral-rewards-in-the-console.md) | What a referral earns, set in the console, each side apart | 2026-10-01 | accepted, on the owner's ruling of 1 October 2026 |  |
| [0108](0108-discount-codes.md) | Discount codes | 2026-10-01 | accepted, on the owner's rulings of 1 October 2026 |  |

## Records beside them

- [Zoho FSM licensing for our own apps](fsm-licensing.md)
- [Zoho FSM trial findings](fsm-trial.md)
