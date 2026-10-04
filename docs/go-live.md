# Going live

The checklist that takes Phase 1 and Phase 2 to production, in the order the owner ruled on 27 September 2026: **the site first, the apps later** (`docs/open-points.md`, item 82). The site's release puts the public site, the try-on and booking a consultation on `maneman.in`; the apps' release puts the client app, the technician app, the ops console and payments on theirs.

Nothing reaches production while a point in `docs/open-points.md` is open, except its engineering follow-ups. Each step here names the point it closes, who does it, and the section of `docs/runbook.md` (RB) that has the commands. `W` is `node node_modules/wrangler/bin/wrangler.js`. Tick a box when the step is done, and record the date where the open point says so.

## Where production stands, 27 September 2026

- **Code:** 268eaa4, of 21 September 2026, with migrations to 0004. The next release carries every migration since.
- **Surfaces:** the public surface alone (`ENABLED_SURFACES`, `src/config/environments.ts`); `mm-site` serves `site/placeholder/production`.
- **Providers** (`wrangler.jsonc`, `env.production.vars`): CRM `zoho`, WhatsApp `evolution` with `MESSAGING_ENABLED` `"false"`, FSM, Books, payments and the geocoder `none`, `SELF_SERVE_BOOKING` `"false"`.
- **Apps:** `mm-app-production` exists with no route. The release leaves every app alone until its surface is switched on (item 152, fixed 27 September 2026).

## 1. Now, in parallel

Nothing here needs a release. The first two have dates.

**The owner**

- [ ] **Subscribe before the trials end, on or about 7 October 2026:** FSM Professional for 100 appointments a month, and Books Standard (items 18 and 4). After that date FSM drops to Free, which has no assets or job sheets.
- [ ] **Start Razorpay's KYC** for live mode (item 6); it takes days and gates every live payment.
- [ ] **Start DLT registration** for SMS login codes (item 37): the entity, a sender ID and the login-code template.
- [ ] **A dedicated WhatsApp number** on its own Evolution instance, its webhook to us (item 38; RB 12, and "The WhatsApp number is banned" for moving a number).
- [ ] **Fix staging's Google key** (item 54; RB 13): in Google Cloud, on the key's project, enable the **Places API (New)** and the **Geocoding API**; link billing; restrict the key to those two APIs and give it **no application restriction by website**, since our server calls it; set the quotas RB 13 lists. Then save an address on app-staging with a building chosen from the list and check it carries a pin (RB 13, "If the address search misbehaves").
- [ ] **Buy GitHub Team** (items 88 and 89), then require every `ci.yml` job on `main`, limit the `production` environment to `main`, and delete merged branches. Check whether required reviewers on a private repository's environment need a higher plan.
- [ ] **Zoho tokens** (RB 8 and 11b.1): a Self Client refresh token for scripts and proofs alone (item 32); the CRM token again with `ZohoCRM.modules.contacts.ALL` (item 21); and every token with only the scopes its sync uses (item 36).
- [ ] **The CRM** (RB 8): `node --env-file=.env.crm-<env> scripts/setup-crm.ts --check`, then without `--check`, then `node --env-file=.env.worker-<env> scripts/check-zoho-setup.ts` (item 34); and, by hand, the one workflow rule: contact consent becoming true assigns an owner, nothing firing for "Try-on — delivery only" (item 35).
- [ ] **FSM's settings:** "Allow overlapping appointments" off (item 29); your own mobile number on your FSM user, so you sign in to the technician app as the sync lists you (item 27); each technician as an FSM user with his mobile number and his territory (item 27).
- [ ] **Books:** delete the receipt `4242595000000065003`, which a proof seeded for a payment that never happened (item 19); add a bank account "Razorpay – staging test" and give its ID to ops for staging's `BOOKS_REFUND_ACCOUNT_ID` (item 10).
- [ ] **Staging's invite previews:** in Cloudflare Zero Trust, an Access application for `staging.maneman.in` with a Bypass / Everyone policy on the paths `r/`, `images/` and `api/og/`, so WhatsApp can fetch an invite's page and card (RB 10b, with the check that WhatsApp's crawler gets through; RB 10 has the same for `api/result/`).
- [ ] **Material and words:** the home page's cleared material (items 73 to 81); the house referral card, 1200 x 630 under 300 KB (item 52); the Grievance Officer's name and address for the privacy page (item 51); the GA4 and Meta Pixel IDs (item 84); your wording in the texts file (items 39, 41, 42 and 45).
- [ ] **Counsel and the CA:** send each their brief (counsel: items 22, 23, 40, 41, 44, 55, 63, 69, 146, 148 and 149; the CA: items 2, 3, 9, 14, 16 and 17).

**Ops, or a developer with the Cloudflare account**

- [ ] **Production's resources** (items 85 and 86; RB 1):

  ```sh
  W queues create mm-fsm-sync-prod
  W r2 bucket create mm-prod-client-photos --location apac
  W r2 bucket create mm-prod-referral-cards --location apac
  node --env-file=.env.cf-read scripts/check-buckets.ts production --strict
  W queues list
  ```

- [ ] **Production's AILabTools key** (item 153): `W secret put AILAB_API_KEY --env production`, with a key of production's own.
- [ ] **Staging's refund account:** the owner's "Razorpay – staging test" ID as `BOOKS_REFUND_ACCOUNT_ID` in `env.staging.vars`, released through CI (item 10).
- [ ] **Staging's cron heartbeat** (RB, "The outside watchers", point 1): a healthchecks.io check, its ping URL as staging's `HEARTBEAT_URL`; and Account Analytics: Read on `mm-ci-staging`, so each staging deploy reports mm-api's CPU time (RB 6).
- [ ] **The watch on the daily allowances** (RB, "The daily allowances"): an Account API Token with Account Analytics: Read and nothing else, as staging's `CLOUDFLARE_ANALYTICS_TOKEN`. Within the hour staging's logs show `daily_allowances_read`.

## 2. Proofs on staging

Each is written up in `docs/verification.md` when it passes. The payment run is what item 8 waits on before self-serve booking goes on in production.

- [ ] **The whole payment path, once, in Razorpay's test mode** (item 91). The owner's number on staging's `MESSAGING_ALLOWLIST` (RB 7); nobody else driving staging's FSM for the hour (item 32); the address typed by hand if item 54 is not fixed yet. Then, in order:
  1. Book a consultation on `/book` with a number FSM has never seen, giving the full address: FSM gets one contact with the pincode on its service address and one work order ending "(booking …)", the CRM a lead, and the logs no `fsm_*_lookup_failed` (item 24).
  2. Sign in at app-staging with the WhatsApp code.
  3. Complete the consultation in FSM (Dispatch, Start Work, Complete Work): within five minutes the app offers the first fit.
  4. Take the first fit to the pay step and let the countdown run out: the slot goes back.
  5. Book again and pay: Checkout opens over the sheet and takes taps; fail once, then pay. `razorpay_events` holds `payment.failed`, `payment.authorized`, `payment.captured` and `order.paid`, each once; the hold is `booked`; FSM has the work order and its appointment; the receipt message arrives.
  6. Within about three hours the receipt opens in the app, and Books shows the payment (item 25).
  7. Move the fit more than 24 hours out: no payment, the same FSM appointment moved, the message arrives.
  8. Move it in the app to tomorrow's first window, then move it again: the ₹4,000 late fee is asked for and paid. Had ops moved it there in FSM instead, the second move would be free, since a move by ops keeps the client's free change (ADR 0096).
  9. Complete the fit: within five minutes the invoice is raised and **sent**, the payment applied in Books, and the app shows the tax invoice. A draft instead is a finding (ruling 46 of ADR 0025).
  10. Book and pay a service visit more than 24 hours out, then cancel it: refunded in full, and the refund reaches Books within the hour.
  11. Book and pay one for tomorrow's first window, then cancel: the payment is kept, and the app says so.
  12. Give the client a credit in the console and book a service visit: "Credit covers it"; cancel it more than 24 hours out and the credit comes back.
  13. Read every open alert (RB, "Alerts and the cron"), check Razorpay's webhook deliveries all succeeded, and list every Zoho record the run made, for item 19's clean-up.
- [ ] **The Zoho calls not yet tried on the org** (items 24 and 25), as each point lists them.
- [ ] **A technician's writes reaching FSM** (item 57): one job each closed as done, partial and no-show, and one reassignment, read back in FSM; the done job's consumables on FSM's summary and out of his kit on the Stock page (ADR 0087). This needs your mobile on your FSM user (item 27).
- [ ] **The field test** (item 72) with the first technician and the owner, on his own phone: it tunes the check-in radius (item 56).
- [ ] **A try-on on a mid-range Android phone over mobile data**, and staging's `alerts` read after a day (item 91).

## 3. The site's release

**Before it:**

- [ ] The home page's material in `site/src/assets`, each block `publish: true` (items 73 to 81), and the production build looked at (`docs/frontend.md`, "Going live in production").
- [ ] Counsel's wording of the privacy page and the terms (items 44 and 149), and the try-on's notices approved (item 146): production's site build refuses `photo-v3` and `gate-v3` until they are (ADR 0104).
- [ ] The Grievance Officer on the privacy page (item 51).
- [ ] The analytics IDs, and the consent banner they need (item 84).
- [ ] The dedicated WhatsApp number (item 38) and `MESSAGING_ENABLED` `"true"` in production's vars (item 164): the try-on's look goes to WhatsApp only, so while it is off the try-on does not run (ADR 0104).
- [ ] Production's AILabTools key and resources (section 1).
- [ ] The outside watchers (RB, "The outside watchers"): production's healthchecks.io check as its `HEARTBEAT_URL`, and an uptime monitor on `https://maneman.in/api/health`. After the release and `apply-triggers`, the check shows a ping every five minutes and `GET /api/health` a `cron_completed_at` a minute old.
- [ ] The daily allowances watched from production (RB, "The daily allowances"): the analytics token put on production as `CLOUDFLARE_ANALYTICS_TOKEN` and deleted from staging (`W secret delete CLOUDFLARE_ANALYTICS_TOKEN --env staging`), so the alerts come once.
- [ ] The zone's table in "The dashboards" (section 4) walked and recorded: this release is the first to need it.
- [ ] **`www.maneman.in` sent to `maneman.in`.** On 2 October 2026 `www` still reached GoDaddy's parked page through an old proxied record: 200 over http, 525 over https. In the Cloudflare dashboard, on `maneman.in`:
  1. **DNS → Records:** replace the `www` record with an `AAAA` record, name `www`, content `100::`, **Proxied**. The address is never reached: Cloudflare answers every request for `www` with the redirect.
  2. **Rules → Redirect Rules → Create rule,** named "www to maneman.in": when the request URL matches the wildcard pattern `https://www.maneman.in/*`, redirect to `https://maneman.in/${1}` with status **301** and **Preserve query string** on.
  3. **Check:** `curl -sI "https://www.maneman.in/book?from=www"` answers `301` with `location: https://maneman.in/book?from=www`, and `curl -sL -o /dev/null -w "%{url_effective}\n" http://www.maneman.in/` prints `https://maneman.in/` once Always Use HTTPS is on.

**The code**, in one pull request through CI and staging: production's `assets.directory` in `site/wrangler.jsonc` pointed at `./dist/production`, a production site build before "Deploy mm-site" in `deploy-production.yml` (`docs/frontend.md`, steps 4 and 5), and the analytics IDs.

**The release:**

- [ ] **Pre-flight** (RB, "Rolling back a Worker version"; RB, "Restoring D1"): `node scripts/release.ts current --worker <mm-api|mm-site> --env production` for each (none mid-rollout), and the D1 bookmark written down: `W d1 time-travel info maneman-prod --env production --timestamp <now>`.
- [ ] **Zoho's answers** (RB, "Checking Zoho's answers before a release"): `node --env-file=.env.books-scripts --env-file=.env.crm-scripts scripts/zoho-contract-probe.ts` ends with no FAIL, and its date and lines are in `docs/verification.md`.
- [ ] **Run `deploy-production.yml`** on the commit that passed staging, with the full 40-character SHA, a canary of 10% and a soak of 300 seconds (ADR 0006). It records every Worker's version, checks the database is production's, uploads mm-api with no traffic, migrates, sends the canary its share and smokes it, soaks, promotes, then ships mm-site. A failure after the canary starts rolls every Worker back; migrations are never rolled back.
- [ ] **After it:** `npm run apply-triggers -- --env production`, then `node --env-file=.env.cf-read scripts/check-triggers.ts production --strict` and the bucket check again (RB 9).
- [ ] **Proofs:** `GET https://maneman.in/api/health` answers production and the release's SHA; `npm run smoke -- --base https://maneman.in --environment production`; a consultation booked on `/book` reaches the CRM as a lead, assigned (RB 8); Web Analytics counts the first day (item 144; RB 14).

With self-serve booking off, a consultation booked on the site is a request: the person, their consent, their address and a CRM lead, which ops answer from the CRM until the console is live (settled item 120).

## 4. The apps' release

**Before it:**

- [ ] The payment run of section 2 passed (item 8).
- [ ] Razorpay live: KYC, live keys, and the live webhook to `https://maneman.in/api/hooks/razorpay` with the nine events of "The dashboards" below (items 5, 6 and 154; RB 11c).
- [ ] The Razorpay and Zoho tables of "The dashboards" below walked on staging and production, each result recorded.
- [ ] The CA's answers, and GST on in Books with the real GSTIN, FSM and Books synced again (items 2, 3, 9, 14, 16, 17 and 26).
- [ ] Counsel's answers (items 22, 23, 40, 41, 55, 63, 69 and 148).
- [ ] The org clean of staging's records before production reads FSM (items 19 and 155).
- [ ] The owner's prices and services in production's console (items 1 and 13); the job sheet's lists, the consumables with their costs, reorder levels and each service's use, and each kit's and the central store's opening count on the Stock page (item 28, ADR 0087).
- [ ] The texts approved (items 39, 41 and 42), and the engineering the rulings still owe (`docs/implementation-plan-2026-09-27.md`).

**Provisioning** (RB 7, 11, 11a, 11b, 11c, 12 and 13):

- [ ] DNS and Access for `app.maneman.in`, `ops.maneman.in` and `tech.maneman.in`, with `mm-ci-production` on each (RB 11, points 1 and 2); `ACCESS_OPS_AUD` for the ops console (RB 11, point 3).
- [ ] Turnstile for the client app's login: add `app.maneman.in` to the hostnames of the `mm-production` widget (Cloudflare dashboard → Turnstile → mm-production → Hostname management). Until then no one can ask for a login code there (`docs/turnstile.md`).
- [ ] FSM and Books: each one's client and its secrets, `setup-fsm.ts --check`, the providers `zoho`, the hosts and `ZOHO_BOOKS_ORG_ID`, and `BOOKS_REFUND_ACCOUNT_ID` of the account "Razorpay" (RB 11b, points 1 to 7).
- [ ] FSM's two webhooks for production, the second for deletion, with a token you keep (item 31; RB 11b, point 6).
- [ ] The rest of production's secrets, each before the release that needs it (RB 7): `OTP_PEPPER` (`openssl rand -hex 32`; the site's WhatsApp codes need it too, so without it the one visit and `/try` cannot prove a number), `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `EVOLUTION_WEBHOOK_TOKEN`, and `GOOGLE_MAPS_API_KEY` once production has its own restricted key (RB 13). A required secret left empty stops every request, so check `GET /api/health` after each.
- [ ] Bootstrap `mm-ops-production` and `mm-tech-production`, and add both to `mm-ci-production` (RB 11, point 6; RB 6).

**The code**, in one pull request: `ENABLED_SURFACES.production` gains the three surfaces, `env.production.routes` their `/api/*` routes, and each app's `wrangler.jsonc` its production route (RB 11, point 4); `env.production.vars` set `FSM_PROVIDER`, `BOOKS_PROVIDER` and `PAYMENTS_PROVIDER` on, `RAZORPAY_KEY_ID` to the live key, `GEOCODE_PROVIDER` `"google"` and `SELF_SERVE_BOOKING` `"true"`; `FSM_CATALOGUE_PUSH.production` `true` (item 11).

**The release:** as the site's, then `npm run apply-triggers -- --env production` to attach the apps' routes (never `W deploy`, RB 11, point 5), and `npm run smoke -- --environment production --surfaces`.

**The owner's live proof, behind Access:** sign in with a real code on the dedicated number; pay a real service visit; see it booked in FSM and its receipt in the app; cancel it more than 24 hours out, and see the refund reach Razorpay, the app and Books. Stop before an invoice is issued, which only a credit note undoes. Then set a price in the console and see `fsm_catalogue_pushed` in the logs and no `fsm_catalogue` alert an hour later (item 25). The same hour's check adds each consumable to FSM's catalogue as a part at Rs. 0: see `fsm_part_added` in the logs, each part in FSM, and Settings · Consumables saying "In FSM" beside each, with no `fsm_catalogue:consumables` alert (ADR 0087).

**Open the doors:** delete the Access applications for `app.maneman.in` and `tech.maneman.in`; the ops console stays behind Access. Read the open alerts after the first day (RB, "Alerts and the cron").

### The dashboards

These settings live only in each vendor's dashboard, where no test can read them. Walk each table, change what differs, and write the date you saw the expected value. Where a row says what was seen on 2 October 2026, that is what has to change.

**The zone, `maneman.in`.** One zone serves staging and production, so it is walked once, in the Cloudflare dashboard.

| Setting               | Where                                                         | Expected                                                                                                                                                       | Checked |
| --------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Always Use HTTPS      | SSL/TLS → Edge Certificates                                   | On. Off on 2 October 2026: `http://maneman.in/` answered 200                                                                                                   |         |
| Minimum TLS version   | SSL/TLS → Edge Certificates                                   | TLS 1.2. Lower on 2 October 2026: a TLS 1.1 handshake was accepted                                                                                             |         |
| Bot Fight Mode        | Security → Settings                                           | Off (ADR 0025, item 12)                                                                                                                                        |         |
| JavaScript detections | Security → Settings                                           | Off (item 111; RB 14, point 1). Every page still carried its script on 2 October 2026                                                                          |         |
| Web Analytics         | Web Analytics → `maneman.in` → Manage site → Advanced options | The beacon on `maneman.in` and `staging.maneman.in` only: a Disable rule for each app, ops and technician host of both environments (item 144; RB 14, point 2) |         |
| `www.maneman.in`      | DNS, and Rules → Redirect Rules                               | A proxied `www` record and the 301 to `https://maneman.in/` (section 3)                                                                                        |         |

**Razorpay.** Staging uses test mode and production live mode, and each mode keeps its own settings. RB 11c has the webhook's steps.

| Setting                  | Expected                                                                                                                                                                                                                                                                               | Staging (test) | Production (live) |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ----------------- |
| The name a client sees   | "Mane Man", on Checkout and on a payment link's page. In test mode on 2 October 2026, a link's page read "Payment Request from ADWATE KUMAR"                                                                                                                                           |                |                   |
| Logo and colour          | The Mane Man mark, `design/brand/mark-navy.svg` exported as a square PNG of at least 256 pixels, and the ink navy `#16233a`                                                                                                                                                            |                |                   |
| The webhook              | Active, on `https://staging.maneman.in/api/hooks/razorpay` or `https://maneman.in/api/hooks/razorpay`, with that environment's `RAZORPAY_WEBHOOK_SECRET`                                                                                                                               |                |                   |
| Its events               | These nine and no others: `order.paid`, `payment.authorized`, `payment.captured`, `payment.failed`, `refund.created`, `refund.processed`, `refund.failed`, `refund.speed_changed` and `payment_link.paid`. Staging received `settlement.processed` on 25 September 2026: switch it off |                |                   |
| Its alert e-mail         | An inbox someone reads every day: Razorpay writes there when the webhook fails                                                                                                                                                                                                         |                |                   |
| Payment capture          | Automatic (item 154)                                                                                                                                                                                                                                                                   |                |                   |
| Payment links            | Enabled (item 166)                                                                                                                                                                                                                                                                     |                |                   |
| Two-factor sign-in       | On for everyone who signs in, and nobody on the team who does not need the dashboard                                                                                                                                                                                                   |                |                   |
| Disputes and chargebacks | One person, named here, reads Razorpay's dispute e-mails and answers each before its deadline                                                                                                                                                                                          |                |                   |

**Zoho Books and the CRM.** Staging and production share one org, so it is walked once; only the refund accounts differ.

| Setting                 | Expected                                                                                                                                                                         | Checked        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Books: "MM person ID"   | A custom field on customers: Text, unique, API name `cf_mm_person_id`                                                                                                            | 2 October 2026 |
| Books: items            | One service item for each service on sale in the console, under the console's name and at the price book's price. Each is made and priced from the console; none is made by hand |                |
| Books: discounts        | At line-item level, before tax (item 181; RB 11b, point 9)                                                                                                                       |                |
| Books: refund accounts  | Bank accounts in INR: "Razorpay – staging test" for staging and "Razorpay" for production, each one's ID that environment's `BOOKS_REFUND_ACCOUNT_ID` (item 10; RB 11b, point 7) |                |
| Books: payment mode     | "Razorpay", under which every payment and refund is recorded                                                                                                                     |                |
| Books: GST              | Off until the CA answers; then on, with the real GSTIN and state, each item's SAC and rate, and the same in `BOOKS_GSTIN`, `BOOKS_GST_STATE`, `BOOKS_SAC` (items 2, 3)           |                |
| Books and the CRM       | Books' Zoho CRM integration: two-way, Contacts only, transaction sync off, duplicates "Skip", and "MM person ID" mapped to a CRM Contacts field. Leads stay Leads (ADR 0110)     |                |
| The CRM's fields        | `setup-crm.ts --check` finds nothing missing, and `check-zoho-setup.ts` passes (item 34; RB 8)                                                                                   |                |
| The CRM's workflow rule | One rule: contact consent becoming true assigns an owner, and nothing fires for "Try-on — delivery only" (item 35; RB 8)                                                         |                |

## Rolling back

The release rolls every Worker back by itself when a check fails after the canary starts. By hand: `node scripts/release.ts restore --env production --message "rollback: <reason>" --to mm-api=<id> …` with the versions the release recorded, then the smoke again (RB, "Rolling back a Worker version"). Migrations are never rolled back; the first release carries every migration since 0004, so a rollback to 268eaa4 runs old code on the new schema, and D1's time travel to the bookmark is the way back for the data (RB, "Restoring D1").
