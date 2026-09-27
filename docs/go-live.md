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
  8. Have ops move it in FSM to under 24 hours away, then move it in the app: the ₹4,000 late fee is asked for and paid.
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
- [ ] Counsel's wording of the privacy page and the terms (items 44 and 149), and the try-on's notices approved (item 146).
- [ ] The Grievance Officer on the privacy page (item 51).
- [ ] The analytics IDs, and the consent banner they need (item 84).
- [ ] The dedicated WhatsApp number (item 38) and `MESSAGING_ENABLED` `"true"` in production's vars, since the try-on sends its result on WhatsApp and the queue sends nothing while it is off.
- [ ] Production's AILabTools key and resources (section 1).

**The code**, in one pull request through CI and staging: production's `assets.directory` in `site/wrangler.jsonc` pointed at `./dist/production`, a production site build before "Deploy mm-site" in `deploy-production.yml` (`docs/frontend.md`, steps 4 and 5), and the analytics IDs.

**The release:**

- [ ] **Pre-flight** (RB, "Rolling back a Worker version"; RB, "Restoring D1"): `node scripts/release.ts current --worker <mm-api|mm-site> --env production` for each (none mid-rollout), and the D1 bookmark written down: `W d1 time-travel info maneman-prod --env production --timestamp <now>`.
- [ ] **Run `deploy-production.yml`** on the commit that passed staging, with the full 40-character SHA, a canary of 10% and a soak of 300 seconds (ADR 0006). It records every Worker's version, checks the database is production's, uploads mm-api with no traffic, migrates, sends the canary its share and smokes it, soaks, promotes, then ships mm-site. A failure after the canary starts rolls every Worker back; migrations are never rolled back.
- [ ] **After it:** `npm run apply-triggers -- --env production`, then `node --env-file=.env.cf-read scripts/check-triggers.ts production --strict` and the bucket check again (RB 9).
- [ ] **Proofs:** `GET https://maneman.in/api/health` answers production and the release's SHA; `npm run smoke -- --base https://maneman.in --environment production`; a consultation booked on `/book` reaches the CRM as a lead, assigned (RB 8); Web Analytics counts the first day (item 144; RB 14).

With self-serve booking off, a consultation booked on the site is a request: the person, their consent, their address and a CRM lead, which ops answer from the CRM until the console is live (settled item 120).

## 4. The apps' release

**Before it:**

- [ ] The payment run of section 2 passed (item 8).
- [ ] Razorpay live: KYC, live keys, the live webhook to `https://maneman.in/api/hooks/razorpay` with the eight events, and automatic capture confirmed for live payments (items 5, 6 and 154; RB 11c).
- [ ] The CA's answers, and GST on in Books with the real GSTIN, FSM and Books synced again (items 2, 3, 9, 14, 16, 17 and 26).
- [ ] Counsel's answers (items 22, 23, 40, 41, 55, 63, 69 and 148).
- [ ] The org clean of staging's records before production reads FSM (items 19 and 155).
- [ ] The owner's prices and services in production's console (items 1 and 13); the job sheet's lists, the consumables with their costs, reorder levels and each service's use, and each kit's and the central store's opening count on the Stock page (item 28, ADR 0087).
- [ ] The texts approved (items 39, 41 and 42), and the engineering the rulings still owe (`docs/implementation-plan-2026-09-27.md`).

**Provisioning** (RB 7, 11, 11a, 11b, 11c, 12 and 13):

- [ ] DNS and Access for `app.maneman.in`, `ops.maneman.in` and `tech.maneman.in`, with `mm-ci-production` on each (RB 11, points 1 and 2); `ACCESS_OPS_AUD` for the ops console (RB 11, point 3).
- [ ] FSM and Books: the client and its secrets, `setup-fsm.ts --check`, the providers `zoho`, the hosts and `ZOHO_BOOKS_ORG_ID`, and `BOOKS_REFUND_ACCOUNT_ID` of the account "Razorpay" (RB 11b, points 1 to 7).
- [ ] FSM's two webhooks for production, the second for deletion, with a token you keep (item 31; RB 11b, point 6).
- [ ] The rest of production's secrets, each before the release that needs it (RB 7): `OTP_PEPPER` (`openssl rand -hex 32`), `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `EVOLUTION_WEBHOOK_TOKEN`, and `GOOGLE_MAPS_API_KEY` once production has its own restricted key (RB 13). A required secret left empty stops every request, so check `GET /api/health` after each.
- [ ] Bootstrap `mm-ops-production` and `mm-tech-production`, and add both to `mm-ci-production` (RB 11, point 6; RB 6).

**The code**, in one pull request: `ENABLED_SURFACES.production` gains the three surfaces, `env.production.routes` their `/api/*` routes, and each app's `wrangler.jsonc` its production route (RB 11, point 4); `env.production.vars` set `FSM_PROVIDER`, `BOOKS_PROVIDER` and `PAYMENTS_PROVIDER` on, `RAZORPAY_KEY_ID` to the live key, `GEOCODE_PROVIDER` `"google"` and `SELF_SERVE_BOOKING` `"true"`; `FSM_CATALOGUE_PUSH.production` `true` (item 11).

**The release:** as the site's, then `npm run apply-triggers -- --env production` to attach the apps' routes (never `W deploy`, RB 11, point 5), and `npm run smoke -- --environment production --surfaces`.

**The owner's live proof, behind Access:** sign in with a real code on the dedicated number; pay a real service visit; see it booked in FSM and its receipt in the app; cancel it more than 24 hours out, and see the refund reach Razorpay, the app and Books. Stop before an invoice is issued, which only a credit note undoes. Then set a price in the console and see `fsm_catalogue_pushed` in the logs and no `fsm_catalogue` alert an hour later (item 25). The same hour's check adds each consumable to FSM's catalogue as a part at Rs. 0: see `fsm_part_added` in the logs, each part in FSM, and Settings · Consumables saying "In FSM" beside each, with no `fsm_catalogue:consumables` alert (ADR 0087).

**Open the doors:** delete the Access applications for `app.maneman.in` and `tech.maneman.in`; the ops console stays behind Access. Read the open alerts after the first day (RB, "Alerts and the cron").

## Rolling back

The release rolls every Worker back by itself when a check fails after the canary starts. By hand: `node scripts/release.ts restore --env production --message "rollback: <reason>" --to mm-api=<id> …` with the versions the release recorded, then the smoke again (RB, "Rolling back a Worker version"). Migrations are never rolled back; the first release carries every migration since 0004, so a rollback to 268eaa4 runs old code on the new schema, and D1's time travel to the bookmark is the way back for the data (RB, "Restoring D1").
