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

- **Database work** (`src/domain/booking/`): `availability`, `open-windows`, `asked-windows`, `occupancy`, `slot-times`,
  `technician-choice`, `technician-rotation`, `hold-slot`, `holds`, `hold-stages`, `booked-hold`, `unbooked-holds`,
  `give-back`, `bookings`, `visit-booking`, `move-in-place`, `public-booking`, `public-consultation`,
  `public-waitlist`, `site-visit`, `form-person`, `proposed-visits`,
  `waitlist`, `services`
- **Rules** (`src/policy/`): `booking`, `slot-times`, `site-booking`, `moving-a-visit`, `prepayment`, `services`,
  `visit-length`
- **Data** (`src/config/`): `booking`, `scheduling`, `visit-types`
- **Routes** (`src/routes/`): `client/booking`, `client/changes`, `public/consultations`, `public/forms`,
  `ops/slot-times`, `ops/services`, `ops/waitlist`
- **Screens:** `apps/app/src/booking/`, `site/src/pages/book.astro`
- **Tests:** `test/worker/booking/`, `e2e/app/booking.e2e.ts`, `e2e/book.e2e.ts`, `e2e/ops/book-visit.e2e.ts`,
  `e2e/ops/waitlist.e2e.ts`

### A visit, and changing it

- **Database work** (`src/domain/visits/`): `visit-status`, `visit-times`, `visit-changes`, `visit-cancel`, `visit-facts`,
  `visit-begun`, `client-visits`, `client-history`, `check-ins`, `next-visit`, `one-visit`, `hand-close`
- **Rules** (`src/policy/`): `check-in`, `next-visit`, `one-visit`
- **Routes** (`src/routes/`): `client/visits`, `ops/visits`, `ops/visit-changes`
- **Screens:** `apps/app/src/visits/`, `apps/ops/src/clients/`
- **Tests:** `test/worker/booking/visit-*`, `test/worker/booking/next-visit.test.ts`, `e2e/app/changes.e2e.ts`,
  `e2e/app/next-visit.e2e.ts`

### Dispatch

- **Database work** (`src/domain/dispatch/`): `dispatch`, `dispatch-board`, `dispatch-landing`, `dispatch-utilisation`, `technicians`, `technician-roster`,
  `technician-work`, `leave`, `blackouts`, `cities`
- **Rules** (`src/policy/`): `dispatch`, `technician-work`
- **Routes** (`src/routes/`): `ops/dispatch`, `ops/dispatch-moves`, `ops/blackouts`, `ops/technicians`,
  `ops/technician-leave`, `ops/technician-phones`
- **Screens:** `apps/ops/src/dispatch/`, `apps/ops/src/technicians/`
- **Tests:** `test/worker/ops/dispatch.test.ts`, `test/worker/field/field-dispatch.test.ts`,
  `e2e/ops/dispatch.e2e.ts`, `e2e/ops/technicians.e2e.ts`

### The technician's work in the field

- **Database work** (`src/domain/field/`): `tech-jobs`, `job-card`, `workable-job`, `job-events`, `job-event-bodies`, `job-record`, `job-use`,
  `job-sheet-settings`, `tech-photos`, `visit-photos`, `photo-views`, `pieces`, `stock`, `low-stock`, `consumables`
- **Rules** (`src/policy/`): `in-job-steps`, `piece-step`, `job-visibility`, `phone-clock`, `stock`
- **Data** (`src/config/`): `job-sheet`, `pieces`, `consumables`
- **Routes** (`src/routes/`): `tech/`, `ops/field`, `ops/client-pieces`, `ops/stock`, `ops/consumables`, `ops/job-sheet`
- **Screens:** `apps/tech/src/`, `apps/ops/src/stock/`
- **Tests:** `test/worker/field/`, `e2e/tech/`, `e2e/ops/stock.e2e.ts`, `e2e/ops/consumables.e2e.ts`,
  `e2e/ops/job-sheet.e2e.ts`

### No-shows and disputes

- **Database work** (`src/domain/no-shows/`): `no-shows`, `no-show-notes`, `no-show-disputes`, `no-show-rulings`,
  `ruling-claims`, `after-a-ruling`
- **Rules** (`src/policy/`): `no-show`
- **Routes** (`src/routes/`): `client/disputes`, `ops/disputes`, `ops/no-shows`, `ops/no-show-rulings`
- **Screens:** `apps/ops/src/no-shows/`
- **Tests:** `test/worker/field/field-no-show.test.ts`, `test/worker/money/no-show-disputes.test.ts`,
  `e2e/app/no-show-dispute.e2e.ts`, `e2e/ops/no-shows.e2e.ts`

### Money

- **Database work** (`src/domain/money/`): `payments`, `payment-links`, `client-payments`, `client-billing`, `refunds`,
  `auto-refunds`, `cancel-refunds`, `credits`, `credit-reminders`, `discount-codes`, `discount-code-holds`,
  `discount-code-uses`, `discount-code-visits`, `requested-codes`, `day-money`, `one-visit-money`, `price-book`,
  `razorpay-catch-up`
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

- **Database work** (`src/domain/clients/`): `people`, `profile`, `fitted`, `hair-profiles`, `client-notes`,
  `address-change`, `number-change`, `number-codes`, `home-prompt`, `places`, `area-names`, `service-area`
- **Rules** (`src/policy/`): `hair-profile`, `address-change`, `number-proof`, `client-notes`, `home-prompt`
- **Vendor** (`src/providers/`): `geocode/`
- **Routes** (`src/routes/`): `client/me`, `client/profile`, `client/notes`, `ops/clients`, `ops/client-record`,
  `ops/client-photos`, `ops/client-consents`, `ops/client-address`, `ops/service-area`, `ops/hair-profile`, `ops/profile`,
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

- **Database work** (`src/domain/referrals/`): `referrals`, `referral-grants`, `referral-cards`, `referral-messages`,
  `invite-lookups`
- **Rules** (`src/policy/`): `referral-reward`, `invites`
- **Data** (`src/config/`): `referral-cards`, `invite-codes`, `house-card`, `card-overlay`
- **Routes** (`src/routes/`): `client/refer`, `ops/referrals`, `ops/client-referral`, `public/referral-landing`,
  `public/referral-reward`
- **Screens:** `apps/app/src/refer/`, `apps/ops/src/referrals/`, `site/src/pages/r/`, `site/src/islands/invite/`
- **Tests:** `test/worker/referrals/`, `e2e/app/refer.e2e.ts`, `e2e/refer-landing.e2e.ts`, `e2e/ops/referrals.e2e.ts`

### The try-on

- **Database work** (`src/domain/try-on/`): `tryon`, `tryon-claims`, `client-try-ons`, `kept-try-ons`, `render-choice`,
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
  `erasure-files`, `data-export`, `my-data-page`, `retention`
- **Rules** (`src/policy/`): `consents`, `account-deletion`, `retention`, `personal-data`
- **Data** (`src/config/`): `notices`, `my-data`
- **Routes** (`src/routes/`): `client/data`, `ops/erasure`
- **Jobs** (`src/scheduled/`): `retention`
- **Screens:** `apps/app/src/profile/`, `apps/ops/src/deletions/`
- **Tests:** `test/worker/privacy/`, `e2e/ops/deletions.e2e.ts`

### Messages

- **Database work** (`src/domain/messages/`): `queued-messages`, `visit-messages`, `visit-message-text`, `stop-messages`,
  `paced-line`
- **Rules** (`src/policy/`): `message-pacing`
- **Data** (`src/config/`): `message-templates`, `message-kinds`
- **Vendor** (`src/providers/`): `messaging/`
- **Jobs:** `src/queues/messaging`, `src/scheduled/unsent-messages`, `src/scheduled/whatsapp-bridge`
- **Routes** (`src/routes/`): `public/stop-messages`, `hooks/evolution`
- **Screens:** `site/src/pages/stop.astro`
- **Tests:** `test/worker/messages/`

### Ops' own work

- **Database work** (`src/domain/ops/`): `alerts`, `needs-a-hand`, `tasks`, `task-closures`, `task-owners`,
  `grievances`, `ops-settings`, `site-notices`, `audit`, `staff`
- **Rules** (`src/policy/`): `tasks`, `alerts`, `grievances`, `ops-settings`, `console-routes`, `access`,
  `decision-reasons`
- **Routes** (`src/routes/`): `ops/alerts`, `ops/tasks`, `ops/grievances`, `ops/settings`, `ops/staff`,
  `ops/whoami`, `ops/storage`
- **Screens:** `apps/ops/src/tasks/`, `apps/ops/src/grievances/`, `apps/ops/src/settings/`
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

- **Database work** (`src/domain/platform/`): `cron-runs`, `maintenance`, `storage-meter`, `ceilings`, `test-records`,
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

5. **Open the pull request.** `src/policy/account-deletion.ts` is personal data, so the pull request waits for a
   person's `reviewed` label (`SENSITIVE_PATHS` in `scripts/lib/auto-merge.ts`). CI runs everything else.

## What changes without a release

Prices, slot times, the hold's length, services, discount codes and many other settings are ops' to change in the
console's Settings, not yours in code. `src/policy/ops-settings.ts` lists each one with its limits. Check there before
changing a number in code.
