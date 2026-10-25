# Start here

For a developer new to this code: an hour's reading, a map of where each feature lives, and a first change walked
through.

## The first hour

1. **[README.md](../README.md)** (10 minutes). The five Workers, what each serves, and the "Words" table.
2. **[walkthrough.md](walkthrough.md)** (15 minutes). Read "A client's life, step by step" and "Actions and what
   they change": the platform as its users meet it.
3. **[getting-started.md](getting-started.md)** (20 minutes). Run it all on your laptop, with stand-ins for every
   vendor:

   ```sh
   npm ci
   npm run db:local
   npm run db:seed:local
   npm run dev:all
   ```

   Book a visit in the client app (`http://app.localhost:4322`), find it in the ops console
   (`http://ops.localhost:4323`), and do it as the technician (`http://tech.localhost:4324`). Every login code is
   `246810`.

4. **[architecture.md](architecture.md)** (10 minutes). The seven layers of `src/`, and "Where a thing goes".
5. **[glossary.md](glossary.md)** (5 minutes). An appointment, a visit and a job are one thing, seen by three people.

Read [CONTRIBUTING.md](../CONTRIBUTING.md) before your first pull request.

## Where each feature lives

Each feature names its files by folder. A name without an extension is a `.ts` or `.tsx` file, and a name ending in
`/` is a folder. `test/node/architecture/start-here-map.test.ts` fails when a file in `src/domain/` is missing from
this map, or when the map names something that no longer exists.

### Booking a visit

- **Database work** (`src/domain/booking/`): `book-paid-hold`, `availability`, `open-windows`, `asked-windows`, `occupancy`, `slot-times`,
  `technician-choice`, `technician-rotation`, `hold-slot`, `holds`, `hold-stages`, `booked-hold`, `unbooked-holds`,
  `give-back`, `bookings`, `visit-booking`, `move-in-place`, `public-booking`, `public-consultation`, `site-notices`,
  `public-waitlist`, `public-lead`, `site-visit`, `form-person`, `proposed-visits`,
  `waitlist`, `services`, `remakes`, `start-offers` (the starts a visit may be booked at, and who can take each), `drive-check` (Google's drives either side of a start), `public-booking-code` (a site booking's discount code), `new-number-state` (what a new number booking is answered),
  `day-plans` (each technician's days as booking plans them), `packages` (each package and its figures, and when its
  visits fall due), `packages-console` (a package added, changed, ordered or deleted in the console), `client-prices`
  (a first fit priced by the hair system made to the client, and any visit's price from its parts)
- **Rules** (`src/policy/`): `booking`, `slot-times`, `site-booking`, `moving-a-visit`, `prepayment`, `services`,
  `visit-length`, `day-plan` (where a visit can start in a technician's day), `packages` (a visit's price from its
  parts, and a package's bounds)
- **Data** (`src/config/`): `booking`, `scheduling`, `visit-types`
- **Routes** (`src/routes/`): `client/booking`, `client/changes`, `public/consultations`, `public/forms`,
  `ops/slot-times`, `ops/services`, `ops/packages`, `ops/client-package`, `ops/waitlist`
- **Screens:** `apps/app/src/booking/`, `site/src/pages/book.astro`
- **Tests:** `test/worker/booking/`, `e2e/app/booking.e2e.ts`, `e2e/book.e2e.ts`, `e2e/ops/book-visit.e2e.ts`,
  `e2e/ops/waitlist.e2e.ts`

### A visit, and changing it

- **Database work** (`src/domain/visits/`): `visit-status`, `visit-times`, `visit-changes`, `visit-cancel`, `visit-facts`, `visit-paid`,
  `visit-begun`, `client-visits`, `client-photo-keys`, `client-history`, `check-ins`, `next-visit`, `follow-ups`, `consultation-recap`, `one-visit`,
  `hand-close`, `lost-reasons` (why a client is not going ahead after a consultation), `open-proposals`, `visit-upkeep` (what a write to a
  visit keeps up beside it),
  `no-show-notes`, `visit-story` (a visit's steps, for its drawer)
- **Rules** (`src/policy/`): `check-in`, `next-visit`, `follow-ups`, `one-visit`
- **Routes** (`src/routes/`): `client/visits`, `ops/visits`, `ops/visit-changes`, `ops/visit-lost-reason`, `ops/visit-story`
- **Screens:** `apps/app/src/visits/`, `apps/ops/src/clients/`
- **Tests:** `test/worker/booking/visit-*`, `test/worker/booking/next-visit.test.ts`, `e2e/app/changes.e2e.ts`,
  `e2e/app/next-visit.e2e.ts`

### Dispatch

- **Database work** (`src/domain/dispatch/`): `dispatch`, `move-proposals`, `dispatch-board`, `dispatch-landing`, `dispatch-utilisation`, `unassigned`, `technicians`, `technician-fit`, `technician-roster`,
  `technician-work`, `technician-days` (a technician's own week and home), `leave`, `leave-requests` (a technician's
  ask for leave, decided on Tasks), `blackouts`, `day-route`, `nearest`
- **Rules** (`src/policy/`): `dispatch`, `technician-work`, `start-times`, `drive-estimate`, `reach` (how far a technician goes from home)
- **Vendor** (`src/providers/`): `routes/`
- **Routes** (`src/routes/`): `ops/dispatch`, `ops/dispatch-moves`, `ops/dispatch-day`, `ops/blackouts`, `ops/technicians`,
  `ops/technician-leave`, `ops/leave-requests`, `ops/technician-phones`
- **Screens:** `apps/ops/src/dispatch/`, `apps/ops/src/technicians/`
- **Tests:** `test/worker/dispatch/dispatch.test.ts`, `test/worker/field/field-dispatch.test.ts`,
  `e2e/ops/dispatch.e2e.ts`, `e2e/ops/technicians.e2e.ts`

### Technicians' pay

- **Database work** (`src/domain/field/`): `technician-pay`, `pay-statement` (the month's pay at those rates, and its CSV)
- **Routes** (`src/routes/`): `ops/technician-pay`
- **Screens:** `apps/ops/src/technician-pay/TechnicianPay.tsx`, `apps/ops/src/technician-pay/PayRates.tsx`,
  `apps/ops/src/technician-pay/PayForms.tsx`
- **Tests:** `test/worker/dispatch/technician-pay.test.ts`, `e2e/ops/technician-pay.e2e.ts`

### The technician's work in the field

- **Database work** (`src/domain/field/`): `tech-jobs`, `job-card`, `workable-job`, `job-events`, `job-event-bodies`,
  `job-record`, `job-use`, `consumable-shortfalls` (a job short of what its service expects, and why), `job-sheet-settings`, `tech-photos`, `visit-photos`, `photo-views`, `job-options` (a
  consultation's packages, prices and the client's try-on looks)
- **Rules** (`src/policy/`): `in-job-steps`, `piece-step`, `job-visibility`, `phone-clock`, `consumable-shortfall`
- **Data** (`src/config/`): `job-sheet`, `pieces`
- **Routes** (`src/routes/`): `tech/`, `ops/field`, `ops/client-pieces`, `ops/job-sheet`
- **Screens:** `apps/tech/src/`
- **Tests:** `test/worker/field/`, `e2e/tech/`, `e2e/ops/job-sheet.e2e.ts`

### Inventory: what we hold, where, and what it is

- **Database work** (`src/domain/inventory/`): `stock`, `stock-places`, `stock-lots`, `stock-units`, `stock-transit`,
  `stock-view`, `stock-photos`, `stock-match`, `stock-risks`, `stock-usage`, `stock-quality`, `stock-watch`,
  `stock-gap`, `low-stock`, `pieces`, `piece-use`, `piece-returns`, `returned-pieces`, `kit`, `kit-check`, `kit-week`,
  `cycle-counts`, `count-tasks`, `count-labels`, `recalls`, `recall-notice`, `consumables`, `hair-systems`,
  `hair-system-names`
- **Rules** (`src/policy/`): `stock`
- **Data** (`src/config/`): `consumables`
- **Routes** (`src/routes/`): `ops/stock`, `ops/stock.places`, `ops/stock.transit`, `ops/stock.read`, `ops/stock.units`,
  `ops/stock.schemas`, `ops/stock-match`, `ops/count-tasks`, `ops/stock-usage`, `ops/recalls`, `ops/stock-quality`,
  `ops/consumables`, `ops/hair-systems`
- **Screens:** `apps/ops/src/stock/`, `apps/ops/src/items/`, `apps/ops/src/kit/`, `apps/ops/src/counts/`,
  `apps/ops/src/quality/`, `apps/ops/src/usage/`, and the technician app's kit, `apps/tech/src/kit/`
- **Tests:** `test/worker/inventory/`, `e2e/ops/stock.e2e.ts`,
  `e2e/ops/consumables.e2e.ts`, `e2e/ops/counts.e2e.ts`, `e2e/ops/quality.e2e.ts`, `e2e/ops/usage.e2e.ts`

### Purchasing: suppliers, orders and the supply plan

- **Database work** (`src/domain/purchasing/`): `suppliers`, `purchase-orders`, `letterhead`, `receipts`, `supplier-claims`,
  `supplier-scorecard`, `custom-orders`, `custom-order-po`, `forecast`, `forecast-layers`, `forecast-accuracy`,
  `supply-plan`, `supply-plan-lines`, `demand-events`, `stock-demand`
- **Routes** (`src/routes/`): `ops/suppliers`, `ops/purchasing`, `ops/purchasing.receipts`, `ops/purchasing.claims`,
  `ops/purchasing.photos`, `ops/purchasing.scorecard`, `ops/custom-orders`, `client/custom-orders`,
  `ops/stock-forecast`, `ops/supply-plan`, `ops/demand-events`
- **Screens:** `apps/ops/src/purchasing/`, `apps/ops/src/suppliers/`, `apps/ops/src/supply-plan/`
- **Tests:** `test/worker/ops/`, `e2e/ops/purchasing.e2e.ts`, `e2e/ops/supply-plan.e2e.ts`

### Cities, their GST and what a city sets apart

- **Database work** (`src/domain/cities/`): `cities` (each city, its state and zone, where a visit, a pincode or a
  client is), `city-changes` (a city added, changed or renamed), `city-rules` (the rules a city sets for itself),
  `gst-registrations` (a state's registration, and what supplies a visit), `served-cities` (the cities and areas the
  public site says it comes to), `pincode-centres` (each pincode's centre, placed hourly)
- **Rules** (`src/policy/`): `city-settings`
- **Data** (`src/config/`): `gst`
- **Routes** (`src/routes/`): `ops/cities`
- **Tests:** `test/worker/ops/cities.test.ts`, `test/node/policy/gst.test.ts`

### No-shows and disputes

- **Database work** (`src/domain/no-shows/`): `no-shows`, `no-show-disputes`, `no-show-rulings`,
  `ruling-claims`, `after-a-ruling`, `door-evidence` (the note and photograph of the door a no-show is sent with)
- **Rules** (`src/policy/`): `no-show`
- **Routes** (`src/routes/`): `client/disputes`, `ops/disputes`, `ops/no-shows`, `ops/no-show-rulings`
- **Screens:** `apps/ops/src/payments/`
- **Tests:** `test/worker/field/field-no-show.test.ts`, `test/worker/money/no-show-disputes.test.ts`,
  `e2e/app/no-show-dispute.e2e.ts`, `e2e/ops/no-shows.e2e.ts`

### Money

- **Database work** (`src/domain/money/`): `payments`, `payment-links`, `payment-links-paid`, `client-payments`,
  `client-billing`, `refunds`, `auto-refunds`, `cancel-refunds`, `credits`, `credit-reminders`, `discount-codes`,
  `discount-code-holds`, `discount-code-uses`, `discount-code-visits`, `discount-code-figures`, `requested-codes`,
  `day-money`, `payment-ledger` (Finance's ledger of payments and unpaid links), `one-visit-money`, `price-book`, `price-lookup` (a price in force, the city's own first), `hair-system-prices` (what each hair system sells for), `city-prices`,
  `razorpay-catch-up`, `razorpay-events` (Razorpay's events, applied from their queue), `custom-order-links`,
  `custom-order-refunds`, `payment-refunds`, `upi-payments` (a visit paid by UPI at the visit, recorded by ops)
- **Rules** (`src/policy/`): `prices`, `prepayment`, `pay-by-link`, `discount-codes`, `credit-reminders`,
  `fraud-holds`
- **Data** (`src/config/`): `gst`
- **Vendor** (`src/providers/`): `payments/`
- **Routes** (`src/routes/`): `client/payments`, `client/discount-codes`, `ops/payments`, `ops/payment-links`,
  `ops/credits`, `ops/discount-codes`, `hooks/razorpay`
- **Screens:** `apps/app/src/payments/`
- **Tests:** `test/worker/money/`, `e2e/app/checkout-policy.e2e.ts`

### Books, the accounts

- **Database work** (`src/domain/books/`): `books-*`, `receipt-supply`, `vendor-pass`
- **Vendor** (`src/providers/`): `books/`
- **Tests:** `test/worker/vendors/books-*`

### Clients

- **Database work** (`src/domain/clients/`): `people`, `contact-updates` (what a CRM lead is still owed), `client-list`, `client-documents` (their invoices and receipts, kept once viewed), `profile`, `fitted`, `hair-profiles`, `client-package` (the package a client is on), `client-notes`, `staff-notes` (staff's notes on a client),
  `address-change`, `number-change`, `number-codes`, `home-prompt`, `places`, `area-names`, `service-area`,
  `pincode-directory` (India Post's pincodes, which ops open a city from), `pincode-launches` (launches scheduled for
  a later day), `launch-runs` (those due, served by the cron on the day), `pincode-reach` (a city's
  technicians, their reach from home, and its pincodes with whoever reaches each), `launch-readiness` (what a city needs first, a pause, what stopping leaves)
- **Rules** (`src/policy/`): `hair-profile`, `address-change`, `number-proof`, `client-notes`, `staff-notes`, `home-prompt`,
  `area-names` (what an area may be called, and the name a post office gives it)
- **Vendor** (`src/providers/`): `geocode/`
- **Routes** (`src/routes/`): `client/me`, `client/profile`, `client/notes`, `ops/clients`, `ops/client-record`,
  `ops/client-photos`, `ops/client-consents`, `ops/client-address`, `ops/service-area`, `ops/pincode-directory`, `ops/pincode-launches`, `ops/pincode-reach`, `ops/hair-profile`, `ops/staff-notes`, `ops/profile`,
  `public/number-codes`
- **Screens:** `apps/app/src/home/`, `apps/app/src/profile/`, `apps/ops/src/clients/`,
  `apps/ops/src/number-changes/`, `apps/ops/src/areas/`
- **Tests:** `test/worker/app/client-*`, `test/worker/ops/ops-clients.test.ts`, `e2e/ops/clients.e2e.ts`,
  `e2e/ops/number-changes.e2e.ts`, `e2e/app/profile.e2e.ts`

### Leads and the CRM

- **Database work** (`src/domain/leads/`): `leads`, `lead-notice`
- **Data** (`src/config/`): `crm`, `pipeline`
- **Vendor** (`src/providers/`): `crm/`
- **Jobs** (`src/queues/`): `crm-sync`
- **Tests:** `test/worker/vendors/crm-*`

### Referrals

- **Database work** (`src/domain/referrals/`): `refer-page` (what Refer reads), `referrals`, `referral-grants`, `referral-cards`, `referral-messages`,
  `invite-lookups`, `channels`, `channel-grants`, `partner-statements`
- **Rules** (`src/policy/`): `referral-reward`, `invites`
- **Data** (`src/config/`): `referral-cards`, `invite-codes`, `house-card`, `card-overlay`
- **Routes** (`src/routes/`): `client/refer`, `ops/referrals`, `ops/client-referral`, `ops/referral-channels`,
  `ops/partner-statements`, `public/referral-landing`, `public/referral-reward`
- **Screens:** `apps/app/src/refer/`, `apps/ops/src/referrals/`, `site/src/pages/r/`, `site/src/islands/invite/`
- **Tests:** `test/worker/referrals/`, `e2e/app/refer.e2e.ts`, `e2e/refer-landing.e2e.ts`, `e2e/ops/referrals.e2e.ts`

### The try-on

- **Database work** (`src/domain/try-on/`): `tryon-uploads` (a photograph's one write, claimed), `tryon`, `tryon-claims`, `client-try-ons`, `kept-try-ons`,
  `photo`
- **Rules** (`src/policy/`): `tryon-delivery`, `kept-try-ons`
- **Data** (`src/config/`): `tryon`
- **Vendor** (`src/providers/`): `image/`
- **Jobs** (`src/queues/`): `render`
- **Routes** (`src/routes/`): `public/tryon-*`
- **Screens:** `site/src/pages/try.astro`, `site/src/islands/tryon/`, `apps/app/src/photos/`
- **Tests:** `test/worker/site/tryon-*`, `test/worker/app/client-try-ons.test.ts`, `e2e/try*`,
  `e2e/app/try-on.e2e.ts`

### Privacy

- **Database work** (`src/domain/privacy/`): `consents`, `booking-consents`, `deletion`, `erasure`, `erasure-statements`,
  `erasure-files`, `data-export`, `my-data-page`, `retention`, `terms-acceptances`
- **Rules** (`src/policy/`): `consents`, `account-deletion`, `retention`, `personal-data`
- **Data** (`src/config/`): `notices`, `my-data`, `legal-versions`
- **Routes** (`src/routes/`): `client/data`, `ops/erasure`
- **Jobs** (`src/scheduled/`): `retention`
- **Screens:** `apps/app/src/profile/`, `apps/ops/src/deletion-requests/`
- **Tests:** `test/worker/privacy/`, `e2e/ops/deletions.e2e.ts`

### Messages

- **Database work** (`src/domain/messages/`): `queued-messages`, `visit-messages`, `visit-message-text`, `technician-updates` (a word from the job card), `move-proposal-text`, `stop-messages`, `inbound` (what any provider reports, in one shape),
  `paced-line`
- **Rules** (`src/policy/`): `message-pacing`
- **Data** (`src/config/`): `message-templates`, `message-kinds`
- **Vendor** (`src/providers/`): `messaging/`
- **Jobs:** `src/queues/messaging`, `src/scheduled/unsent-messages`, `src/scheduled/whatsapp-bridge`
- **Routes** (`src/routes/`): `public/stop-messages`, `hooks/evolution`
- **Screens:** `site/src/pages/stop.astro`
- **Tests:** `test/worker/messages/`

### The Care inbox

- **Database work** (`src/domain/care/`): `inbox`, `replies`, `care-people` (each client's named Care person), `chat-tasks` (a chat past its reply-by time, on Tasks), `after-hours` (the answer to a message sent while Care are off), `cover` (the team's days off and who covers them), `city-matters` (what Care send to a client's city), `strangers` (a chat from a number we don't know, linked or saved), `quick-replies` (saved answers), `remedies` (free visits Care give, and their approval), `care-numbers` (whether the same-day promise holds), `app-reports` (something wrong told from the app), `chat-archive` (a client's thread quiet a year, moved to the backups bucket)
- **Routes** (`src/routes/`): `ops/conversations`, `ops/care-people`, `ops/care-rota`, `ops/city-matters`, `ops/strangers`, `ops/quick-replies`, `ops/remedies`, `ops/care-numbers`, `hooks/evolution` (files what clients write), `client/problems`
- **Screens:** `apps/ops/src/care/` (Messages, the thread, its client panel, City matters, remedies, quick replies, the Care team and its numbers)
- **Tests:** `test/worker/care/`, `test/dom/ops-messages.test.ts`, `test/dom/ops-care-numbers.test.ts`, `e2e/ops/messages.e2e.ts`

### Reports

- **Database work** (`src/domain/analytics/`): `nightly` (the copy Zoho Analytics reads, once a night), `funnel` (the Funnel page), `rows`
  (what each of its tables holds), `capacity` (each technician's day, from the dispatch board), `message-days`,
  `care-cases` (grievances and tasks, opened and closed), `leads`, `spend` (offline spend, partner payments and
  invites' free visits), `client-months` (where each client stood each month), `stock` (the stock ledger, and each week's position),
  `credits` (free visits given, used and owed), `pieces` (each hair system fitted, and the areas), `targets`, `access` (who may read what, from the Staff list),
  `client-key` (a client as the copy knows them)
- **Database work** (`src/domain/money/`): `spend` (offline spend, as typed on the Spend page), `standard-costs`
  (what each hair system costs us)
- **Rules** (`src/policy/`): `channels` (how a lead found us, and a campaign's city), `client-standing` (active,
  lapsed or lost)
- **Routes** (`src/routes/`): `ops/spend`, `ops/funnel`
- **Screens:** `apps/ops/src/spend/`
- **Vendor** (`src/providers/`): `warehouse/` (Supabase's Postgres, or the stub)
- **Jobs:** `src/scheduled/analytics.ts`
- **Schema:** `warehouse/migrations/`, applied by `scripts/ops/warehouse-migrate.ts`
- **Tests:** `test/worker/jobs/analytics-nightly.test.ts`, `test/node/api/warehouse-postgres.test.ts`

### The Words page

- **Database work** (`src/domain/words/`): `catalogue`, `words`, `publish`, `message-wording`
- **Rules** (`src/policy/`): `word-checks`
- **Data** (`src/config/`): `words.json`, which npm run words writes from the site's copy and the message texts
- **Routes** (`src/routes/`): `ops/words`, `public/site-words`
- **Build:** `scripts/lib/site-words.ts` reads the published words for a site build; `site/src/lib/published-words.ts`
  lays them over the copy; `.github/workflows/site-words.yml` rebuilds staging's site after a publish
- **Tests:** `test/worker/words/words.test.ts`, `test/node/words/`, `test/node/policy/word-checks.test.ts`

### Ops' own work

- **Database work** (`src/domain/ops/`): `needs-a-hand`, `alert-names`, `tasks`, `task-queues` (the board's queues), `task-facts` (what each task turns on),
  `task-reach` (whose cities each is in), `task-closures`, `task-owners`, `grievances`, `activity`, `staff`,
  `task-spans` (when each task opened and closed), `targets` (each month's plan, city by city)
- **Rules** (`src/policy/`): `tasks`, `alerts`, `grievances`, `ops-settings`, `console-routes`, `access`,
  `decision-reasons`
- **Routes** (`src/routes/`): `ops/alerts`, `ops/tasks`, `ops/grievances`, `ops/settings`, `ops/staff`,
  `ops/whoami`, `ops/storage`, `ops/activity`, `ops/targets`
- **Screens:** `apps/ops/src/tasks/`, `apps/ops/src/grievances/`, `apps/ops/src/settings/`, `apps/ops/src/activity/`,
  `apps/ops/src/targets/`
- **Tests:** `test/worker/ops/`, `e2e/ops/tasks.e2e.ts`, `e2e/ops/grievances.e2e.ts`, `e2e/ops/settings.e2e.ts`,
  `e2e/ops/staff.e2e.ts`

### Signing in

- **Database work** (`src/domain/sign-in/`): `login`, `sessions`, `one-time-codes`, `rate-limit`
- **Rules** (`src/policy/`): `one-time-code`, `rate-limits`
- **Data** (`src/config/`): `limits`
- **Vendor** (`src/providers/`): `codes`, `turnstile`, `cloudflare-access`
- **Routes** (`src/routes/`): `client/auth`, `client/sessions`, `tech/auth`
- **Screens:** `apps/app/src/login/`, `apps/tech/src/login/`
- **Tests:** `test/worker/app/client-auth.test.ts`, `test/worker/app/client-sessions.test.ts`,
  `test/worker/app/one-time-codes.test.ts`, `test/worker/field/tech-auth.test.ts`, `e2e/app/login.e2e.ts`

### The platform

- **Database work** (`src/domain/platform/`): `audit` (the audit log every write adds to), `alerts`, `road-drives` (Google's drives between pins, kept a day), `vendor-breakers` (a vendor held off while it keeps failing), `ops-settings`
  (the Rules every module reads), `cron-runs`, `backups`, `maintenance`, `storage-meter`, `ceilings`, `test-records`,
  `enqueue`
- **Rules** (`src/policy/`): `database-size`, `storage-share`, `launch`, `staging-test-records`
- **Jobs:** `src/scheduled/`, `src/queues/consumer`
- **Routes** (`src/routes/`): `health`
- **Tests:** `test/worker/jobs/`, `test/worker/platform/`

## Your first change

Say the rule for deleting an account changes: a request must now be decided within a different number of days.
Here is how to find everything that change touches.

1. **Find the rule.** The map puts deletion under Privacy, and its rules in `src/policy/account-deletion.ts`. The
   number is `DELETION_DECIDED_WITHIN_DAYS`.
2. **Find who reads it.** Search for the name:

   ```sh
   git grep -n DELETION_DECIDED_WITHIN_DAYS -- src apps site
   ```

   `src/domain/privacy/deletion.ts` alerts ops a few days before the deadline. `src/policy/tasks.ts` gives the ops task its
   deadline.

3. **Find the words that state it.** Copy says the number in words, so searching for the name misses it. Search for
   the number in the content files instead: `apps/app/src/content/`, `site/src/content/` and
   `apps/ops/src/content/`. The decision behind it is `docs/decisions/0049-dpdp.md`.
4. **Change the tests.** `test/node/policy/policy-account-deletion.test.ts` and
   `test/node/site/site-content.test.ts` pin the number. `test/worker/privacy/erasure.test.ts` ages a request past
   the alert. Run just those:

   ```sh
   npx vitest run --project node test/node/policy/policy-account-deletion.test.ts test/node/site/site-content.test.ts
   npx vitest run --project worker test/worker/privacy/erasure.test.ts
   ```

5. **Open the pull request.** `src/policy/account-deletion.ts` is personal data, so the pull request waits for the
   `reviewed` label (`SENSITIVE_PATHS` in `scripts/lib/auto-merge.ts`), which whoever lands it gives once they have
   read it through (CONTRIBUTING.md, "When a person must look"). CI runs everything else.

## What changes without a release

Prices, slot times, the hold's length, services, discount codes and many other settings are ops' to change in the
console's Settings, not yours in code. `src/policy/ops-settings.ts` lists each one with its limits. Check there before
changing a number in code.
